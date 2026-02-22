import { NextRequest, NextResponse } from "next/server";
import type { Bucket } from "firebase-admin/storage";
import { getBucket, getFirestore } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMPORT_PASSWORD = process.env.IMPORT_PASSWORD || "shary@incident";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function toDocId(value: string) {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "_");
}

function nowTs() {
  return Date.now();
}

function pickFirstNonEmpty<T>(...values: T[]): T | "" {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return v;
  }
  return "";
}

function deriveStatusFromState(stateValue: string, fallback?: "open" | "resolved") {
  const s = String(stateValue || "").toLowerCase();
  if (!s) return fallback || "open";
  if (s.includes("resolved") || s.includes("closed")) return "resolved";
  return "open";
}

function parseDateMs(value: any) {
  if (!value) return 0;
  const d = new Date(String(value).trim().replace(" ", "T"));
  const ms = d.getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function dedupeByLatestNumber(list: any[]) {
  const byNumber = new Map<string, any>();
  for (const item of list) {
    const number = pickFirstNonEmpty(item.Number, item.number);
    if (!number) continue;
    const key = String(number);
    const current = byNumber.get(key);
    if (!current) {
      byNumber.set(key, item);
      continue;
    }
    const currentMs = parseDateMs(
      pickFirstNonEmpty(
        current.StateUpdatedAt,
        current.stateUpdatedAt,
        current.Opened,
        current.openedOn,
        current.openedAt,
        current.opened,
        current.Updated,
        current.updatedAt,
        current.Created,
        current.createdAt
      )
    );
    const nextMs = parseDateMs(
      pickFirstNonEmpty(
        item.StateUpdatedAt,
        item.stateUpdatedAt,
        item.Opened,
        item.openedOn,
        item.openedAt,
        item.opened,
        item.Updated,
        item.updatedAt,
        item.Created,
        item.createdAt
      )
    );
    if (nextMs >= currentMs) {
      byNumber.set(key, item);
    }
  }
  return Array.from(byNumber.values());
}

function normalizeItem(item: any, existingData?: any) {
  const resolvedState = pickFirstNonEmpty(
    item.State,
    item.state,
    item["Incident State"],
    item.status,
    existingData?.state
  );
  const resolvedOpenedAt = pickFirstNonEmpty(
    item.Opened,
    item.openedOn,
    item.openedAt,
    item.opened,
    item["Opened At"],
    item["Opened Date"],
    item.Updated,
    item.updatedAt,
    item.Created,
    item.createdAt,
    existingData?.openedAt
  );
  const resolvedDescription = pickFirstNonEmpty(
    item.Description,
    item.description,
    existingData?.description
  );
  const resolvedSummary = pickFirstNonEmpty(item.summary, existingData?.summary);
  const resolvedSummaryStructured = pickFirstNonEmpty(
    item.summaryStructured,
    existingData?.summaryStructured,
    null
  );

  const derivedStatus = deriveStatusFromState(String(resolvedState || ""), existingData?.status);

  return {
    number: item.Number || item.number || "",
    state: String(resolvedState || ""),
    openedAt: String(resolvedOpenedAt || ""),
    description: String(resolvedDescription || ""),
    summary: String(resolvedSummary || ""),
    summaryStructured: resolvedSummaryStructured || null,
    status: derivedStatus,
    raw: item,
  };
}

async function uploadAttachmentsForIncident(bucket: Bucket, incidentNumber: string, attachments: any[]) {
  const uploaded: any[] = [];

  for (const att of attachments || []) {
    const alreadyCdn =
      typeof att?.url === "string" && att.url.includes("firebasestorage.googleapis.com");
    if (alreadyCdn && !att.base64) {
      uploaded.push(att);
      continue;
    }
    if (!att?.base64) continue;

    const fileName = att.fileName || att.name || "attachment";
    // Deterministic path so repeated uploads with the same filename overwrite instead of duplicating.
    const path = `incidents/${incidentNumber}/${fileName}`;
    const buffer = Buffer.from(att.base64, "base64");
    const file = bucket.file(path);
    await file.save(buffer, {
      contentType: att.contentType || "application/octet-stream",
      resumable: false,
      metadata: {
        contentType: att.contentType || undefined,
      },
    });
    const [url] = await file.getSignedUrl({ action: "read", expires: "2099-12-31" });
    uploaded.push({
      fileName,
      size: att.size,
      sizeBytes: att.sizeBytes || buffer.length,
      contentType: att.contentType,
      url,
    });
  }

  return uploaded;
}

async function importIncidents(incidents: any[]) {
  const db = getFirestore();
  const bucket = getBucket();

  const list = dedupeByLatestNumber(incidents || []);
  let created = 0;
  let updated = 0;

  for (const item of list) {
    const number = pickFirstNonEmpty(item.Number, item.number);
    if (!number) continue;

    const id = toDocId(number);
    const docRef = db.collection("incidents").doc(id);
    const snap = await docRef.get();
    const existingData = snap.exists ? snap.data() : null;
    const normalized = normalizeItem(item, existingData);

    const attachments = Array.isArray(item.attachments) ? item.attachments : [];
    const existingCdn = Array.isArray(existingData?.cdnAttachments)
      ? existingData.cdnAttachments
      : [];
    const uploaded = await uploadAttachmentsForIncident(bucket, normalized.number, attachments);
    // Overwrite or add by fileName to avoid duplicate entries.
    const cdnAttachments = [...existingCdn];
    for (const u of uploaded) {
      const idx = cdnAttachments.findIndex((c) => c?.fileName === u.fileName);
      if (idx >= 0) cdnAttachments[idx] = u;
      else cdnAttachments.push(u);
    }

    await docRef.set(
      {
        number: normalized.number,
        state: normalized.state,
        openedAt: normalized.openedAt,
        description: normalized.description,
        summary: normalized.summary,
        summaryStructured: normalized.summaryStructured,
        status: normalized.status,
        raw: normalized.raw,
        cdnAttachments,
        updatedAt: nowTs(),
      },
      { merge: true }
    );

    if (snap.exists) updated += 1;
    else created += 1;
  }

  return { created, updated, total: list.length };
}

function json(data: any, status = 200) {
  return new NextResponse(JSON.stringify(data ?? {}), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

export async function OPTIONS() {
  return json({}, 204);
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const incidents = Array.isArray(payload.incidents) ? payload.incidents : [];
    const password = payload.password || "";

    if (password !== IMPORT_PASSWORD) {
      return json({ error: "Invalid password" }, 401);
    }
    if (!incidents.length) {
      return json({ error: "Missing incidents array" }, 400);
    }

    const result = await importIncidents(incidents);
    return json({ ok: true, ...result });
  } catch (error: any) {
    return json({ error: String(error?.message || error) }, 500);
  }
}

const http = require("http");
require("dotenv").config();
const OpenAIImport = require("openai");
const admin = require("firebase-admin");

const OpenAI = OpenAIImport.default || OpenAIImport;

const PORT = process.env.PORT || 8787;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const IMPORT_PASSWORD = process.env.IMPORT_PASSWORD || "shary@incident";
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || "shary-incidents.appspot.com";
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "";

let firebaseApp = null;

function initFirebaseAdmin() {
  if (firebaseApp) return firebaseApp;

  let credential;
  let projectIdFromCred = "";
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    credential = admin.credential.cert(parsed);
    projectIdFromCred = parsed.project_id || "";
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const json = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    credential = admin.credential.cert(parsed);
    projectIdFromCred = parsed.project_id || "";
  } else {
    credential = admin.credential.applicationDefault();
  }

  firebaseApp = admin.initializeApp({
    credential,
    storageBucket: STORAGE_BUCKET,
    projectId: PROJECT_ID || projectIdFromCred || undefined,
  });

  return firebaseApp;
}

function getFirestore() {
  initFirebaseAdmin();
  return admin.firestore();
}

function getBucket() {
  initFirebaseAdmin();
  return admin.storage().bucket();
}

function toDocId(number) {
  return String(number || "").replace(/[^A-Za-z0-9_-]/g, "_");
}

function nowTs() {
  return Date.now();
}

function pickFirstNonEmpty(...values) {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return v;
  }
  return "";
}

function deriveStatusFromState(stateValue, fallback) {
  const s = String(stateValue || "").toLowerCase();
  if (!s) return fallback || "open";
  if (s.includes("resolved") || s.includes("closed")) return "resolved";
  return "open";
}

function parseDateMs(value) {
  if (!value) return 0;
  const d = new Date(String(value).trim().replace(" ", "T"));
  const ms = d.getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function dedupeByLatestNumber(list) {
  const byNumber = new Map();
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

function normalizeItem(item, existingData) {
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

async function uploadAttachmentsForIncident(bucket, incidentNumber, attachments) {
  const uploaded = [];
  for (const att of attachments || []) {
    const alreadyCdn =
      typeof att?.url === "string" && att.url.includes("firebasestorage.googleapis.com");
    if (alreadyCdn && !att.base64) {
      uploaded.push(att);
      continue;
    }
    if (!att.base64) continue;

    const fileName = att.fileName || att.name || "attachment";
    const path = `incidents/${incidentNumber}/${Date.now()}-${fileName}`;
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

async function importIncidents(incidents) {
  initFirebaseAdmin();
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
    const cdnAttachments = [...existingCdn, ...uploaded];

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

function buildPrompt(incident) {
  return `Summarize the incident using the JSON input below.

Return ONLY valid JSON with this exact schema:
{
  "title": "INC123",
  "what_happened": "string",
  "key_timeline": ["YYYY-MM-DD HH:MM:SS - event", "..."],
  "current_application_state": {
    "status": "string",
    "application_id": "string",
    "presale_no": "string",
    "emirates_id": "string",
    "chassis_no": "string",
    "details": "string"
  },
  "evidence": ["string", "..."],
  "attachments": ["fileName (size) - url", "..."]
}

Rules:
- Use the incident "Number" as the title.
- Explain what happened in plain English, based on detail.activity.
- Timeline: include 3–5 key events only.
- Current state: use applicationData if present; otherwise leave fields empty.
- Evidence: short bullets derived from work notes/field changes.
- Attachments: include uploaded images if present.
- Do not invent anything.

JSON:
${JSON.stringify(incident, null, 2)}`;
}

async function summarizeIncident(client, incident) {
  // Responses API: response_format -> text.format
  const response = await client.responses.create({
    model: MODEL,
    input: [
      {
        role: "system",
        content:
          "You are an operations analyst. Respond ONLY with valid JSON that matches the requested schema. No extra text.",
      },
      { role: "user", content: buildPrompt(incident) },
    ],
    text: {
      format: { type: "json_object" },
    },
  });

  const text = response.output_text || "";

  try {
    return JSON.parse(text);
  } catch {
    return {
      title: incident.Number || incident.number || "",
      what_happened: "",
      key_timeline: [],
      current_application_state: {
        status: "",
        application_id: "",
        presale_no: "",
        emirates_id: "",
        chassis_no: "",
        details: "",
      },
      evidence: [],
      attachments: [],
      error: "Invalid JSON summary",
      raw: text,
    };
  }
}

function sendJson(res, statusCode, data) {
  const body = statusCode === 204 ? "" : JSON.stringify(data ?? {}, null, 2);

  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });

  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    if (req.method === "POST" && req.url === "/summarize") {
      if (!process.env.OPENAI_API_KEY) {
        sendJson(res, 500, { error: "Missing OPENAI_API_KEY" });
        return;
      }

      const raw = await readBody(req);
      const payload = JSON.parse(raw || "{}");
      const incidents = Array.isArray(payload.incidents) ? payload.incidents : [];

      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const summaries = [];
      for (const incident of incidents) {
        const structured = await summarizeIncident(client, incident);

        summaries.push({
          number: incident.Number || incident.number || "",
          // structured is an object (or a fallback object). summary string isn't needed.
          structured,
        });
      }

      sendJson(res, 200, { summaries });
      return;
    }

    if (req.method === "POST" && req.url === "/import") {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || "{}");
      const incidents = Array.isArray(payload.incidents) ? payload.incidents : [];
      const password = payload.password || "";

      if (!incidents.length) {
        sendJson(res, 400, { error: "Missing incidents array" });
        return;
      }
      if (password !== IMPORT_PASSWORD) {
        sendJson(res, 401, { error: "Invalid password" });
        return;
      }

      try {
        const result = await importIncidents(incidents);
        sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        console.error("[/import] failed", error);
        sendJson(res, 500, { error: String(error?.message || error) });
      }
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error("[server] unhandled", error);
    sendJson(res, 500, { error: String(error?.message || error) });
  }
});

server.listen(PORT, () => {
  console.log(`Local LLM server running on http://localhost:${PORT}`);
});

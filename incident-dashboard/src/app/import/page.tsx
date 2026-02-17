"use client";

import { useEffect, useState } from "react";
import { collection, doc, getDocs, setDoc } from "firebase/firestore";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup } from "firebase/auth";
import { auth, db } from "@/lib/firebase";

const PASSWORD = "shary@incident";

function toDocId(number: string) {
  return number.replace(/[^A-Za-z0-9_-]/g, "_");
}

function nowTs() {
  return Date.now();
}

function pickFirstNonEmpty(...values: any[]) {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return v;
  }
  return "";
}

function deriveStatusFromState(stateValue: string, fallback?: "open" | "resolved") {
  const s = (stateValue || "").toLowerCase();
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


export default function ImportPage() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  async function handleGoogleLogin() {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
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
    const resolvedSummary = pickFirstNonEmpty(
      item.summary,
      existingData?.summary
    );
    const resolvedSummaryStructured = pickFirstNonEmpty(
      item.summaryStructured,
      existingData?.summaryStructured,
      null
    );

    const derivedStatus = deriveStatusFromState(
      String(resolvedState || ""),
      existingData?.status
    );

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

  async function handleImport(file: File) {
    setStatus("Importing...");
    const text = await file.text();
    const payload = JSON.parse(text);
    const inputList = Array.isArray(payload) ? payload : payload?.incidents || [];
    const list = dedupeByLatestNumber(inputList);

    const existing = new Set<string>();
    const existingById = new Map<string, any>();
    const existingSnap = await getDocs(collection(db, "incidents"));
    existingSnap.forEach((docSnap) => {
      existing.add(docSnap.id);
      existingById.set(docSnap.id, docSnap.data());
    });

    let created = 0;
    let updated = 0;
    for (const item of list) {
      const idFromItem = toDocId(item.Number || item.number || "");
      const normalized = normalizeItem(item, existingById.get(idFromItem));
      if (!normalized.number) continue;
      const id = toDocId(normalized.number);
      await setDoc(
        doc(db, "incidents", id),
        {
          number: normalized.number,
          state: normalized.state,
          openedAt: normalized.openedAt,
          description: normalized.description,
          summary: normalized.summary,
          summaryStructured: normalized.summaryStructured,
          status: normalized.status,
          raw: normalized.raw,
          updatedAt: nowTs(),
        },
        { merge: true }
      );
      if (existing.has(id)) {
        updated += 1;
      } else {
        created += 1;
      }
    }

    setStatus(
      `Imported ${created} new and updated ${updated} existing incident(s) from ${list.length} unique incidents.`
    );
  }

  if (!user) {
    return (
      <div className="login">
        <div className="login-card">
          <div className="brand">
            <span className="brand-dot" />
            Import Incidents
          </div>
          <div style={{ marginTop: 12 }} className="sidebar-section">
            <button className="button primary" onClick={handleGoogleLogin}>
              Continue with Google
            </button>
            {status && <div className="chip">{status}</div>}
          </div>
        </div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="login">
        <div className="login-card">
          <div className="brand">
            <span className="brand-dot" />
            Import Incidents
          </div>
          <div style={{ marginTop: 12 }} className="sidebar-section">
            <input
              className="input"
              placeholder="Enter password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              className="button primary"
              onClick={() => {
                if (password === PASSWORD) {
                  setAuthed(true);
                  setStatus("");
                } else {
                  setStatus("Invalid password.");
                }
              }}
            >
              Unlock Import
            </button>
            {status && <div className="chip">{status}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand">
          <span className="brand-dot" />
          Import JSON
        </div>
        <div style={{ marginTop: 12 }} className="sidebar-section">
          <input
            className="input"
            type="file"
            accept="application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImport(f);
            }}
          />
          {status && <div className="chip">{status}</div>}
        </div>
      </div>
    </div>
  );
}

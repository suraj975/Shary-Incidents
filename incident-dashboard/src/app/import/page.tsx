"use client";

import { useEffect, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup } from "firebase/auth";
import { auth } from "@/lib/firebase";

const PASSWORD = "shary@incident";

function pickFirstNonEmpty(...values: any[]) {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return v;
  }
  return "";
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

  async function handleImport(file: File) {
    try {
      setStatus("Importing via server…");
      const text = await file.text();
      const payload = JSON.parse(text);
      const inputList = Array.isArray(payload) ? payload : payload?.incidents || [];
      const list = dedupeByLatestNumber(inputList);

      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidents: list, password: PASSWORD }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const msg = data?.error || response.statusText || "Import failed";
        throw new Error(msg);
      }
      setStatus(
        `Uploaded ${data.created || 0} new, ${data.updated || 0} updated (from ${data.total || list.length}).`
      );
    } catch (error: any) {
      setStatus(String(error?.message || error));
    }
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

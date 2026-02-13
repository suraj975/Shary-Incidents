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

  function normalizeItem(item: any) {
    return {
      number: item.Number || item.number || "",
      state: item.State || item.state || "",
      openedAt: item.Opened || item.openedAt || "",
      description: item.Description || item.description || "",
      summary: item.summary || "",
      summaryStructured: item.summaryStructured || null,
      raw: item,
    };
  }

  async function handleImport(file: File) {
    setStatus("Importing...");
    const text = await file.text();
    const payload = JSON.parse(text);
    const list = Array.isArray(payload) ? payload : payload?.incidents || [];

    const existing = new Set<string>();
    const existingSnap = await getDocs(collection(db, "incidents"));
    existingSnap.forEach((docSnap) => existing.add(docSnap.id));

    let count = 0;
    let skipped = 0;
    for (const item of list) {
      const normalized = normalizeItem(item);
      if (!normalized.number) continue;
      const id = toDocId(normalized.number);
      if (existing.has(id)) {
        skipped += 1;
        continue;
      }
      await setDoc(
        doc(db, "incidents", id),
        {
          number: normalized.number,
          state: normalized.state,
          openedAt: normalized.openedAt,
          description: normalized.description,
          summary: normalized.summary,
          summaryStructured: normalized.summaryStructured,
          raw: normalized.raw,
          updatedAt: nowTs(),
        },
        { merge: true }
      );
      count += 1;
    }

    setStatus(`Imported ${count} incident(s). Skipped ${skipped} existing.`);
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

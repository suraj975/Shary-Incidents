"use client";

import { useEffect, useState } from "react";
import { doc, setDoc } from "firebase/firestore";
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

  async function handleImport(file: File) {
    setStatus("Importing...");
    const text = await file.text();
    const payload = JSON.parse(text);
    const list = Array.isArray(payload) ? payload : payload?.incidents || [];

    let count = 0;
    for (const item of list) {
      if (!item.Number) continue;
      const id = toDocId(item.Number);
      await setDoc(
        doc(db, "incidents", id),
        {
          number: item.Number,
          state: item.State || item.state || "",
          openedAt: item.Opened || item.openedAt || "",
          description: item.Description || "",
          summary: item.summary || "",
          summaryStructured: item.summaryStructured || null,
          raw: item,
          updatedAt: nowTs(),
        },
        { merge: true }
      );
      count += 1;
    }

    setStatus(`Imported ${count} incident(s).`);
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

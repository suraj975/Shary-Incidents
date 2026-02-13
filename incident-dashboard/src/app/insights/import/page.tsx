"use client";

import { useEffect, useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
} from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import * as XLSX from "xlsx";
import { buildInsights } from "@/lib/insights";

const PASSWORD = "shary@incident";
const DEFAULT_PATH =
  "/Users/surajsingh/Documents/New project/incident-dashboard/sahry all incidents.xlsx";

function nowTs() {
  return Date.now();
}

export default function InsightsImportPage() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [user, setUser] = useState<any>(null);
  const [serverPath, setServerPath] = useState(DEFAULT_PATH);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  async function handleGoogleLogin() {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  }

  async function writeInsightsPayload(
    insights: any,
    totalRows: number,
    source: string,
    fileName?: string,
  ) {
    const createdAt = nowTs();
    const insightsId = `insights_${createdAt}`;
    await setDoc(doc(db, "insights", insightsId), {
      source,
      createdAt,
      insights,
      totalRows,
      fileName: fileName || "",
    });
    await setDoc(
      doc(db, "insights", "latest"),
      {
        source,
        createdAt,
        insightsId,
        insights,
        totalRows,
        fileName: fileName || "",
      },
      { merge: true },
    );
    setStatus(`Insights updated from ${totalRows} rows.`);
  }

  async function writeInsights(list: any[], source: string, fileName?: string) {
    const insights = buildInsights(list);
    await writeInsightsPayload(insights, list.length, source, fileName);
  }

  async function handleExcelUpload(file: File) {
    setStatus("Processing...");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const list = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as any[];
    await writeInsights(list, "excel-upload", file.name);
  }

  async function handleServerBuild() {
    setStatus("Processing server file...");
    const res = await fetch("/api/insights/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: serverPath }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data?.error || "Failed to build insights.");
      return;
    }
    if (data?.insights && typeof data.totalRows === "number") {
      await writeInsightsPayload(
        data.insights,
        data.totalRows,
        "server-file",
        serverPath.split("/").pop(),
      );
      setStatus(`Insights updated from ${data.totalRows} rows (server file).`);
      return;
    }
    setStatus("Server build completed but no insights returned.");
  }

  if (!user) {
    return (
      <div className="login">
        <div className="login-card">
          <div className="brand">
            <span className="brand-dot" />
            Import Insights
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
            Import Insights
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
          Import Insights (Excel)
        </div>
        <div style={{ marginTop: 12 }} className="sidebar-section">
          <input
            className="input"
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleExcelUpload(f);
            }}
          />
          <div className="chip">Or build from server file (dev only)</div>
          <input
            className="input"
            value={serverPath}
            onChange={(e) => setServerPath(e.target.value)}
          />
          <button className="button primary" onClick={handleServerBuild}>
            Build Insights from Server File
          </button>
          {status && <div className="chip">{status}</div>}
        </div>
      </div>
    </div>
  );
}

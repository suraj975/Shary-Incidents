"use client";

import { useEffect, useMemo, useState } from "react";
import {
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { Comment, CommentType, Incident, SummaryStructured } from "@/lib/types";

const threeDaysMs = 3 * 24 * 60 * 60 * 1000;

function parseOpenedAt(value?: string) {
  if (!value) return null;
  const dt = new Date(value.replace(" ", "T"));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function nowTs() {
  return Date.now();
}

function renderSummary(structured?: SummaryStructured | null, fallback?: string) {
  if (structured) {
    return (
      <>
          <div className="summary-block">
          <div className="summary-title">What Happened</div>
          <div className="summary-text">{structured.what_happened || "—"}</div>
        </div>
        <div className="summary-block">
          <div className="summary-title">Key Timeline</div>
          <ul className="timeline">
            {(structured.key_timeline || []).map((t, i) => (
              <li key={i}>{t}</li>
            ))}
            {(!structured.key_timeline || structured.key_timeline.length === 0) && (
              <li>—</li>
            )}
          </ul>
        </div>
        <div className="summary-block">
          <div className="summary-title">Current Application State</div>
          <div className="summary-text">
            {structured.current_application_state || "—"}
          </div>
        </div>
        <div className="summary-block">
          <div className="summary-title">Evidence</div>
          <ul className="timeline">
            {(structured.evidence || []).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
            {(!structured.evidence || structured.evidence.length === 0) && <li>—</li>}
          </ul>
        </div>
        <div className="summary-block">
          <div className="summary-title">Attachments</div>
          <ul className="timeline">
            {(structured.attachments || []).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
            {(!structured.attachments || structured.attachments.length === 0) && <li>—</li>}
          </ul>
        </div>
      </>
    );
  }

  if (!fallback) return <div className="chip">No summary available.</div>;

  const lines = fallback.split(/\r?\n/);
  const sections: { title: string; body: string[] }[] = [];
  let current = { title: "Summary", body: [] as string[] };
  const headingRegex =
    /^-\s*(What happened|Key timeline|Current application state|Evidence(?:.*)?|Attachments)\s*:\s*$/i;

  for (const line of lines) {
    const match = line.trim().match(headingRegex);
    if (match) {
      if (current.body.length || current.title) sections.push(current);
      current = { title: match[1], body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.body.length || current.title) sections.push(current);

  return (
    <>
      {sections.map((s, idx) => (
        <div key={idx} className="summary-block">
          <div className="summary-title">{s.title}</div>
          <div className="summary-text">{s.body.join("\n").trim()}</div>
        </div>
      ))}
    </>
  );
}

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [tab, setTab] = useState<"summary" | "app" | "log">("summary");
  const [comments, setComments] = useState<Comment[]>([]);
  const [logs, setLogs] = useState<
    { id: string; text: string; createdAt: number; authorName?: string }[]
  >([]);
  const [commentText, setCommentText] = useState("");
  const [commentType, setCommentType] = useState<CommentType>("ops");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = collection(db, "incidents");
    const unsub = onSnapshot(q, (snap) => {
      const items: Incident[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as any;
        items.push({
          id: docSnap.id,
          number: data.number,
          state: data.state,
          openedAt: data.openedAt,
          description: data.description,
          summary: data.summary,
          summaryStructured: data.summaryStructured || null,
          raw: data.raw,
          status: data.status || "open",
          callAttempts: data.callAttempts || 0,
          noAnswerCount: data.noAnswerCount || 0,
          updatedAt: data.updatedAt || 0,
        });
      });
      items.sort((a, b) => {
        const da = parseOpenedAt(a.openedAt)?.getTime() || 0;
        const dbt = parseOpenedAt(b.openedAt)?.getTime() || 0;
        if (dbt !== da) return dbt - da;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
      setIncidents(items);
      if (!activeId && items.length) setActiveId(items[0].id);
    });
    return () => unsub();
  }, [user, activeId]);

  const activeIncident = useMemo(
    () => incidents.find((i) => i.id === activeId) || null,
    [incidents, activeId]
  );

  const applicationDetails = useMemo(() => {
    const raw = (activeIncident?.raw as any) || {};
    const app = raw.applicationData || {};
    const keys = raw.applicationKeys || {};
    const merged: Record<string, string> = {};

    const add = (label: string, value: any) => {
      if (value === undefined || value === null) return;
      const str = String(value).trim();
      if (!str) return;
      merged[label] = str;
    };

    add("Number", raw.Number || activeIncident?.number);
    add("State", raw.State || activeIncident?.state);
    add("Opened", raw.Opened || activeIncident?.openedAt);
    add("Reported For", raw["Reported For"]);
    add("Assignment Group", raw["Assignment Group"]);
    add("ApplicationId", keys.applicationId);
    add("EmiratesId", keys.emiratesId);
    add("Presale No", keys.presaleNo);
    add("Chassis No", keys.chassisNo);

    Object.entries(app).forEach(([k, v]) => add(k, v));
    return merged;
  }, [activeIncident]);

  useEffect(() => {
    if (!activeIncident) return;
    const q = collection(db, "incidents", activeIncident.id, "comments");
    const unsub = onSnapshot(q, (snap) => {
      const items: Comment[] = [];
      snap.forEach((d) => {
        const data = d.data() as any;
        items.push({
          id: d.id,
          text: data.text,
          type: data.type,
          authorName: data.authorName,
          authorUid: data.authorUid,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        });
      });
      items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setComments(items);
    });
    return () => unsub();
  }, [activeIncident]);

  useEffect(() => {
    if (!activeIncident) return;
    const q = collection(db, "incidents", activeIncident.id, "logs");
    const unsub = onSnapshot(q, (snap) => {
      const items: { id: string; text: string; createdAt: number; authorName?: string }[] = [];
      snap.forEach((d) => {
        const data = d.data() as any;
        items.push({
          id: d.id,
          text: data.text,
          createdAt: data.createdAt,
          authorName: data.authorName,
        });
      });
      items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setLogs(items);
    });
    return () => unsub();
  }, [activeIncident]);

  async function addLog(text: string) {
    if (!activeIncident || !user) return;
    await addDoc(collection(db, "incidents", activeIncident.id, "logs"), {
      text,
      createdAt: nowTs(),
      authorName: user.email || "User",
      authorUid: user.uid,
    });
  }

  async function handleGoogleLogin() {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  }

  async function handleLogout() {
    await signOut(auth);
  }


  async function addComment() {
    if (!activeIncident || !commentText.trim() || !user) return;
    await addDoc(collection(db, "incidents", activeIncident.id, "comments"), {
      text: commentText.trim(),
      type: commentType,
      authorName: user.email || "User",
      authorUid: user.uid,
      createdAt: nowTs(),
      updatedAt: nowTs(),
    });
    await addLog(`Comment added (${commentType.toUpperCase()}).`);
    setCommentText("");
  }

  async function saveCommentEdit(id: string) {
    if (!activeIncident) return;
    await updateDoc(doc(db, "incidents", activeIncident.id, "comments", id), {
      text: editingText.trim(),
      updatedAt: nowTs(),
    });
    await addLog("Comment edited.");
    setEditingCommentId(null);
    setEditingText("");
  }

  async function removeComment(id: string) {
    if (!activeIncident) return;
    await deleteDoc(doc(db, "incidents", activeIncident.id, "comments", id));
    await addLog("Comment deleted.");
  }

  async function updateCounts(field: "callAttempts" | "noAnswerCount", delta: number) {
    if (!activeIncident) return;
    const next = Math.max(0, (activeIncident[field] || 0) + delta);
    await updateDoc(doc(db, "incidents", activeIncident.id), {
      [field]: next,
      updatedAt: nowTs(),
    });
    await addLog(
      `${field === "callAttempts" ? "Calls" : "Didn’t pick up"}: ${next}`
    );
  }

  async function toggleResolved() {
    if (!activeIncident) return;
    const nextStatus = activeIncident.status === "resolved" ? "open" : "resolved";
    await updateDoc(doc(db, "incidents", activeIncident.id), {
      status: nextStatus,
      updatedAt: nowTs(),
    });
    await addLog(
      nextStatus === "resolved" ? "Marked resolved." : "Marked unresolved."
    );
  }

  if (!user) {
    return (
      <div className="login">
        <div className="login-card">
          <div className="brand">
            <span className="brand-dot" />
            Shary Incidents Dashboard
          </div>
          <div style={{ marginTop: 12 }} className="sidebar-section">
            <button className="button primary" onClick={handleGoogleLogin}>
              Continue with Google
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <aside className="panel sidebar">
        <div className="brand">
          <span className="brand-dot" />
          Shary Incidents
        </div>

        <div className="sidebar-section">
          <div className="chip">Logged in as {user.email}</div>
          <button className="button" onClick={handleLogout}>
            Log out
          </button>
        </div>

        <div className="sidebar-section">
          <label className="section-title">Import Incidents</label>
          <div className="chip">Open /import to upload JSON</div>
        </div>

        <div className="sidebar-section">
          <label className="section-title">Incidents</label>
          <div className="list">
            {incidents.map((i) => {
              const opened = parseOpenedAt(i.openedAt);
              const isUrgent = opened
                ? Date.now() - opened.getTime() > threeDaysMs
                : false;
              return (
                <div
                  key={i.id}
                  className={`incident-card ${
                    i.id === activeId ? "active" : ""
                  } ${isUrgent ? "urgent" : ""} ${
                    i.status === "resolved" ? "resolved" : ""
                  }`}
                  onClick={() => setActiveId(i.id)}
                >
                  <div style={{ fontWeight: 700 }}>{i.number}</div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>
                    {i.state || "—"} | {i.openedAt || "—"}
                  </div>
                </div>
              );
            })}
            {incidents.length === 0 && (
              <div className="chip">No incidents in Firestore.</div>
            )}
          </div>
        </div>
      </aside>

      <main className="panel main">
        <div className="topbar">
          <div>
            <div className="section-title">Incident</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              {activeIncident?.number || "Select an incident"}
            </div>
          </div>
          <div className="tabs">
            <div
              className={`tab ${tab === "summary" ? "active" : ""}`}
              onClick={() => setTab("summary")}
            >
              Summary
            </div>
            <div
              className={`tab ${tab === "app" ? "active" : ""}`}
              onClick={() => setTab("app")}
            >
              Application Details
            </div>
            <div
              className={`tab ${tab === "log" ? "active" : ""}`}
              onClick={() => setTab("log")}
            >
              Activity Log
            </div>
          </div>
        </div>

        <div className="content">
          <section className="card">
            {tab === "summary" ? (
              activeIncident ? (
                renderSummary(activeIncident.summaryStructured, activeIncident.summary)
              ) : (
                <div className="chip">Select an incident to view summary.</div>
              )
            ) : tab === "app" && activeIncident ? (
              <>
                <div className="summary-block">
                  <div className="section-title">Application Details</div>
                  <div className="kv-grid">
                    {Object.entries(applicationDetails).map(([k, v]) => (
                      <div key={k} className="kv-row">
                        <div className="key">{k}</div>
                        <div className="value">{v}</div>
                      </div>
                    ))}
                    {Object.keys(applicationDetails).length === 0 && (
                      <div className="chip">No application details found.</div>
                    )}
                  </div>
                </div>
              </>
            ) : tab === "log" ? (
              activeIncident ? (
                <>
                  <div className="summary-block">
                    <div className="section-title">Activity Log</div>
                    {logs.map((l) => (
                      <div key={l.id} className="comment">
                        <div className="comment-header">
                          <div>
                            {new Date(l.createdAt).toLocaleString()} •{" "}
                            {l.authorName || "User"}
                          </div>
                        </div>
                        <div style={{ marginTop: 6 }}>{l.text}</div>
                      </div>
                    ))}
                    {logs.length === 0 && <div className="chip">No log entries yet.</div>}
                  </div>
                </>
              ) : (
                <div className="chip">Select an incident to view logs.</div>
              )
            ) : (
              <div className="chip">Select an incident to view application details.</div>
            )}
          </section>

          <section className="card">
            {activeIncident ? (
              <>
                <div className="section-title">Operations Controls</div>
                <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                  <button
                    className={`button primary ${
                      activeIncident.status === "resolved" ? "resolved" : ""
                    }`}
                    onClick={toggleResolved}
                  >
                    {activeIncident.status === "resolved"
                      ? "Mark Unresolved"
                      : "Mark Resolved"}
                  </button>
                  <div className="count-box">
                    <div className="chip">Calls</div>
                    <button className="button" onClick={() => updateCounts("callAttempts", -1)}>-</button>
                    <button className="button" onClick={() => updateCounts("callAttempts", 1)}>+</button>
                    <div className="count">{activeIncident.callAttempts || 0}</div>
                  </div>
                  <div className="count-box">
                    <div className="chip">Didn’t Pick Up</div>
                    <button className="button" onClick={() => updateCounts("noAnswerCount", -1)}>-</button>
                    <button className="button" onClick={() => updateCounts("noAnswerCount", 1)}>+</button>
                    <div className="count">{activeIncident.noAnswerCount || 0}</div>
                  </div>
                </div>

                <div style={{ marginTop: 16 }}>
                  <div className="section-title">Add Comment</div>
                  <select
                    className="select"
                    value={commentType}
                    onChange={(e) => setCommentType(e.target.value as CommentType)}
                  >
                    <option value="ops">Operations Comment</option>
                    <option value="pm">Project Manager Comment</option>
                    <option value="dev">Developer Comment</option>
                  </select>
                  <textarea
                    className="textarea"
                    rows={4}
                    placeholder="Add your update..."
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    style={{ marginTop: 8 }}
                  />
                  <button className="button" onClick={addComment} style={{ marginTop: 8 }}>
                    Add Comment
                  </button>
                </div>

                <div style={{ marginTop: 16 }}>
                  <div className="section-title">Comments</div>
                  {comments.map((c) => (
                    <div key={c.id} className="comment">
                      <div className="comment-header">
                        <div>
                          {c.authorName} • {c.type.toUpperCase()} • {new Date(c.createdAt).toLocaleString()}
                        </div>
                        <div className="comment-actions">
                          {editingCommentId === c.id ? (
                            <>
                              <button className="button" onClick={() => saveCommentEdit(c.id)}>Save</button>
                              <button className="button" onClick={() => { setEditingCommentId(null); setEditingText(""); }}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button className="button" onClick={() => { setEditingCommentId(c.id); setEditingText(c.text); }}>Edit</button>
                              <button className="button danger" onClick={() => removeComment(c.id)}>Delete</button>
                            </>
                          )}
                        </div>
                      </div>
                      {editingCommentId === c.id ? (
                        <textarea
                          className="textarea"
                          rows={3}
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          style={{ marginTop: 8 }}
                        />
                      ) : (
                        <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{c.text}</div>
                      )}
                    </div>
                  ))}
                  {comments.length === 0 && <div className="chip">No comments yet.</div>}
                </div>

              </>
            ) : (
              <div className="chip">Select an incident to manage operations.</div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

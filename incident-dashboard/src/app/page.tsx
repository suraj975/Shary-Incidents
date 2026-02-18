"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
const COMMENT_MAX_LENGTH = 500;
const QUICK_COMMENT_TEMPLATES = [
  "Called user",
  "No answer",
  "Waiting for user",
  "Escalated to Ops",
];

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
            {(() => {
              const state = structured.current_application_state;
              if (!state) return "—";
              if (typeof state === "string") return state;
              if (typeof state === "object") {
                const entries = Object.entries(state);
                if (entries.length === 0) return "—";
                return (
                  <ul className="timeline">
                    {entries.map(([k, v]) => (
                      <li key={k}>
                        <strong>{k.replace(/_/g, " ")}:</strong>{" "}
                        {typeof v === "string" ? v : JSON.stringify(v)}
                      </li>
                    ))}
                  </ul>
                );
              }
              return String(state);
            })()}
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
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [incidentQuery, setIncidentQuery] = useState("");
  const [incidentFilter, setIncidentFilter] = useState<
    "all" | "assigned" | "resolved" | "in_progress" | "hold"
  >("all");
  const [opsDrawerOpen, setOpsDrawerOpen] = useState(false);
  const commentChars = commentText.length;
  const isCommentValid = commentText.trim().length > 0 && commentChars <= COMMENT_MAX_LENGTH;

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
            opsHelp: data.opsHelp || false,
            updatedAt: data.updatedAt || 0,
          });
      });
      items.sort((a, b) => {
        const aOps = !!a.opsHelp;
        const bOps = !!b.opsHelp;
        if (aOps !== bOps) return aOps ? -1 : 1;

        const aResolved = a.status === "resolved";
        const bResolved = b.status === "resolved";
        if (aResolved !== bResolved) return aResolved ? 1 : -1;

        const da = parseOpenedAt(a.openedAt)?.getTime();
        const dbt = parseOpenedAt(b.openedAt)?.getTime();
        if (da != null && dbt != null && dbt !== da) return dbt - da;
        if (da == null && dbt != null) return 1;
        if (da != null && dbt == null) return -1;

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

  const filteredIncidents = useMemo(() => {
    const query = incidentQuery.trim().toLowerCase();
    return incidents.filter((i) => {
      const state = (i.state || "").toLowerCase();
      const status = (i.status || "").toLowerCase();
      let passesFilter = true;
      if (incidentFilter === "resolved") {
        passesFilter = status === "resolved" || state === "resolved";
      } else if (incidentFilter === "assigned") {
        passesFilter = status !== "resolved" && state.includes("assigned");
      } else if (incidentFilter === "in_progress") {
        passesFilter = status !== "resolved" && state.includes("in progress");
      } else if (incidentFilter === "hold") {
        passesFilter = status !== "resolved" && state.includes("hold");
      }
      if (!passesFilter) return false;
      if (!query) return true;
      const hay = [
        i.number,
        i.state,
        i.openedAt,
        i.description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(query);
    });
  }, [incidents, incidentQuery, incidentFilter]);

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
    setOpsDrawerOpen(false);
  }, [activeId]);

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
    if (!activeIncident || !isCommentValid || !user) return;
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

  useEffect(() => {
    commentInputRef.current?.focus();
  }, [commentType]);

  function applyTemplate(template: string) {
    setCommentText((prev) => (prev.trim() ? `${prev}\n${template}` : template));
    commentInputRef.current?.focus();
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

  async function toggleOpsHelp() {
    if (!activeIncident) return;
    const next = !activeIncident.opsHelp;
    await updateDoc(doc(db, "incidents", activeIncident.id), {
      opsHelp: next,
      updatedAt: nowTs(),
    });
    await addLog(next ? "Ops help requested." : "Ops help cleared.");
  }

  const operationsPanel = activeIncident ? (
    <>
      <div className="section-title">Operations Controls</div>
      <div className="ops-layout">
        <div className="ops-section">
          <div className="ops-heading">Incident Status</div>
          <div className="status-list">
            <div className="status-row status-state-row">
              <span className="status-key">State</span>
              <span className="status-value status-state-value">
                {activeIncident.state || "In Progress"}
              </span>
            </div>
            <div className="status-row status-status-row">
              <span className="status-key">Status</span>
              <span
                className={`status-value ${
                  activeIncident.status === "resolved"
                    ? "status-resolved-value"
                    : "status-open-value"
                }`}
              >
                {activeIncident.status === "resolved" ? "Resolved" : "Open"}
              </span>
            </div>
            <div className="status-row status-ops-row">
              <span className="status-key">Ops Help</span>
              <span
                className={`status-value ${
                  activeIncident.opsHelp
                    ? "status-ops-requested-value"
                    : "status-ops-idle-value"
                }`}
              >
                {activeIncident.opsHelp ? "Requested" : "Not Requested"}
              </span>
            </div>
          </div>
          <div className="ops-action-grid status-actions">
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
            <button
              className={`button ${activeIncident.opsHelp ? "danger" : "warning"}`}
              onClick={toggleOpsHelp}
            >
              {activeIncident.opsHelp ? "Remove Ops Flag" : "Request Ops Help"}
            </button>
          </div>
        </div>

        <div className="ops-section">
          <div className="ops-heading">Contact Attempts</div>
          <div className="attempt-grid">
            <div className="attempt-card attempt-calls">
              <div className="attempt-title">Calls</div>
              <div className="attempt-value">{activeIncident.callAttempts || 0}</div>
              <div className="attempt-controls">
                <button
                  className="button icon-button icon-minus"
                  onClick={() => updateCounts("callAttempts", -1)}
                  aria-label="Decrease calls"
                >
                  -
                </button>
                <button
                  className="button icon-button icon-plus"
                  onClick={() => updateCounts("callAttempts", 1)}
                  aria-label="Increase calls"
                >
                  +
                </button>
              </div>
            </div>
            <div className="attempt-card attempt-no-answer">
              <div className="attempt-title">Didn’t Pick Up</div>
              <div className="attempt-value">{activeIncident.noAnswerCount || 0}</div>
              <div className="attempt-controls">
                <button
                  className="button icon-button icon-minus"
                  onClick={() => updateCounts("noAnswerCount", -1)}
                  aria-label="Decrease no answer count"
                >
                  -
                </button>
                <button
                  className="button icon-button icon-plus"
                  onClick={() => updateCounts("noAnswerCount", 1)}
                  aria-label="Increase no answer count"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="ops-section ops-section-spaced">
        <div className="ops-heading">Comment Composer</div>
        <select
          className="select"
          value={commentType}
          onChange={(e) => setCommentType(e.target.value as CommentType)}
        >
          <option value="ops">Operations Comment</option>
          <option value="pm">Project Manager Comment</option>
          <option value="dev">Developer Comment</option>
        </select>
        <div className="template-row">
          {QUICK_COMMENT_TEMPLATES.map((template) => (
            <button
              key={template}
              className="button template-chip"
              onClick={() => applyTemplate(template)}
            >
              {template}
            </button>
          ))}
        </div>
        <textarea
          ref={commentInputRef}
          className="textarea"
          rows={4}
          maxLength={COMMENT_MAX_LENGTH}
          placeholder="Add your update..."
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          style={{ marginTop: 8 }}
        />
        <div className="char-counter">
          {commentChars}/{COMMENT_MAX_LENGTH}
        </div>
        <button
          className="button comment-submit"
          onClick={addComment}
          disabled={!isCommentValid}
        >
          Add Comment
        </button>
      </div>

      <div className="ops-section ops-section-spaced">
        <div className="ops-heading">Comment Timeline</div>
        {comments.map((c) => (
          <div key={c.id} className="comment">
            <div className="comment-header">
              <div className="comment-meta">
                <div className="comment-avatar">
                  {(c.authorName || "U").slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <div className="comment-author-row">
                    <span>{c.authorName || "User"}</span>
                    <span className={`role-tag role-${c.type}`}>
                      {c.type.toUpperCase()}
                    </span>
                  </div>
                  <div>{new Date(c.createdAt).toLocaleString()}</div>
                </div>
              </div>
              <div className="comment-actions">
                {editingCommentId === c.id ? (
                  <>
                    <button className="button" onClick={() => saveCommentEdit(c.id)}>Save</button>
                    <button className="button" onClick={() => { setEditingCommentId(null); setEditingText(""); }}>Cancel</button>
                  </>
                ) : (
                  <details className="comment-menu">
                    <summary className="button icon-button menu-trigger" aria-label="Comment actions">
                      ...
                    </summary>
                    <div className="comment-menu-list">
                      <button
                        className="menu-item"
                        onClick={() => {
                          setEditingCommentId(c.id);
                          setEditingText(c.text);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="menu-item danger-text"
                        onClick={() => removeComment(c.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </details>
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
  );

  if (!user) {
    return (
      <div className="login">
        <div className="login-card">
          <div className="brand">
            <span className="brand-dot" />
            <div>
              <div className="login-title">Shary Incidents</div>
              <div className="login-subtitle">
                Secure operations dashboard for incident tracking and case follow‑up.
              </div>
            </div>
          </div>
          <div className="login-actions">
            <button className="google-button" onClick={handleGoogleLogin}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#0b0e14"
                  d="M12 10.2v3.6h5.05c-.2 1.25-1.5 3.66-5.05 3.66-3.05 0-5.54-2.52-5.54-5.62 0-3.1 2.49-5.62 5.54-5.62 1.73 0 2.9.74 3.56 1.38l2.42-2.34C16.52 3.64 14.46 2.6 12 2.6 6.9 2.6 2.76 6.77 2.76 11.84 2.76 16.9 6.9 21.08 12 21.08c6.93 0 8.63-4.85 8.63-7.4 0-.5-.06-.88-.12-1.27H12z"
                />
              </svg>
              Continue with Google
            </button>
            <div className="login-note">
              Use your company Gmail account to continue.
            </div>
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
          <Link className="button" href="/insights">
            Insights
          </Link>
        </div>

        <div className="sidebar-section">
          <label className="section-title">Import Incidents</label>
          <div className="chip">Open /import to upload JSON</div>
        </div>

        <div className="sidebar-section">
          <label className="section-title">Incidents</label>
          <div className="incident-controls">
            <div className="incident-tabs">
              <button
                className={`incident-tab ${
                  incidentFilter === "all" ? "active" : ""
                }`}
                onClick={() => setIncidentFilter("all")}
              >
                All
              </button>
              <button
                className={`incident-tab ${
                  incidentFilter === "assigned" ? "active" : ""
                }`}
                onClick={() => setIncidentFilter("assigned")}
              >
                Assigned
              </button>
              <button
                className={`incident-tab ${
                  incidentFilter === "resolved" ? "active" : ""
                }`}
                onClick={() => setIncidentFilter("resolved")}
              >
                Resolved
              </button>
              <button
                className={`incident-tab ${
                  incidentFilter === "in_progress" ? "active" : ""
                }`}
                onClick={() => setIncidentFilter("in_progress")}
              >
                In Progress
              </button>
              <button
                className={`incident-tab ${
                  incidentFilter === "hold" ? "active" : ""
                }`}
                onClick={() => setIncidentFilter("hold")}
              >
                Hold
              </button>
            </div>
            <div className="incident-search">
              <input
                className="incident-search-input"
                placeholder="Search incidents..."
                value={incidentQuery}
                onChange={(e) => setIncidentQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="list">
            {filteredIncidents.map((i) => {
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
                  <div className="incident-card-header">
                    <div className="incident-number">{i.number}</div>
                    <div className="incident-pill-group">
                      {i.opsHelp ? (
                        <div className="incident-pill pill-ops">Ops Help</div>
                      ) : null}
                      <div
                        className={`incident-pill ${
                          i.status === "resolved"
                            ? "pill-resolved"
                            : isUrgent
                            ? "pill-urgent"
                            : "pill-open"
                        }`}
                      >
                        {i.status === "resolved" ? "Resolved" : i.state || "—"}
                      </div>
                    </div>
                  </div>
                  <div className="incident-meta">
                    <span className="incident-meta-label">Opened</span>
                    <span className="incident-meta-value">
                      {i.openedAt || "—"}
                    </span>
                  </div>
                </div>
              );
            })}
            {filteredIncidents.length === 0 && (
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

          <section className="card ops-card ops-desktop-card">
            {operationsPanel}
          </section>
        </div>

        <button
          className="button primary ops-drawer-fab"
          onClick={() => setOpsDrawerOpen(true)}
        >
          Operations
        </button>
      </main>

      {opsDrawerOpen ? (
        <div className="ops-drawer-backdrop" onClick={() => setOpsDrawerOpen(false)}>
          <div className="panel ops-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="ops-drawer-header">
              <div className="section-title">Operations Controls</div>
              <button className="button" onClick={() => setOpsDrawerOpen(false)}>
                Close
              </button>
            </div>
            <div className="ops-drawer-body">{operationsPanel}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

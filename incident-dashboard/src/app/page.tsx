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
import { ref, uploadString, getDownloadURL } from "firebase/storage";
import { auth, db, storage } from "@/lib/firebase";
import type { Comment, CommentType, Incident, SummaryStructured, Attachment } from "@/lib/types";

function AttachmentCard({
  att,
  previewSrc,
  openHref,
  onPreview,
}: {
  att: Attachment;
  previewSrc?: string;
  openHref?: string;
  onPreview: () => void;
}) {
  const size = att.sizeBytes
    ? `${Math.round(att.sizeBytes / 1024)} KB`
    : att.size || "";
  const label = att.fileName || att.name || "Attachment";
  const href = openHref || att.url || att.href || att.link || "";
  const isImage = (att.contentType || "").startsWith("image") ||
    (/\.(png|jpe?g|gif|webp|bmp)$/i.test(label) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(href));
  const effectiveHref = previewSrc || href;

  return (
    <div className="attachment-card">
      {isImage ? (
        <div
          className="attachment-thumb"
          style={{ backgroundImage: previewSrc ? `url(${previewSrc})` : undefined }}
        >
          {!previewSrc && <div className="attachment-thumb-placeholder">IMG</div>}
        </div>
      ) : null}
      <div className="attachment-name">{label}</div>
      <div className="attachment-meta">{size || ""}</div>
      {isImage ? (
        <button className="attachment-link" onClick={onPreview}>
          View
        </button>
      ) : effectiveHref ? (
        <a className="attachment-link" href={effectiveHref} target="_blank" rel="noreferrer">
          Open
        </a>
      ) : null}
    </div>
  );
}

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

async function resolveStorageUrl(rawUrl: string) {
  if (!rawUrl || !rawUrl.includes("firebasestorage.googleapis.com")) return rawUrl;
  if (rawUrl.includes("token=")) return rawUrl;

  const nameMatch = rawUrl.match(/[?&]name=([^&]+)/);
  const encodedPathMatch = rawUrl.match(/\/o\/([^?]+)/);
  const path =
    (nameMatch ? decodeURIComponent(nameMatch[1]) : null) ||
    (encodedPathMatch ? decodeURIComponent(encodedPathMatch[1]) : null);

  if (!path) return rawUrl;

  try {
    const storageRef = ref(storage, path);
    return await getDownloadURL(storageRef);
  } catch {
    // If we cannot resolve to a signed URL, return empty so callers can avoid CORS hits.
    return "";
  }
}

function renderSummary(structured?: SummaryStructured | null, fallback?: string, fallbackRaw?: any) {
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

  // If fallback looks like JSON, pretty-print it so raw objects don't show as one huge line.
  let text = fallback;
  if (!fallback.trim().includes("\n") && fallback.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(fallback);
      text = JSON.stringify(parsed, null, 2);
    } catch {
      text = fallback;
    }
  }

  // If a structured summary exists inside raw but not promoted, use it.
  if (!structured && fallbackRaw && typeof fallbackRaw === "object") {
    const maybeStructured = (fallbackRaw as any).summaryStructured || (fallbackRaw as any).summary_structured;
    if (maybeStructured && typeof maybeStructured === "object") {
      return renderSummary(maybeStructured as any, undefined, undefined);
    }
  }

  const lines = text.split(/\r?\n/);
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
  const [tab, setTab] = useState<"summary" | "app" | "log" | "attachments">("summary");
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
  const [attachmentPreviews, setAttachmentPreviews] = useState<Record<string, string>>({});
  const [attachmentLinks, setAttachmentLinks] = useState<Record<string, string>>({});
  const [attachmentModal, setAttachmentModal] = useState<{ open: boolean; src: string; name: string }>({
    open: false,
    src: "",
    name: "",
  });
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const commentChars = commentText.length;
  const isCommentValid = commentText.trim().length > 0 && commentChars <= COMMENT_MAX_LENGTH;
  const [hasUnsignedAttachments, setHasUnsignedAttachments] = useState(false);

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
            cdnAttachments: data.cdnAttachments || [],
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

  const attachmentList = useMemo<Attachment[]>(() => {
    const raw = (activeIncident?.raw as any) || {};
    const detailAttachments: Attachment[] = Array.isArray(raw.attachments)
      ? raw.attachments
      : [];
    const cdn = Array.isArray(activeIncident?.cdnAttachments) ? activeIncident?.cdnAttachments : [];

    const summaryAttachments = Array.isArray(activeIncident?.summaryStructured?.attachments)
      ? activeIncident?.summaryStructured?.attachments
      : [];

    const parsedSummary: Attachment[] = summaryAttachments
      .map((item: string) => {
        const match = item.match(/\(([^)]+)\)\s*-\s*(https?:\/\/\S+)/);
        if (match) {
          const name = item.split(" (")[0];
          return { fileName: name, size: match[1], url: match[2] };
        }
        const urlMatch = item.match(/https?:\/\/\S+/);
        if (urlMatch) return { fileName: item.replace(urlMatch[0], "").trim() || item, url: urlMatch[0] };
        return { fileName: item };
      })
      .filter(Boolean);

    // Merge, preferring CDN (has URL) over raw copies with no URL, dedupe by fileName (case-insensitive)
    // Merge; dedupe strictly by filename (case-insensitive). Prefer a CDN URL, then signed/link, then base64.
    const combined = [...cdn, ...detailAttachments, ...parsedSummary];
    const byName = new Map<string, Attachment>();
    combined.forEach((att) => {
      if (!att) return;
      const name = (att.fileName || att.name || "attachment").trim();
      if (!name) return;
      const link = (att.url || att.href || att.link || "").trim();
      const hasPayload = !!link || !!att.base64;
      if (!hasPayload) return;

      const key = name.toLowerCase();
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, att);
        return;
      }
      const existingUrl = (existing.url || existing.href || existing.link || "").trim();
      const thisUrl = link;
      const existingHasUrl = !!existingUrl;
      const thisHasUrl = !!thisUrl;
      if (!existingHasUrl && thisHasUrl) {
        byName.set(key, att);
      } else if (existingHasUrl && thisHasUrl) {
        // keep the first; no change
      } else if (!existingHasUrl && !thisHasUrl) {
        // both base64 only; keep first
      }
    });
    return Array.from(byName.values());
  }, [activeIncident]);

  useEffect(() => {
    let alive = true;
    const cache = new Map<string, string>();

    async function getPreview(att: Attachment, idx: number) {
      if (att.base64) {
        return `data:${att.contentType || "image/jpeg"};base64,${att.base64}`;
      }
      const key = att.url || att.href || att.link || `att-${idx}`;
      if (!key) return "";
      if (attachmentPreviews[key]) return attachmentPreviews[key];
      if (cache.has(key)) return cache.get(key) || "";

      const resolvedUrl = key.startsWith("http") ? await resolveStorageUrl(key) : "";
      if (!resolvedUrl) {
        setHasUnsignedAttachments(true);
        return "";
      }
      cache.set(key, resolvedUrl);
      return resolvedUrl;
    }

    async function loadAll() {
      const entries = await Promise.all(
        attachmentList.map(async (att, idx) => {
          const key = att.url || att.href || att.link || `att-${idx}`;
          const src = await getPreview(att, idx);
          const resolved = key.startsWith("http") ? await resolveStorageUrl(key) : key;
          return [key, src, resolved] as const;
        })
      );
      if (!alive) return;
      const nextPreview: Record<string, string> = {};
      const nextLinks: Record<string, string> = {};
      entries.forEach(([k, v, resolved]) => {
        if (v) nextPreview[k] = v;
        if (resolved) nextLinks[k] = resolved;
      });
      setAttachmentPreviews(nextPreview);
      setAttachmentLinks(nextLinks);
      setHasUnsignedAttachments(entries.some(([, , resolved]) => resolved === ""));
    }

    if (attachmentList.length) {
      loadAll();
    } else {
      setAttachmentPreviews({});
    }

    return () => {
      alive = false;
    };
  }, [attachmentList]);

  async function handlePreview(att: Attachment, key: string) {
    let src = attachmentPreviews[key];
    if (!src) {
      // try to fetch on demand
      if (att.base64) {
        src = `data:${att.contentType || "image/jpeg"};base64,${att.base64}`;
      } else if (att.url || att.href || att.link) {
        try {
          const resolvedUrl = await resolveStorageUrl(att.url || att.href || att.link || "");
          if (resolvedUrl) {
            src = resolvedUrl;
            setAttachmentPreviews((prev) => ({ ...prev, [key]: src! }));
            setAttachmentLinks((prev) => ({ ...prev, [key]: resolvedUrl }));
          }
        } catch (error) {
          // ignore; will fail gracefully
        }
      }
    }

    if (src) {
      setAttachmentModal({ open: true, src, name: att.fileName || att.name || "Attachment" });
    }
  }

  async function uploadAllAttachments() {
    if (!activeIncident) return;
    const incidentNumber = activeIncident.number || "incident";
    const toUpload = attachmentList.filter(
      (att) =>
        att.base64 &&
        !(att.url || "").includes("firebasestorage.googleapis.com") &&
        !(att.href || "").includes("firebasestorage.googleapis.com")
    );
    if (!toUpload.length) return;

    setUploadingAttachments(true);
    setUploadError(null);
    try {
      const uploaded: Attachment[] = [];
      for (const att of toUpload) {
        const fileName = att.fileName || att.name || "attachment";
        // Deterministic path so re-uploads overwrite instead of duplicating.
        const path = `incidents/${incidentNumber}/${fileName}`;
        const storageRef = ref(storage, path);
        await uploadString(storageRef, att.base64 as string, "base64", {
          contentType: att.contentType || "application/octet-stream",
        });
        const url = await getDownloadURL(storageRef);
        uploaded.push({
          fileName,
          sizeBytes: att.sizeBytes,
          size: att.size,
          contentType: att.contentType,
          url,
        });
        setAttachmentPreviews((prev) => ({ ...prev, [att.url || att.href || path]: url }));
        setAttachmentLinks((prev) => ({ ...prev, [att.url || att.href || path]: url }));
      }
      // Merge with de-duplication by fileName to avoid appending duplicates.
      const merged = [...(activeIncident.cdnAttachments || [])];
      for (const u of uploaded) {
        const idx = merged.findIndex((c) => c?.fileName === u.fileName);
        if (idx >= 0) merged[idx] = u;
        else merged.push(u);
      }
      await updateDoc(doc(db, "incidents", activeIncident.id), {
        cdnAttachments: merged,
        updatedAt: nowTs(),
      });
    } catch (error: any) {
      setUploadError(String(error?.message || error));
    } finally {
      setUploadingAttachments(false);
    }
  }

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
            <div
              className={`tab ${tab === "attachments" ? "active" : ""}`}
              onClick={() => setTab("attachments")}
            >
              Attachments
            </div>
          </div>
        </div>

        <div className="content">
          <section className="card">
            {tab === "summary" ? (
              activeIncident ? (
                (() => {
                  const fallbackSummary =
                    activeIncident.summary ||
                    (activeIncident.raw as any)?.Summary ||
                    (activeIncident.raw as any)?.summary;
                  const structured =
                    activeIncident.summaryStructured ||
                    (activeIncident.raw as any)?.summaryStructured ||
                    null;
                  return renderSummary(structured, fallbackSummary, activeIncident.raw);
                })()
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
            ) : tab === "attachments" && activeIncident ? (
              <>
                <div className="summary-block">
                  <div className="attachments-header">
                    <div className="section-title">Attachments</div>
                    <div className="attachments-actions">
                      {uploadError ? <span className="chip danger-text">{uploadError}</span> : null}
                      {hasUnsignedAttachments ? (
                        <span className="chip warning">
                          Some attachments need re-upload (no signed URL).
                        </span>
                      ) : null}
                      <button
                        className="button"
                        onClick={uploadAllAttachments}
                        disabled={uploadingAttachments || attachmentList.length === 0}
                      >
                        {uploadingAttachments ? "Uploading..." : "Upload to CDN"}
                      </button>
                    </div>
                  </div>
                  <div className="attachment-grid">
                    {attachmentList.map((att, idx) => {
                      const key = att.url || att.href || att.link || `att-${idx}`;
                      const openHref = attachmentLinks[key] || att.url || att.href || att.link || "";
                      return (
                        <AttachmentCard
                          key={key}
                          att={att as any}
                          previewSrc={attachmentPreviews[key]}
                          openHref={openHref}
                          onPreview={() => handlePreview(att as Attachment, key)}
                        />
                      );
                    })}
                    {attachmentList.length === 0 && (
                      <div className="chip">No attachments.</div>
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
              <div className="chip">Select an incident to view details.</div>
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

      {attachmentModal.open ? (
        <div className="modal-backdrop" onClick={() => setAttachmentModal({ open: false, src: "", name: "" })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{attachmentModal.name}</div>
              <button
                className="button icon-button"
                onClick={() => setAttachmentModal({ open: false, src: "", name: "" })}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <img src={attachmentModal.src} alt={attachmentModal.name} className="modal-image" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

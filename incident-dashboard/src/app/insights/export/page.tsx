"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot } from "firebase/firestore";
import { onIdTokenChanged } from "firebase/auth";
import * as XLSX from "xlsx";
import { auth, db } from "@/lib/firebase";
import { parseOpenedAt } from "@/lib/insights";

const TRACKER_PRESET_KEYS = [
  "opened_date",
  "source_of_case",
  "old_case_status",
  "final_case_status",
  "status",
  "ops_action",
  "comment",
  "screenshots",
  "business_team_help",
  "business_team_comments",
];
const STORAGE_SELECTED_COLUMNS_KEY = "insights_export_selected_columns";
const STORAGE_HEADER_NAMES_KEY = "insights_export_header_names";

const DEFAULT_LABELS: Record<string, string> = {
  incident_number: "Incident Number",
  opened_date: "Date",
  source_of_case: "Source of case",
  old_case_status: "Old Case Status",
  final_case_status: "Final Case Status",
  status: "Status",
  ops_action: "OPS Action",
  comment: "Comment",
  screenshots: "Screenshots",
  business_team_help: "Business Team Help",
  business_team_comments: "Business Team Comments",
  state: "Current State",
  opened_at: "Opened At",
  updated_at: "Updated At",
  resolved_at: "Resolved At",
  days_to_resolve: "Days to Resolve",
  age_days_open: "Open Age (Days)",
  call_attempts: "Calls",
  no_answer_count: "Didn't Pick Up",
  total_contact_attempts: "Total Contact Attempts",
  ops_help: "Ops Help",
  description: "Description",
  assignment_group: "Assignment Group",
  emriates_id: "Emirates Id",
  chassis_no: "Chassis No",
};

function getPath(obj: any, path: string) {
  return path.split(".").reduce((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return acc[key];
  }, obj);
}

function pickFirst(...values: any[]) {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    return s;
  }
  return "";
}

function toCell(value: any) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function toIso(value: any) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return new Date(n).toISOString();
}

function buildRow(incident: any) {
  const raw = incident.raw || {};
  const openedDate =
    parseOpenedAt(
      incident.openedAt ||
        raw.Opened ||
        raw["Opened At"] ||
        raw["Opened Date"] ||
        raw.Created
    ) || null;
  const updatedAtMs = Number(incident.updatedAt || 0);
  const resolved = String(incident.status || "").toLowerCase() === "resolved";
  const daysToResolve =
    resolved && openedDate && updatedAtMs > 0
      ? round2((updatedAtMs - openedDate.getTime()) / (24 * 60 * 60 * 1000))
      : "";
  const ageDaysOpen =
    !resolved && openedDate
      ? round2((Date.now() - openedDate.getTime()) / (24 * 60 * 60 * 1000))
      : "";

  const callAttempts = Number(incident.callAttempts || 0);
  const noAnswerCount = Number(incident.noAnswerCount || 0);
  const totalContact = callAttempts + noAnswerCount;
  const opsHelp = !!incident.opsHelp;

  const opsAction = pickFirst(
    raw["OPS Action"],
    totalContact > 0 ? `Contacted user (${totalContact})` : "",
    opsHelp ? "Ops Help Requested" : ""
  );

  const row: Record<string, string | number> = {
    incident_number: toCell(incident.number),
    opened_date: openedDate ? openedDate.toISOString().slice(0, 10) : "",
    source_of_case: pickFirst(raw["Source of case"], raw.source, raw.Source),
    old_case_status: pickFirst(raw["Old Case Status"], incident.state),
    final_case_status: pickFirst(
      raw["Final Case Status"],
      resolved ? "Resolved" : incident.state
    ),
    status: pickFirst(incident.status, raw.Status, "open"),
    ops_action: opsAction,
    comment: pickFirst(raw["Comment "], raw.Comment, incident.description),
    screenshots: toCell(raw.Screenshots || getPath(raw, "summaryStructured.attachments")),
    business_team_help: opsHelp ? "Yes" : "No",
    business_team_comments: pickFirst(raw["Business Team Comments"]),
    state: toCell(incident.state),
    opened_at: toCell(incident.openedAt),
    updated_at: toIso(updatedAtMs),
    resolved_at: resolved ? toIso(updatedAtMs) : "",
    days_to_resolve: daysToResolve,
    age_days_open: ageDaysOpen,
    call_attempts: callAttempts,
    no_answer_count: noAnswerCount,
    total_contact_attempts: totalContact,
    ops_help: opsHelp ? "Yes" : "No",
    description: toCell(incident.description),
    assignment_group: pickFirst(raw["Assignment Group"], raw.assignment_group),
    emriates_id: pickFirst(
      getPath(raw, "applicationKeys.emiratesId"),
      raw["EmiratesId"]
    ),
    chassis_no: pickFirst(
      getPath(raw, "applicationKeys.chassisNo"),
      raw["Chassis No"]
    ),
  };

  Object.entries(raw).forEach(([key, value]) => {
    if (key in row) return;
    row[key] = toCell(value);
  });

  return row;
}

export default function ExportInsightsPage() {
  const [user, setUser] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [headerNames, setHeaderNames] = useState<Record<string, string>>({});
  const [columnQuery, setColumnQuery] = useState("");
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [previewWrap, setPreviewWrap] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);
  const [configTab, setConfigTab] = useState<"columns" | "headers" | "order">(
    "columns"
  );
  const [dragColumn, setDragColumn] = useState<string | null>(null);
  const loadedPrefsRef = useRef(false);

  useEffect(() => {
    const unsub = onIdTokenChanged(auth, (u) => {
      setUser(u || null);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;
    const q = collection(db, "incidents");
    const unsub = onSnapshot(q, (snap) => {
      const items: any[] = [];
      snap.forEach((docSnap) => {
        items.push({
          id: docSnap.id,
          ...docSnap.data(),
        });
      });
      setIncidents(items);
    });
    return () => unsub();
  }, [authReady, user]);

  const rows = useMemo(() => incidents.map(buildRow), [incidents]);

  const allColumns = useMemo(() => {
    const keys = new Set<string>();
    rows.forEach((row) => Object.keys(row).forEach((k) => keys.add(k)));
    const found = Array.from(keys);
    const preferred = TRACKER_PRESET_KEYS.filter((k) => keys.has(k));
    const rest = found
      .filter((k) => !preferred.includes(k))
      .sort((a, b) => a.localeCompare(b));
    return [...preferred, ...rest];
  }, [rows]);

  useEffect(() => {
    if (!allColumns.length) return;
    if (!loadedPrefsRef.current) {
      loadedPrefsRef.current = true;
      try {
        const rawCols = localStorage.getItem(STORAGE_SELECTED_COLUMNS_KEY);
        const rawHeaders = localStorage.getItem(STORAGE_HEADER_NAMES_KEY);
        if (rawCols) {
          const savedCols = JSON.parse(rawCols);
          if (Array.isArray(savedCols)) {
            const filtered = savedCols.filter((c) => allColumns.includes(c));
            if (filtered.length) setSelectedColumns(filtered);
          }
        }
        if (rawHeaders) {
          const savedHeaders = JSON.parse(rawHeaders);
          if (savedHeaders && typeof savedHeaders === "object") {
            setHeaderNames(savedHeaders);
          }
        }
      } catch {
        // Ignore invalid local storage payloads and continue with defaults.
      }
    }
    setSelectedColumns((prev) => {
      if (prev.length) return prev.filter((c) => allColumns.includes(c));
      return TRACKER_PRESET_KEYS.filter((k) => allColumns.includes(k));
    });
  }, [allColumns]);

  const visibleColumns = useMemo(() => {
    const q = columnQuery.trim().toLowerCase();
    return allColumns.filter((column) => {
      if (showSelectedOnly && !selectedColumns.includes(column)) return false;
      if (!q) return true;
      const label = (headerNames[column] || column).toLowerCase();
      return column.toLowerCase().includes(q) || label.includes(q);
    });
  }, [allColumns, columnQuery, headerNames, selectedColumns, showSelectedOnly]);

  const previewRows = useMemo(() => {
    if (showAllRows) return rows;
    return rows.slice(0, 100);
  }, [rows, showAllRows]);
  const exportColumns = useMemo(
    () => selectedColumns.filter((column) => column !== "incident_number"),
    [selectedColumns]
  );

  useEffect(() => {
    setHeaderNames((prev) => {
      const next = { ...prev };
      allColumns.forEach((column) => {
        if (!next[column]) next[column] = DEFAULT_LABELS[column] || column;
      });
      return next;
    });
  }, [allColumns]);

  useEffect(() => {
    if (!loadedPrefsRef.current) return;
    localStorage.setItem(
      STORAGE_SELECTED_COLUMNS_KEY,
      JSON.stringify(selectedColumns)
    );
  }, [selectedColumns]);

  useEffect(() => {
    if (!loadedPrefsRef.current) return;
    localStorage.setItem(
      STORAGE_HEADER_NAMES_KEY,
      JSON.stringify(headerNames)
    );
  }, [headerNames]);

  function setTrackerPreset() {
    const cols = TRACKER_PRESET_KEYS.filter((k) => allColumns.includes(k));
    setSelectedColumns(cols);
  }

  function resetColumnsToDefault() {
    const cols = TRACKER_PRESET_KEYS.filter((k) => allColumns.includes(k));
    setSelectedColumns(cols);
  }

  function toggleColumn(column: string) {
    setSelectedColumns((prev) =>
      prev.includes(column) ? prev.filter((c) => c !== column) : [...prev, column]
    );
  }

  function resetHeaderNames() {
    setHeaderNames((prev) => {
      const next = { ...prev };
      allColumns.forEach((column) => {
        next[column] = DEFAULT_LABELS[column] || column;
      });
      return next;
    });
  }

  function moveColumn(column: string, direction: -1 | 1) {
    setSelectedColumns((prev) => {
      const idx = prev.indexOf(column);
      if (idx < 0) return prev;
      const nextIdx = idx + direction;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[nextIdx]] = [next[nextIdx], next[idx]];
      return next;
    });
  }

  function moveColumnToEdge(column: string, edge: "top" | "bottom") {
    setSelectedColumns((prev) => {
      const idx = prev.indexOf(column);
      if (idx < 0) return prev;
      const next = prev.filter((c) => c !== column);
      if (edge === "top") {
        return [column, ...next];
      }
      return [...next, column];
    });
  }

  function reorderByDrag(targetColumn: string) {
    if (!dragColumn || dragColumn === targetColumn) return;
    setSelectedColumns((prev) => {
      const from = prev.indexOf(dragColumn);
      const to = prev.indexOf(targetColumn);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  function downloadExcel() {
    if (!selectedColumns.length) return;
    const data = rows.map((row, index) => {
      const out: Record<string, string | number> = {
        "No.": index + 1,
        "Incident Number": row.incident_number ?? "",
      };
      exportColumns.forEach((column) => {
        const label = (headerNames[column] || column).trim() || column;
        out[label] = row[column] ?? "";
      });
      return out;
    });
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, sheet, "Export");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `ops_business_export_${stamp}.xlsx`);
  }

  if (!user) {
    return (
      <div className="login">
        <div className="login-card">
          <div className="brand">
            <span className="brand-dot" />
            Export Studio
          </div>
          <div style={{ marginTop: 12 }} className="sidebar-section">
            <div className="chip">Please log in to export data.</div>
            <Link className="button" href="/insights">
              Back to Insights
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page insights-page export-page">
      <aside className="panel sidebar">
        <div className="brand">
          <span className="brand-dot" />
          Export Studio
        </div>
        <div className="sidebar-section">
          <div className="section-title">Rows: {rows.length}</div>
          <div className="section-title">Columns: {selectedColumns.length}</div>
          <button className="button primary" onClick={downloadExcel} disabled={!selectedColumns.length}>
            Download .xlsx
          </button>
          <Link className="button" href="/insights">
            Back to Insights
          </Link>
        </div>
      </aside>

      <main className="panel main export-main">
        <div className="topbar">
          <div>
            <div className="section-title">Export</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              Ops & Business Excel Export
            </div>
          </div>
          <div className="topbar-actions">
            <button className="button" onClick={setTrackerPreset}>
              Use Tracker Preset
            </button>
            <button className="button" onClick={resetColumnsToDefault}>
              Reset Columns
            </button>
            <button className="button" onClick={() => setSelectedColumns(allColumns)}>
              Select All
            </button>
            <button className="button" onClick={() => setSelectedColumns([])}>
              Clear
            </button>
            <button className="button primary" onClick={downloadExcel} disabled={!selectedColumns.length}>
              Download .xlsx
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="card">
            <div className="chip">No incidents found in Firestore.</div>
          </div>
        ) : (
          <div className="export-layout">
            <section className="card export-controls">
              <div className="section-title">Export Configuration</div>
              <div className="export-tabs">
                <button
                  className={`export-tab ${configTab === "columns" ? "active" : ""}`}
                  onClick={() => setConfigTab("columns")}
                >
                  Columns
                </button>
                <button
                  className={`export-tab ${configTab === "headers" ? "active" : ""}`}
                  onClick={() => setConfigTab("headers")}
                >
                  Header Names
                </button>
                <button
                  className={`export-tab ${configTab === "order" ? "active" : ""}`}
                  onClick={() => setConfigTab("order")}
                >
                  Order
                </button>
              </div>
              <div className="export-toolbar">
                <input
                  className="input"
                  placeholder={
                    configTab === "order"
                      ? "Search selected columns..."
                      : "Search columns or header names..."
                  }
                  value={columnQuery}
                  onChange={(e) => setColumnQuery(e.target.value)}
                />
                <label className="column-toggle">
                  <input
                    type="checkbox"
                    checked={showSelectedOnly}
                    onChange={(e) => setShowSelectedOnly(e.target.checked)}
                  />
                  <span>Show selected only</span>
                </label>
                <div className="export-toolbar-actions">
                  <button className="button" onClick={resetColumnsToDefault}>
                    Reset Columns
                  </button>
                  <button className="button" onClick={resetHeaderNames}>
                    Reset Headers
                  </button>
                </div>
              </div>
              {configTab === "columns" ? (
                <div className="column-list">
                  {visibleColumns.map((column) => (
                    <div key={column} className="column-row columns-only">
                      <label className="column-toggle">
                        <input
                          type="checkbox"
                          checked={selectedColumns.includes(column)}
                          onChange={() => toggleColumn(column)}
                        />
                        <span>{(headerNames[column] || column).trim() || column}</span>
                      </label>
                    </div>
                  ))}
                  {visibleColumns.length === 0 ? (
                    <div className="chip">No matching columns.</div>
                  ) : null}
                </div>
              ) : null}

              {configTab === "headers" ? (
                <div className="column-list">
                  {visibleColumns.map((column) => (
                    <div key={column} className="column-row">
                      <div className="column-key-label">
                        {(headerNames[column] || column).trim() || column}
                      </div>
                      <input
                        className="input"
                        value={headerNames[column] || ""}
                        onChange={(e) =>
                          setHeaderNames((prev) => ({
                            ...prev,
                            [column]: e.target.value,
                          }))
                        }
                        placeholder="Excel header name"
                      />
                    </div>
                  ))}
                  {visibleColumns.length === 0 ? (
                    <div className="chip">No matching columns.</div>
                  ) : null}
                </div>
              ) : null}

              {configTab === "order" ? (
                <div className="order-list-wrap">
                  <div className="section-title">Column Order (After Incident Number)</div>
                  <div className="order-list">
                    {exportColumns.map((column, idx) => (
                      <div
                        key={`order-${column}`}
                        className={`order-item ${dragColumn === column ? "dragging" : ""}`}
                        draggable
                        onDragStart={() => setDragColumn(column)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => reorderByDrag(column)}
                        onDragEnd={() => setDragColumn(null)}
                      >
                        <span className="order-label">
                          {idx + 1}. {(headerNames[column] || column).trim() || column}
                        </span>
                        <div className="order-actions">
                          <button
                            className="button order-btn"
                            onClick={() => moveColumn(column, -1)}
                            disabled={idx === 0}
                          >
                            Up
                          </button>
                          <button
                            className="button order-btn"
                            onClick={() => moveColumn(column, 1)}
                            disabled={idx === exportColumns.length - 1}
                          >
                            Down
                          </button>
                          <button
                            className="button order-btn"
                            onClick={() => moveColumnToEdge(column, "top")}
                            disabled={idx === 0}
                          >
                            Top
                          </button>
                          <button
                            className="button order-btn"
                            onClick={() => moveColumnToEdge(column, "bottom")}
                            disabled={idx === exportColumns.length - 1}
                          >
                            Bottom
                          </button>
                        </div>
                      </div>
                    ))}
                    {exportColumns.length === 0 ? (
                      <div className="chip">Select columns to arrange order.</div>
                    ) : null}
                    {exportColumns.length > 0 ? (
                      <div className="chip">
                        Tip: Drag a row to reorder instantly.
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>

            <section className="card export-preview-card">
              <div className="preview-header">
                <div className="section-title">
                  Preview Data ({showAllRows ? rows.length : previewRows.length} / {rows.length} rows)
                </div>
                <div className="topbar-actions">
                  <button className="button" onClick={() => setPreviewWrap((v) => !v)}>
                    {previewWrap ? "Truncate Cells" : "Wrap Cells"}
                  </button>
                  <button className="button" onClick={() => setShowAllRows((v) => !v)}>
                    {showAllRows ? "Show First 100" : "Show All Rows"}
                  </button>
                </div>
              </div>
              <div className="table-wrap export-preview-wrap">
                <table
                  className={`insights-table export-preview-table ${
                    previewWrap ? "cells-wrap" : "cells-truncate"
                  }`}
                >
                  <thead>
                    <tr>
                      <th>No.</th>
                      <th>Incident Number</th>
                      {exportColumns.map((column) => (
                        <th key={column}>{(headerNames[column] || column).trim() || column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, idx) => (
                      <tr key={`row-${idx}`}>
                        <td>{idx + 1}</td>
                        <td>{toCell(row.incident_number)}</td>
                        {exportColumns.map((column) => (
                          <td key={`${idx}-${column}`}>{toCell(row[column])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

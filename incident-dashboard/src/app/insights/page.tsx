"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import { collection, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { onIdTokenChanged } from "firebase/auth";
import { buildIncidentInsights } from "@/lib/insights";

const COLORS = [
  "var(--chart-pie-1, #5ed7ff)",
  "var(--chart-pie-2, #7cf7c4)",
  "var(--chart-pie-3, #ffd166)",
  "var(--chart-pie-4, #ff6b6b)",
  "var(--chart-pie-5, #b48cff)",
];
const CHART_TICK = { fill: "var(--chart-label, #9fb2c8)" };
const CHART_LEGEND = { color: "var(--chart-label, #9fb2c8)" };
const CHART_TOOLTIP = {
  backgroundColor: "var(--bg-elev, #111620)",
  border: "1px solid var(--border, #253047)",
  borderRadius: "10px",
};
const CHART_TOOLTIP_LABEL = { color: "var(--chart-label, #9fb2c8)" };
const CHART_TOOLTIP_ITEM = { color: "var(--text, #f1f5f9)" };

export default function InsightsPage() {
  const [user, setUser] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [incidents, setIncidents] = useState<any[]>([]);

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

  const metrics = useMemo(() => buildIncidentInsights(incidents), [incidents]);

  if (!user) {
    return (
      <div className="login">
        <div className="login-card">
          <div className="brand">
            <span className="brand-dot" />
            Insights
          </div>
          <div style={{ marginTop: 12 }} className="sidebar-section">
            <div className="chip">Please log in to view insights.</div>
            <Link className="button" href="/">
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page insights-page">
      <aside className="panel sidebar">
        <div className="brand">
          <span className="brand-dot" />
          Shary Incidents
        </div>
        <div className="sidebar-section insights-quick-panel">
          <div className="chip sidebar-email-chip">{user.email}</div>
          <div className="insights-quick-actions">
            <Link className="button" href="/">
              Dashboard
            </Link>
            <Link className="button primary" href="/insights/export">
              Export Studio
            </Link>
          </div>
        </div>
      </aside>

      <main className="panel main insights-main">
        <div className="topbar">
          <div>
            <div className="section-title">Insights</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              Incident Operations Analytics
            </div>
          </div>
          <div className="topbar-actions">
            <Link className="button primary" href="/insights/export">
              Download Excel
            </Link>
          </div>
        </div>

        {metrics.total === 0 ? (
          <div className="card">
            <div className="chip">No incidents found in Firestore.</div>
          </div>
        ) : (
          <>
            <div className="insights-kpis">
              <div className="card kpi-card">
                <div className="kpi-title">Total Incidents</div>
                <div className="kpi-value">{metrics.total}</div>
              </div>
              <div className="card kpi-card">
                <div className="kpi-title">Resolved Rate</div>
                <div className="kpi-value">{metrics.resolvedRate}%</div>
              </div>
              <div className="card kpi-card">
                <div className="kpi-title">Avg Days to Resolve</div>
                <div className="kpi-value">{metrics.avgResolutionDays}</div>
              </div>
              <div className="card kpi-card">
                <div className="kpi-title">Median Days to Resolve</div>
                <div className="kpi-value">{metrics.medianResolutionDays}</div>
              </div>
              <div className="card kpi-card">
                <div className="kpi-title">Open Over 3 Days</div>
                <div className="kpi-value">{metrics.oldOpenCount}</div>
              </div>
              <div className="card kpi-card">
                <div className="kpi-title">Avg Contact Attempts</div>
                <div className="kpi-value">
                  {(metrics.avgCalls + metrics.avgNoAnswer).toFixed(2)}
                </div>
              </div>
            </div>

            <div className="card chart-card">
              <div className="section-title">Detected Patterns</div>
              <div style={{ marginTop: 8 }}>
                {metrics.patterns.length ? (
                  metrics.patterns.map((p) => (
                    <div key={p} className="comment" style={{ marginBottom: 8 }}>
                      {p}
                    </div>
                  ))
                ) : (
                  <div className="chip">Not enough data yet for strong patterns.</div>
                )}
              </div>
            </div>

            <div className="insights-grid">
              <div className="card chart-card">
                <div className="section-title">Opened vs Resolved Trend</div>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={metrics.trend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, rgba(255,255,255,0.08))" />
                      <XAxis dataKey="date" tick={CHART_TICK} />
                      <YAxis tick={CHART_TICK} />
                      <Tooltip contentStyle={CHART_TOOLTIP} labelStyle={CHART_TOOLTIP_LABEL} itemStyle={CHART_TOOLTIP_ITEM} />
                      <Legend wrapperStyle={CHART_LEGEND} />
                      <Line
                        type="monotone"
                        dataKey="opened"
                        stroke="var(--chart-open, #4cc9f0)"
                        strokeWidth={3}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="resolved"
                        stroke="var(--chart-resolved, #ff8a3d)"
                        strokeWidth={3}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card chart-card">
                <div className="section-title">Status Split</div>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={metrics.statusPie}
                        dataKey="value"
                        nameKey="name"
                        outerRadius={90}
                        innerRadius={52}
                      >
                        {metrics.statusPie.map((_, index) => (
                          <Cell
                            key={`status-${index}`}
                            fill={COLORS[index % COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Legend wrapperStyle={CHART_LEGEND} />
                      <Tooltip contentStyle={CHART_TOOLTIP} labelStyle={CHART_TOOLTIP_LABEL} itemStyle={CHART_TOOLTIP_ITEM} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card chart-card">
                <div className="section-title">State Distribution</div>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={metrics.stateBars}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, rgba(255,255,255,0.08))" />
                      <XAxis dataKey="name" tick={CHART_TICK} />
                      <YAxis tick={CHART_TICK} />
                      <Tooltip contentStyle={CHART_TOOLTIP} labelStyle={CHART_TOOLTIP_LABEL} itemStyle={CHART_TOOLTIP_ITEM} />
                      <Bar dataKey="value" fill="var(--chart-bar-1, #7cf7c4)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card chart-card">
                <div className="section-title">Avg Resolution Days by State</div>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={metrics.resolutionByState}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, rgba(255,255,255,0.08))" />
                      <XAxis dataKey="name" tick={CHART_TICK} />
                      <YAxis tick={CHART_TICK} />
                      <Tooltip contentStyle={CHART_TOOLTIP} labelStyle={CHART_TOOLTIP_LABEL} itemStyle={CHART_TOOLTIP_ITEM} />
                      <Bar dataKey="avgDays" fill="var(--chart-bar-3, #ffd166)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card chart-card">
                <div className="section-title">Contact Effort Pattern</div>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={metrics.effortBars}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, rgba(255,255,255,0.08))" />
                      <XAxis dataKey="bucket" tick={CHART_TICK} />
                      <YAxis tick={CHART_TICK} />
                      <Tooltip contentStyle={CHART_TOOLTIP} labelStyle={CHART_TOOLTIP_LABEL} itemStyle={CHART_TOOLTIP_ITEM} />
                      <Bar dataKey="count" fill="var(--chart-bar-2, #b48cff)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card chart-card">
                <div className="section-title">Effort Bucket Resolve Rate (%)</div>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={metrics.effortBars}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, rgba(255,255,255,0.08))" />
                      <XAxis dataKey="bucket" tick={CHART_TICK} />
                      <YAxis tick={CHART_TICK} />
                      <Tooltip contentStyle={CHART_TOOLTIP} labelStyle={CHART_TOOLTIP_LABEL} itemStyle={CHART_TOOLTIP_ITEM} />
                      <Bar dataKey="resolvedRate" fill="var(--chart-open, #5ed7ff)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card chart-card">
                <div className="section-title">Top Assignment Groups</div>
                <div className="table-wrap">
                  <table className="insights-table">
                    <thead>
                      <tr>
                        <th>Group</th>
                        <th>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.topAssignment.map((row) => (
                        <tr key={row.name}>
                          <td>{row.name}</td>
                          <td>{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card chart-card">
                <div className="section-title">Oldest Open Incidents</div>
                <div className="table-wrap">
                  <table className="insights-table">
                    <thead>
                      <tr>
                        <th>Incident</th>
                        <th>State</th>
                        <th>Age (days)</th>
                        <th>Ops Help</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.oldestOpen.map((row, idx) => (
                        <tr key={`${row.number}-${row.openedAt}-${idx}`}>
                          <td>{row.number}</td>
                          <td>{row.state}</td>
                          <td>{row.ageDays}</td>
                          <td>{row.opsHelp ? "Yes" : "No"}</td>
                        </tr>
                      ))}
                      {metrics.oldestOpen.length === 0 ? (
                        <tr>
                          <td colSpan={4}>No open incidents.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card chart-card">
                <div className="section-title">Top Issue Types</div>
                <div className="table-wrap">
                  <table className="insights-table">
                    <thead>
                      <tr>
                        <th>Issue</th>
                        <th>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.topIssues.map((row) => (
                        <tr key={row.name}>
                          <td>{row.name}</td>
                          <td>{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

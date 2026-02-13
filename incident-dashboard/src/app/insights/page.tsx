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
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { onIdTokenChanged } from "firebase/auth";

const COLORS = ["#5ed7ff", "#7cf7c4", "#ffd166", "#ff6b6b", "#b48cff"];

type InsightsPayload = {
  total: number;
  trend: { date: string; count: number }[];
  stateBars: { name: string; value: number }[];
  priorityPie: { name: string; value: number }[];
  topShort: { name: string; value: number }[];
  topAssignment: { name: string; value: number }[];
  debugOpenedSamples?: { raw: any; parsed: string | null; type: string }[];
};

export default function InsightsPage() {
  const [user, setUser] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [insights, setInsights] = useState<InsightsPayload | null>(null);
  const [sourceCount, setSourceCount] = useState(0);

  useEffect(() => {
    const unsub = onIdTokenChanged(auth, (u) => {
      setUser(u || null);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;
    const ref = doc(db, "insights", "latest");
    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.data() as any;
      setInsights(data?.insights || null);
      setSourceCount(data?.insights?.total || 0);
    });
    return () => unsub();
  }, [authReady, user]);

  const metrics = useMemo(() => insights, [insights]);

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
        <div className="sidebar-section">
          <div className="chip">Logged in as {user.email}</div>
          <Link className="button" href="/">
            Back to Dashboard
          </Link>
        </div>
      </aside>

      <main className="panel main insights-main">
        <div className="topbar">
          <div>
            <div className="section-title">Insights</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              Shary Incident Analytics
            </div>
          </div>
        </div>

        {!metrics && (
          <div className="card">
            <div className="chip">
              No insights found. Upload the Excel file in /import to generate
              insights.
            </div>
          </div>
        )}
        {metrics?.debugOpenedSamples?.length ? (
          <div className="card">
            <div className="section-title">Debug Opened Samples</div>
            <div className="table-wrap">
              <table className="insights-table">
                <thead>
                  <tr>
                    <th>Raw</th>
                    <th>Parsed</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.debugOpenedSamples.map((row: any, idx: number) => (
                    <tr key={idx}>
                      <td>{String(row.raw)}</td>
                      <td>{row.parsed || "null"}</td>
                      <td>{row.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {metrics && (
          <div className="insights-kpis">
          <div className="card kpi-card">
            <div className="kpi-title">Total Incidents</div>
            <div className="kpi-value">{metrics.total}</div>
          </div>
          <div className="card kpi-card">
            <div className="kpi-title">Top Category</div>
            <div className="kpi-value">
              {metrics.topShort[0]?.name || "—"}
            </div>
          </div>
          <div className="card kpi-card">
            <div className="kpi-title">Top Assignment Group</div>
            <div className="kpi-value">
              {metrics.topAssignment[0]?.name || "—"}
            </div>
          </div>
        </div>
        )}

        {metrics && (
          <div className="insights-grid">
          <div className="card chart-card">
            <div className="section-title">Incident Trend</div>
            <div className="chart-wrap">
              {metrics.trend.length === 0 ? (
                <div className="chip">
                  No trend data. Check that the Opened column is parsed.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={metrics.trend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="#5ed7ff" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="card chart-card">
            <div className="section-title">By State</div>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={metrics.stateBars}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#7cf7c4" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card chart-card">
            <div className="section-title">Priority Split</div>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={metrics.priorityPie}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={90}
                    innerRadius={50}
                  >
                    {metrics.priorityPie.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card chart-card">
            <div className="section-title">Top Issues</div>
            <div className="table-wrap">
              <table className="insights-table">
                <thead>
                  <tr>
                    <th>Issue</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.topShort.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td>{row.value}</td>
                    </tr>
                  ))}
                  {metrics.topShort.length === 0 && (
                    <tr>
                      <td colSpan={2}>No data</td>
                    </tr>
                  )}
                </tbody>
              </table>
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
                  {metrics.topAssignment.length === 0 && (
                    <tr>
                      <td colSpan={2}>No data</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        )}
      </main>
    </div>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseOpenedAt(value?: any) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const dt = new Date(ms);
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  const raw = String(value).trim();
  const iso = new Date(raw.replace(" ", "T"));
  if (!Number.isNaN(iso.getTime())) return iso;

  const dmy = raw.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/
  );
  if (dmy) {
    const dd = Number(dmy[1]);
    const mm = Number(dmy[2]) - 1;
    const yyyy = Number(dmy[3]);
    const hh = dmy[4] ? Number(dmy[4]) : 0;
    const min = dmy[5] ? Number(dmy[5]) : 0;
    const dt = new Date(yyyy, mm, dd, hh, min, 0);
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  return null;
}

function dayKey(dt: Date) {
  return dt.toISOString().slice(0, 10);
}

function safeAvg(sum: number, count: number) {
  return count ? sum / count : 0;
}

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toLabel(v: any, fallback = "Unknown") {
  const s = String(v || "").trim();
  return s || fallback;
}

function effortBucket(total: number) {
  if (total <= 0) return "0";
  if (total <= 2) return "1-2";
  if (total <= 5) return "3-5";
  return "6+";
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export type IncidentInsights = {
  total: number;
  resolved: number;
  open: number;
  resolvedRate: number;
  avgResolutionDays: number;
  medianResolutionDays: number;
  oldOpenCount: number;
  avgCalls: number;
  avgNoAnswer: number;
  statusPie: { name: string; value: number }[];
  trend: { date: string; opened: number; resolved: number }[];
  stateBars: { name: string; value: number }[];
  resolutionByState: { name: string; avgDays: number; incidents: number }[];
  effortBars: { bucket: string; count: number; resolvedRate: number }[];
  topAssignment: { name: string; value: number }[];
  topIssues: { name: string; value: number }[];
  oldestOpen: {
    number: string;
    state: string;
    openedAt: string;
    ageDays: number;
    opsHelp: boolean;
  }[];
  patterns: string[];
};

export function buildIncidentInsights(list: any[]): IncidentInsights {
  const now = Date.now();
  const byState: Record<string, number> = {};
  const byAssignment: Record<string, number> = {};
  const byIssue: Record<string, number> = {};
  const openedByDate: Record<string, number> = {};
  const resolvedByDate: Record<string, number> = {};
  const byEffort: Record<string, { total: number; resolved: number }> = {
    "0": { total: 0, resolved: 0 },
    "1-2": { total: 0, resolved: 0 },
    "3-5": { total: 0, resolved: 0 },
    "6+": { total: 0, resolved: 0 },
  };
  const resolutionStateMap: Record<string, { sum: number; count: number }> = {};
  const oldestOpen: {
    number: string;
    state: string;
    openedAt: string;
    ageDays: number;
    opsHelp: boolean;
  }[] = [];

  let resolved = 0;
  let open = 0;
  let oldOpenCount = 0;
  let sumResolutionDays = 0;
  let sumCalls = 0;
  let sumNoAnswer = 0;
  let resolvedCountWithDays = 0;
  const resolutionDays: number[] = [];
  let opsHelpCount = 0;
  let resolvedContactSum = 0;
  let resolvedContactCount = 0;
  let openContactSum = 0;
  let openContactCount = 0;

  for (const row of list) {
    const raw = row.raw || {};
    const state = toLabel(row.state || raw.State);
    const status = String(row.status || "").toLowerCase() === "resolved" ? "resolved" : "open";
    const opened = parseOpenedAt(
      row.openedAt ||
        raw.Opened ||
        raw["Opened At"] ||
        raw["Opened Date"] ||
        raw.Created
    );
    const updatedMs = toNum(row.updatedAt);
    const calls = toNum(row.callAttempts);
    const noAnswer = toNum(row.noAnswerCount);
    const opsHelp = !!row.opsHelp;
    const effort = calls + noAnswer;

    byState[state] = (byState[state] || 0) + 1;
    sumCalls += calls;
    sumNoAnswer += noAnswer;
    if (opsHelp) opsHelpCount += 1;

    const assignment = toLabel(raw["Assignment Group"] || raw.assignment_group, "Unassigned");
    byAssignment[assignment] = (byAssignment[assignment] || 0) + 1;

    const issue = toLabel(
      raw["Short Description"] || raw.short_description || row.description,
      "Unknown issue"
    );
    byIssue[issue] = (byIssue[issue] || 0) + 1;

    if (opened) {
      const key = dayKey(opened);
      openedByDate[key] = (openedByDate[key] || 0) + 1;
    }

    const bucket = effortBucket(effort);
    byEffort[bucket].total += 1;

    if (status === "resolved") {
      resolved += 1;
      byEffort[bucket].resolved += 1;
      resolvedContactSum += effort;
      resolvedContactCount += 1;

      if (updatedMs > 0) {
        const resolvedDate = new Date(updatedMs);
        resolvedByDate[dayKey(resolvedDate)] = (resolvedByDate[dayKey(resolvedDate)] || 0) + 1;
      }

      if (opened && updatedMs > 0) {
        const days = Math.max(0, (updatedMs - opened.getTime()) / DAY_MS);
        sumResolutionDays += days;
        resolvedCountWithDays += 1;
        resolutionDays.push(days);
        if (!resolutionStateMap[state]) {
          resolutionStateMap[state] = { sum: 0, count: 0 };
        }
        resolutionStateMap[state].sum += days;
        resolutionStateMap[state].count += 1;
      }
    } else {
      open += 1;
      openContactSum += effort;
      openContactCount += 1;
      if (opened) {
        const ageDays = Math.max(0, (now - opened.getTime()) / DAY_MS);
        if (ageDays > 3) oldOpenCount += 1;
        oldestOpen.push({
          number: toLabel(row.number, "N/A"),
          state,
          openedAt: row.openedAt || opened.toISOString(),
          ageDays: round2(ageDays),
          opsHelp,
        });
      }
    }
  }

  resolutionDays.sort((a, b) => a - b);
  const mid = Math.floor(resolutionDays.length / 2);
  const medianResolutionDays =
    resolutionDays.length === 0
      ? 0
      : resolutionDays.length % 2 === 0
      ? (resolutionDays[mid - 1] + resolutionDays[mid]) / 2
      : resolutionDays[mid];

  const trendKeys = Array.from(
    new Set([...Object.keys(openedByDate), ...Object.keys(resolvedByDate)])
  ).sort((a, b) => a.localeCompare(b));
  const trend = trendKeys.map((date) => ({
    date,
    opened: openedByDate[date] || 0,
    resolved: resolvedByDate[date] || 0,
  }));

  const stateBars = Object.entries(byState)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));

  const resolutionByState = Object.entries(resolutionStateMap)
    .map(([name, v]) => ({
      name,
      avgDays: round2(safeAvg(v.sum, v.count)),
      incidents: v.count,
    }))
    .sort((a, b) => b.avgDays - a.avgDays)
    .slice(0, 8);

  const effortBars = ["0", "1-2", "3-5", "6+"].map((bucket) => {
    const item = byEffort[bucket];
    return {
      bucket,
      count: item.total,
      resolvedRate: round2(safeAvg(item.resolved * 100, item.total)),
    };
  });

  const topAssignment = Object.entries(byAssignment)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, value]) => ({ name, value }));

  const topIssues = Object.entries(byIssue)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, value]) => ({ name, value }));

  const dominantState = stateBars[0];
  const dominantShare = dominantState ? round2((dominantState.value * 100) / list.length) : 0;
  const avgContactResolved = safeAvg(resolvedContactSum, resolvedContactCount);
  const avgContactOpen = safeAvg(openContactSum, openContactCount);

  const patterns: string[] = [];
  if (dominantState && dominantShare >= 35) {
    patterns.push(
      `${dominantState.name} is the dominant state (${dominantShare}% of incidents).`
    );
  }
  if (avgContactResolved > avgContactOpen && resolvedCountWithDays > 0) {
    patterns.push(
      `Resolved incidents show higher contact effort (${round2(avgContactResolved)} vs ${round2(
        avgContactOpen
      )} attempts).`
    );
  }
  if (open > 0 && oldOpenCount > 0) {
    patterns.push(
      `${round2((oldOpenCount * 100) / open)}% of open incidents are older than 3 days.`
    );
  }
  if (list.length > 0 && opsHelpCount > 0) {
    patterns.push(
      `${round2((opsHelpCount * 100) / list.length)}% of incidents currently have Ops Help flag.`
    );
  }

  oldestOpen.sort((a, b) => b.ageDays - a.ageDays);

  return {
    total: list.length,
    resolved,
    open,
    resolvedRate: round2(safeAvg(resolved * 100, list.length)),
    avgResolutionDays: round2(safeAvg(sumResolutionDays, resolvedCountWithDays)),
    medianResolutionDays: round2(medianResolutionDays),
    oldOpenCount,
    avgCalls: round2(safeAvg(sumCalls, list.length)),
    avgNoAnswer: round2(safeAvg(sumNoAnswer, list.length)),
    statusPie: [
      { name: "Open", value: open },
      { name: "Resolved", value: resolved },
    ],
    trend,
    stateBars,
    resolutionByState,
    effortBars,
    topAssignment,
    topIssues,
    oldestOpen: oldestOpen.slice(0, 10),
    patterns,
  };
}

// Legacy builder kept for existing import flows.
export function buildInsights(list: any[]) {
  const incidents = list.map((row, idx) => ({
    id: `row_${idx}`,
    number: toLabel(row.Number || row.number || row["Incident Number"], `N-${idx + 1}`),
    state: toLabel(row.State || row.state),
    status:
      String(row.Status || row.status || row.State || "")
        .toLowerCase()
        .includes("resolved")
        ? "resolved"
        : "open",
    openedAt: row.Opened || row.openedAt || row["Opened At"] || "",
    description: toLabel(
      row["Short Description"] || row.short_description || row.Description,
      "Unknown issue"
    ),
    callAttempts: toNum(row.callAttempts),
    noAnswerCount: toNum(row.noAnswerCount),
    opsHelp: !!row.opsHelp,
    updatedAt: Date.now(),
    raw: row,
  }));
  return buildIncidentInsights(incidents);
}

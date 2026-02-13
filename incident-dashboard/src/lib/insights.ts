export function parseOpenedAt(value?: string) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial date (days since 1899-12-30)
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const dt = new Date(ms);
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  const raw = String(value).trim();
  // Try ISO-like first
  const iso = new Date(raw.replace(" ", "T"));
  if (!Number.isNaN(iso.getTime())) return iso;

  // Try DD/MM/YYYY HH:mm or DD/MM/YYYY
  const m = raw.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/
  );
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]) - 1;
    const yyyy = Number(m[3]);
    const hh = m[4] ? Number(m[4]) : 0;
    const min = m[5] ? Number(m[5]) : 0;
    const dt = new Date(yyyy, mm, dd, hh, min, 0);
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  return null;
}

export function dayKey(dt: Date) {
  return dt.toISOString().slice(0, 10);
}

export function buildInsights(list: any[]) {
  const byState: Record<string, number> = {};
  const byDate: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  const byAssignment: Record<string, number> = {};
  const byShortDesc: Record<string, number> = {};
  const debugOpenedSamples: { raw: any; parsed: string | null; type: string }[] = [];

  for (const i of list) {
    const rawOpened =
      i.Opened ||
      i.openedAt ||
      i.Created ||
      i["Created"] ||
      i["Opened At"] ||
      i["Opened Date"];
    const state = String(i.State || i.state || "Unknown").trim();
    byState[state] = (byState[state] || 0) + 1;

    const opened = parseOpenedAt(rawOpened);
    if (opened) {
      const key = dayKey(opened);
      byDate[key] = (byDate[key] || 0) + 1;
    }

    const priority = String(
      i.Priority || i.priority || i.Urgency || "Unknown"
    ).trim();
    byPriority[priority] = (byPriority[priority] || 0) + 1;

    const assignment = String(
      i["Assignment Group"] || i.assignment_group || "Unknown"
    ).trim();
    byAssignment[assignment] = (byAssignment[assignment] || 0) + 1;

    const short = String(
      i["Short Description"] || i.short_description || i.Description || "Unknown"
    ).trim();
    byShortDesc[short] = (byShortDesc[short] || 0) + 1;
  }

  const trend = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  const stateBars = Object.entries(byState).map(([name, value]) => ({
    name,
    value,
  }));

  const priorityPie = Object.entries(byPriority).map(([name, value]) => ({
    name,
    value,
  }));

  const topShort = Object.entries(byShortDesc)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, value]) => ({ name, value }));

  const topAssignment = Object.entries(byAssignment)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, value]) => ({ name, value }));

  for (const i of list.slice(0, 5)) {
    const raw =
      i.Opened ||
      i.openedAt ||
      i.Created ||
      i["Created"] ||
      i["Opened At"] ||
      i["Opened Date"];
    const parsed = parseOpenedAt(raw);
    debugOpenedSamples.push({
      raw,
      parsed: parsed ? parsed.toISOString() : null,
      type: Object.prototype.toString.call(raw),
    });
  }

  return {
    total: list.length,
    trend,
    stateBars,
    priorityPie,
    topShort,
    topAssignment,
    debugOpenedSamples,
  };
}

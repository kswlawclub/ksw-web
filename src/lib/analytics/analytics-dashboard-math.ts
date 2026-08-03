export type AnalyticsRangeDays = 1 | 7 | 30;
export type AnalyticsDashboardMetric = { changePercent: number | null; value: number };
export type AnalyticsDashboardData = {
  devices: Array<{ count: number; label: string; percentage: number }>;
  error: string | null;
  generatedAt: string;
  metrics: { competitionViews: AnalyticsDashboardMetric; pageViews: AnalyticsDashboardMetric; sessions: AnalyticsDashboardMetric; sponsorClicks: AnalyticsDashboardMetric; uniqueVisitors: AnalyticsDashboardMetric };
  rangeDays: AnalyticsRangeDays;
  topCompetitions: Array<{ count: number; label: string }>;
  topPages: Array<{ count: number; label: string }>;
  topSponsors: Array<{ count: number; label: string }>;
  trafficSources: Array<{ count: number; label: string; percentage: number }>;
  trend: Array<{ competitionViews: number; day: string; pageViews: number; uniqueVisitors: number }>;
};

export type AnalyticsEventRow = { competition_id: string | null; device_category: string | null; event_type: string; occurred_at: string; page_path: string | null; referrer: string | null; session_id: string; sponsor_id: string | null; visitor_id: string };

export function parseAnalyticsRange(value: string | undefined): AnalyticsRangeDays { return value === "1" ? 1 : value === "30" ? 30 : 7; }
export function analyticsRangeBounds(now: Date, days: AnalyticsRangeDays) { const currentEnd = new Date(now); const currentStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); if (days > 1) currentStart.setUTCDate(currentStart.getUTCDate() - (days - 1)); const previousStart = new Date(currentStart); previousStart.setUTCDate(previousStart.getUTCDate() - days); return { currentEnd, currentStart, previousStart }; }
export function percentageChange(current: number, previous: number) { return previous > 0 ? Math.round(((current - previous) / previous) * 100) : null; }
export function trafficSource(referrer: string | null) { const value = (referrer ?? "").toLowerCase(); if (!value) return "Direct"; if (value.includes("facebook.com") || value.includes("fb.com")) return "Facebook"; if (value.includes("line.me") || value.includes("line.app")) return "LINE"; if (value.includes("google.")) return "Google"; return "Other"; }
export function deviceLabel(value: string | null) { return value === "mobile" ? "Mobile" : value === "desktop" ? "Desktop" : value === "tablet" ? "Tablet" : "Other"; }

function dateKey(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10); }
function countBy<T>(rows: T[], key: (row: T) => string) { return rows.reduce((counts, row) => { const value = key(row); if (value) counts.set(value, (counts.get(value) ?? 0) + 1); return counts; }, new Map<string, number>()); }
function topRows(counts: Map<string, number>, names: Map<string, string>, limit = 5) { return Array.from(counts.entries()).map(([id, count]) => ({ count, label: names.get(id) ?? "รายการที่ไม่พร้อมแสดง" })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)).slice(0, limit); }
function summary(rows: AnalyticsEventRow[]) { return { competitionViews: rows.filter((row) => row.event_type === "competition_view").length, pageViews: rows.filter((row) => row.event_type === "page_view").length, sessions: new Set(rows.map((row) => row.session_id)).size, sponsorClicks: rows.filter((row) => row.event_type === "sponsor_click").length, uniqueVisitors: new Set(rows.map((row) => row.visitor_id)).size }; }

export function buildAnalyticsDashboard(events: AnalyticsEventRow[], rangeDays: AnalyticsRangeDays, now: Date, names = { competitions: new Map<string, string>(), sponsors: new Map<string, string>() }): Omit<AnalyticsDashboardData, "error" | "generatedAt"> {
  const bounds = analyticsRangeBounds(now, rangeDays); const current = events.filter((event) => new Date(event.occurred_at) >= bounds.currentStart && new Date(event.occurred_at) < bounds.currentEnd); const previous = events.filter((event) => new Date(event.occurred_at) >= bounds.previousStart && new Date(event.occurred_at) < bounds.currentStart); const currentSummary = summary(current); const previousSummary = summary(previous);
  const metrics = Object.fromEntries(Object.entries(currentSummary).map(([key, value]) => [key, { changePercent: percentageChange(value, previousSummary[key as keyof typeof previousSummary]), value }])) as AnalyticsDashboardData["metrics"];
  const daily = new Map<string, { competitionViews: number; day: string; pageViews: number; uniqueVisitors: Set<string> }>(); for (let day = new Date(bounds.currentStart); day < bounds.currentEnd; day.setUTCDate(day.getUTCDate() + 1)) daily.set(day.toISOString().slice(0, 10), { competitionViews: 0, day: day.toISOString().slice(0, 10), pageViews: 0, uniqueVisitors: new Set() });
  current.forEach((event) => { const entry = daily.get(dateKey(event.occurred_at)); if (!entry) return; entry.uniqueVisitors.add(event.visitor_id); if (event.event_type === "page_view") entry.pageViews += 1; if (event.event_type === "competition_view") entry.competitionViews += 1; }); const deviceCounts = countBy(current, (event) => deviceLabel(event.device_category)); const sourceCounts = countBy(current, (event) => trafficSource(event.referrer)); const total = current.length;
  return { devices: Array.from(deviceCounts.entries()).map(([label, count]) => ({ count, label, percentage: total ? Math.round((count / total) * 100) : 0 })).sort((a, b) => b.count - a.count), metrics, rangeDays, topCompetitions: topRows(countBy(current.filter((event) => event.event_type === "competition_view"), (event) => event.competition_id ?? ""), names.competitions), topPages: topRows(countBy(current.filter((event) => event.event_type === "page_view"), (event) => event.page_path ?? ""), new Map(current.map((event) => [event.page_path ?? "", event.page_path ?? "/"]))), topSponsors: topRows(countBy(current.filter((event) => event.event_type === "sponsor_click"), (event) => event.sponsor_id ?? ""), names.sponsors), trafficSources: Array.from(sourceCounts.entries()).map(([label, count]) => ({ count, label, percentage: total ? Math.round((count / total) * 100) : 0 })).sort((a, b) => b.count - a.count), trend: Array.from(daily.values()).map((entry) => ({ competitionViews: entry.competitionViews, day: entry.day, pageViews: entry.pageViews, uniqueVisitors: entry.uniqueVisitors.size })) };
}

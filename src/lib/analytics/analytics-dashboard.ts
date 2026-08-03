import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { analyticsRangeBounds, buildAnalyticsDashboard, type AnalyticsDashboardData, type AnalyticsEventRow, type AnalyticsRangeDays } from "./analytics-dashboard-math";

export { analyticsRangeBounds, buildAnalyticsDashboard, parseAnalyticsRange, percentageChange, trafficSource, deviceLabel } from "./analytics-dashboard-math";
export type { AnalyticsDashboardData, AnalyticsRangeDays } from "./analytics-dashboard-math";

export async function loadAnalyticsDashboard(rangeDays: AnalyticsRangeDays): Promise<AnalyticsDashboardData> {
  const generatedAt = new Date().toISOString();
  const empty = buildAnalyticsDashboard([], rangeDays, new Date(generatedAt));
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ...empty, error: "ไม่พบการตั้งค่า Analytics server" , generatedAt };
  const bounds = analyticsRangeBounds(new Date(generatedAt), rangeDays);
  const eventsResult = await supabase.from("analytics_events").select("competition_id, device_category, event_type, occurred_at, page_path, referrer, session_id, sponsor_id, visitor_id").gte("occurred_at", bounds.previousStart.toISOString()).lt("occurred_at", bounds.currentEnd.toISOString());
  if (eventsResult.error) { console.error("analytics dashboard query failed", { code: eventsResult.error.code, message: eventsResult.error.message }); return { ...empty, error: "ไม่สามารถโหลดข้อมูล Analytics ได้", generatedAt }; }
  const events = (eventsResult.data ?? []) as AnalyticsEventRow[];
  const competitionIds = Array.from(new Set(events.map((event) => event.competition_id).filter((id): id is string => Boolean(id))));
  const sponsorIds = Array.from(new Set(events.map((event) => event.sponsor_id).filter((id): id is string => Boolean(id))));
  const [competitionsResult, sponsorsResult] = await Promise.all([
    competitionIds.length ? supabase.from("leagues").select("id, name").in("id", competitionIds) : Promise.resolve({ data: [], error: null }),
    sponsorIds.length ? supabase.from("sponsors").select("id, name").in("id", sponsorIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (competitionsResult.error || sponsorsResult.error) console.error("analytics dashboard entity query failed", { competitions: competitionsResult.error?.message, sponsors: sponsorsResult.error?.message });
  const names = {
    competitions: new Map((competitionsResult.data ?? []).map((row) => [row.id, row.name] as const)),
    sponsors: new Map((sponsorsResult.data ?? []).map((row) => [row.id, row.name] as const)),
  };
  return { ...buildAnalyticsDashboard(events, rangeDays, new Date(generatedAt), names), error: null, generatedAt };
}

import { AdminAnalyticsDashboard } from "@/components/admin-analytics-dashboard";
import { loadAnalyticsDashboard, parseAnalyticsRange } from "@/lib/analytics/analytics-dashboard";
import { requireAdminSession } from "@/lib/admin-server-auth";

export default async function AdminAnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireAdminSession();
  const params = await searchParams;
  const data = await loadAnalyticsDashboard(parseAnalyticsRange(params.range));
  return <AdminAnalyticsDashboard data={data} />;
}

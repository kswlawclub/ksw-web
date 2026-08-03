import assert from "node:assert/strict";
import test from "node:test";
import { analyticsRangeBounds, buildAnalyticsDashboard, deviceLabel, parseAnalyticsRange, percentageChange, trafficSource, type AnalyticsEventRow } from "./analytics-dashboard-math.ts";

const event = (overrides: Partial<AnalyticsEventRow>): AnalyticsEventRow => ({ competition_id: null, device_category: "desktop", event_type: "page_view", occurred_at: "2026-08-03T10:00:00.000Z", page_path: "/", referrer: null, session_id: "session-1", sponsor_id: null, visitor_id: "visitor-1", ...overrides });

test("calculates Today, 7 Days and 30 Days ranges with an equal previous period", () => {
  const now = new Date("2026-08-03T12:00:00.000Z");
  assert.equal(parseAnalyticsRange(undefined), 7);
  assert.equal(parseAnalyticsRange("30"), 30);
  assert.equal(analyticsRangeBounds(now, 7).currentStart.toISOString(), "2026-07-28T00:00:00.000Z");
  assert.equal(analyticsRangeBounds(now, 1).previousStart.toISOString(), "2026-08-02T00:00:00.000Z");
});

test("aggregates unique visitors, sessions, comparison, traffic and devices without identifiers", () => {
  const dashboard = buildAnalyticsDashboard([
    event({ competition_id: "competition-1", event_type: "competition_view", page_path: "/competitions/cup", referrer: "https://facebook.com/post", visitor_id: "visitor-1" }),
    event({ device_category: "mobile", event_type: "sponsor_click", sponsor_id: "sponsor-1", visitor_id: "visitor-2", session_id: "session-2" }),
    event({ occurred_at: "2026-08-02T10:00:00.000Z" }),
  ], 1, new Date("2026-08-03T12:00:00.000Z"), { competitions: new Map([["competition-1", "Cup จริง"]]), sponsors: new Map([["sponsor-1", "Sponsor จริง"]]) });
  assert.equal(dashboard.metrics.uniqueVisitors.value, 2);
  assert.equal(dashboard.metrics.sessions.value, 2);
  assert.equal(dashboard.topCompetitions[0]?.label, "Cup จริง");
  assert.equal(dashboard.topSponsors[0]?.label, "Sponsor จริง");
  assert.equal(dashboard.trafficSources.some((source) => source.label === "Direct"), true);
  assert.equal(dashboard.trafficSources.some((source) => source.label === "Facebook"), true);
  assert.equal(trafficSource("https://line.me/x"), "LINE");
  assert.equal(deviceLabel("tablet"), "Tablet");
  assert.equal(percentageChange(4, 0), null);
  assert.equal(percentageChange(6, 4), 50);
});

test("returns empty lists and zero metrics for an empty dataset", () => {
  const dashboard = buildAnalyticsDashboard([], 7, new Date("2026-08-03T12:00:00.000Z"));
  assert.equal(dashboard.metrics.pageViews.value, 0);
  assert.deepEqual(dashboard.topPages, []);
  assert.equal(dashboard.trend.length, 7);
});

import assert from "node:assert/strict";
import test from "node:test";
import { aggregateAnalyticsEvents } from "./analytics-aggregation.ts";
import type { AnalyticsEventRecord } from "./analytics-contract.ts";

const event = (overrides: Partial<AnalyticsEventRecord>): AnalyticsEventRecord => ({
  browserFamily: "Chrome", competitionId: null, deviceCategory: "desktop", eventType: "page_view", matchId: null,
  occurredAt: "2026-08-03T10:00:00.000Z", path: "/", referrer: null, sessionId: "session-1", sponsorId: null, visitorId: "visitor-1", ...overrides,
});

test("aggregates today, seven-day and thirty-day dashboard metrics from anonymous events", () => {
  const events = [
    event({ eventType: "page_view" }),
    event({ eventType: "competition_view", sessionId: "session-2", visitorId: "visitor-2" }),
    event({ eventType: "sponsor_click", sessionId: "session-2", visitorId: "visitor-2" }),
    event({ occurredAt: "2026-06-01T10:00:00.000Z" }),
  ];
  assert.deepEqual(aggregateAnalyticsEvents(events, new Date("2026-08-03T00:00:00.000Z"), new Date("2026-08-04T00:00:00.000Z")), {
    competitionViews: 1, pageViews: 1, sessions: 2, sponsorClicks: 1, uniqueVisitors: 2,
  });
});

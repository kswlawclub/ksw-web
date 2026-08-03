import type { AnalyticsEventRecord } from "./analytics-contract";

export type AnalyticsPeriodSummary = {
  competitionViews: number;
  pageViews: number;
  sessions: number;
  sponsorClicks: number;
  uniqueVisitors: number;
};

export function aggregateAnalyticsEvents(events: AnalyticsEventRecord[], from: Date, until: Date): AnalyticsPeriodSummary {
  const inPeriod = events.filter((event) => {
    const occurredAt = new Date(event.occurredAt).getTime();
    return Number.isFinite(occurredAt) && occurredAt >= from.getTime() && occurredAt < until.getTime();
  });
  return {
    competitionViews: inPeriod.filter((event) => event.eventType === "competition_view").length,
    pageViews: inPeriod.filter((event) => event.eventType === "page_view").length,
    sessions: new Set(inPeriod.map((event) => event.sessionId)).size,
    sponsorClicks: inPeriod.filter((event) => event.eventType === "sponsor_click").length,
    uniqueVisitors: new Set(inPeriod.map((event) => event.visitorId)).size,
  };
}

export function analyticsPeriodStart(now: Date, days: 1 | 7 | 30) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

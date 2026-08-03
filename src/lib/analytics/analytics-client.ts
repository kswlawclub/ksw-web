"use client";

import type { AnalyticsEventPayload } from "./analytics-contract";

const dispatched = new Set<string>();

export function trackAnalyticsEvent(event: Omit<AnalyticsEventPayload, "path" | "referrer"> & Partial<Pick<AnalyticsEventPayload, "path" | "referrer">>) {
  if (typeof window === "undefined") return;
  const payload: AnalyticsEventPayload = {
    ...event,
    path: event.path ?? window.location.pathname,
    referrer: event.referrer ?? document.referrer,
  };
  const key = `${payload.eventType}:${payload.path}:${payload.competitionId ?? ""}:${payload.matchId ?? ""}:${payload.sponsorId ?? ""}`;
  if (dispatched.has(key)) return;
  dispatched.add(key);
  void fetch("/api/analytics/events", { body: JSON.stringify(payload), credentials: "same-origin", headers: { "content-type": "application/json" }, keepalive: true, method: "POST" }).catch(() => undefined);
}

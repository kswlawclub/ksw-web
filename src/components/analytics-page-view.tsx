"use client";

import { useEffect } from "react";
import { trackAnalyticsEvent } from "@/lib/analytics/analytics-client";
import type { AnalyticsEventType } from "@/lib/analytics/analytics-contract";

type AnalyticsPageViewProps = { competitionId?: string; eventTypes?: AnalyticsEventType[] };

export function AnalyticsPageView({ competitionId, eventTypes = ["page_view"] }: AnalyticsPageViewProps) {
  useEffect(() => {
    eventTypes.forEach((eventType) => trackAnalyticsEvent({ competitionId, eventType }));
  }, [competitionId, eventTypes]);
  return null;
}

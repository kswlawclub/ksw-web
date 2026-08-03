"use client";

import type { ComponentProps } from "react";
import { trackAnalyticsEvent } from "@/lib/analytics/analytics-client";

type AnalyticsSponsorLinkProps = ComponentProps<"a"> & { sponsorId: string };

export function AnalyticsSponsorLink({ children, onClick, sponsorId, ...props }: AnalyticsSponsorLinkProps) {
  return <a {...props} onClick={(event) => { trackAnalyticsEvent({ eventType: "sponsor_click", sponsorId }); onClick?.(event); }}>{children}</a>;
}

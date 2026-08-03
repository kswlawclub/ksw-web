export const analyticsEventTypes = ["page_view", "competition_view", "gallery_view", "sponsor_click", "external_link"] as const;

export type AnalyticsEventType = (typeof analyticsEventTypes)[number];

export type AnalyticsEventPayload = {
  competitionId?: string | null;
  eventType: AnalyticsEventType;
  matchId?: string | null;
  path: string;
  referrer?: string | null;
  sponsorId?: string | null;
};

export type AnalyticsEventRecord = AnalyticsEventPayload & {
  browserFamily: string;
  deviceCategory: "desktop" | "mobile" | "tablet" | "unknown";
  occurredAt: string;
  sessionId: string;
  visitorId: string;
};

export const ANALYTICS_VISITOR_COOKIE = "ksw_visitor";
export const ANALYTICS_SESSION_COOKIE = "ksw_session";
export const ANALYTICS_VISITOR_MAX_AGE = 60 * 60 * 24 * 365;
export const ANALYTICS_SESSION_MAX_AGE = 60 * 30;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function sanitizeAnalyticsPath(value: unknown) {
  const raw = text(value);
  if (!raw || !raw.startsWith("/")) return null;
  const path = raw.split(/[?#]/, 1)[0] ?? "";
  return path.length > 0 && path.length <= 200 ? path : null;
}

export function sanitizeAnalyticsReferrer(value: unknown, origin: string) {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.origin === origin ? sanitizeAnalyticsPath(url.pathname) : url.origin;
  } catch {
    return null;
  }
}

export function validateAnalyticsEvent(value: unknown): AnalyticsEventPayload | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const eventType = text(input.eventType) as AnalyticsEventType;
  const path = sanitizeAnalyticsPath(input.path);
  const competitionId = text(input.competitionId);
  const matchId = text(input.matchId);
  const sponsorId = text(input.sponsorId);
  if (!analyticsEventTypes.includes(eventType) || !path) return null;
  if ((competitionId && !isUuid(competitionId)) || (matchId && !isUuid(matchId)) || (sponsorId && !isUuid(sponsorId))) return null;
  return { competitionId: competitionId || null, eventType, matchId: matchId || null, path, referrer: text(input.referrer) || null, sponsorId: sponsorId || null };
}

export function analyticsUserAgent(userAgent: string) {
  const value = userAgent.toLowerCase();
  const deviceCategory = /ipad|tablet/.test(value) ? "tablet" : /mobi|android|iphone/.test(value) ? "mobile" : value ? "desktop" : "unknown";
  const browserFamily = /edg\//.test(value) ? "Edge" : /firefox\//.test(value) ? "Firefox" : /chrome\//.test(value) ? "Chrome" : /safari\//.test(value) ? "Safari" : "Other";
  return { browserFamily, deviceCategory } as const;
}

export function analyticsDuplicateKey(event: Pick<AnalyticsEventPayload, "eventType" | "path">, sessionId: string) {
  return `${sessionId}:${event.eventType}:${event.path}`;
}

export function isAnalyticsDuplicate(lastSeenAt: number | undefined, now: number, windowMs = 15_000) {
  return typeof lastSeenAt === "number" && now - lastSeenAt < windowMs;
}

import { NextRequest, NextResponse } from "next/server";
import {
  ANALYTICS_SESSION_COOKIE,
  ANALYTICS_SESSION_MAX_AGE,
  ANALYTICS_VISITOR_COOKIE,
  ANALYTICS_VISITOR_MAX_AGE,
  analyticsDuplicateKey,
  analyticsUserAgent,
  isAnalyticsDuplicate,
  sanitizeAnalyticsReferrer,
  validateAnalyticsEvent,
} from "@/lib/analytics/analytics-contract";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const recentEvents = new Map<string, number>();
const DEDUPE_WINDOW_MS = 15_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;
const recentBySession = new Map<string, number[]>();

function validId(value: string | undefined) {
  return Boolean(value && /^[0-9a-f-]{36}$/i.test(value));
}

function setAnalyticsCookies(response: NextResponse, visitorId: string, sessionId: string) {
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(ANALYTICS_VISITOR_COOKIE, visitorId, { httpOnly: true, maxAge: ANALYTICS_VISITOR_MAX_AGE, path: "/", sameSite: "lax", secure });
  response.cookies.set(ANALYTICS_SESSION_COOKIE, sessionId, { httpOnly: true, maxAge: ANALYTICS_SESSION_MAX_AGE, path: "/", sameSite: "lax", secure });
}

function isAllowed(sessionId: string, eventKey: string, now: number) {
  const duplicateAt = recentEvents.get(eventKey);
  if (isAnalyticsDuplicate(duplicateAt, now, DEDUPE_WINDOW_MS)) return false;
  const timestamps = (recentBySession.get(sessionId) ?? []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT) return false;
  timestamps.push(now);
  recentBySession.set(sessionId, timestamps);
  recentEvents.set(eventKey, now);
  return true;
}

export async function POST(request: NextRequest) {
  const origin = request.nextUrl.origin;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ accepted: false, error: "invalid_payload" }, { status: 400 });
  }
  const event = validateAnalyticsEvent(payload);
  if (!event) return NextResponse.json({ accepted: false, error: "invalid_event" }, { status: 400 });

  const visitorId = validId(request.cookies.get(ANALYTICS_VISITOR_COOKIE)?.value) ? request.cookies.get(ANALYTICS_VISITOR_COOKIE)?.value as string : crypto.randomUUID();
  const sessionId = validId(request.cookies.get(ANALYTICS_SESSION_COOKIE)?.value) ? request.cookies.get(ANALYTICS_SESSION_COOKIE)?.value as string : crypto.randomUUID();
  const response = NextResponse.json({ accepted: true });
  setAnalyticsCookies(response, visitorId, sessionId);

  const now = Date.now();
  if (!isAllowed(sessionId, analyticsDuplicateKey(event, sessionId), now)) return response;
  const supabase = getSupabaseAdmin();
  if (!supabase) return response;

  const userAgent = analyticsUserAgent(request.headers.get("user-agent") ?? "");
  const insert = await supabase.from("analytics_events").insert({
    browser_family: userAgent.browserFamily,
    competition_id: event.competitionId,
    device_category: userAgent.deviceCategory,
    event_type: event.eventType,
    match_id: event.matchId,
    occurred_at: new Date(now).toISOString(),
    page_path: event.path,
    referrer: sanitizeAnalyticsReferrer(event.referrer, origin),
    session_id: sessionId,
    sponsor_id: event.sponsorId,
    visitor_id: visitorId,
  });
  if (insert.error) console.error("analytics ingestion failed", { code: insert.error.code, message: insert.error.message });
  return response;
}

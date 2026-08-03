import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYTICS_SESSION_MAX_AGE,
  ANALYTICS_VISITOR_MAX_AGE,
  analyticsDuplicateKey,
  analyticsUserAgent,
  isAnalyticsDuplicate,
  sanitizeAnalyticsPath,
  sanitizeAnalyticsReferrer,
  validateAnalyticsEvent,
} from "./analytics-contract.ts";

test("validates only allowlisted analytics events and strips query strings", () => {
  const event = validateAnalyticsEvent({ eventType: "competition_view", path: "/competitions/cup-test?token=secret", competitionId: "0bb4ec55-2cab-4cf4-b24d-00b29ccf9cba" });
  assert.equal(event?.path, "/competitions/cup-test");
  assert.equal(validateAnalyticsEvent({ eventType: "admin_write", path: "/admin" }), null);
  assert.equal(sanitizeAnalyticsPath("https://example.com/private"), null);
  assert.equal(sanitizeAnalyticsReferrer("https://ksw.example/gallery?email=test@example.com", "https://ksw.example"), "/gallery");
});

test("uses privacy-preserving cookie lifetimes and detects duplicate page events", () => {
  assert.equal(ANALYTICS_VISITOR_MAX_AGE > ANALYTICS_SESSION_MAX_AGE, true);
  assert.equal(isAnalyticsDuplicate(1_000, 5_000), true);
  assert.equal(isAnalyticsDuplicate(1_000, 20_000), false);
  assert.equal(analyticsDuplicateKey({ eventType: "page_view", path: "/" }, "session-a"), "session-a:page_view:/");
});

test("derives coarse device and browser categories only", () => {
  assert.deepEqual(analyticsUserAgent("Mozilla/5.0 (iPhone) Version/17.0 Mobile Safari/604.1"), { browserFamily: "Safari", deviceCategory: "mobile" });
});

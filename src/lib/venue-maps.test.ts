import assert from "node:assert/strict";
import test from "node:test";

const { getExplicitVenueMapsUrl, normalizeMapsUrl, validateMapsUrl } = await import(new URL("./venue-maps.ts", import.meta.url).href);

test("accepts valid https and http Maps URLs", () => {
  assert.equal(normalizeMapsUrl("https://maps.google.com/?q=stadium"), "https://maps.google.com/?q=stadium");
  assert.equal(normalizeMapsUrl(" http://maps.google.com/?q=stadium "), "http://maps.google.com/?q=stadium");
});

test("accepts Google Maps short links", () => {
  assert.equal(normalizeMapsUrl("https://maps.app.goo.gl/example"), "https://maps.app.goo.gl/example");
});

test("rejects malformed and unsafe URLs without a venue fallback", () => {
  assert.equal(normalizeMapsUrl("javascript:alert(1)"), null);
  assert.equal(normalizeMapsUrl("data:text/plain,test"), null);
  assert.equal(normalizeMapsUrl("not a URL"), null);
  assert.equal(validateMapsUrl("javascript:alert(1)"), "Google Maps URL ต้องเป็นลิงก์ http/https ที่ถูกต้อง");
});

test("normalizes empty input to null", () => {
  assert.equal(normalizeMapsUrl("   "), null);
  assert.equal(normalizeMapsUrl(null), null);
  assert.equal(validateMapsUrl(""), "");
});

test("only exposes a public Maps URL when both venue and explicit URL exist", () => {
  assert.equal(getExplicitVenueMapsUrl({ mapsUrl: "https://maps.app.goo.gl/example", venueName: "สนามทดสอบ" }), "https://maps.app.goo.gl/example");
  assert.equal(getExplicitVenueMapsUrl({ mapsUrl: null, venueName: "Royal Thai Air Force Stadium Dhupatemiya" }), null);
  assert.equal(getExplicitVenueMapsUrl({ mapsUrl: "https://maps.app.goo.gl/example", venueName: "" }), null);
});

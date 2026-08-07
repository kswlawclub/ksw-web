import assert from "node:assert/strict";
import test from "node:test";

const { getVenueMapsUrl } = await import(new URL("./venue-maps.ts", import.meta.url).href);

test("uses a valid custom Google Maps URL", () => {
  assert.equal(getVenueMapsUrl({ mapsUrl: "https://maps.google.com/?q=stadium", venueName: "สนามทดสอบ" }), "https://maps.google.com/?q=stadium");
});

test("builds a Google Maps search URL from a venue name", () => {
  assert.equal(getVenueMapsUrl({ venueName: "Royal Thai Air Force Stadium Dhupatemiya" }), "https://www.google.com/maps/search/?api=1&query=Royal%20Thai%20Air%20Force%20Stadium%20Dhupatemiya");
});

test("falls back to the venue search for malformed or unsafe custom URLs", () => {
  assert.equal(getVenueMapsUrl({ mapsUrl: "javascript:alert(1)", venueName: "สนามทดสอบ" }), "https://www.google.com/maps/search/?api=1&query=%E0%B8%AA%E0%B8%99%E0%B8%B2%E0%B8%A1%E0%B8%97%E0%B8%94%E0%B8%AA%E0%B8%AD%E0%B8%9A");
  assert.equal(getVenueMapsUrl({ mapsUrl: "not a URL", venueName: "สนามทดสอบ" }), "https://www.google.com/maps/search/?api=1&query=%E0%B8%AA%E0%B8%99%E0%B8%B2%E0%B8%A1%E0%B8%97%E0%B8%94%E0%B8%AA%E0%B8%AD%E0%B8%9A");
});

test("returns null without a custom URL or venue name", () => {
  assert.equal(getVenueMapsUrl({ mapsUrl: "data:text/plain,test", venueName: "" }), null);
});

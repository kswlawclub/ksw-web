import assert from "node:assert/strict";
import test from "node:test";
import { calculateLeagueMatchweekReadiness } from "./league-matchweek-readiness.ts";

test("counts ready and incomplete Standard League fixtures independently", () => {
  assert.deepEqual(calculateLeagueMatchweekReadiness([
    { matchDate: "2026-08-02T10:00:00.000Z", venue: "V1" },
    { matchDate: null, venue: "V2" },
    { matchDate: "2026-08-03T10:00:00.000Z", venue: null },
  ]), { incompleteMatches: 2, matchesWithDateTime: 2, matchesWithVenue: 2, readyMatches: 1, totalMatches: 3 });
});

import assert from "node:assert/strict";
import test from "node:test";
import { featuredCompetitionMatches } from "./home-competition-view-model.ts";

test("Home fixtures and results stay in the featured competition context", () => {
  const matches = [
    { competitionId: "active", matchDate: "2026-08-04T10:00:00Z", status: "scheduled" },
    { competitionId: "active", matchDate: "2026-08-01T10:00:00Z", status: "finished" },
    { competitionId: "archive", matchDate: "2026-08-05T10:00:00Z", status: "scheduled" },
    { competitionId: "archive", matchDate: "2026-08-03T10:00:00Z", status: "finished" },
  ];
  const featured = featuredCompetitionMatches(matches, "active", new Date("2026-08-03T00:00:00Z").getTime());
  assert.deepEqual(featured.fixtures.map((match) => match.competitionId), ["active"]);
  assert.deepEqual(featured.results.map((match) => match.competitionId), ["active"]);
});

test("Upcoming featured competition with no completed match has no latest results", () => {
  const featured = featuredCompetitionMatches([{ competitionId: "upcoming", matchDate: "2026-08-04T10:00:00Z", status: "scheduled" }], "upcoming", new Date("2026-08-03T00:00:00Z").getTime());
  assert.equal(featured.results.length, 0);
});

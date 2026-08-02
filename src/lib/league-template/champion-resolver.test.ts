import assert from "node:assert/strict";
import test from "node:test";
import { resolveStandardLeagueChampion } from "./champion-resolver.ts";

const config = { fixtureStatus: "confirmed" as const, fixtureVersion: 1 };
const finishedMatches = [
  { awayScore: 0, fixtureKey: "leg-1:a:b", homeScore: 1, status: "finished" },
  { awayScore: 1, fixtureKey: "leg-1:a:c", homeScore: 1, status: "completed" },
];

test("returns the sporting leader only after every confirmed fixture is complete", () => {
  assert.deepEqual(resolveStandardLeagueChampion({
    config,
    expectedFixtureCount: 2,
    matches: finishedMatches,
    standings: [
      { goalDifference: 3, goalsFor: 5, points: 6, teamId: "a", wins: 2 },
      { goalDifference: 1, goalsFor: 3, points: 3, teamId: "b", wins: 1 },
    ],
  }), { championTeamId: "a", status: "champion" });

  assert.equal(resolveStandardLeagueChampion({
    config,
    expectedFixtureCount: 2,
    matches: [{ ...finishedMatches[0], status: "scheduled" }, finishedMatches[1]],
    standings: [],
  }).status, "pending");
});

test("never picks a champion through a technical fallback", () => {
  const result = resolveStandardLeagueChampion({
    config,
    expectedFixtureCount: 2,
    matches: finishedMatches,
    standings: [
      { goalDifference: 3, goalsFor: 5, points: 6, teamId: "a", wins: 2 },
      { goalDifference: 3, goalsFor: 5, points: 6, teamId: "b", wins: 2 },
    ],
  });
  assert.equal(result.status, "needs_admin_resolution");
});

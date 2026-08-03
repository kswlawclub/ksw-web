import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeHomeFixtures,
  effectiveHomeMatchweek,
  homeFixturePartitionLabel,
  isHomeFinishedFixture,
  isPublishedHomeCompetition,
} from "./home-competition-contract.ts";

test("Home excludes unpublished competitions", () => {
  assert.equal(isPublishedHomeCompetition({ isPublished: true }), true);
  assert.equal(isPublishedHomeCompetition({ isPublished: false }), false);
});

test("Home uses effective Matchweek and does not duplicate linked knockout fixtures", () => {
  assert.equal(effectiveHomeMatchweek({ id: "league-1", linkedNodeId: null, originalMatchweek: 3, scheduledMatchweek: 6, penaltyAwayScore: null, penaltyHomeScore: null, partitionLabel: null, status: "scheduled" }), 6);
  assert.deepEqual(dedupeHomeFixtures([{ id: "knockout-1" }, { id: "knockout-1" }, { id: "league-1" }]).map((fixture) => fixture.id), ["knockout-1", "league-1"]);
});

test("Home preserves finished penalty results and Council division context", () => {
  assert.equal(isHomeFinishedFixture("completed"), true);
  assert.equal(homeFixturePartitionLabel("division_2"), "Division 2");
  assert.equal(homeFixturePartitionLabel("main"), null);
});

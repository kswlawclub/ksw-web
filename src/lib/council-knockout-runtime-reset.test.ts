import assert from "node:assert/strict";
import test from "node:test";
import { getCouncilKnockoutResetPlan, hasExactCouncilKnockoutResetTargets, type CouncilKnockoutResetInput } from "./council-knockout-runtime-reset.ts";
import { buildCompetitionTree } from "./competition-tree.ts";
import { deriveKnockoutRoundState } from "./knockout-round-engine.ts";

function input(overrides: Partial<CouncilKnockoutResetInput> = {}): CouncilKnockoutResetInput {
  return {
    matches: [],
    nodes: [],
    partitions: [
      { partitionKey: "division_1" },
      { partitionKey: "division_2" },
    ],
    seasonStatus: "active",
    ...overrides,
  };
}

test("allows resetting bracket nodes with no knockout match", () => {
  const inspection = getCouncilKnockoutResetPlan(input({ nodes: [{ id: "node-1" }, { id: "node-2" }] }));

  assert.equal(inspection.canReset, true);
  assert.deepEqual(inspection.plan?.nodeIds, ["node-1", "node-2"]);
  assert.deepEqual(inspection.plan?.matchIds, []);
  assert.deepEqual(inspection.plan?.linkedNodeIds, []);
});

test("allows scheduled and pending draft fixtures, including linked nodes", () => {
  const inspection = getCouncilKnockoutResetPlan(input({
    matches: [
      { id: "match-scheduled", status: "scheduled", homeScore: null, awayScore: null },
      { id: "match-pending", status: "pending", homeScore: null, awayScore: null },
    ],
    nodes: [{ id: "node-1", linkedMatchId: "match-scheduled" }, { id: "node-2", linkedMatchId: "match-pending" }],
  }));

  assert.equal(inspection.canReset, true);
  assert.deepEqual(inspection.plan?.linkedNodeIds, ["node-1", "node-2"]);
  assert.deepEqual(inspection.plan?.matchIds, ["match-scheduled", "match-pending"]);
});

test("level A plan clears only knockout draft ids and preserves division approval inputs", () => {
  const inspection = getCouncilKnockoutResetPlan(input({
    matches: [{ id: "match-1", status: "scheduled" }],
    nodes: [{ id: "node-1", linkedMatchId: "match-1" }],
  }));

  assert.equal(inspection.canReset, true);
  assert.deepEqual(inspection.plan?.partitionKeys, ["division_1", "division_2"]);
  assert.ok(inspection.plan?.preserves.includes("division_approval"));
  assert.ok(inspection.plan?.preserves.includes("qualification_snapshot"));
  assert.ok(inspection.plan?.preserves.includes("group_fixtures_and_results"));
});

test("level B can reuse the same safe plan before reopening division approval", () => {
  const inspection = getCouncilKnockoutResetPlan(input({ nodes: [{ id: "node-1" }] }));

  assert.equal(inspection.canReset, true);
  assert.ok(inspection.plan);
  // The division action applies its existing approval-to-draft RPC only after this plan succeeds.
  assert.ok(inspection.plan.preserves.includes("division_approval"));
});

for (const [name, override, code] of [
  ["completed competition", { seasonStatus: "completed" }, "competition_completed"],
  ["persisted division champion", { partitions: [{ partitionKey: "division_1", championTeamId: "team-1" }] }, "division_champion_persisted"],
  ["home score", { matches: [{ id: "match-1", status: "scheduled", homeScore: 1 }] }, "knockout_score_exists"],
  ["away score", { matches: [{ id: "match-1", status: "scheduled", awayScore: 1 }] }, "knockout_score_exists"],
  ["penalty score", { matches: [{ id: "match-1", status: "scheduled", penaltyHomeScore: 4 }] }, "knockout_score_exists"],
  ["winner", { matches: [{ id: "match-1", status: "scheduled", winnerTeamId: "team-1" }] }, "knockout_winner_exists"],
  ["manual winner", { matches: [{ id: "match-1", status: "scheduled", manualWinnerTeamId: "team-1" }] }, "knockout_winner_exists"],
  ["finished match", { matches: [{ id: "match-1", status: "finished" }] }, "knockout_match_completed"],
  ["completed match", { matches: [{ id: "match-1", status: "completed" }] }, "knockout_match_completed"],
] as const) {
  test(`blocks reset for ${name}`, () => {
    const inspection = getCouncilKnockoutResetPlan(input(override));
    assert.equal(inspection.canReset, false);
    assert.equal(inspection.plan, null);
    assert.ok(inspection.blockers.some((blocker) => blocker.code === code));
  });
}

test("a played Division 2 blocks the combined Council reset", () => {
  const inspection = getCouncilKnockoutResetPlan(input({
    matches: [{ id: "division-2-final", status: "finished", winnerTeamId: "team-8" }],
    nodes: [{ id: "division-1-draft" }, { id: "division-2-final", linkedMatchId: "division-2-final" }],
  }));

  assert.equal(inspection.canReset, false);
  assert.equal(inspection.plan, null);
  assert.ok(inspection.blockingReasons.includes("มีผู้ชนะที่บันทึกแล้ว"));
});

test("the shared inspection is reusable by both UI and server reset paths", () => {
  const inspection = getCouncilKnockoutResetPlan(input({
    matches: [{ id: "match-1", status: "scheduled" }],
    nodes: [{ id: "node-1", linkedMatchId: "match-1" }],
  }));

  assert.equal(inspection.canReset, true);
  assert.deepEqual(inspection.plan?.matchIds, ["match-1"]);
  assert.deepEqual(inspection.plan?.nodeIds, ["node-1"]);
});

test("affected rows must exactly match the inspected reset plan", () => {
  assert.equal(hasExactCouncilKnockoutResetTargets(["node-2", "node-1"], ["node-1", "node-2"]), true);
  assert.equal(hasExactCouncilKnockoutResetTargets(["node-1"], ["node-1", "node-2"]), false);
  assert.equal(hasExactCouncilKnockoutResetTargets(["node-1", "node-3"], ["node-1", "node-2"]), false);
  assert.equal(hasExactCouncilKnockoutResetTargets(null, ["node-1"]), false);
});

test("a regenerated draft starts the round engine at the first round with no fixtures", () => {
  let sequence = 0;
  const nodes = buildCompetitionTree({
    bracketCapacity: 4,
    competitionId: "competition-1",
    entrantCount: 4,
    entryMode: "custom",
    entrants: Array.from({ length: 4 }, (_, index) => ({ teamId: `team-${index + 1}`, type: "manual_team" as const })),
    idFactory: () => `node-${++sequence}`,
    partitionKey: "division_1",
  }).nodes;
  const runtime = deriveKnockoutRoundState({ matches: [], nodes, partitionKey: "division_1" });

  assert.equal(runtime.currentRound?.roundIndex, 0);
  assert.equal(runtime.currentRound?.linkedMatchCount, 0);
  assert.equal(runtime.firstPlayableRound?.roundIndex, 0);
});

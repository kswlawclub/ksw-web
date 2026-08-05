import assert from "node:assert/strict";
import test from "node:test";
import { getKnockoutTemplateSwitchGuard } from "./knockout-template-switching.ts";
import { findUnmaterializedKnockoutDraftAssignments } from "./unmaterialized-knockout-draft-cleanup.ts";

const skeletonNode = {
  awaySource: { type: "unassigned" as const },
  bracketPosition: 1,
  competitionId: "competition",
  homeSource: { groupId: "group-a", rank: 1, teamId: "team-a", type: "group_rank" as const },
  id: "node-1",
  matchOrder: 1,
  roundIndex: 0,
  roundLabel: "Quarterfinal",
};

test("selects an unverified non-manual draft team assignment and makes the guard allow after cleanup", () => {
  const cleanup = findUnmaterializedKnockoutDraftAssignments({ matches: [], nodes: [skeletonNode], qualificationSnapshot: [] });
  assert.deepEqual(cleanup, [{ awayTeamId: false, homeTeamId: true, nodeId: "node-1" }]);

  const clearedNode = { ...skeletonNode, homeSource: { ...skeletonNode.homeSource, teamId: undefined } };
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [], nodes: [clearedNode], qualificationSnapshot: [] }).allowed, true);
});

test("never selects manual, legacy, linked, fixture, or played knockout data", () => {
  const manual = { ...skeletonNode, homeSource: { teamId: "team-a", type: "manual_team" as const } };
  const legacy = { ...skeletonNode, homeSource: { teamId: "team-a", type: "legacy_source" as unknown as "group_rank" } };
  const linked = { ...skeletonNode, linkedMatchId: "fixture-1" };

  assert.deepEqual(findUnmaterializedKnockoutDraftAssignments({ matches: [], nodes: [manual], qualificationSnapshot: [] }), []);
  assert.deepEqual(findUnmaterializedKnockoutDraftAssignments({ matches: [], nodes: [legacy], qualificationSnapshot: [] }), []);
  assert.deepEqual(findUnmaterializedKnockoutDraftAssignments({ matches: [], nodes: [linked], qualificationSnapshot: [] }), []);
  assert.deepEqual(findUnmaterializedKnockoutDraftAssignments({ matches: [{ id: "fixture-1", status: "scheduled", winnerTeamId: null }], nodes: [skeletonNode], qualificationSnapshot: [] }), []);
  assert.deepEqual(findUnmaterializedKnockoutDraftAssignments({ matches: [{ id: "fixture-1", status: "finished", winnerTeamId: "team-a" }], nodes: [skeletonNode], qualificationSnapshot: [] }), []);
});

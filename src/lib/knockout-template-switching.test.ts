import assert from "node:assert/strict";
import test from "node:test";
import { getKnockoutTemplateSwitchGuard, hasResolvedBracketPairing, isTopologyOnlyNode } from "./knockout-template-switching.ts";

const skeletonNode = {
  awaySource: { type: "unassigned" as const },
  bracketPosition: 1,
  competitionId: "competition",
  homeSource: { groupId: "group-a", rank: 1, type: "group_rank" as const },
  id: "node-1",
  matchOrder: 1,
  roundIndex: 0,
  roundLabel: "Quarterfinal",
};

test("allows template switching for empty bracket topology without a knockout match", () => {
  assert.deepEqual(getKnockoutTemplateSwitchGuard({ matches: [], nodes: [skeletonNode] }), { allowed: true });
  assert.equal(isTopologyOnlyNode(skeletonNode), true);
  assert.equal(hasResolvedBracketPairing(skeletonNode), false);
});

test("blocks template switching after a concrete team has been assigned to a node", () => {
  const node = { ...skeletonNode, homeSource: { teamId: "team-1", type: "manual_team" as const } };
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [], nodes: [node] }).allowed, false);
  assert.equal(isTopologyOnlyNode(node), false);
});

test("blocks template switching after fixtures or results exist", () => {
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [{ status: "scheduled", winnerTeamId: null }], nodes: [skeletonNode] }).allowed, false);
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [{ status: "finished", winnerTeamId: "team-1" }], nodes: [] }).allowed, false);
});

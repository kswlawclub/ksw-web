import assert from "node:assert/strict";
import test from "node:test";
import { getKnockoutTemplateSwitchGuard, hasResolvedBracketPairing, inspectKnockoutTemplateSwitchState, isTopologyOnlyNode } from "./knockout-template-switching.ts";

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
  assert.deepEqual(getKnockoutTemplateSwitchGuard({ matches: [], nodes: [skeletonNode] }), { allowed: true, code: "allowed", reason: undefined });
  assert.equal(isTopologyOnlyNode(skeletonNode), true);
  assert.equal(hasResolvedBracketPairing(skeletonNode), false);
  assert.equal(inspectKnockoutTemplateSwitchState({ matches: [], nodes: [skeletonNode] }).resettableNodes.length, 1);
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

test("reports the exact blocking source for nodes and fixtures", () => {
  const assignedNode = { ...skeletonNode, id: "assigned", homeSource: { teamId: "team-1", type: "manual_team" as const } };
  const nodeDiagnostic = inspectKnockoutTemplateSwitchState({ matches: [], nodes: [skeletonNode, assignedNode] });
  assert.equal(nodeDiagnostic.code, "team_assigned");
  assert.equal(nodeDiagnostic.blockingNodes[0]?.node.id, "assigned");
  assert.equal(nodeDiagnostic.resettableNodes[0]?.id, "node-1");

  const fixtureDiagnostic = inspectKnockoutTemplateSwitchState({ matches: [{ id: "fixture-1", status: "scheduled", winnerTeamId: null }], nodes: [skeletonNode] });
  assert.equal(fixtureDiagnostic.code, "fixture_created");
  assert.equal(fixtureDiagnostic.fixtures[0]?.match.id, "fixture-1");
});

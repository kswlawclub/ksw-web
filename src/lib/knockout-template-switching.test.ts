import assert from "node:assert/strict";
import test from "node:test";
import { classifyKnockoutNodeState, getKnockoutTemplateSwitchGuard, hasResolvedBracketPairing, inspectKnockoutTemplateSwitchState, isTopologyOnlyNode, topologySourceTeamId } from "./knockout-template-switching.ts";

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

test("keeps template source drafts switchable and blocks only materialized pairings", () => {
  const invalid = { ...skeletonNode, id: "invalid", homeSource: { teamId: "team-1", type: "unassigned" as const } };
  const groupRank = { ...skeletonNode, id: "group-rank", homeSource: { groupId: "group-a", rank: 1, teamId: "team-3", type: "group_rank" as const } };
  const nodeWinner = { ...skeletonNode, id: "node-winner", homeSource: { nodeId: "source-node", teamId: "team-4", type: "node_winner" as const } };
  const direct = { ...skeletonNode, id: "direct", homeSource: { teamId: "team-2", type: "manual_team" as const } };
  const legacy = { ...skeletonNode, id: "legacy", homeSource: { teamId: "team-5", type: "legacy_source" } };
  const linked = { ...invalid, id: "linked", linkedMatchId: "match-1" };
  const derivedSources = [groupRank.homeSource];

  assert.equal(classifyKnockoutNodeState(skeletonNode), "source_draft");
  assert.equal(classifyKnockoutNodeState(invalid), "materialized_pairing");
  assert.equal(classifyKnockoutNodeState(groupRank), "materialized_pairing");
  assert.equal(classifyKnockoutNodeState(groupRank, derivedSources), "source_draft");
  assert.equal(classifyKnockoutNodeState(nodeWinner), "materialized_pairing");
  assert.equal(classifyKnockoutNodeState(direct), "materialized_pairing");
  assert.equal(classifyKnockoutNodeState(legacy), "materialized_pairing");
  assert.equal(classifyKnockoutNodeState(linked), "materialized_pairing");
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [], nodes: [skeletonNode] }).allowed, true);
  assert.equal(getKnockoutTemplateSwitchGuard({ derivedSources, matches: [], nodes: [groupRank] }).allowed, true);
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [], nodes: [groupRank] }).code, "team_assigned");
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [], nodes: [nodeWinner] }).code, "team_assigned");
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [], nodes: [legacy] }).code, "team_assigned");
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [], nodes: [direct] }).code, "team_assigned");
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [{ status: "scheduled", winnerTeamId: null }], nodes: [invalid] }).code, "fixture_created");
  assert.equal(topologySourceTeamId("unassigned", "team-1"), null);
  assert.equal(topologySourceTeamId("group_rank", "team-1"), null);
  assert.equal(topologySourceTeamId("node_winner", "team-1"), null);
  assert.equal(topologySourceTeamId("manual_team", "team-1"), "team-1");
});

test("allows repeated standard and council template switches before the first knockout fixture", () => {
  const standardDraft = {
    ...skeletonNode,
    id: "standard-quarterfinal",
    homeSource: { groupId: "group-a", rank: 1, teamId: "team-a", type: "group_rank" as const },
    awaySource: { bestOrder: 1, teamId: "team-b", type: "best_ranked" as const },
  };
  const councilDraft = {
    ...skeletonNode,
    id: "council-quarterfinal",
    homeSource: { groupId: "group-a", rank: 1, type: "group_rank" as const },
    awaySource: { nodeId: "previous-round", type: "node_winner" as const },
  };
  const derivedSources = [standardDraft.homeSource, standardDraft.awaySource];

  assert.equal(getKnockoutTemplateSwitchGuard({ derivedSources, matches: [], nodes: [standardDraft] }).allowed, true);
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [], nodes: [councilDraft] }).allowed, true);
  assert.equal(getKnockoutTemplateSwitchGuard({ derivedSources, matches: [], nodes: [standardDraft, councilDraft] }).allowed, true);
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [], nodes: [{ ...standardDraft, linkedMatchId: "fixture-1" }] }).code, "linked_match");
});

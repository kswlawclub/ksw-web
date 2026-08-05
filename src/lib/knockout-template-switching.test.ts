import assert from "node:assert/strict";
import test from "node:test";
import { classifyKnockoutNodeState, getKnockoutTemplateSwitchGuard, hasResolvedBracketPairing, topologySourceTeamId } from "./knockout-template-switching.ts";

const skeletonNode = {
  awaySource: { type: "unassigned" as const },
  homeSource: { groupId: "group-a", rank: 1, type: "group_rank" as const },
  id: "node-1",
};

test("allows an empty skeleton and source metadata without a team or match", () => {
  const winnerSource = { ...skeletonNode, id: "winner-source", homeSource: { nodeId: "prior-node", type: "node_winner" as const } };
  const guard = getKnockoutTemplateSwitchGuard({ matches: [], nodes: [skeletonNode, winnerSource] });

  assert.equal(classifyKnockoutNodeState(skeletonNode), "draft");
  assert.equal(classifyKnockoutNodeState(winnerSource), "draft");
  assert.equal(guard.allowed, true);
  assert.equal(guard.reasonCode, "allowed_draft_only");
  assert.deepEqual(guard.resettableNodeIds, ["node-1", "winner-source"]);
});

test("allows a qualification-derived team resolution only when its approved source matches", () => {
  const node = { ...skeletonNode, homeSource: { groupId: "group-a", rank: 1, teamId: "team-a", type: "group_rank" as const } };
  const qualificationSnapshot = [{ groupId: "group-a", rank: 1, teamId: "team-a", type: "group_rank" as const }];

  assert.equal(classifyKnockoutNodeState(node), "confirmed_draft");
  assert.equal(classifyKnockoutNodeState(node, { qualificationSnapshot }), "resolved_draft");
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [], nodes: [node], qualificationSnapshot }).allowed, true);
});

test("keeps confirmed source assignments resettable until a knockout fixture exists", () => {
  const manual = { ...skeletonNode, id: "manual", homeSource: { teamId: "team-a", type: "manual_team" as const } };
  const unknown = { ...skeletonNode, id: "unknown", homeSource: { teamId: "team-b", type: "legacy_source" } };
  const unassigned = { ...skeletonNode, id: "unassigned", homeSource: { teamId: "team-c", type: "unassigned" as const } };
  const winner = { ...skeletonNode, id: "winner", homeSource: { nodeId: "prior", teamId: "team-d", type: "node_winner" as const } };

  [manual, unknown, unassigned, winner].forEach((node) => {
    const guard = getKnockoutTemplateSwitchGuard({ matches: [], nodes: [node] });
    assert.equal(classifyKnockoutNodeState(node), "confirmed_draft");
    assert.equal(guard.allowed, true);
    assert.equal(guard.reasonCode, "allowed_confirmed_draft");
    assert.deepEqual(guard.resettableNodeIds, [node.id]);
  });
});

test("blocks linked fixtures and knockout results", () => {
  const linked = { ...skeletonNode, linkedMatchId: "fixture-1" };
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [], nodes: [linked] }).reasonCode, "linked_knockout_match");
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [{ id: "fixture-1", status: "scheduled", winnerTeamId: null }], nodes: [skeletonNode] }).reasonCode, "linked_knockout_match");
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [{ id: "fixture-1", status: "finished", winnerTeamId: "team-a" }], nodes: [linked] }).reasonCode, "knockout_result_exists");
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [{ id: "fixture-1", penaltyHomeScore: 4, status: "scheduled", winnerTeamId: null }], nodes: [] }).reasonCode, "knockout_result_exists");
  assert.equal(classifyKnockoutNodeState(linked, { matches: [{ id: "fixture-1", status: "finished", winnerTeamId: "team-a" }] }), "played");
});

test("allows Standard to Council to Standard before materialization and blocks afterward", () => {
  const standard = { ...skeletonNode, id: "standard", homeSource: { groupId: "group-a", rank: 1, teamId: "team-a", type: "group_rank" as const }, awaySource: { bestOrder: 1, rank: 3, teamId: "team-b", type: "best_ranked" as const } };
  const council = { ...skeletonNode, id: "council", homeSource: { groupId: "group-a", rank: 1, type: "group_rank" as const }, awaySource: { nodeId: "prior", type: "node_winner" as const } };
  const qualificationSnapshot = [standard.homeSource, standard.awaySource];

  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [], nodes: [standard], qualificationSnapshot }).allowed, true);
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [], nodes: [council], qualificationSnapshot }).allowed, true);
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [], nodes: [standard, council], qualificationSnapshot }).allowed, true);
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [], nodes: [{ ...standard, homeSource: { teamId: "team-a", type: "manual_team" as const } }], qualificationSnapshot }).allowed, true);
  assert.equal(getKnockoutTemplateSwitchGuard({ matches: [{ id: "fixture-1", status: "scheduled", winnerTeamId: null }], nodes: [standard], qualificationSnapshot }).allowed, false);
});

test("keeps the public visibility adapter independent from the Admin switch guard", () => {
  assert.equal(hasResolvedBracketPairing(skeletonNode), false);
  assert.equal(hasResolvedBracketPairing({ ...skeletonNode, linkedMatchId: "fixture-1" }), true);
  assert.equal(hasResolvedBracketPairing({ ...skeletonNode, awaySource: { teamId: "away", type: "manual_team" }, homeSource: { teamId: "home", type: "manual_team" } }), true);
  assert.equal(topologySourceTeamId("group_rank", "team-a"), null);
  assert.equal(topologySourceTeamId("manual_team", "team-a"), "team-a");
});

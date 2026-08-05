import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKnockoutMatchReadinessByMatchId,
  getKnockoutMatchPresentation,
  isKnockoutMatchReadyForEditing,
  isKnockoutRoundReadyForFixtures,
} from "./knockout-round-readiness.ts";
import type { CompetitionTreeNode } from "./competition-tree.ts";

function node(input: Partial<CompetitionTreeNode>): CompetitionTreeNode {
  return {
    awaySource: { teamId: "away", type: "manual_team" },
    bracketPosition: 1,
    competitionId: "competition",
    homeSource: { teamId: "home", type: "manual_team" },
    id: "node",
    matchOrder: 1,
    partitionKey: "division_1",
    roundIndex: 0,
    roundLabel: "Quarterfinal",
    ...input,
  };
}

test("first-round nodes with two teams are ready for fixtures and editing", () => {
  const firstRound = node({ id: "quarter" });
  assert.equal(isKnockoutRoundReadyForFixtures([firstRound], { matches: [], nodes: [firstRound] }).ready, true);
  assert.equal(isKnockoutMatchReadyForEditing(firstRound, { matches: [], nodes: [firstRound] }).ready, true);
});

test("a node winner stays read-only until its linked source match is finished with a winner", () => {
  const quarter = node({ id: "quarter", linkedMatchId: "quarter-match" });
  const semifinal = node({ id: "semi", homeSource: { nodeId: "quarter", type: "node_winner" } });
  const context = { matches: [{ id: "quarter-match", status: "scheduled", winner_team_id: null }], nodes: [quarter, semifinal] };
  assert.equal(isKnockoutMatchReadyForEditing(semifinal, context).ready, false);
  assert.deepEqual(isKnockoutMatchReadyForEditing(semifinal, context).waitingNodeIds, ["quarter"]);
});

test("a downstream round becomes ready only after every source match has a winner", () => {
  const left = node({ id: "left", linkedMatchId: "left-match" });
  const right = node({ id: "right", linkedMatchId: "right-match" });
  const final = node({ id: "final", homeSource: { nodeId: "left", type: "node_winner" }, awaySource: { nodeId: "right", type: "node_winner" } });
  const partial = { matches: [{ id: "left-match", status: "finished", winner_team_id: "team-a" }, { id: "right-match", status: "finished", winner_team_id: null }], nodes: [left, right, final] };
  assert.equal(isKnockoutMatchReadyForEditing(final, partial).ready, false);
  const complete = { matches: [{ id: "left-match", status: "finished", winner_team_id: "team-a" }, { id: "right-match", status: "completed", winner_team_id: "team-b" }], nodes: [left, right, final] };
  assert.equal(isKnockoutMatchReadyForEditing(final, complete).ready, true);
});

test("a scheduled upstream fixture never makes the next Council division round ready", () => {
  const division1Quarter = node({ id: "division-1-quarter", linkedMatchId: "division-1-match", partitionKey: "division_1" });
  const division2Quarter = node({ id: "division-2-quarter", linkedMatchId: "division-2-match", partitionKey: "division_2" });
  const division1Semifinal = node({
    id: "division-1-semi",
    homeSource: { nodeId: "division-1-quarter", type: "node_winner" },
    partitionKey: "division_1",
  });
  const division2Semifinal = node({
    id: "division-2-semi",
    homeSource: { nodeId: "division-2-quarter", type: "node_winner" },
    partitionKey: "division_2",
  });
  const context = {
    matches: [
      { id: "division-1-match", status: "finished", winner_team_id: "d1-winner" },
      { id: "division-2-match", status: "scheduled", winner_team_id: null },
    ],
    nodes: [division1Quarter, division2Quarter, division1Semifinal, division2Semifinal],
  };

  assert.equal(isKnockoutMatchReadyForEditing(division1Semifinal, context).ready, true);
  assert.equal(isKnockoutMatchReadyForEditing(division2Semifinal, context).ready, false);
  assert.equal(isKnockoutRoundReadyForFixtures([division2Semifinal], context).ready, false);
});

test("a missing readiness entry is fail-safe while waiting and ready entries retain their presentation", () => {
  assert.deepEqual(getKnockoutMatchPresentation(undefined), { editable: false, state: "missing" });
  assert.deepEqual(getKnockoutMatchPresentation({ away: { ready: true, teamId: "away", waitingNodeId: null }, home: { ready: false, teamId: null, waitingNodeId: "quarter" }, ready: false, waitingNodeIds: ["quarter"] }), { editable: false, state: "waiting" });
  assert.deepEqual(getKnockoutMatchPresentation({ away: { ready: true, teamId: "away", waitingNodeId: null }, home: { ready: true, teamId: "home", waitingNodeId: null }, ready: true, waitingNodeIds: [] }), { editable: true, state: "ready" });
});

test("a linked fixture without a matching readiness entry remains read-only", () => {
  const readinessByMatchId = buildKnockoutMatchReadinessByMatchId({
    matches: [{ id: "linked-fixture", status: "scheduled", winner_team_id: null }],
    nodes: [],
  });

  assert.deepEqual(getKnockoutMatchPresentation(readinessByMatchId.get("linked-fixture")), { editable: false, state: "missing" });
});

test("readiness is keyed by linked match id without crossing Council divisions", () => {
  const division1 = node({ id: "d1-node", linkedMatchId: "d1-match", partitionKey: "division_1" });
  const division2 = node({ id: "d2-node", linkedMatchId: "d2-match", partitionKey: "division_2" });
  const readinessByMatchId = buildKnockoutMatchReadinessByMatchId({ matches: [], nodes: [division1, division2] });

  assert.equal(readinessByMatchId.get("d1-match")?.ready, true);
  assert.equal(readinessByMatchId.get("d2-match")?.ready, true);
  assert.equal(readinessByMatchId.get("missing-match"), undefined);
});

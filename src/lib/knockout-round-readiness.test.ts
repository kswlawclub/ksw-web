import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKnockoutMatchReadinessByMatchId,
  getKnockoutRoundProgression,
  getKnockoutMatchPresentation,
  getPrematureKnockoutFixtureDrafts,
  isKnockoutMatchReadyForEditing,
  isKnockoutRoundReadyForFixtures,
} from "./knockout-round-readiness.ts";
import { buildCompetitionTree, type CompetitionTreeNode } from "./competition-tree.ts";

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

test("a confirmed Council topology starts at its direct-team round and advances only after every winner exists", () => {
  let nextId = 0;
  const tree = buildCompetitionTree({
    bracketCapacity: 4,
    competitionId: "competition",
    entrantCount: 4,
    entryMode: "custom",
    entrants: Array.from({ length: 4 }, (_, index) => ({ teamId: `team-${index + 1}`, type: "manual_team" as const })),
    idFactory: () => `node-${++nextId}`,
    partitionKey: "division_1",
  });
  const initial = getKnockoutRoundProgression({ matches: [], nodes: tree.nodes });
  assert.equal(initial.currentRound?.roundIndex, 0);
  assert.equal(initial.currentRound?.playable, true);

  const firstRound = tree.nodes.filter((entry) => entry.roundIndex === 0).map((entry, index) => ({ ...entry, linkedMatchId: `first-${index + 1}` }));
  const downstream = tree.nodes.filter((entry) => entry.roundIndex > 0);
  const progressed = getKnockoutRoundProgression({
    matches: firstRound.map((entry, index) => ({ id: entry.linkedMatchId!, status: "finished", winner_team_id: `winner-${index + 1}` })),
    nodes: [...firstRound, ...downstream],
  });
  assert.equal(progressed.currentRound?.roundIndex, 1);
  assert.equal(progressed.currentRound?.playable, true);
});

test("only unplayed downstream fixture drafts are repairable before the first round has fixtures", () => {
  const first = node({ id: "first", roundIndex: 0 });
  const downstream = node({ id: "downstream", linkedMatchId: "wrong-fixture", roundIndex: 1, homeSource: { nodeId: "first", type: "node_winner" } });
  const repairable = getPrematureKnockoutFixtureDrafts({ matches: [{ id: "wrong-fixture", status: "scheduled", winner_team_id: null }], nodes: [first, downstream] });
  assert.deepEqual(repairable, { matchIds: ["wrong-fixture"], nodeIds: ["downstream"] });
  const played = getPrematureKnockoutFixtureDrafts({ matches: [{ home_score: 1, id: "wrong-fixture", status: "finished", winner_team_id: "team-a" }], nodes: [first, downstream] });
  assert.deepEqual(played, { matchIds: [], nodeIds: [] });
});

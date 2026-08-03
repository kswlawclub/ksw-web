import assert from "node:assert/strict";
import test from "node:test";
import { groupPublicCupV2Rounds, publicCupV2ScoreLabel, publicCupV2SourceLabel } from "./public-cup-v2-bracket.ts";
import type { PublicCupV2Node } from "./public-cup-v2-types.ts";

function node(input: Partial<PublicCupV2Node>): PublicCupV2Node {
  return {
    awaySource: { bestOrder: null, groupId: null, groupLabel: null, rank: null, team: null, type: "node_winner", winnerNodeId: "previous" },
    bracketPosition: 1,
    homeSource: { bestOrder: null, groupId: null, groupLabel: null, rank: null, team: null, type: "node_winner", winnerNodeId: "previous" },
    id: "node",
    linkedMatch: null,
    linkedMatchId: null,
    matchOrder: 1,
    partitionKey: "main",
    roundIndex: 0,
    roundLabel: "Round of 16",
    ...input,
  };
}

test("groups 16- and 32-team KSW topology dynamically by round and order", () => {
  const rounds = groupPublicCupV2Rounds([
    node({ id: "r1-2", matchOrder: 2, roundIndex: 0, roundLabel: "Round of 32" }),
    node({ id: "r1-1", matchOrder: 1, roundIndex: 0, roundLabel: "Round of 32" }),
    node({ id: "r2-1", roundIndex: 1, roundLabel: "Round of 16" }),
  ]);
  assert.equal(rounds[0]?.roundLabel, "Round of 32");
  assert.equal(rounds[0]?.nodes[0]?.id, "r1-1");
  assert.equal(rounds[0]?.current, true);
});

test("keeps unresolved nodes locked and renders normal and penalty scores", () => {
  const unresolved = node({ homeSource: { bestOrder: null, groupId: null, groupLabel: null, rank: null, team: null, type: "node_winner", winnerNodeId: "node-a" } });
  assert.equal(publicCupV2SourceLabel(unresolved.homeSource), "รอผู้ชนะจากคู่ก่อนหน้า");
  assert.equal(publicCupV2ScoreLabel(unresolved), "VS");
  assert.equal(publicCupV2ScoreLabel(node({ linkedMatch: { awayPenaltyScore: 4, awayScore: 1, awayTeam: null, homePenaltyScore: 5, homeScore: 1, homeTeam: null, id: "match", matchDate: null, status: "finished", venue: null, winner: null } })), "1-1 (จุดโทษ 5-4)");
});

test("does not include Council nodes in the KSW main bracket", () => {
  const rounds = groupPublicCupV2Rounds([node({ partitionKey: "division_1" })]);
  assert.equal(rounds.length, 0);
});

test("keeps Council division topologies separate even when their sizes differ", () => {
  const nodes = [
    node({ id: "d1-r1", partitionKey: "division_1", roundIndex: 0, roundLabel: "Quarterfinal" }),
    node({ id: "d1-r2", partitionKey: "division_1", roundIndex: 1, roundLabel: "Semifinal" }),
    node({ id: "d2-r1", partitionKey: "division_2", roundIndex: 0, roundLabel: "Round of 16" }),
  ];
  assert.deepEqual(groupPublicCupV2Rounds(nodes, "division_1").map((round) => round.nodes.map((entry) => entry.id)), [["d1-r1"], ["d1-r2"]]);
  assert.deepEqual(groupPublicCupV2Rounds(nodes, "division_2").map((round) => round.nodes.map((entry) => entry.id)), [["d2-r1"]]);
});

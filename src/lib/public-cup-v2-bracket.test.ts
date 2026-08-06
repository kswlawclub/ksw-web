import assert from "node:assert/strict";
import test from "node:test";
import { groupPublicCupV2Rounds, isPublicCupKswMatch, publicCupV2ScoreLabel, publicCupV2SourceLabel, publicCupV2SourcePresentation } from "./public-cup-v2-bracket.ts";
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

function resolvedNode(input: Partial<PublicCupV2Node>): PublicCupV2Node {
  return node({
    awaySource: { bestOrder: null, groupId: null, groupLabel: null, rank: null, team: { id: "away", logoUrl: null, name: "ทีมเยือน", shortName: null }, type: "manual_team", winnerNodeId: null },
    homeSource: { bestOrder: null, groupId: null, groupLabel: null, rank: null, team: { id: "home", logoUrl: null, name: "ทีมเหย้า", shortName: null }, type: "manual_team", winnerNodeId: null },
    ...input,
  });
}

test("groups 16- and 32-team KSW topology dynamically by round and order", () => {
  const rounds = groupPublicCupV2Rounds([
    resolvedNode({ id: "r1-2", matchOrder: 2, roundIndex: 0, roundLabel: "Round of 32" }),
    resolvedNode({ id: "r1-1", matchOrder: 1, roundIndex: 0, roundLabel: "Round of 32" }),
    resolvedNode({ id: "r2-1", roundIndex: 1, roundLabel: "Round of 16" }),
  ]);
  assert.equal(rounds[0]?.roundLabel, "Round of 32");
  assert.equal(rounds[0]?.nodes[0]?.id, "r1-1");
  assert.equal(rounds[0]?.current, true);
});

test("does not render topology-only nodes as public match rounds", () => {
  assert.equal(groupPublicCupV2Rounds([node({ roundLabel: "Quarterfinal" })]).length, 0);
  assert.equal(groupPublicCupV2Rounds([resolvedNode({ roundLabel: "Quarterfinal" })]).length, 1);
});

test("keeps unresolved nodes locked and renders normal and penalty scores", () => {
  const unresolved = node({ homeSource: { bestOrder: null, groupId: null, groupLabel: null, rank: null, team: null, type: "node_winner", winnerNodeId: "node-a" } });
  assert.equal(publicCupV2SourceLabel(unresolved.homeSource), "รอผู้ชนะจากคู่ก่อนหน้า");
  assert.equal(publicCupV2ScoreLabel(unresolved), "VS");
  assert.equal(publicCupV2ScoreLabel(node({ linkedMatch: { awayPenaltyScore: 4, awayScore: 1, awayTeam: null, homePenaltyScore: 5, homeScore: 1, homeTeam: null, id: "match", matchDate: null, status: "finished", venue: null, winner: null } })), "1-1 (จุดโทษ 5-4)");
});

test("resolves future final sources from topology without creating a fixture", () => {
  const semifinalOne = node({ id: "semi-1", matchOrder: 1, roundIndex: 1, roundLabel: "Semifinal" });
  const semifinalTwo = node({ id: "semi-2", matchOrder: 2, roundIndex: 1, roundLabel: "Semifinal" });
  const final = node({ id: "final", matchOrder: 1, roundIndex: 2, roundLabel: "Final", homeSource: { bestOrder: null, groupId: null, groupLabel: null, rank: null, team: null, type: "node_winner", winnerNodeId: "semi-1" }, awaySource: { bestOrder: null, groupId: null, groupLabel: null, rank: null, team: null, type: "node_winner", winnerNodeId: "semi-2" } });
  assert.equal(publicCupV2SourcePresentation(final.homeSource, [semifinalOne, semifinalTwo, final]), "ผู้ชนะรอบรองชนะเลิศ คู่ที่ 1");
  assert.equal(publicCupV2SourcePresentation(final.awaySource, [semifinalOne, semifinalTwo, final]), "ผู้ชนะรอบรองชนะเลิศ คู่ที่ 2");
  assert.equal(final.linkedMatch, null);
});

test("uses known teams and keeps the unresolved side as a topology source", () => {
  const semifinal = node({ id: "semi-2", matchOrder: 2, roundIndex: 1, roundLabel: "Semifinal" });
  const final = resolvedNode({ id: "final", roundIndex: 2, roundLabel: "Final", linkedMatch: null, awaySource: { bestOrder: null, groupId: null, groupLabel: null, rank: null, team: null, type: "node_winner", winnerNodeId: "semi-2" } });
  assert.equal(publicCupV2SourcePresentation(final.homeSource, [semifinal, final]), "ทีมเหย้า");
  assert.equal(publicCupV2SourcePresentation(final.awaySource, [semifinal, final]), "ผู้ชนะรอบรองชนะเลิศ คู่ที่ 2");
});

test("keeps both resolved final teams visible without treating the topology as a fixture", () => {
  const final = resolvedNode({ id: "final", linkedMatch: null, roundIndex: 2, roundLabel: "Final" });
  assert.equal(publicCupV2SourcePresentation(final.homeSource, [final]), "ทีมเหย้า");
  assert.equal(publicCupV2SourcePresentation(final.awaySource, [final]), "ทีมเยือน");
  assert.equal(final.linkedMatch, null);
});

test("does not include Council nodes in the KSW main bracket", () => {
  const rounds = groupPublicCupV2Rounds([resolvedNode({ partitionKey: "division_1" })]);
  assert.equal(rounds.length, 0);
});

test("keeps Council division topologies separate even when their sizes differ", () => {
  const nodes = [
    resolvedNode({ id: "d1-r1", partitionKey: "division_1", roundIndex: 0, roundLabel: "Quarterfinal" }),
    resolvedNode({ id: "d1-r2", partitionKey: "division_1", roundIndex: 1, roundLabel: "Semifinal" }),
    resolvedNode({ id: "d2-r1", partitionKey: "division_2", roundIndex: 0, roundLabel: "Round of 16" }),
  ];
  assert.deepEqual(groupPublicCupV2Rounds(nodes, "division_1").map((round) => round.nodes.map((entry) => entry.id)), [["d1-r1"], ["d1-r2"]]);
  assert.deepEqual(groupPublicCupV2Rounds(nodes, "division_2").map((round) => round.nodes.map((entry) => entry.id)), [["d2-r1"]]);
});

test("preserves Quarterfinal, Semifinal, and Final as ordered round sections", () => {
  const nodes = [
    ...Array.from({ length: 4 }, (_, index) => resolvedNode({ id: `quarter-${index}`, matchOrder: index + 1, partitionKey: "division_1", roundIndex: 0, roundLabel: "Quarterfinal" })),
    ...Array.from({ length: 2 }, (_, index) => resolvedNode({ id: `semi-${index}`, matchOrder: index + 1, partitionKey: "division_1", roundIndex: 1, roundLabel: "Semifinal" })),
    resolvedNode({ id: "final", partitionKey: "division_1", roundIndex: 2, roundLabel: "Final" }),
  ];
  const rounds = groupPublicCupV2Rounds(nodes, "division_1");

  assert.deepEqual(rounds.map((round) => [round.roundLabel, round.nodes.length]), [["Quarterfinal", 4], ["Semifinal", 2], ["Final", 1]]);
});

test("identifies a KSW match from a resolved bracket team without changing topology", () => {
  assert.equal(isPublicCupKswMatch(node({
    linkedMatch: { awayPenaltyScore: null, awayScore: 0, awayTeam: null, homePenaltyScore: null, homeScore: 1, homeTeam: { id: "ksw", logoUrl: null, name: "KSW เอฟซี", shortName: "KSW" }, id: "match", matchDate: null, status: "finished", venue: null, winner: null },
  })), true);
  assert.equal(isPublicCupKswMatch(node({ linkedMatch: { awayPenaltyScore: null, awayScore: null, awayTeam: { id: "away", logoUrl: null, name: "ทีมเยือน", shortName: null }, homePenaltyScore: null, homeScore: null, homeTeam: { id: "home", logoUrl: null, name: "ทีมเหย้า", shortName: null }, id: "match", matchDate: null, status: "scheduled", venue: null, winner: null } })), false);
});

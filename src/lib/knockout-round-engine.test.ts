import assert from "node:assert/strict";
import test from "node:test";
import { buildCompetitionTree } from "./competition-tree.ts";
import { deriveKnockoutRoundState } from "./knockout-round-engine.ts";

function treeFor(capacity: 2 | 4 | 8 | 16 | 32, partitionKey = "main") {
  let index = 0;
  return buildCompetitionTree({
    bracketCapacity: capacity,
    competitionId: "competition",
    entrantCount: capacity,
    entryMode: "custom",
    entrants: Array.from({ length: capacity }, (_, entryIndex) => ({ teamId: `team-${entryIndex + 1}`, type: "manual_team" as const })),
    idFactory: () => `node-${++index}`,
    partitionKey,
  }).nodes;
}

for (const capacity of [2, 4, 8, 16, 32] as const) {
  test(`${capacity}-team topology starts at its direct-entry round`, () => {
    const state = deriveKnockoutRoundState({ matches: [], nodes: treeFor(capacity) });
    assert.equal(state.currentRound?.roundIndex, 0);
    assert.equal(state.firstPlayableRound?.roundIndex, 0);
    assert.equal(state.finalRound?.roundIndex, Math.log2(capacity) - 1);
  });

  test(`${capacity}-team Council partition follows the same runtime transitions`, () => {
    const nodes = treeFor(capacity, "division_1");
    const confirmed = deriveKnockoutRoundState({ matches: [], nodes, partitionKey: "division_1" });
    assert.equal(confirmed.runtimePhase, "current_round_ready");
    assert.equal(confirmed.currentRound?.state, "confirmed_draft");

    const firstRound = nodes.filter((node) => node.roundIndex === 0).map((node, index) => ({ ...node, linkedMatchId: `fixture-${index + 1}` }));
    const playing = deriveKnockoutRoundState({
      matches: firstRound.map((node) => ({ id: node.linkedMatchId!, status: "scheduled", winnerTeamId: null })),
      nodes: [...firstRound, ...nodes.filter((node) => node.roundIndex > 0)],
      partitionKey: "division_1",
    });
    assert.equal(playing.runtimePhase, "fixtures_created");
    assert.equal(playing.currentRound?.roundIndex, 0);

    const completed = deriveKnockoutRoundState({
      matches: firstRound.map((node, index) => ({ id: node.linkedMatchId!, status: "finished", winnerTeamId: `winner-${index + 1}` })),
      nodes: [...firstRound, ...nodes.filter((node) => node.roundIndex > 0)],
      partitionKey: "division_1",
    });
    assert.equal(completed.runtimePhase, capacity === 2 ? "completed" : "current_round_ready");
    assert.equal(completed.currentRound?.roundIndex ?? null, capacity === 2 ? null : 1);
  });
}

test("uses the same round for Standard current round and fixture selection", () => {
  const nodes = treeFor(8);
  const initial = deriveKnockoutRoundState({ matches: [], nodes });
  assert.equal(initial.currentRound?.roundIndex, initial.firstPlayableRound?.roundIndex);

  const firstRound = nodes.filter((node) => node.roundIndex === 0).map((node, index) => ({ ...node, linkedMatchId: `match-${index + 1}` }));
  const state = deriveKnockoutRoundState({
    matches: firstRound.map((node, index) => ({ id: node.linkedMatchId!, status: "finished", winnerTeamId: `winner-${index + 1}` })),
    nodes: [...firstRound, ...nodes.filter((node) => node.roundIndex > 0)],
  });
  assert.equal(state.currentRound?.roundIndex, 1);
  assert.equal(state.firstPlayableRound?.roundIndex, 1);
});

test("keeps Council Division 1 and Division 2 runtime contexts independent", () => {
  const division1Nodes = treeFor(4, "division_1");
  const division2Nodes = treeFor(4, "division_2");
  const completedDivision1FirstRound = division1Nodes
    .filter((node) => node.roundIndex === 0)
    .map((node, index) => ({ ...node, linkedMatchId: `d1-match-${index + 1}` }));
  const nodes = [
    ...completedDivision1FirstRound,
    ...division1Nodes.filter((node) => node.roundIndex > 0),
    ...division2Nodes,
  ];
  const matches = completedDivision1FirstRound.map((node, index) => ({
    id: node.linkedMatchId!,
    status: index === 0 ? "completed" : "finished",
    winnerTeamId: `d1-winner-${index + 1}`,
  }));

  const division1 = deriveKnockoutRoundState({ matches, nodes, partitionKey: "division_1" });
  const division2 = deriveKnockoutRoundState({ matches, nodes, partitionKey: "division_2" });

  assert.deepEqual(division1.completedRounds.map((round) => round.roundIndex), [0]);
  assert.equal(division1.currentRound?.roundIndex, 1);
  assert.equal(division1.firstPlayableRound?.roundIndex, 1);
  assert.equal(division1.advanceFromRound?.roundIndex, 0);
  assert.equal(division2.currentRound?.roundIndex, 0);
  assert.equal(division2.firstPlayableRound?.roundIndex, 0);
  assert.deepEqual(division2.completedRounds, []);
});

for (const capacity of [4, 8, 16, 32] as const) {
  test(`${capacity}-team Council final round provides a completed champion candidate`, () => {
    const nodes = treeFor(capacity, "division_2");
    const finalRoundIndex = Math.log2(capacity) - 1;
    const finalNode = nodes.find((node) => node.roundIndex === finalRoundIndex);
    assert.ok(finalNode);
    const finalMatchId = `division-2-final-${capacity}`;
    const state = deriveKnockoutRoundState({
      matches: [{ id: finalMatchId, status: "finished", winnerTeamId: `division-2-champion-${capacity}` }],
      nodes: nodes.map((node) => node.id === finalNode.id ? { ...node, linkedMatchId: finalMatchId } : node),
      partitionKey: "division_2",
    });
    const runtimeFinal = state.finalRound;
    const candidate = runtimeFinal?.nodes[0]?.linkedMatchId === finalMatchId && runtimeFinal.complete
      ? `division-2-champion-${capacity}`
      : null;

    assert.equal(runtimeFinal?.roundIndex, finalRoundIndex);
    assert.equal(runtimeFinal?.complete, true);
    assert.equal(candidate, `division-2-champion-${capacity}`);
  });
}

import assert from "node:assert/strict";
import test from "node:test";
import { buildCompetitionTree } from "./competition-tree.ts";
import { deriveKnockoutRoundState } from "./knockout-round-engine.ts";

function treeFor(capacity: 4 | 8 | 16 | 32) {
  let index = 0;
  return buildCompetitionTree({
    bracketCapacity: capacity,
    competitionId: "competition",
    entrantCount: capacity,
    entryMode: "custom",
    entrants: Array.from({ length: capacity }, (_, entryIndex) => ({ teamId: `team-${entryIndex + 1}`, type: "manual_team" as const })),
    idFactory: () => `node-${++index}`,
  }).nodes;
}

for (const capacity of [4, 8, 16, 32] as const) {
  test(`${capacity}-team topology starts at its direct-entry round`, () => {
    const state = deriveKnockoutRoundState({ matches: [], nodes: treeFor(capacity) });
    assert.equal(state.currentRound?.roundIndex, 0);
    assert.equal(state.firstPlayableRound?.roundIndex, 0);
    assert.equal(state.finalRound?.roundIndex, Math.log2(capacity) - 1);
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

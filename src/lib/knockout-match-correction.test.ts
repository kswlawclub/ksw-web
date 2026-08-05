import assert from "node:assert/strict";
import test from "node:test";
import { buildCompetitionTree } from "./competition-tree.ts";
import { analyzeKnockoutMatchCorrectionImpact } from "./knockout-match-correction.ts";

function setup(capacity: 4 | 8 | 16 | 32, partitionKey = "main", prefix = partitionKey) {
  let index = 0;
  const nodes = buildCompetitionTree({ bracketCapacity: capacity, competitionId: "competition", entrantCount: capacity, entryMode: "custom", entrants: Array.from({ length: capacity }, (_, entry) => ({ teamId: `team-${entry + 1}`, type: "manual_team" as const })), idFactory: () => `${prefix}-node-${++index}`, partitionKey }).nodes;
  const first = nodes.find((node) => node.roundIndex === 0)!;
  const matches = nodes.flatMap((node) => node.roundIndex === 0 ? [{ awayScore: 0, awayTeamId: node.awaySource.teamId!, homeScore: 1, homeTeamId: node.homeSource.teamId!, id: `match-${node.id}`, penaltyAwayScore: null, penaltyHomeScore: null, status: "finished", venue: "สนาม", winnerTeamId: node.homeSource.teamId! }] : []);
  const linkedNodes = nodes.map((node) => node.roundIndex === 0 ? { ...node, linkedMatchId: `match-${node.id}` } : node);
  return { matches, nodes: linkedNodes, target: first };
}

function proposal(winnerTeamId: string, patch = {}) {
  return { awayScore: 0, homeScore: 1, matchDate: null, penaltyAwayScore: null, penaltyHomeScore: null, status: "finished" as const, venue: "สนาม", winnerTeamId, ...patch };
}

test("editorial correction has no downstream impact", () => {
  const state = setup(4);
  const targetMatchId = `match-${state.target.id}`;
  const plan = analyzeKnockoutMatchCorrectionImpact({ matches: state.matches, nodes: state.nodes, proposed: proposal(state.target.homeSource.teamId!, { venue: "สนามใหม่" }), targetMatchId });
  assert.equal(plan.correctionType, "editorial");
  assert.deepEqual(plan.affectedNodeIds, []);
});

test("score correction with the same winner preserves downstream", () => {
  const state = setup(4);
  const plan = analyzeKnockoutMatchCorrectionImpact({ matches: state.matches, nodes: state.nodes, proposed: proposal(state.target.homeSource.teamId!, { homeScore: 3, awayScore: 1 }), targetMatchId: `match-${state.target.id}` });
  assert.equal(plan.correctionType, "result_same_winner");
  assert.equal(plan.winnerChanged, false);
  assert.deepEqual(plan.affectedMatchIds, []);
});

for (const capacity of [4, 8, 16, 32] as const) {
  test(`winner correction follows only the ${capacity}-team dependency path`, () => {
    const state = setup(capacity);
    const plan = analyzeKnockoutMatchCorrectionImpact({ matches: state.matches, nodes: state.nodes, proposed: proposal(state.target.awaySource.teamId!, { homeScore: 0, awayScore: 1 }), targetMatchId: `match-${state.target.id}` });
    assert.equal(plan.winnerChanged, true);
    assert.equal(plan.affectedNodeIds.length, Math.log2(capacity) - 1);
    assert.equal(plan.runtimeRoundIndex, 1);
    const unrelated = state.nodes.find((node) => node.roundIndex === 0 && node.id !== state.target.id)!;
    assert.equal(plan.affectedNodeIds.includes(unrelated.id), false);
  });
}

test("Council Division 1 correction cannot traverse Division 2", () => {
  const d1 = setup(4, "division_1");
  const d2 = setup(4, "division_2");
  const plan = analyzeKnockoutMatchCorrectionImpact({ matches: [...d1.matches, ...d2.matches], nodes: [...d1.nodes, ...d2.nodes], proposed: proposal(d1.target.awaySource.teamId!, { homeScore: 0, awayScore: 1 }), targetMatchId: `match-${d1.target.id}` });
  assert.ok(plan.affectedNodeIds.every((id) => !d2.nodes.some((node) => node.id === id)));
});

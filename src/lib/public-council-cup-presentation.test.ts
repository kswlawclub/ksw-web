import assert from "node:assert/strict";
import test from "node:test";
import { derivePublicCouncilCupPresentationState } from "@/lib/public-council-cup-presentation";
import type { PublicCupV2Data, PublicCupV2Node, PublicCupV2Team } from "@/lib/public-cup-v2-types";

const division1Winner: PublicCupV2Team = { id: "d1-winner", logoUrl: null, name: "Division 1 Winner", shortName: "D1" };
const division2Winner: PublicCupV2Team = { id: "d2-winner", logoUrl: null, name: "Division 2 Winner", shortName: "D2" };

function finalNode(partitionKey: "division_1" | "division_2", roundIndex: number, winner: PublicCupV2Team | null, status = "finished"): PublicCupV2Node {
  return {
    awaySource: { bestOrder: null, groupId: null, groupLabel: null, rank: null, team: null, type: "node_winner", winnerNodeId: null },
    bracketPosition: 0,
    homeSource: { bestOrder: null, groupId: null, groupLabel: null, rank: null, team: null, type: "node_winner", winnerNodeId: null },
    id: `${partitionKey}-${roundIndex}`,
    linkedMatch: { awayPenaltyScore: null, awayScore: 0, awayTeam: null, homePenaltyScore: null, homeScore: 1, homeTeam: null, id: `${partitionKey}-match`, matchDate: null, status, venue: null, winner },
    linkedMatchId: `${partitionKey}-match`,
    matchOrder: 1,
    partitionKey,
    roundIndex,
    roundLabel: `Round ${roundIndex + 1}`,
  };
}

function data(nodes: PublicCupV2Node[]): PublicCupV2Data {
  return {
    champions: { division1: null, division2: null, main: null },
    config: null,
    groups: [],
    linkedMatches: nodes.flatMap((node) => node.linkedMatch ?? []),
    nodes,
    partitions: [
      { bracketCapacity: 4, championAt: null, champion: null, entrantCount: 4, key: "division_1", label: "Division 1", status: "active" },
      { bracketCapacity: 4, championAt: null, champion: null, entrantCount: 4, key: "division_2", label: "Division 2", status: "active" },
    ],
    templateKey: "council_two_division",
    teams: [division1Winner, division2Winner],
  };
}

test("awaits administrative completion only after both division finals have winners", () => {
  const presentation = derivePublicCouncilCupPresentationState({
    data: data([finalNode("division_1", 1, division1Winner), finalNode("division_2", 1, division2Winner)]),
    seasonStatus: "active",
  });

  assert.equal(presentation.state, "awaiting_completion");
  assert.equal(presentation.hasOutstandingKnockoutMatches, false);
  assert.equal(presentation.divisions[0].candidateWinner?.id, division1Winner.id);
  assert.equal(presentation.divisions[1].candidateWinner?.id, division2Winner.id);
});

test("stays live when only one division final is complete", () => {
  const presentation = derivePublicCouncilCupPresentationState({
    data: data([finalNode("division_1", 1, division1Winner), finalNode("division_2", 1, null, "scheduled")]),
    seasonStatus: "active",
  });

  assert.equal(presentation.state, "live");
  assert.equal(presentation.hasOutstandingKnockoutMatches, true);
});

test("does not infer confirmed results from zero remaining matches without a final winner", () => {
  const presentation = derivePublicCouncilCupPresentationState({
    data: data([finalNode("division_1", 2, division1Winner), finalNode("division_2", 2, null)]),
    seasonStatus: "active",
  });

  assert.equal(presentation.state, "live");
  assert.equal(presentation.hasOutstandingKnockoutMatches, false);
  assert.equal(presentation.hasFinalWinnerGap, true);
});

test("completed season keeps the completed presentation state", () => {
  const presentation = derivePublicCouncilCupPresentationState({
    data: data([finalNode("division_1", 3, division1Winner), finalNode("division_2", 3, division2Winner)]),
    seasonStatus: "completed",
  });

  assert.equal(presentation.state, "completed");
});

test("uses the highest topology round index for 4, 8, 16, and 32-team division finals", () => {
  [1, 2, 3, 4].forEach((finalRoundIndex) => {
    const presentation = derivePublicCouncilCupPresentationState({
      data: data([finalNode("division_1", finalRoundIndex, division1Winner), finalNode("division_2", finalRoundIndex, division2Winner)]),
      seasonStatus: "active",
    });
    assert.equal(presentation.state, "awaiting_completion");
    assert.equal(presentation.divisions[0].finalRoundIndex, finalRoundIndex);
  });
});

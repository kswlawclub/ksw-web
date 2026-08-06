import assert from "node:assert/strict";
import test from "node:test";
import { derivePublicCouncilCupPresentationState, derivePublicCouncilTopologyRounds, getPublicParticipantDisplayList, PUBLIC_PARTICIPANT_PREVIEW_LIMIT, shouldShowPublicParticipantToggle, type PublicParticipant } from "@/lib/public-council-cup-presentation";
import type { PublicCupV2Data, PublicCupV2Node, PublicCupV2Team } from "@/lib/public-cup-v2-types";

const homeTeam: PublicCupV2Team = { id: "home", logoUrl: null, name: "Home Team", shortName: "H" };
const awayTeam: PublicCupV2Team = { id: "away", logoUrl: null, name: "Away Team", shortName: "A" };

function node(input: Partial<PublicCupV2Node>): PublicCupV2Node {
  return {
    awaySource: { bestOrder: null, groupId: null, groupLabel: null, rank: null, team: awayTeam, type: "manual_team", winnerNodeId: null },
    bracketPosition: 0,
    homeSource: { bestOrder: null, groupId: null, groupLabel: null, rank: null, team: homeTeam, type: "manual_team", winnerNodeId: null },
    id: "node",
    linkedMatch: null,
    linkedMatchId: null,
    matchOrder: 1,
    partitionKey: "division_1",
    roundIndex: 0,
    roundLabel: "Semifinal",
    ...input,
  };
}

function data(nodes: PublicCupV2Node[]): PublicCupV2Data {
  return {
    champions: { division1: null, division2: null, main: null },
    config: null,
    groups: [],
    linkedMatches: nodes.flatMap((entry) => entry.linkedMatch ?? []),
    nodes,
    partitions: [
      { bracketCapacity: 4, championAt: null, champion: null, entrantCount: 4, key: "division_1", label: "Division 1", status: "active" },
      { bracketCapacity: 4, championAt: null, champion: null, entrantCount: 4, key: "division_2", label: "Division 2", status: "active" },
    ],
    templateKey: "council_two_division",
    teams: [homeTeam, awayTeam],
  };
}

function finishedFinal(partitionKey: "division_1" | "division_2", winner: PublicCupV2Team | null) {
  return node({
    id: `${partitionKey}-final`,
    linkedMatch: { awayPenaltyScore: null, awayScore: 0, awayTeam, homePenaltyScore: null, homeScore: 1, homeTeam, id: `${partitionKey}-final-match`, matchDate: null, status: "finished", venue: null, winner },
    linkedMatchId: `${partitionKey}-final-match`,
    partitionKey,
    roundIndex: 1,
    roundLabel: "Final",
  });
}

test("awaits administrative completion only after both division finals have winners", () => {
  const presentation = derivePublicCouncilCupPresentationState({ data: data([finishedFinal("division_1", homeTeam), finishedFinal("division_2", awayTeam)]), seasonStatus: "active" });
  assert.equal(presentation.state, "awaiting_completion");
});

test("does not derive awaiting completion from incomplete finals or a completed season", () => {
  assert.equal(derivePublicCouncilCupPresentationState({ data: data([finishedFinal("division_1", homeTeam), finishedFinal("division_2", null)]), seasonStatus: "active" }).state, "live");
  assert.equal(derivePublicCouncilCupPresentationState({ data: data([finishedFinal("division_1", homeTeam), finishedFinal("division_2", awayTeam)]), seasonStatus: "completed" }).state, "completed");
});

test("keeps a single ordered participant list when collapsed or expanded", () => {
  const teams: PublicParticipant[] = Array.from({ length: 14 }, (_, index) => ({ id: `team-${index}`, logoUrl: "", name: `Team ${index}`, seed: "", shortName: `T${index}` }));
  assert.deepEqual(getPublicParticipantDisplayList(teams, false).map((team) => team.id), teams.slice(0, PUBLIC_PARTICIPANT_PREVIEW_LIMIT).map((team) => team.id));
  assert.deepEqual(getPublicParticipantDisplayList(teams, true).map((team) => team.id), teams.map((team) => team.id));
  assert.equal(shouldShowPublicParticipantToggle(teams), true);
  assert.equal(shouldShowPublicParticipantToggle(teams.slice(0, PUBLIC_PARTICIPANT_PREVIEW_LIMIT)), false);
});

test("keeps every topology round visible for divisions with different bracket sizes", () => {
  const competition = data([
    node({ id: "d1-semi", partitionKey: "division_1", roundIndex: 0 }),
    node({ id: "d1-final", partitionKey: "division_1", roundIndex: 1, roundLabel: "Final" }),
    node({ id: "d2-quarter", partitionKey: "division_2", roundIndex: 0, roundLabel: "Quarterfinal" }),
    node({ id: "d2-semi", partitionKey: "division_2", roundIndex: 1 }),
    node({ id: "d2-final", partitionKey: "division_2", roundIndex: 2, roundLabel: "Final" }),
  ]);
  assert.deepEqual(derivePublicCouncilTopologyRounds(competition, "division_1").map((round) => round.roundIndex), [0, 1]);
  assert.deepEqual(derivePublicCouncilTopologyRounds(competition, "division_2").map((round) => round.roundIndex), [0, 1, 2]);
});

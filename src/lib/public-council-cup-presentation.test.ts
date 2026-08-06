import assert from "node:assert/strict";
import test from "node:test";
import { derivePublicCouncilCupPresentationState, derivePublicCouncilLiveDivisionState, derivePublicCouncilTopologyRounds, derivePublicCouncilTournamentProgress, getPublicParticipantDisplayList, PUBLIC_PARTICIPANT_PREVIEW_LIMIT, shouldShowPublicParticipantToggle, type PublicParticipant } from "@/lib/public-council-cup-presentation";
import type { PublicCupV2Data, PublicCupV2Node, PublicCupV2Team } from "@/lib/public-cup-v2-types";

const division1Winner: PublicCupV2Team = { id: "d1-winner", logoUrl: null, name: "Division 1 Winner", shortName: "D1" };
const division2Winner: PublicCupV2Team = { id: "d2-winner", logoUrl: null, name: "Division 2 Winner", shortName: "D2" };
const homeTeam: PublicCupV2Team = { id: "home", logoUrl: null, name: "Home Team", shortName: "H" };
const awayTeam: PublicCupV2Team = { id: "away", logoUrl: null, name: "Away Team", shortName: "A" };

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

function directDraftNode(partitionKey: "division_1" | "division_2", roundIndex: number): PublicCupV2Node {
  return {
    awaySource: { bestOrder: null, groupId: null, groupLabel: null, rank: 1, team: awayTeam, type: "group_rank", winnerNodeId: null },
    bracketPosition: 0,
    homeSource: { bestOrder: null, groupId: null, groupLabel: null, rank: 1, team: homeTeam, type: "group_rank", winnerNodeId: null },
    id: `${partitionKey}-draft-${roundIndex}`,
    linkedMatch: null,
    linkedMatchId: null,
    matchOrder: 1,
    partitionKey,
    roundIndex,
    roundLabel: `Round ${roundIndex + 1}`,
  };
}

function waitingNode(partitionKey: "division_1" | "division_2", roundIndex: number): PublicCupV2Node {
  return {
    ...directDraftNode(partitionKey, roundIndex),
    awaySource: { bestOrder: null, groupId: null, groupLabel: null, rank: null, team: null, type: "node_winner", winnerNodeId: "previous-away" },
    homeSource: { bestOrder: null, groupId: null, groupLabel: null, rank: null, team: null, type: "node_winner", winnerNodeId: "previous-home" },
    id: `${partitionKey}-waiting-${roundIndex}`,
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

test("derives playing and round-complete states independently for Division 1 and Division 2", () => {
  const competition = data([
    finalNode("division_1", 0, division1Winner),
    finalNode("division_2", 0, null, "scheduled"),
  ]);
  const presentation = derivePublicCouncilCupPresentationState({ data: competition, seasonStatus: "active" });

  assert.equal(derivePublicCouncilLiveDivisionState({ data: competition, partitionKey: "division_1", presentation }).status, "round_complete");
  assert.equal(derivePublicCouncilLiveDivisionState({ data: competition, partitionKey: "division_2", presentation }).status, "playing");
});

test("identifies a fully resolved round without a fixture as ready for the next round", () => {
  const competition = data([directDraftNode("division_1", 1), waitingNode("division_2", 1)]);
  const presentation = derivePublicCouncilCupPresentationState({ data: competition, seasonStatus: "active" });

  assert.equal(derivePublicCouncilLiveDivisionState({ data: competition, partitionKey: "division_1", presentation }).status, "ready_for_next_round");
});

test("identifies unresolved winner dependencies as awaiting the next round", () => {
  const competition = data([waitingNode("division_1", 1), directDraftNode("division_2", 1)]);
  const presentation = derivePublicCouncilCupPresentationState({ data: competition, seasonStatus: "active" });
  const state = derivePublicCouncilLiveDivisionState({ data: competition, partitionKey: "division_1", presentation });

  assert.equal(state.status, "awaiting_next_round");
  assert.match(state.waitingFor ?? "", /รอผู้ชนะ/);
});

test("marks both divisions as awaiting completion once the presentation state is confirmed", () => {
  const competition = data([finalNode("division_1", 1, division1Winner), finalNode("division_2", 1, division2Winner)]);
  const presentation = derivePublicCouncilCupPresentationState({ data: competition, seasonStatus: "active" });

  assert.equal(derivePublicCouncilLiveDivisionState({ data: competition, partitionKey: "division_1", presentation }).status, "awaiting_completion");
  assert.equal(derivePublicCouncilLiveDivisionState({ data: competition, partitionKey: "division_2", presentation }).status, "awaiting_completion");
});

function progressNode(partitionKey: "division_1" | "division_2", index: number, status: string | null): PublicCupV2Node {
  const source = directDraftNode(partitionKey, index);
  return {
    ...source,
    id: `${partitionKey}-progress-${index}`,
    linkedMatch: status ? { awayPenaltyScore: null, awayScore: 0, awayTeam, homePenaltyScore: null, homeScore: 1, homeTeam, id: `${partitionKey}-progress-match-${index}`, matchDate: null, status, venue: null, winner: status === "finished" ? homeTeam : null } : null,
    linkedMatchId: status ? `${partitionKey}-progress-match-${index}` : null,
  };
}

test("calculates tournament progress from real group fixtures and confirmed knockout topology", () => {
  const result = derivePublicCouncilTournamentProgress({
    data: data(Array.from({ length: 6 }, (_, index) => progressNode(index < 3 ? "division_1" : "division_2", index, "finished"))),
    groupMatches: Array.from({ length: 9 }, () => ({ away_score: 0, home_score: 1, status: "completed" })),
  });

  assert.deepEqual(result, {
    expectedGroupMatches: 9,
    expectedKnockoutMatches: 6,
    playedGroupMatches: 9,
    playedKnockoutMatches: 6,
    playedMatches: 15,
    progressBasis: "confirmed_tournament_plan",
    progressPercent: 100,
    remainingMatches: 0,
    scheduledTotal: 15,
    totalMatches: 15,
  });
});

test("counts a confirmed final topology as remaining before its fixture exists", () => {
  const result = derivePublicCouncilTournamentProgress({ data: data([progressNode("division_1", 1, null)]), groupMatches: [] });

  assert.equal(result.expectedKnockoutMatches, 1);
  assert.equal(result.playedKnockoutMatches, 0);
  assert.equal(result.remainingMatches, 1);
  assert.equal(result.progressPercent, 0);
});

test("keeps 36 unplayed group fixtures at zero progress before knockout topology exists", () => {
  const result = derivePublicCouncilTournamentProgress({
    data: data([]),
    groupMatches: Array.from({ length: 36 }, () => ({ status: "scheduled" })),
  });

  assert.deepEqual([result.scheduledTotal, result.playedMatches, result.remainingMatches, result.progressPercent, result.progressBasis], [36, 0, 36, 0, "scheduled_fixtures"]);
});

test("uses actual topology size for 4, 8, 16, and 32-team divisions", () => {
  [4, 8, 16, 32].forEach((teamCount) => {
    const nodes = Array.from({ length: teamCount - 1 }, (_, index) => progressNode("division_1", index, null));
    const result = derivePublicCouncilTournamentProgress({ data: data(nodes), groupMatches: [] });
    assert.equal(result.expectedKnockoutMatches, teamCount - 1);
    assert.equal(result.totalMatches, teamCount - 1);
  });
});

test("combines independently sized Division 1 and Division 2 topologies", () => {
  const nodes = [
    ...Array.from({ length: 3 }, (_, index) => progressNode("division_1", index, "finished")),
    ...Array.from({ length: 7 }, (_, index) => progressNode("division_2", index, null)),
  ];
  const result = derivePublicCouncilTournamentProgress({ data: data(nodes), groupMatches: [] });

  assert.equal(result.expectedKnockoutMatches, 10);
  assert.equal(result.playedKnockoutMatches, 3);
  assert.equal(result.remainingMatches, 7);
});

test("does not count scheduled, pending, active, or scoreless completed records as played", () => {
  const result = derivePublicCouncilTournamentProgress({
    data: data([
      progressNode("division_1", 0, "scheduled"),
      progressNode("division_1", 1, "pending"),
      progressNode("division_2", 0, "active"),
      { ...progressNode("division_2", 1, "completed"), linkedMatch: { ...progressNode("division_2", 1, "completed").linkedMatch!, awayScore: null, homeScore: null } },
    ]),
    groupMatches: [
      { status: "scheduled" },
      { status: "pending" },
      { status: "active" },
      { status: "completed" },
    ],
  });

  assert.equal(result.playedMatches, 0);
  assert.equal(result.remainingMatches, 8);
});

test("does not double count a topology node after its fixture is linked", () => {
  const result = derivePublicCouncilTournamentProgress({ data: data([progressNode("division_1", 0, "scheduled")]), groupMatches: [] });

  assert.equal(result.expectedKnockoutMatches, 1);
  assert.equal(result.scheduledTotal, 1);
  assert.equal(result.totalMatches, 1);
});

test("keeps progress below 100 percent when every group fixture is complete but knockout topology remains", () => {
  const result = derivePublicCouncilTournamentProgress({
    data: data([progressNode("division_1", 0, null)]),
    groupMatches: [{ away_score: 0, home_score: 1, status: "finished" }, { away_score: 2, home_score: 2, status: "completed" }],
  });

  assert.deepEqual([result.playedMatches, result.totalMatches, result.remainingMatches, result.progressPercent], [2, 3, 1, 67]);
});

test("keeps progress at zero when no fixture exists", () => {
  assert.deepEqual(derivePublicCouncilTournamentProgress({ data: data([]), groupMatches: [] }), {
    expectedGroupMatches: 0,
    expectedKnockoutMatches: 0,
    playedGroupMatches: 0,
    playedKnockoutMatches: 0,
    playedMatches: 0,
    progressBasis: "scheduled_fixtures",
    progressPercent: 0,
    remainingMatches: 0,
    scheduledTotal: 0,
    totalMatches: 0,
  });
});

const participantTeams: PublicParticipant[] = Array.from({ length: 14 }, (_, index) => ({
  id: `team-${index + 1}`,
  logoUrl: "",
  name: `Team ${index + 1}`,
  seed: "",
  shortName: `T${index + 1}`,
}));

test("keeps a single ordered participant list when collapsed or expanded", () => {
  const collapsed = getPublicParticipantDisplayList(participantTeams, false);
  const expanded = getPublicParticipantDisplayList(participantTeams, true);

  assert.equal(collapsed.length, PUBLIC_PARTICIPANT_PREVIEW_LIMIT);
  assert.deepEqual(collapsed.map((team) => team.id), participantTeams.slice(0, PUBLIC_PARTICIPANT_PREVIEW_LIMIT).map((team) => team.id));
  assert.equal(expanded.length, participantTeams.length);
  assert.deepEqual(expanded.map((team) => team.id), participantTeams.map((team) => team.id));
  assert.deepEqual(getPublicParticipantDisplayList(participantTeams, false), collapsed);
});

test("only shows the participant toggle when a responsive preview would hide teams", () => {
  assert.equal(shouldShowPublicParticipantToggle(participantTeams), true);
  assert.equal(shouldShowPublicParticipantToggle(participantTeams.slice(0, PUBLIC_PARTICIPANT_PREVIEW_LIMIT)), false);
});

test("keeps every topology round visible for divisions with different bracket sizes", () => {
  const competition = data([
    directDraftNode("division_1", 0),
    waitingNode("division_1", 1),
    directDraftNode("division_2", 0),
    waitingNode("division_2", 1),
    waitingNode("division_2", 2),
  ]);

  assert.deepEqual(derivePublicCouncilTopologyRounds(competition, "division_1").map((round) => round.roundIndex), [0, 1]);
  assert.deepEqual(derivePublicCouncilTopologyRounds(competition, "division_2").map((round) => round.roundIndex), [0, 1, 2]);
  assert.equal(derivePublicCouncilTopologyRounds(competition, "division_2")[2]?.nodes[0]?.linkedMatch, null);
});

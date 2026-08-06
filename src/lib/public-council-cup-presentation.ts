import type { PublicCupV2Data, PublicCupV2Match, PublicCupV2PartitionKey, PublicCupV2Team } from "@/lib/public-cup-v2-types";
import { groupPublicCupV2Rounds, publicCupV2SourceLabel } from "@/lib/public-cup-v2-bracket";

export type PublicCouncilCupPresentationState = "live" | "awaiting_completion" | "completed";

export type PublicCouncilDivisionFinalState = {
  candidateWinner: PublicCupV2Team | null;
  finalComplete: boolean;
  finalMatchFinished: boolean;
  finalRoundIndex: number | null;
  finalRoundLabel: string | null;
  partitionKey: "division_1" | "division_2";
};

export type PublicCouncilCupPresentation = {
  divisions: [PublicCouncilDivisionFinalState, PublicCouncilDivisionFinalState];
  hasFinalWinnerGap: boolean;
  hasOutstandingKnockoutMatches: boolean;
  state: PublicCouncilCupPresentationState;
};

export type PublicCouncilLiveDivisionStatus = "playing" | "round_complete" | "awaiting_next_round" | "ready_for_next_round" | "awaiting_completion";

export type PublicCouncilLiveDivisionState = {
  completedMatches: number;
  matchCount: number;
  nextRoundLabel: string | null;
  remainingMatches: number;
  roundLabel: string | null;
  status: PublicCouncilLiveDivisionStatus;
  waitingFor: string | null;
};

export type PublicCouncilTopologyRound = {
  completed: boolean;
  current: boolean;
  finishedCount: number;
  nodes: PublicCupV2Data["nodes"];
  roundIndex: number;
  roundLabel: string;
};

export type PublicParticipant = {
  id: string;
  logoUrl: string;
  name: string;
  seed: string;
  shortName: string;
};

export const PUBLIC_PARTICIPANT_PREVIEW_LIMIT = 6;

export function getPublicParticipantDisplayList(teams: PublicParticipant[], expanded: boolean) {
  return expanded ? teams : teams.slice(0, PUBLIC_PARTICIPANT_PREVIEW_LIMIT);
}

export function shouldShowPublicParticipantToggle(teams: PublicParticipant[]) {
  return teams.length > PUBLIC_PARTICIPANT_PREVIEW_LIMIT;
}

export function derivePublicCouncilTopologyRounds(data: PublicCupV2Data, partitionKey: "division_1" | "division_2"): PublicCouncilTopologyRound[] {
  const resolvedRoundByIndex = new Map(groupPublicCupV2Rounds(data.nodes, partitionKey).map((round) => [round.roundIndex, round]));
  const nodesByRound = new Map<number, PublicCupV2Data["nodes"]>();

  data.nodes
    .filter((node) => node.partitionKey === partitionKey)
    .forEach((node) => nodesByRound.set(node.roundIndex, [...(nodesByRound.get(node.roundIndex) ?? []), node]));

  return Array.from(nodesByRound.entries())
    .sort(([left], [right]) => left - right)
    .map(([roundIndex, nodes]) => {
      const orderedNodes = [...nodes].sort((left, right) => left.matchOrder - right.matchOrder);
      const resolvedRound = resolvedRoundByIndex.get(roundIndex);
      const finishedCount = orderedNodes.filter((node) => isFinished(node.linkedMatch)).length;
      return {
        completed: resolvedRound?.completed ?? (orderedNodes.length > 0 && finishedCount === orderedNodes.length),
        current: resolvedRound?.current ?? false,
        finishedCount,
        nodes: orderedNodes,
        roundIndex,
        roundLabel: orderedNodes[0]?.roundLabel || `Round ${roundIndex + 1}`,
      };
    });
}

export type PublicMatchStatus = { status?: unknown };

export function derivePublicCouncilTournamentProgress({ data, groupMatches }: { data: PublicCupV2Data; groupMatches: PublicMatchStatus[] }) {
  const isFinishedStatus = (status: unknown) => typeof status === "string" && ["finished", "completed"].includes(status.toLowerCase());
  const expectedGroupMatches = groupMatches.length;
  const expectedKnockoutMatches = data.nodes.filter((node) => node.partitionKey === "division_1" || node.partitionKey === "division_2").length;
  const knockoutMatches = Array.from(new Map(data.linkedMatches.map((match) => [match.id, match])).values());
  const playedGroupMatches = groupMatches.filter((match) => isFinishedStatus(match.status)).length;
  const playedKnockoutMatches = knockoutMatches.filter((match) => isFinishedStatus(match.status)).length;
  const totalMatches = expectedGroupMatches + expectedKnockoutMatches;
  const playedMatches = playedGroupMatches + playedKnockoutMatches;
  return {
    expectedGroupMatches,
    expectedKnockoutMatches,
    playedMatches,
    playedGroupMatches,
    playedKnockoutMatches,
    progressPercent: totalMatches ? Math.min(100, Math.max(0, Math.round((playedMatches / totalMatches) * 100))) : 0,
    remainingMatches: Math.max(0, totalMatches - playedMatches),
    totalMatches,
  };
}

function isFinished(match: PublicCupV2Match | null) {
  return Boolean(match && ["finished", "completed"].includes(match.status));
}

function liveRoundTimeline(data: PublicCupV2Data, partitionKey: "division_1" | "division_2") {
  const visibleRounds = groupPublicCupV2Rounds(data.nodes, partitionKey);
  const visibleRoundByIndex = new Map(visibleRounds.map((round) => [round.roundIndex, round]));
  const groups = new Map<number, typeof data.nodes>();
  data.nodes
    .filter((node) => node.partitionKey === partitionKey)
    .forEach((node) => groups.set(node.roundIndex, [...(groups.get(node.roundIndex) ?? []), node]));

  return Array.from(groups.entries())
    .sort(([left], [right]) => left - right)
    .map(([roundIndex, nodes]) => {
      const visible = visibleRoundByIndex.get(roundIndex);
      const orderedNodes = [...nodes].sort((left, right) => left.matchOrder - right.matchOrder);
      return {
        completed: visible?.completed ?? false,
        current: visible?.current ?? false,
        hasPublicPairing: Boolean(visible),
        nodes: orderedNodes,
        roundIndex,
        roundLabel: orderedNodes[0]?.roundLabel || `Round ${roundIndex + 1}`,
      };
    });
}

function divisionFinalState(data: PublicCupV2Data, partitionKey: "division_1" | "division_2"): PublicCouncilDivisionFinalState {
  const partitionNodes = data.nodes.filter((node) => node.partitionKey === partitionKey);
  const finalRoundIndex = partitionNodes.length ? Math.max(...partitionNodes.map((node) => node.roundIndex)) : null;
  const finalNodes = finalRoundIndex === null ? [] : partitionNodes.filter((node) => node.roundIndex === finalRoundIndex);
  const finalMatchFinished = finalNodes.length > 0 && finalNodes.every((node) => isFinished(node.linkedMatch));
  const finalComplete = finalNodes.length > 0 && finalNodes.every((node) => isFinished(node.linkedMatch) && Boolean(node.linkedMatch?.winner));

  return {
    candidateWinner: finalComplete ? finalNodes[0]?.linkedMatch?.winner ?? null : null,
    finalComplete,
    finalMatchFinished,
    finalRoundIndex,
    finalRoundLabel: finalNodes[0]?.roundLabel ?? null,
    partitionKey,
  };
}

export function derivePublicCouncilCupPresentationState(input: { data: PublicCupV2Data; seasonStatus: string }): PublicCouncilCupPresentation {
  const divisions = [
    divisionFinalState(input.data, "division_1"),
    divisionFinalState(input.data, "division_2"),
  ] as [PublicCouncilDivisionFinalState, PublicCouncilDivisionFinalState];
  const hasOutstandingKnockoutMatches = input.data.linkedMatches.some((match) => !isFinished(match));
  const seasonCompleted = input.seasonStatus.toLowerCase() === "completed";
  const finalsConfirmed = divisions.every((division) => division.finalComplete && Boolean(division.candidateWinner));

  return {
    divisions,
    hasFinalWinnerGap: divisions.some((division) => division.finalMatchFinished && !division.candidateWinner),
    hasOutstandingKnockoutMatches,
    state: seasonCompleted ? "completed" : finalsConfirmed && !hasOutstandingKnockoutMatches ? "awaiting_completion" : "live",
  };
}

export function derivePublicCouncilLiveDivisionState({ data, partitionKey, presentation }: { data: PublicCupV2Data; partitionKey: "division_1" | "division_2"; presentation: PublicCouncilCupPresentation }): PublicCouncilLiveDivisionState {
  if (presentation.state === "awaiting_completion") return { completedMatches: 0, matchCount: 0, nextRoundLabel: null, remainingMatches: 0, roundLabel: null, status: "awaiting_completion", waitingFor: null };

  const rounds = liveRoundTimeline(data, partitionKey);
  const currentRound = rounds.find((round) => round.current);
  const lastVisibleRound = [...rounds].reverse().find((round) => round.hasPublicPairing);
  const nextTopologyRound = currentRound
    ? rounds.find((round) => round.roundIndex > currentRound.roundIndex)
    : lastVisibleRound
      ? rounds.find((round) => round.roundIndex > lastVisibleRound.roundIndex)
      : rounds[0];
  const activeRound = currentRound ?? lastVisibleRound ?? nextTopologyRound ?? null;
  const roundMatches = activeRound?.nodes.map((node) => node.linkedMatch).filter((match): match is PublicCupV2Match => Boolean(match)) ?? [];
  const completedMatches = roundMatches.filter(isFinished).length;
  const remainingMatches = roundMatches.length - completedMatches;
  const unresolvedNode = nextTopologyRound?.nodes.find((node) => !node.homeSource.team || !node.awaySource.team) ?? null;
  const waitingFor = unresolvedNode
    ? `${publicCupV2SourceLabel(unresolvedNode.homeSource)} · ${publicCupV2SourceLabel(unresolvedNode.awaySource)}`
    : null;

  if (currentRound && roundMatches.some((match) => !isFinished(match))) {
    return { completedMatches, matchCount: roundMatches.length, nextRoundLabel: nextTopologyRound?.roundLabel ?? null, remainingMatches, roundLabel: currentRound.roundLabel, status: "playing", waitingFor: null };
  }
  if (currentRound && !roundMatches.length && currentRound.nodes.every((node) => node.homeSource.team && node.awaySource.team)) {
    return { completedMatches: 0, matchCount: currentRound.nodes.length, nextRoundLabel: currentRound.roundLabel, remainingMatches: currentRound.nodes.length, roundLabel: currentRound.roundLabel, status: "ready_for_next_round", waitingFor: null };
  }
  if (lastVisibleRound?.completed) {
    return { completedMatches, matchCount: roundMatches.length, nextRoundLabel: nextTopologyRound?.roundLabel ?? null, remainingMatches: 0, roundLabel: lastVisibleRound.roundLabel, status: "round_complete", waitingFor };
  }
  return { completedMatches: 0, matchCount: activeRound?.nodes.length ?? 0, nextRoundLabel: nextTopologyRound?.roundLabel ?? activeRound?.roundLabel ?? null, remainingMatches: 0, roundLabel: activeRound?.roundLabel ?? null, status: "awaiting_next_round", waitingFor };
}

export function publicCouncilDivisionPresentation(
  presentation: PublicCouncilCupPresentation,
  partitionKey: PublicCupV2PartitionKey,
) {
  return presentation.divisions.find((division) => division.partitionKey === partitionKey) ?? null;
}

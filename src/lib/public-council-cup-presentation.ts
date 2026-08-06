import type { PublicCupV2Data, PublicCupV2Match, PublicCupV2Team } from "@/lib/public-cup-v2-types";
import { groupPublicCupV2Rounds } from "@/lib/public-cup-v2-bracket";

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

function isFinished(match: PublicCupV2Match | null) {
  return Boolean(match && ["finished", "completed"].includes(match.status));
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

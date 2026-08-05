import type { PublicCupV2Data, PublicCupV2Match, PublicCupV2PartitionKey, PublicCupV2Team } from "@/lib/public-cup-v2-types";

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

export function publicCouncilDivisionPresentation(
  presentation: PublicCouncilCupPresentation,
  partitionKey: PublicCupV2PartitionKey,
) {
  return presentation.divisions.find((division) => division.partitionKey === partitionKey) ?? null;
}

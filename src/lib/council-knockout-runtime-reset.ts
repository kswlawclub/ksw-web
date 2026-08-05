export type CouncilKnockoutResetNode = {
  id: string;
  linkedMatchId?: string | null;
};

export type CouncilKnockoutResetMatch = {
  awayScore?: number | null;
  homeScore?: number | null;
  id: string;
  manualWinnerTeamId?: string | null;
  penaltyAwayScore?: number | null;
  penaltyHomeScore?: number | null;
  status?: string | null;
  winnerTeamId?: string | null;
};

export type CouncilKnockoutResetPartition = {
  championTeamId?: string | null;
  partitionKey: string;
};

export type CouncilKnockoutResetInput = {
  matches: CouncilKnockoutResetMatch[];
  nodes: CouncilKnockoutResetNode[];
  partitions: CouncilKnockoutResetPartition[];
  seasonStatus?: string | null;
};

export type CouncilKnockoutResetBlockerCode =
  | "competition_completed"
  | "division_champion_persisted"
  | "knockout_score_exists"
  | "knockout_winner_exists"
  | "knockout_match_completed";

export type CouncilKnockoutResetBlocker = {
  code: CouncilKnockoutResetBlockerCode;
  message: string;
};

export type CouncilKnockoutResetPlan = {
  linkedNodeIds: string[];
  matchIds: string[];
  nodeIds: string[];
  partitionKeys: string[];
  preserves: readonly [
    "competition_metadata",
    "participants",
    "groups",
    "group_fixtures_and_results",
    "standings",
    "qualification_snapshot",
    "division_approval",
  ];
};

export type CouncilKnockoutResetInspection = {
  blockers: CouncilKnockoutResetBlocker[];
  blockingReasons: string[];
  canReset: boolean;
  matchCount: number;
  nodeCount: number;
  plan: CouncilKnockoutResetPlan | null;
};

function hasValue(value: unknown) {
  return value !== null && value !== undefined && value !== "";
}

/** Returns true only when a write touched exactly the latest inspected targets. */
export function hasExactCouncilKnockoutResetTargets(actualIds: readonly string[] | null | undefined, expectedIds: readonly string[]) {
  if (!actualIds || actualIds.length !== expectedIds.length) return false;
  const actual = new Set(actualIds);
  return actual.size === expectedIds.length && expectedIds.every((id) => actual.has(id));
}

/**
 * Read-only safety policy for resetting Council knockout runtime drafts.
 * This intentionally does not inspect or mutate group-stage data.
 */
export function getCouncilKnockoutResetPlan(input: CouncilKnockoutResetInput): CouncilKnockoutResetInspection {
  const blockers: CouncilKnockoutResetBlocker[] = [];

  if (input.seasonStatus === "completed") {
    blockers.push({ code: "competition_completed", message: "การแข่งขันปิดแล้ว" });
  }
  if (input.partitions.some((partition) => hasValue(partition.championTeamId))) {
    blockers.push({ code: "division_champion_persisted", message: "มีแชมป์ดิวิชั่นที่บันทึกแล้ว" });
  }
  if (input.matches.some((match) => hasValue(match.homeScore) || hasValue(match.awayScore) || hasValue(match.penaltyHomeScore) || hasValue(match.penaltyAwayScore))) {
    blockers.push({ code: "knockout_score_exists", message: "มีคะแนนหรือผลจุดโทษแล้ว" });
  }
  if (input.matches.some((match) => hasValue(match.winnerTeamId) || hasValue(match.manualWinnerTeamId))) {
    blockers.push({ code: "knockout_winner_exists", message: "มีผู้ชนะที่บันทึกแล้ว" });
  }
  if (input.matches.some((match) => match.status === "finished" || match.status === "completed")) {
    blockers.push({ code: "knockout_match_completed", message: "มีแมตช์รอบน็อกเอาต์ที่จบแล้ว" });
  }

  const canReset = blockers.length === 0;
  return {
    blockers,
    blockingReasons: blockers.map((blocker) => blocker.message),
    canReset,
    matchCount: input.matches.length,
    nodeCount: input.nodes.length,
    plan: canReset
      ? {
          linkedNodeIds: input.nodes.filter((node) => Boolean(node.linkedMatchId)).map((node) => node.id),
          matchIds: input.matches.map((match) => match.id),
          nodeIds: input.nodes.map((node) => node.id),
          partitionKeys: input.partitions.map((partition) => partition.partitionKey),
          preserves: [
            "competition_metadata",
            "participants",
            "groups",
            "group_fixtures_and_results",
            "standings",
            "qualification_snapshot",
            "division_approval",
          ],
        }
      : null,
  };
}

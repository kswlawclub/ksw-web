import type { CompetitionTreeNode, CompetitionTreeSource } from "@/lib/competition-tree";
import { getKnockoutTemplateSwitchGuard, type KnockoutMatchForState, type QualificationSnapshotSource } from "@/lib/knockout-template-switching";

export type UnmaterializedKnockoutDraftCleanup = {
  awayTeamId: boolean;
  homeTeamId: boolean;
  nodeId: string;
};

function canClearDerivedDraftTeam(source: CompetitionTreeSource) {
  return Boolean(source.teamId) && (source.type === "best_ranked" || source.type === "group_rank" || source.type === "node_winner");
}

function hasUnclearTeamAssignment(source: CompetitionTreeSource) {
  return Boolean(source.teamId) && !canClearDerivedDraftTeam(source);
}

/**
 * Selects only stale, non-manual source resolutions. A fixture anywhere in the
 * knockout stage makes the cleanup unavailable so this cannot alter a real draw.
 */
export function findUnmaterializedKnockoutDraftAssignments(input: {
  matches: KnockoutMatchForState[];
  nodes: CompetitionTreeNode[];
  qualificationSnapshot: QualificationSnapshotSource[];
}): UnmaterializedKnockoutDraftCleanup[] {
  if (input.matches.length) return [];

  const guard = getKnockoutTemplateSwitchGuard(input);
  const nodeStates = new Map(guard.nodeStates.map((entry) => [entry.nodeId, entry]));

  return input.nodes.flatMap((node) => {
    const state = nodeStates.get(node.id);
    if (node.linkedMatchId || state?.reasonCode !== "unverified_team_assignment") return [];
    if (hasUnclearTeamAssignment(node.homeSource) || hasUnclearTeamAssignment(node.awaySource)) return [];

    const homeTeamId = canClearDerivedDraftTeam(node.homeSource);
    const awayTeamId = canClearDerivedDraftTeam(node.awaySource);
    return homeTeamId || awayTeamId ? [{ awayTeamId, homeTeamId, nodeId: node.id }] : [];
  });
}

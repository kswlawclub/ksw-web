import type { CompetitionTreeNode, CompetitionTreeSource } from "@/lib/competition-tree";

export type KnockoutReadinessMatch = {
  id: string;
  status: string | null | undefined;
  winner_team_id?: string | null;
};

export type KnockoutSourceReadiness = {
  ready: boolean;
  teamId: string | null;
  waitingNodeId: string | null;
};

export type KnockoutNodeReadiness = {
  away: KnockoutSourceReadiness;
  home: KnockoutSourceReadiness;
  ready: boolean;
  waitingNodeIds: string[];
};

export type KnockoutReadinessContext = {
  matches: KnockoutReadinessMatch[];
  nodes: CompetitionTreeNode[];
};

export type KnockoutMatchPresentation = {
  editable: boolean;
  state: "missing" | "ready" | "waiting";
};

function resolvedWinner(match: KnockoutReadinessMatch | undefined) {
  return match && ["finished", "completed"].includes(match.status ?? "")
    ? match.winner_team_id ?? null
    : null;
}

export function areSourceDependenciesResolved(
  source: CompetitionTreeSource,
  context: KnockoutReadinessContext,
): KnockoutSourceReadiness {
  if (source.type !== "node_winner") {
    return { ready: Boolean(source.teamId), teamId: source.teamId ?? null, waitingNodeId: null };
  }

  if (!source.nodeId) return { ready: false, teamId: null, waitingNodeId: null };
  const sourceNode = context.nodes.find((node) => node.id === source.nodeId);
  const sourceMatch = sourceNode?.linkedMatchId
    ? context.matches.find((match) => match.id === sourceNode.linkedMatchId)
    : undefined;
  const winnerTeamId = resolvedWinner(sourceMatch);
  return {
    ready: Boolean(winnerTeamId),
    teamId: winnerTeamId,
    waitingNodeId: winnerTeamId ? null : source.nodeId,
  };
}

export function isKnockoutMatchReadyForEditing(
  node: CompetitionTreeNode,
  context: KnockoutReadinessContext,
): KnockoutNodeReadiness {
  const home = areSourceDependenciesResolved(node.homeSource, context);
  const away = areSourceDependenciesResolved(node.awaySource, context);
  return {
    away,
    home,
    ready: home.ready && away.ready && home.teamId !== away.teamId,
    waitingNodeIds: [home.waitingNodeId, away.waitingNodeId].filter((nodeId): nodeId is string => Boolean(nodeId)),
  };
}

export function isKnockoutRoundReadyForFixtures(
  nodes: CompetitionTreeNode[],
  context: KnockoutReadinessContext,
) {
  const nodeReadiness = nodes.map((node) => ({ node, readiness: isKnockoutMatchReadyForEditing(node, context) }));
  return { nodeReadiness, ready: nodeReadiness.length > 0 && nodeReadiness.every(({ readiness }) => readiness.ready) };
}

export function buildKnockoutMatchReadinessByMatchId(context: KnockoutReadinessContext) {
  return new Map(
    context.nodes.flatMap((node) => node.linkedMatchId
      ? [[node.linkedMatchId, isKnockoutMatchReadyForEditing(node, context)] as const]
      : []),
  );
}

export function getKnockoutMatchPresentation(readiness: KnockoutNodeReadiness | undefined): KnockoutMatchPresentation {
  if (!readiness) return { editable: false, state: "missing" };
  return readiness.ready
    ? { editable: true, state: "ready" }
    : { editable: false, state: "waiting" };
}

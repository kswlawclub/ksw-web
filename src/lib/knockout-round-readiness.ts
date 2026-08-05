import type { CompetitionTreeNode, CompetitionTreeSource } from "@/lib/competition-tree";

export type KnockoutReadinessMatch = {
  away_score?: number | null;
  id: string;
  home_score?: number | null;
  manual_winner_team_id?: string | null;
  penalty_away_score?: number | null;
  penalty_home_score?: number | null;
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

export type KnockoutRoundProgress = {
  complete: boolean;
  linkedMatchCount: number;
  nodes: CompetitionTreeNode[];
  playable: boolean;
  reason: "complete" | "ready_for_fixtures" | "waiting_for_dependencies";
  roundIndex: number;
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

export function getKnockoutRoundProgression(context: KnockoutReadinessContext) {
  const matchesById = new Map(context.matches.map((match) => [match.id, match]));
  const grouped = new Map<number, CompetitionTreeNode[]>();
  context.nodes.forEach((node) => grouped.set(node.roundIndex, [...(grouped.get(node.roundIndex) ?? []), node]));
  const rounds = Array.from(grouped, ([roundIndex, nodes]): KnockoutRoundProgress => {
    const complete = nodes.length > 0 && nodes.every((node) => {
      const match = node.linkedMatchId ? matchesById.get(node.linkedMatchId) : undefined;
      return Boolean(match && ["finished", "completed"].includes(match.status ?? "") && match.winner_team_id);
    });
    const playable = isKnockoutRoundReadyForFixtures(nodes, context).ready;
    return {
      complete,
      linkedMatchCount: nodes.filter((node) => Boolean(node.linkedMatchId)).length,
      nodes,
      playable,
      reason: complete ? "complete" : playable ? "ready_for_fixtures" : "waiting_for_dependencies",
      roundIndex,
    };
  }).sort((left, right) => left.roundIndex - right.roundIndex);
  return { currentRound: rounds.find((round) => !round.complete) ?? null, rounds };
}

function isUnplayedFixtureDraft(match: KnockoutReadinessMatch) {
  return !["finished", "completed"].includes(match.status ?? "")
    && match.away_score == null
    && match.home_score == null
    && match.manual_winner_team_id == null
    && match.penalty_away_score == null
    && match.penalty_home_score == null
    && match.winner_team_id == null;
}

export function getPrematureKnockoutFixtureDrafts(context: KnockoutReadinessContext) {
  const progression = getKnockoutRoundProgression(context);
  const currentRound = progression.currentRound;
  if (!currentRound || currentRound.linkedMatchCount > 0) return { matchIds: [] as string[], nodeIds: [] as string[] };
  const matchesById = new Map(context.matches.map((match) => [match.id, match]));
  const candidates = progression.rounds
    .filter((round) => round.roundIndex > currentRound.roundIndex)
    .flatMap((round) => round.nodes)
    .flatMap((node) => {
      const match = node.linkedMatchId ? matchesById.get(node.linkedMatchId) : undefined;
      return match && isUnplayedFixtureDraft(match) ? [{ matchId: match.id, nodeId: node.id }] : [];
    });
  return { matchIds: candidates.map((candidate) => candidate.matchId), nodeIds: candidates.map((candidate) => candidate.nodeId) };
}

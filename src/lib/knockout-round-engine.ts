import type { CompetitionTreeNode, CompetitionTreeSource } from "@/lib/competition-tree";

export type KnockoutRoundEngineMatch = {
  awayScore?: number | null;
  homeScore?: number | null;
  id: string;
  penaltyAwayScore?: number | null;
  penaltyHomeScore?: number | null;
  status: string | null | undefined;
  winnerTeamId?: string | null;
};

export type KnockoutRoundNodeState = "topology_only" | "draft" | "resolved_draft" | "confirmed_draft" | "materialized" | "played";

export type KnockoutRoundState = {
  complete: boolean;
  linkedMatchCount: number;
  nodes: CompetitionTreeNode[];
  playable: boolean;
  requiresFixtures: boolean;
  roundIndex: number;
  roundLabel: string;
  state: KnockoutRoundNodeState;
};

export type KnockoutRoundEngineInput = {
  matches: KnockoutRoundEngineMatch[];
  nodes: CompetitionTreeNode[];
  partitionKey?: string;
  qualificationSnapshot?: CompetitionTreeSource[];
  resolveSource?: (source: CompetitionTreeSource, node: CompetitionTreeNode) => string | null;
};

export type KnockoutRoundEngineState = {
  completedRounds: KnockoutRoundState[];
  currentRound: KnockoutRoundState | null;
  finalRound: KnockoutRoundState | null;
  firstPlayableRound: KnockoutRoundState | null;
  localizedLabels: Record<number, string>;
  playableRounds: KnockoutRoundState[];
  roundStates: KnockoutRoundState[];
  rounds: KnockoutRoundState[];
};

const stateRank: Record<KnockoutRoundNodeState, number> = {
  topology_only: 0,
  draft: 1,
  resolved_draft: 2,
  confirmed_draft: 3,
  materialized: 4,
  played: 5,
};

function hasResult(match: KnockoutRoundEngineMatch | undefined) {
  return Boolean(match && (match.status === "finished" || match.status === "completed") && match.winnerTeamId);
}

function sourceKey(source: CompetitionTreeSource) {
  return `${source.type}:${source.groupId ?? ""}:${source.rank ?? ""}:${source.bestOrder ?? ""}`;
}

function defaultSourceResolver(
  source: CompetitionTreeSource,
  nodesById: Map<string, CompetitionTreeNode>,
  matchesById: Map<string, KnockoutRoundEngineMatch>,
  qualificationBySource: Map<string, string>,
) {
  if (source.teamId) return source.teamId;
  if (source.type === "node_winner" && source.nodeId) {
    const sourceNode = nodesById.get(source.nodeId);
    const sourceMatch = sourceNode?.linkedMatchId ? matchesById.get(sourceNode.linkedMatchId) : undefined;
    return hasResult(sourceMatch) ? sourceMatch?.winnerTeamId ?? null : null;
  }
  return qualificationBySource.get(sourceKey(source)) ?? null;
}

function nodeState(
  node: CompetitionTreeNode,
  matchesById: Map<string, KnockoutRoundEngineMatch>,
  resolveSource: (source: CompetitionTreeSource, node: CompetitionTreeNode) => string | null,
): KnockoutRoundNodeState {
  const linkedMatch = node.linkedMatchId ? matchesById.get(node.linkedMatchId) : undefined;
  if (hasResult(linkedMatch)) return "played";
  if (node.linkedMatchId) return "materialized";
  const sources = [node.homeSource, node.awaySource];
  if (sources.every((source) => source.type === "unassigned" || source.type === "bye")) return "topology_only";
  if (sources.some((source) => source.teamId)) return "confirmed_draft";
  if (sources.some((source) => Boolean(resolveSource(source, node)))) return "resolved_draft";
  return "draft";
}

/**
 * Read-only projection of a knockout topology. It deliberately owns no
 * persistence, template-switching, or public-visibility policy.
 */
export function deriveKnockoutRoundState(input: KnockoutRoundEngineInput): KnockoutRoundEngineState {
  const nodes = input.partitionKey
    ? input.nodes.filter((node) => (node.partitionKey ?? "main") === input.partitionKey)
    : input.nodes;
  const matchesById = new Map(input.matches.map((match) => [match.id, match]));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const qualificationBySource = new Map((input.qualificationSnapshot ?? [])
    .filter((source) => Boolean(source.teamId))
    .map((source) => [sourceKey(source), source.teamId!]));
  const resolveSource = input.resolveSource
    ? input.resolveSource
    : (source: CompetitionTreeSource) => defaultSourceResolver(source, nodesById, matchesById, qualificationBySource);
  const grouped = new Map<number, CompetitionTreeNode[]>();
  nodes.forEach((node) => grouped.set(node.roundIndex, [...(grouped.get(node.roundIndex) ?? []), node]));

  const rounds = Array.from(grouped.entries())
    .sort(([left], [right]) => left - right)
    .map(([roundIndex, roundNodes]) => {
      const orderedNodes = [...roundNodes].sort((left, right) => left.matchOrder - right.matchOrder);
      const states = orderedNodes.map((node) => nodeState(node, matchesById, resolveSource));
      const linkedMatchCount = orderedNodes.filter((node) => Boolean(node.linkedMatchId)).length;
      const complete = orderedNodes.length > 0 && orderedNodes.every((node) => {
        const match = node.linkedMatchId ? matchesById.get(node.linkedMatchId) : undefined;
        return Boolean(match?.status === "finished" && match.winnerTeamId);
      });
      const playable = orderedNodes.length > 0 && orderedNodes.every((node) => {
        const homeTeamId = resolveSource(node.homeSource, node);
        const awayTeamId = resolveSource(node.awaySource, node);
        return Boolean(homeTeamId && awayTeamId && homeTeamId !== awayTeamId);
      });
      const state = states.reduce<KnockoutRoundNodeState>((current, candidate) => stateRank[candidate] > stateRank[current] ? candidate : current, "topology_only");
      return {
        complete,
        linkedMatchCount,
        nodes: orderedNodes,
        playable,
        requiresFixtures: orderedNodes.some((node) => !node.linkedMatchId),
        roundIndex,
        roundLabel: orderedNodes[0]?.roundLabel ?? `Round ${roundIndex + 1}`,
        state,
      } satisfies KnockoutRoundState;
    });
  const currentRound = rounds.find((round) => !round.complete) ?? null;
  const playableRounds = rounds.filter((round) => round.playable);

  return {
    completedRounds: rounds.filter((round) => round.complete),
    currentRound,
    finalRound: rounds[rounds.length - 1] ?? null,
    firstPlayableRound: rounds.find((round) => !round.complete && round.playable && round.requiresFixtures) ?? null,
    localizedLabels: Object.fromEntries(rounds.map((round) => [round.roundIndex, round.roundLabel])),
    playableRounds,
    roundStates: rounds,
    rounds,
  };
}

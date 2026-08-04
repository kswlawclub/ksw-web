import type { PublicCupV2Data, PublicCupV2Node, PublicCupV2Team } from "@/lib/public-cup-v2-types";

export type CompletedParticipantPerformance = "champion" | "runner_up" | "semifinalist" | "quarterfinalist" | "other";

export type CompletedParticipantTeamOrderInput = {
  displayOrder: number | null;
  id: string;
  isKsw: boolean;
  name: string;
  seed: number | null;
};

export type CompletedParticipantTeamOrderResult = CompletedParticipantTeamOrderInput & {
  performance: CompletedParticipantPerformance;
};

const performanceRank: Record<CompletedParticipantPerformance, number> = {
  champion: 0,
  runner_up: 1,
  semifinalist: 2,
  quarterfinalist: 3,
  other: 4,
};

const naturalNameCollator = new Intl.Collator("th", { numeric: true, sensitivity: "base" });

function loserOfFinishedNode(node: PublicCupV2Node) {
  const match = node.linkedMatch;
  if (!match?.winner) return null;
  const teams = [match.homeTeam, match.awayTeam].filter((team): team is PublicCupV2Team => team !== null);
  return teams.find((team) => team.id !== match.winner?.id) ?? null;
}

function assignPerformance(target: Map<string, CompletedParticipantPerformance>, teamId: string, performance: CompletedParticipantPerformance) {
  if (!teamId) return;
  const current = target.get(teamId);
  if (!current || performanceRank[performance] < performanceRank[current]) target.set(teamId, performance);
}

function bracketPerformances(bracket: PublicCupV2Data | null) {
  const performances = new Map<string, CompletedParticipantPerformance>();
  if (!bracket) return performances;

  bracket.partitions.forEach((partition) => {
    if (partition.champion) assignPerformance(performances, partition.champion.id, "champion");
    const partitionNodes = bracket.nodes.filter((node) => node.partitionKey === partition.key);
    const finalRoundIndex = Math.max(...partitionNodes.map((node) => node.roundIndex));
    if (!Number.isFinite(finalRoundIndex)) return;

    partitionNodes.forEach((node) => {
      const roundDistanceFromFinal = finalRoundIndex - node.roundIndex;
      const loser = loserOfFinishedNode(node);
      if (!loser) return;
      if (roundDistanceFromFinal === 0) assignPerformance(performances, loser.id, "runner_up");
      if (roundDistanceFromFinal === 1) assignPerformance(performances, loser.id, "semifinalist");
      if (roundDistanceFromFinal === 2) assignPerformance(performances, loser.id, "quarterfinalist");
    });
  });

  return performances;
}

export function sortCompletedParticipantTeams<T extends CompletedParticipantTeamOrderInput>({ bracket, championTeamIds = new Set<string>(), leaguePlacements = new Map<string, number>(), teams }: {
  bracket: PublicCupV2Data | null;
  championTeamIds?: Set<string>;
  leaguePlacements?: Map<string, number>;
  teams: T[];
}): Array<T & { performance: CompletedParticipantPerformance }> {
  const performances = bracketPerformances(bracket);
  const uniqueTeams = new Map<string, T>();
  teams.forEach((team) => {
    if (!team.id || uniqueTeams.has(team.id)) return;
    uniqueTeams.set(team.id, team);
  });

  return Array.from(uniqueTeams.values())
    .map((team) => {
      const leaguePosition = leaguePlacements.get(team.id);
      const performance = performances.get(team.id)
        ?? (championTeamIds.has(team.id) ? "champion" : leaguePosition === 2 ? "runner_up" : "other");
      return { ...team, performance };
    })
    .sort((left, right) => {
      if (left.isKsw !== right.isKsw) return left.isKsw ? -1 : 1;
      const performanceDifference = performanceRank[left.performance] - performanceRank[right.performance];
      if (performanceDifference) return performanceDifference;
      const displayOrderDifference = (left.displayOrder ?? Number.MAX_SAFE_INTEGER) - (right.displayOrder ?? Number.MAX_SAFE_INTEGER);
      if (displayOrderDifference) return displayOrderDifference;
      const seedDifference = (left.seed ?? Number.MAX_SAFE_INTEGER) - (right.seed ?? Number.MAX_SAFE_INTEGER);
      if (seedDifference) return seedDifference;
      return naturalNameCollator.compare(left.name, right.name);
    });
}

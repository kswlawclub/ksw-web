import type { PublicCupV2Data, PublicCupV2Node, PublicCupV2Team } from "./public-cup-v2-types";

export function derivePublicCupChampionPath(input: {
  championId: string | null | undefined;
  data: PublicCupV2Data;
  partitionKey: string;
}) {
  if (!input.championId) return [] as PublicCupV2Node[];
  return input.data.nodes
    .filter((node) => node.partitionKey === input.partitionKey && node.linkedMatch?.winner?.id === input.championId)
    .sort((left, right) => right.roundIndex - left.roundIndex || right.matchOrder - left.matchOrder);
}

export function publicCupPartitionTeams(data: PublicCupV2Data, partitionKey: string) {
  const teamIds = new Set<string>();
  data.nodes
    .filter((node) => node.partitionKey === partitionKey)
    .forEach((node) => {
      [
        node.homeSource.team?.id,
        node.awaySource.team?.id,
        node.linkedMatch?.homeTeam?.id,
        node.linkedMatch?.awayTeam?.id,
      ].forEach((teamId) => {
        if (teamId) teamIds.add(teamId);
      });
    });
  return data.teams.filter((team) => teamIds.has(team.id));
}

export function hasUnpartitionedPublicCupTeams(data: PublicCupV2Data, teamsByPartition: PublicCupV2Team[][]) {
  const partitionedIds = new Set(teamsByPartition.flatMap((teams) => teams.map((team) => team.id)));
  return data.teams.some((team) => !partitionedIds.has(team.id));
}

export function publicCupArchiveMetadata(data: PublicCupV2Data, node: PublicCupV2Node) {
  const partition = data.partitions.find((entry) => entry.key === node.partitionKey);
  return {
    divisionLabel: node.partitionKey === "main" ? "Main" : partition?.label ?? "ไม่ระบุดิวิชั่น",
    groupLabel: node.homeSource.groupLabel ?? node.awaySource.groupLabel ?? "",
  };
}

export function chronicleGroupLabel(groupId: string, groupLabels: Map<string, string>) {
  if (!groupId) return "ไม่ระบุกลุ่ม";
  return groupLabels.get(groupId) ?? "ไม่ระบุกลุ่ม";
}

import type { PublicCupV2Data, PublicCupV2Node, PublicCupV2Team } from "./public-cup-v2-types";

type ArchiveMatch = Record<string, unknown>;

export type PublicCupArchiveMatch<T extends ArchiveMatch = ArchiveMatch> = {
  groupId: string | null;
  isFinal: boolean;
  match: T;
  matchId: string;
  matchOrder: number;
  partitionKey: string | null;
  roundIndex: number | null;
  roundLabel: string | null;
  section: "group" | "knockout" | "other";
};

function archiveText(row: ArchiveMatch | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" && value.trim() ? value : "";
}

function bracketRoundLabel(node: PublicCupV2Node, finalRoundIndex: number, isFinal: boolean) {
  if (isFinal) return "Final";
  const distanceFromFinal = finalRoundIndex - node.roundIndex;
  if (distanceFromFinal === 1) return "Semifinal";
  if (distanceFromFinal === 2) return "Quarterfinal";
  return node.roundLabel || "Knockout Stage";
}

/**
 * Assigns every persisted match to exactly one public archive section.
 * Linked nodes own knockout matches; only unlinked group-stage rows use group_id.
 */
export function buildPublicCupArchive<T extends ArchiveMatch>({ matches, nodes }: { matches: T[]; nodes: PublicCupV2Node[] }) {
  const finalNodeIds = new Set<string>();
  const finalRoundByPartition = new Map<string, number>();

  nodes.forEach((node) => {
    const current = finalRoundByPartition.get(node.partitionKey);
    if (current === undefined || node.roundIndex > current) finalRoundByPartition.set(node.partitionKey, node.roundIndex);
  });
  finalRoundByPartition.forEach((roundIndex, partitionKey) => {
    const finalNode = nodes
      .filter((node) => node.partitionKey === partitionKey && node.roundIndex === roundIndex && node.linkedMatchId)
      .sort((left, right) => left.matchOrder - right.matchOrder || left.id.localeCompare(right.id))[0];
    if (finalNode) finalNodeIds.add(finalNode.id);
  });

  const nodeByMatchId = new Map<string, PublicCupV2Node>();
  nodes.forEach((node) => {
    if (node.linkedMatchId) nodeByMatchId.set(node.linkedMatchId, node);
  });
  const seenMatchIds = new Set<string>();
  const archive: PublicCupArchiveMatch<T>[] = [];

  matches.forEach((match) => {
    const matchId = archiveText(match, "id");
    if (!matchId || seenMatchIds.has(matchId)) return;
    seenMatchIds.add(matchId);

    const node = nodeByMatchId.get(matchId);
    if (node) {
      const finalRoundIndex = finalRoundByPartition.get(node.partitionKey) ?? node.roundIndex;
      const isFinal = finalNodeIds.has(node.id);
      archive.push({
        groupId: null,
        isFinal,
        match,
        matchId,
        matchOrder: node.matchOrder,
        partitionKey: node.partitionKey,
        roundIndex: node.roundIndex,
        roundLabel: bracketRoundLabel(node, finalRoundIndex, isFinal),
        section: "knockout",
      });
      return;
    }

    const groupId = archiveText(match, "group_id");
    if (archiveText(match, "competition_stage").toLowerCase() === "group" || groupId) {
      archive.push({ groupId: groupId || null, isFinal: false, match, matchId, matchOrder: 0, partitionKey: null, roundIndex: null, roundLabel: null, section: "group" });
      return;
    }

    archive.push({ groupId: null, isFinal: false, match, matchId, matchOrder: 0, partitionKey: null, roundIndex: null, roundLabel: null, section: "other" });
  });

  return archive;
}

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

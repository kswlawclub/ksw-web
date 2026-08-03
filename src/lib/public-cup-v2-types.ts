export const publicCupV2TemplateKeys = ["ksw_standard", "council_two_division"] as const;

export type PublicCupV2TemplateKey = (typeof publicCupV2TemplateKeys)[number] | "legacy_cup";
export type PublicCupV2PartitionKey = "division_1" | "division_2" | "main" | string;

export type PublicCupV2Team = {
  id: string;
  logoUrl: string | null;
  name: string;
  shortName: string | null;
};

export type PublicCupV2Source = {
  bestOrder: number | null;
  groupId: string | null;
  groupLabel: string | null;
  rank: number | null;
  team: PublicCupV2Team | null;
  type: string;
  winnerNodeId: string | null;
};

export type PublicCupV2Match = {
  awayPenaltyScore: number | null;
  awayScore: number | null;
  awayTeam: PublicCupV2Team | null;
  homePenaltyScore: number | null;
  homeScore: number | null;
  homeTeam: PublicCupV2Team | null;
  id: string;
  matchDate: string | null;
  status: string;
  venue: string | null;
  winner: PublicCupV2Team | null;
};

export type PublicCupV2Node = {
  awaySource: PublicCupV2Source;
  bracketPosition: number;
  homeSource: PublicCupV2Source;
  id: string;
  linkedMatch: PublicCupV2Match | null;
  linkedMatchId: string | null;
  matchOrder: number;
  partitionKey: PublicCupV2PartitionKey;
  roundIndex: number;
  roundLabel: string;
};

export type PublicCupV2Partition = {
  bracketCapacity: number | null;
  championAt: string | null;
  champion: PublicCupV2Team | null;
  entrantCount: number | null;
  key: PublicCupV2PartitionKey;
  label: string;
  status: string;
};

export type PublicCupV2Config = {
  bracketCapacity: number | null;
  entrantCount: number | null;
  qualificationStatus: string;
  status: string;
  templateKey: Exclude<PublicCupV2TemplateKey, "legacy_cup">;
};

export type PublicCupV2Data = {
  champions: {
    division1: PublicCupV2Team | null;
    division2: PublicCupV2Team | null;
    main: PublicCupV2Team | null;
  };
  config: PublicCupV2Config | null;
  groups: Array<{ id: string; label: string; name: string }>;
  linkedMatches: PublicCupV2Match[];
  nodes: PublicCupV2Node[];
  partitions: PublicCupV2Partition[];
  templateKey: PublicCupV2TemplateKey;
  teams: PublicCupV2Team[];
};

type Row = Record<string, unknown>;

function nullableNumber(row: Row, key: string) {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function nullableText(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function text(row: Row, key: string, fallback = "") {
  return nullableText(row, key) ?? fallback;
}

export function detectPublicCupV2Template(input: { competitionType: string; isPublished: boolean; templateKey: string | null }) {
  if (!input.isPublished || input.competitionType !== "cup") return "legacy_cup" as const;
  return publicCupV2TemplateKeys.includes(input.templateKey as (typeof publicCupV2TemplateKeys)[number])
    ? input.templateKey as Exclude<PublicCupV2TemplateKey, "legacy_cup">
    : "legacy_cup" as const;
}

export function mapPublicCupV2Data(input: {
  config: Row | null;
  groups: Row[];
  linkedMatches: Row[];
  nodes: Row[];
  partitions: Row[];
  templateKey: PublicCupV2TemplateKey;
  teams: Row[];
}): PublicCupV2Data {
  const teamsById = new Map(input.teams.map((team) => {
    const id = text(team, "id");
    return [id, {
      id,
      logoUrl: nullableText(team, "logo_url"),
      name: text(team, "name", "ทีมไม่ทราบชื่อ"),
      shortName: nullableText(team, "short_name"),
    } satisfies PublicCupV2Team];
  }));
  const groupsById = new Map(input.groups.map((group) => [text(group, "id"), {
    id: text(group, "id"),
    label: text(group, "label") || text(group, "name"),
    name: text(group, "name"),
  }]));
  const teamFor = (teamId: string | null) => teamId ? teamsById.get(teamId) ?? null : null;
  const sourceFor = (row: Row, side: "home" | "away"): PublicCupV2Source => {
    const groupId = nullableText(row, `${side}_source_group_id`);
    const teamId = nullableText(row, `${side}_source_team_id`);
    return {
      bestOrder: nullableNumber(row, `${side}_source_best_order`),
      groupId,
      groupLabel: groupId ? groupsById.get(groupId)?.label ?? null : null,
      rank: nullableNumber(row, `${side}_source_rank`),
      team: teamFor(teamId),
      type: text(row, `${side}_source_type`, "unassigned"),
      winnerNodeId: nullableText(row, `${side}_source_node_id`),
    };
  };
  const matchesById = new Map(input.linkedMatches.map((match) => {
    const id = text(match, "id");
    return [id, {
      awayPenaltyScore: nullableNumber(match, "penalty_away_score"),
      awayScore: nullableNumber(match, "away_score"),
      awayTeam: teamFor(nullableText(match, "away_team_id")),
      homePenaltyScore: nullableNumber(match, "penalty_home_score"),
      homeScore: nullableNumber(match, "home_score"),
      homeTeam: teamFor(nullableText(match, "home_team_id")),
      id,
      matchDate: nullableText(match, "match_date"),
      status: text(match, "status", "scheduled"),
      venue: nullableText(match, "venue"),
      winner: teamFor(nullableText(match, "winner_team_id")),
    } satisfies PublicCupV2Match];
  }));
  const partitions = input.partitions.map((partition) => {
    const key = text(partition, "partition_key", "main");
    return {
      bracketCapacity: nullableNumber(partition, "bracket_capacity"),
      championAt: nullableText(partition, "champion_at"),
      champion: teamFor(nullableText(partition, "champion_team_id")),
      entrantCount: nullableNumber(partition, "entrant_count"),
      key,
      label: text(partition, "partition_label") || key,
      status: text(partition, "status", "draft"),
    } satisfies PublicCupV2Partition;
  });
  const partitionByKey = new Map(partitions.map((partition) => [partition.key, partition]));

  return {
    champions: {
      division1: partitionByKey.get("division_1")?.champion ?? null,
      division2: partitionByKey.get("division_2")?.champion ?? null,
      main: partitionByKey.get("main")?.champion ?? null,
    },
    config: input.config && input.templateKey !== "legacy_cup" ? {
      bracketCapacity: nullableNumber(input.config, "bracket_capacity"),
      entrantCount: nullableNumber(input.config, "entrant_count"),
      qualificationStatus: text(input.config, "qualification_status", "pending"),
      status: text(input.config, "status", "draft"),
      templateKey: input.templateKey,
    } : null,
    groups: Array.from(groupsById.values()),
    linkedMatches: Array.from(matchesById.values()),
    nodes: input.nodes
      .map((node) => {
        const linkedMatchId = nullableText(node, "linked_match_id");
        return {
          awaySource: sourceFor(node, "away"),
          bracketPosition: nullableNumber(node, "bracket_position") ?? 0,
          homeSource: sourceFor(node, "home"),
          id: text(node, "id"),
          linkedMatch: linkedMatchId ? matchesById.get(linkedMatchId) ?? null : null,
          linkedMatchId,
          matchOrder: nullableNumber(node, "match_order") ?? 0,
          partitionKey: text(node, "partition_key", "main"),
          roundIndex: nullableNumber(node, "round_index") ?? 0,
          roundLabel: text(node, "round_label"),
        } satisfies PublicCupV2Node;
      })
      .sort((left, right) => left.partitionKey.localeCompare(right.partitionKey) || left.roundIndex - right.roundIndex || left.matchOrder - right.matchOrder),
    partitions,
    templateKey: input.templateKey,
    teams: Array.from(teamsById.values()).filter((team) => team.id),
  };
}

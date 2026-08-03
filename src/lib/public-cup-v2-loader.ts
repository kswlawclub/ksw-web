import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  detectPublicCupV2Template,
  mapPublicCupV2Data,
  type PublicCupV2Data,
} from "@/lib/public-cup-v2-types";

type Row = Record<string, unknown>;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" && value.trim() ? value : "";
}

function isPublished(competition: Row) {
  return competition.is_published === true;
}

function logReadFailure(source: string, competitionId: string, error: { code?: string; message?: string } | null) {
  if (!error) return;
  console.error("public cup v2 loader failed", { code: error.code, competitionId, message: error.message, source });
}

export async function loadPublicCupV2Data(competition: Row): Promise<PublicCupV2Data | null> {
  const competitionId = text(competition, "id");
  const competitionType = text(competition, "competition_type");
  if (!competitionId || competitionType !== "cup" || !isPublished(competition)) return null;

  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const configResult = await supabase
    .from("competition_knockout_configs")
    .select("competition_id, entrant_count, bracket_capacity, status, template_key, qualification_status")
    .eq("competition_id", competitionId)
    .maybeSingle();
  if (configResult.error) {
    logReadFailure("competition_knockout_configs", competitionId, configResult.error);
    return null;
  }

  const templateKey = detectPublicCupV2Template({
    competitionType,
    isPublished: true,
    templateKey: text(configResult.data as Row | undefined, "template_key") || null,
  });
  if (templateKey === "legacy_cup") return null;

  const [nodesResult, partitionsResult, groupsResult, participantsResult] = await Promise.all([
    supabase
      .from("competition_bracket_nodes")
      .select("id, partition_key, round_index, round_label, match_order, bracket_position, linked_match_id, home_source_type, home_source_group_id, home_source_rank, home_source_team_id, home_source_node_id, home_source_best_order, away_source_type, away_source_group_id, away_source_rank, away_source_team_id, away_source_node_id, away_source_best_order")
      .eq("competition_id", competitionId)
      .order("partition_key")
      .order("round_index")
      .order("match_order"),
    supabase
      .from("competition_knockout_partitions")
      .select("partition_key, partition_label, entrant_count, bracket_capacity, champion_team_id, champion_at, status")
      .eq("competition_id", competitionId)
      .order("partition_key"),
    supabase
      .from("competition_groups")
      .select("id, name, label")
      .eq("competition_id", competitionId)
      .order("sort_order"),
    supabase
      .from("competition_teams")
      .select("team_id")
      .eq("competition_id", competitionId)
      .eq("is_active", true),
  ]);
  const firstError = nodesResult.error ?? partitionsResult.error ?? groupsResult.error ?? participantsResult.error;
  if (firstError) {
    logReadFailure("competition engine v2 graph", competitionId, firstError);
    return null;
  }

  const nodes = (nodesResult.data ?? []) as Row[];
  const partitions = (partitionsResult.data ?? []) as Row[];
  const groups = (groupsResult.data ?? []) as Row[];
  const linkedMatchIds = nodes.map((node) => text(node, "linked_match_id")).filter(Boolean);
  const matchesResult = linkedMatchIds.length
    ? await supabase
        .from("matches")
        .select("id, home_team_id, away_team_id, home_score, away_score, penalty_home_score, penalty_away_score, winner_team_id, match_date, venue, status")
        .in("id", linkedMatchIds)
    : { data: [] as Row[], error: null };
  if (matchesResult.error) {
    logReadFailure("linked knockout matches", competitionId, matchesResult.error);
    return null;
  }

  const teamIds = new Set<string>();
  ((participantsResult.data ?? []) as Row[]).forEach((participant) => teamIds.add(text(participant, "team_id")));
  nodes.forEach((node) => {
    teamIds.add(text(node, "home_source_team_id"));
    teamIds.add(text(node, "away_source_team_id"));
  });
  partitions.forEach((partition) => teamIds.add(text(partition, "champion_team_id")));
  ((matchesResult.data ?? []) as Row[]).forEach((match) => {
    teamIds.add(text(match, "home_team_id"));
    teamIds.add(text(match, "away_team_id"));
    teamIds.add(text(match, "winner_team_id"));
  });
  const resolvedTeamIds = Array.from(teamIds).filter(Boolean);
  const teamsResult = resolvedTeamIds.length
    ? await supabase.from("teams").select("id, name, short_name, logo_url").in("id", resolvedTeamIds)
    : { data: [] as Row[], error: null };
  if (teamsResult.error) {
    logReadFailure("cup teams", competitionId, teamsResult.error);
    return null;
  }

  return mapPublicCupV2Data({
    config: configResult.data as Row,
    groups,
    linkedMatches: (matchesResult.data ?? []) as Row[],
    nodes,
    partitions,
    teams: (teamsResult.data ?? []) as Row[],
    templateKey,
  });
}

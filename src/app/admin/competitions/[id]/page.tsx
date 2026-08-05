import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AdminCompetitionMatchManager,
  type AdminCompetitionMatch,
  type AdminCompetitionMatchTeam,
} from "@/components/admin-competition-match-manager";
import {
  type AdminCompetitionGroup,
  type AdminCompetitionGroupTeam,
} from "@/components/admin-competition-groups-manager";
import { AdminCupCompetitionWorkspace } from "@/components/admin-cup-competition-workspace";
import { AdminCompetitionPublicationControl } from "@/components/admin-competition-publication-control";
import { AdminLeagueCompetitionWorkspace } from "@/components/admin-league-competition-workspace";
import { CopyPublicLinkButton } from "@/components/copy-public-link-button";
import { TeamLogo } from "@/components/team-logo";
import { loadCompetitionParticipants } from "@/lib/competition-participants";
import { requireAdminSession } from "@/lib/admin-server-auth";
import { getCompetitionTypeLabel, isCupCompetition, normalizeCompetitionType } from "@/lib/competition-format";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  deriveCompetitionEngineV2Integrity,
  type CompetitionEngineV2Integrity,
} from "@/lib/competition-engine-v2-state";
import {
  validateCompetitionTree,
  type CompetitionTreeNode,
  type CompetitionTreeSource,
  type CompetitionTreeSummary,
} from "@/lib/competition-tree";
import type { ApprovedQualificationSummary } from "@/app/admin/competitions/[id]/qualification-actions";
import type { CompetitionEngineV2Config } from "@/app/admin/competitions/[id]/competition-engine-v2-actions";
import type { CouncilWorkflowPartition } from "@/lib/cup-competition-workflow";
import type {
  StandardLeagueConfig,
  StandardLeagueMatchweek,
  StandardLeagueRescheduleHistory,
} from "@/lib/league-template/types";

type Row = Record<string, unknown>;

const competitionColumns =
  "id, name, season, slug, short_description, description, cover_image_url, edition_number, start_date, end_date, location, display_order, competition_type, competition_engine_version, season_status, is_active, is_featured, is_published, created_at";
const matchColumns =
  "id, league_id, group_id, competition_stage, fixture_source, knockout_partition_key, league_leg, matchweek, scheduled_matchweek, reschedule_reason, rescheduled_at, rescheduled_by, league_fixture_version, league_fixture_key, match_date, home_team_id, away_team_id, home_score, away_score, penalty_home_score, penalty_away_score, manual_winner_team_id, winner_team_id, venue, status";
const teamColumns = "id, name, short_name, logo_url, is_ksw";
const groupColumns = "id, competition_id, name, label, sort_order, qualifiers_count, created_at, updated_at";
const competitionTeamGroupColumns = "id, competition_id, team_id, group_id, is_active, display_order";
const engineV2ConfigColumns =
  "competition_id, entrant_count, bracket_capacity, entry_mode, group_stage_enabled, status, template_key, extra_rank_enabled, extra_rank, extra_qualifier_count, qualification_status, qualification_approved_at, qualification_approved_by_label, qualification_snapshot";
const bracketNodeColumns =
  "id, competition_id, partition_key, round_index, round_label, match_order, bracket_position, home_source_type, away_source_type, home_source_group_id, home_source_rank, home_source_team_id, home_source_node_id, home_source_best_order, away_source_group_id, away_source_rank, away_source_team_id, away_source_node_id, away_source_best_order, linked_match_id";

function text(row: Row | undefined, keys: string[], fallback = "") {
  if (!row) return fallback;

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }

  return fallback;
}

function number(row: Row | undefined, keys: string[]) {
  if (!row) return 0;

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }

  return 0;
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "Not set";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function statusLabel(value: string) {
  return value ? value : "Not set";
}

function booleanLabel(value: unknown) {
  return value === true ? "Yes" : "No";
}

function teamInitials(team: Row) {
  return text(team, ["short_name", "name"], "FC").slice(0, 3).toUpperCase();
}

function teamName(team: Row | undefined) {
  return text(team, ["name", "short_name"], "Unknown team");
}

async function runQuery<T>(
  source: string,
  query: PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  try {
    const result = await query;
    if (result.error) console.error("admin competition workspace query failed", source, result.error);
    return result.data ?? [];
  } catch (error) {
    console.error("admin competition workspace query failed", source, error);
    return [];
  }
}

async function runQueryStatus<T>(
  source: string,
  query: PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  try {
    const result = await query;
    if (result.error) {
      console.error("admin competition workspace query failed", source, result.error);
      return { data: [] as T[], ok: false };
    }
    return { data: result.data ?? [], ok: true };
  } catch (error) {
    console.error("admin competition workspace query failed", source, error);
    return { data: [] as T[], ok: false };
  }
}

function matchTeamIds(matches: Row[]) {
  return Array.from(
    new Set(
      matches
        .flatMap((match) => [text(match, ["home_team_id"], ""), text(match, ["away_team_id"], "")])
        .filter(Boolean),
    ),
  );
}

function asMatch(row: Row): AdminCompetitionMatch {
  return {
    away_score: typeof row.away_score === "number" ? row.away_score : null,
    away_team_id: text(row, ["away_team_id"], ""),
    competition_stage: text(row, ["competition_stage"], "") || null,
    fixture_source: text(row, ["fixture_source"], "") || null,
    group_id: text(row, ["group_id"], "") || null,
    home_score: typeof row.home_score === "number" ? row.home_score : null,
    home_team_id: text(row, ["home_team_id"], ""),
    id: text(row, ["id"], ""),
    league_fixture_key: text(row, ["league_fixture_key"], "") || null,
    league_fixture_version: typeof row.league_fixture_version === "number" ? row.league_fixture_version : null,
    league_id: text(row, ["league_id"], "") || null,
    league_leg: typeof row.league_leg === "number" ? row.league_leg : null,
    manual_winner_team_id: text(row, ["manual_winner_team_id"], "") || null,
    match_date: text(row, ["match_date"], "") || null,
    matchweek: typeof row.matchweek === "number" ? row.matchweek : null,
    originalMatchweek: typeof row.matchweek === "number" ? row.matchweek : null,
    scheduledMatchweek: typeof row.scheduled_matchweek === "number" ? row.scheduled_matchweek : null,
    effectiveMatchweek: typeof row.scheduled_matchweek === "number" ? row.scheduled_matchweek : typeof row.matchweek === "number" ? row.matchweek : null,
    rescheduleReason: text(row, ["reschedule_reason"], "") || null,
    rescheduledAt: text(row, ["rescheduled_at"], "") || null,
    rescheduledBy: text(row, ["rescheduled_by"], "") || null,
    penalty_away_score: typeof row.penalty_away_score === "number" ? row.penalty_away_score : null,
    penalty_home_score: typeof row.penalty_home_score === "number" ? row.penalty_home_score : null,
    status: text(row, ["status"], ""),
    venue: text(row, ["venue"], "") || null,
    winner_team_id: text(row, ["winner_team_id"], "") || null,
  };
}

function asStandardLeagueConfig(row: Row | undefined): StandardLeagueConfig | null {
  if (!row || text(row, ["template_key"]) !== "standard_league") return null;
  return {
    championAt: text(row, ["champion_at"]) || null,
    championConfirmedBy: text(row, ["champion_confirmed_by"]) || null,
    championConfirmedByLabel: text(row, ["champion_confirmed_by_label"]) || null,
    championResolutionReason: text(row, ["champion_resolution_reason"]) || null,
    championTeamId: text(row, ["champion_team_id"]) || null,
    competitionId: text(row, ["competition_id"]),
    confirmedAt: text(row, ["confirmed_at"]) || null,
    confirmedBy: text(row, ["confirmed_by"]) || null,
    confirmedByLabel: text(row, ["confirmed_by_label"]) || null,
    drawPoints: typeof row.draw_points === "number" ? row.draw_points : 1,
    fixtureStatus: text(row, ["fixture_status"]) === "confirmed" ? "confirmed" : "draft",
    fixtureVersion: number(row, ["fixture_version"]),
    legs: number(row, ["legs"]) === 2 ? 2 : 1,
    lossPoints: number(row, ["loss_points"]),
    standingsPolicyKey: "standard_league_v1",
    templateKey: "standard_league",
    winPoints: typeof row.win_points === "number" ? row.win_points : 3,
  };
}

function asMatchTeam(row: Row, participantIsActive = false): AdminCompetitionMatchTeam {
  return {
    id: text(row, ["id"], ""),
    is_ksw: row.is_ksw === true,
    logo_url: text(row, ["logo_url"], "") || null,
    name: text(row, ["name", "short_name"], "Unknown team"),
    participant_is_active: participantIsActive,
    short_name: text(row, ["short_name"], "") || null,
  };
}

function asCompetitionGroup(row: Row): AdminCompetitionGroup {
  const name = text(row, ["name"], "");
  return {
    id: text(row, ["id"], ""),
    label: text(row, ["label"], "") || (name ? `Group ${name}` : "Group"),
    name,
    qualifiers_count: number(row, ["qualifiers_count"]) || 2,
    sort_order: number(row, ["sort_order"]),
  };
}

function asGroupTeam(row: Row, team: Row | undefined): AdminCompetitionGroupTeam {
  return {
    competition_team_id: text(row, ["id"], ""),
    display_order: number(row, ["display_order"]),
    group_id: text(row, ["group_id"], "") || null,
    is_active: row.is_active !== false,
    is_ksw: team?.is_ksw === true,
    logo_url: text(team, ["logo_url"], "") || null,
    name: teamName(team),
    short_name: text(team, ["short_name"], "") || null,
    team_id: text(row, ["team_id"], ""),
  };
}

function asEngineV2Config(row: Row | undefined): CompetitionEngineV2Config | null {
  if (!row) return null;

  const rawSnapshot = Array.isArray(row.qualification_snapshot) ? row.qualification_snapshot : [];
  const rawSummary = rawSnapshot[0] && typeof rawSnapshot[0] === "object"
    ? (rawSnapshot[0] as Row).approvalSummary
    : null;
  const qualificationSnapshotSummary = rawSummary && typeof rawSummary === "object"
    && typeof (rawSummary as Row).entrantCount === "number"
    && typeof (rawSummary as Row).bracketCapacity === "number"
    && typeof (rawSummary as Row).byeCount === "number"
    && typeof (rawSummary as Row).playInCount === "number"
    && typeof (rawSummary as Row).roundCount === "number"
    && typeof (rawSummary as Row).knockoutMatchCount === "number"
    && typeof (rawSummary as Row).extraQualifierCount === "number"
    ? rawSummary as ApprovedQualificationSummary
    : null;

  return {
    bracketCapacity: typeof row.bracket_capacity === "number" ? row.bracket_capacity : null,
    competitionId: text(row, ["competition_id"], ""),
    entrantCount: typeof row.entrant_count === "number" ? row.entrant_count : null,
    entryMode: text(row, ["entry_mode"], "bye") as CompetitionEngineV2Config["entryMode"],
    groupStageEnabled: row.group_stage_enabled === true,
    extraRankEnabled: row.extra_rank_enabled === true,
    extraRank: typeof row.extra_rank === "number" ? row.extra_rank : null,
    extraQualifierCount: typeof row.extra_qualifier_count === "number" ? row.extra_qualifier_count : 0,
    qualificationStatus: row.qualification_status === "approved" ? "approved" : "pending",
    qualificationApprovedAt: typeof row.qualification_approved_at === "string" ? row.qualification_approved_at : null,
    qualificationApprovedByLabel: typeof row.qualification_approved_by_label === "string" ? row.qualification_approved_by_label : null,
    qualificationSnapshot: rawSnapshot.map((entry) => {
      const value = entry as Row;
      return {
        bestOrder: typeof value.bestOrder === "number" ? value.bestOrder : undefined,
        groupId: typeof value.groupId === "string" ? value.groupId : undefined,
        rank: typeof value.rank === "number" ? value.rank : undefined,
        teamId: typeof value.teamId === "string" ? value.teamId : undefined,
        type: value.type === "best_ranked" ? "best_ranked" : "group_rank",
      };
    }),
    qualificationSnapshotSummary,
    status: text(row, ["status"], "draft") as CompetitionEngineV2Config["status"],
    templateKey: row.template_key === "ksw_standard" || row.template_key === "council_two_division" ? row.template_key : null,
  };
}

function asTreeSource(row: Row, side: "away" | "home"): CompetitionTreeSource {
  const candidate = text(row, [`${side}_source_type`], "unassigned");
  const teamId = text(row, [`${side}_source_team_id`], "") || undefined;
  const type = candidate === "best_ranked" || candidate === "bye" || candidate === "group_rank" || candidate === "manual_team" || candidate === "node_winner" || candidate === "unassigned"
    ? candidate
    : teamId ? "manual_team" : "unassigned";

  return {
    bestOrder: number(row, [`${side}_source_best_order`]) || undefined,
    groupId: text(row, [`${side}_source_group_id`], "") || undefined,
    nodeId: text(row, [`${side}_source_node_id`], "") || undefined,
    rank: number(row, [`${side}_source_rank`]) || undefined,
    teamId,
    type,
  };
}

function asCompetitionTreeNode(row: Row): CompetitionTreeNode {
  return {
    awaySource: asTreeSource(row, "away"),
    bracketPosition: number(row, ["bracket_position"]),
    competitionId: text(row, ["competition_id"]),
    homeSource: asTreeSource(row, "home"),
    id: text(row, ["id"]),
    linkedMatchId: text(row, ["linked_match_id"]) || undefined,
    matchOrder: number(row, ["match_order"]),
    partitionKey: text(row, ["partition_key"]) || undefined,
    roundIndex: number(row, ["round_index"]),
    roundLabel: text(row, ["round_label"]),
  };
}

function mergeMatchTeams(activeTeams: Row[], matchTeams: Row[]) {
  const merged = new Map<string, AdminCompetitionMatchTeam>();

  matchTeams.forEach((team) => {
    const id = text(team, ["id"], "");
    if (id) merged.set(id, asMatchTeam(team, false));
  });
  activeTeams.forEach((team) => {
    const id = text(team, ["id"], "");
    if (id) merged.set(id, asMatchTeam(team, true));
  });

  return Array.from(merged.values()).sort((a, b) => {
    if (a.participant_is_active !== b.participant_is_active) {
      return a.participant_is_active === false ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });
}

async function loadWorkspaceData(id: string) {
  await requireAdminSession();

  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return {
      competition: undefined,
      groupDataReady: false,
      groupTeams: [] as AdminCompetitionGroupTeam[],
      groups: [] as AdminCompetitionGroup[],
      engineV2Config: null as CompetitionEngineV2Config | null,
      leagueConfig: null as StandardLeagueConfig | null,
      leagueMatchweeks: [] as StandardLeagueMatchweek[],
      rescheduleHistory: [] as StandardLeagueRescheduleHistory[],
      engineV2TreeSummary: null as CompetitionTreeSummary | null,
      engineV2Workflow: null as CompetitionEngineV2Integrity | null,
      councilWorkflowPartitions: [] as CouncilWorkflowPartition[],
      matchTeams: [] as Row[],
      matches: [] as Row[],
      teams: [] as Row[],
    };
  }

  const competitionRows = await runQuery(
    "workspace_competition",
    supabase.from("leagues").select(competitionColumns).eq("id", id).limit(1),
  );
  const competition = competitionRows[0];

  if (!competition) {
    return {
      competition: undefined,
      groupDataReady: false,
      groupTeams: [] as AdminCompetitionGroupTeam[],
      groups: [] as AdminCompetitionGroup[],
      engineV2Config: null as CompetitionEngineV2Config | null,
      leagueConfig: null as StandardLeagueConfig | null,
      leagueMatchweeks: [] as StandardLeagueMatchweek[],
      rescheduleHistory: [] as StandardLeagueRescheduleHistory[],
      engineV2TreeSummary: null as CompetitionTreeSummary | null,
      engineV2Workflow: null as CompetitionEngineV2Integrity | null,
      councilWorkflowPartitions: [] as CouncilWorkflowPartition[],
      matchTeams: [] as Row[],
      matches: [] as Row[],
      teams: [] as Row[],
    };
  }

  const competitionType = normalizeCompetitionType(competition.competition_type);
  const isCup = isCupCompetition(competitionType);
  const [teams, matches, groupResult, competitionTeamResult, engineV2ConfigResult, engineV2TreeResult, councilPartitionsResult, leagueConfigResult, rescheduleHistoryResult] = await Promise.all([
    loadCompetitionParticipants(supabase, id, {
      includeInactiveParticipants: false,
    }),
    runQuery(
      "workspace_matches",
      supabase.from("matches").select(matchColumns).eq("league_id", id).order("match_date", { ascending: true }),
    ),
    isCup
      ? runQueryStatus<Row>(
          "workspace_competition_groups",
          supabase.from("competition_groups").select(groupColumns).eq("competition_id", id).order("sort_order", { ascending: true }),
        )
      : Promise.resolve({ data: [] as Row[], ok: true }),
    isCup
      ? runQueryStatus<Row>(
          "workspace_competition_team_groups",
          supabase
            .from("competition_teams")
            .select(competitionTeamGroupColumns)
            .eq("competition_id", id)
            .eq("is_active", true)
            .order("display_order", { ascending: true }),
        )
      : Promise.resolve({ data: [] as Row[], ok: true }),
    isCup
      ? runQueryStatus<Row>(
          "workspace_competition_engine_v2_config",
          supabase
            .from("competition_knockout_configs")
            .select(engineV2ConfigColumns)
            .eq("competition_id", id)
            .limit(1),
        )
      : Promise.resolve({ data: [] as Row[], ok: true }),
    isCup
      ? runQueryStatus<Row>(
          "workspace_competition_engine_v2_tree",
          supabase
            .from("competition_bracket_nodes")
            .select(bracketNodeColumns)
            .eq("competition_id", id)
            .order("round_index", { ascending: true })
            .order("match_order", { ascending: true }),
        )
      : Promise.resolve({ data: [] as Row[], ok: true }),
    isCup
      ? runQueryStatus<Row>(
          "workspace_council_partitions",
          supabase
            .from("competition_knockout_partitions")
            .select("partition_key, approval_status, status, champion_team_id")
            .eq("competition_id", id)
            .in("partition_key", ["division_1", "division_2"]),
        )
      : Promise.resolve({ data: [] as Row[], ok: true }),
    competitionType === "league"
      ? runQueryStatus<Row>(
          "workspace_standard_league_config",
          supabase
            .from("competition_league_configs")
            .select("competition_id, template_key, legs, win_points, draw_points, loss_points, standings_policy_key, fixture_status, fixture_version, confirmed_at, confirmed_by, confirmed_by_label, champion_team_id, champion_at, champion_confirmed_by, champion_confirmed_by_label, champion_resolution_reason")
            .eq("competition_id", id)
            .limit(1),
        )
      : Promise.resolve({ data: [] as Row[], ok: true }),
    competitionType === "league"
      ? runQueryStatus<Row>(
          "workspace_standard_league_reschedule_history",
          supabase
            .from("competition_league_match_reschedules")
            .select("id, match_id, original_matchweek, from_scheduled_matchweek, to_scheduled_matchweek, reason, changed_at, changed_by, changed_by_label")
            .eq("competition_id", id)
            .order("changed_at", { ascending: false }),
        )
      : Promise.resolve({ data: [] as Row[], ok: true }),
  ]);
  const teamIds = matchTeamIds(matches);
  const groupTeamIds = competitionTeamResult.data.map((row) => text(row, ["team_id"], "")).filter(Boolean);
  const groupCanonicalTeams = groupTeamIds.length
    ? await runQuery(
        "workspace_group_teams",
        supabase.from("teams").select(teamColumns).in("id", groupTeamIds),
      )
    : [];
  const groupCanonicalTeamMap = new Map(groupCanonicalTeams.map((team) => [text(team, ["id"], ""), team]));
  const groupTeams = competitionTeamResult.data
    .map((row) => asGroupTeam(row, groupCanonicalTeamMap.get(text(row, ["team_id"], ""))))
    .filter((team) => team.competition_team_id && team.team_id && team.is_active);
  const groups = groupResult.data.map(asCompetitionGroup).filter((group) => group.id);
  const engineV2Config = asEngineV2Config(engineV2ConfigResult.data[0]);
  const leagueConfig = asStandardLeagueConfig(leagueConfigResult.data[0]);
  const leagueFixtureWeeks = leagueConfig?.fixtureStatus === "confirmed"
    ? Array.from(new Set(matches.map((match) => number(match, ["matchweek"])).filter((matchweek) => matchweek > 0))).sort((a, b) => a - b)
    : [];
  if (leagueConfig && leagueFixtureWeeks.length) {
    const ensured = await supabase
      .from("competition_league_matchweeks")
      .upsert(leagueFixtureWeeks.map((matchweek) => ({ competition_id: id, fixture_version: leagueConfig.fixtureVersion, matchweek, status: "unconfigured" })), { onConflict: "competition_id,fixture_version,matchweek", ignoreDuplicates: true });
    if (ensured.error) console.error("standard league matchweek initialization failed", ensured.error);
    const completedWeeks = leagueFixtureWeeks.filter((matchweek) => {
      const fixtures = matches.filter((match) => number(match, ["matchweek"]) === matchweek);
      return fixtures.length > 0 && fixtures.every((match) => ["finished", "completed"].includes(text(match, ["status"])));
    });
    if (completedWeeks.length) {
      const completed = await supabase
        .from("competition_league_matchweeks")
        .upsert(completedWeeks.map((matchweek) => ({ competition_id: id, fixture_version: leagueConfig.fixtureVersion, matchweek, status: "completed" })), { onConflict: "competition_id,fixture_version,matchweek" });
      if (completed.error) console.error("standard league completed matchweek derivation failed", completed.error);
    }
  }
  const leagueMatchweekResult = leagueConfig?.fixtureStatus === "confirmed"
    ? await runQueryStatus<Row>("workspace_standard_league_matchweeks", supabase.from("competition_league_matchweeks").select("matchweek, status, confirmed_at, confirmed_by_label, updated_at").eq("competition_id", id).eq("fixture_version", leagueConfig.fixtureVersion).order("matchweek"))
    : { data: [] as Row[], ok: true };
  const leagueMatchweeks = leagueMatchweekResult.data.map((row) => {
    const status = text(row, ["status"]);
    return {
      confirmedAt: text(row, ["confirmed_at"]) || null,
      confirmedBy: text(row, ["confirmed_by_label"]) || null,
      matchweek: number(row, ["matchweek"]),
      status: (status === "draft" || status === "confirmed" || status === "completed" ? status : "unconfigured") as StandardLeagueMatchweek["status"],
      updatedAt: text(row, ["updated_at"]) || null,
    };
  });
  const rescheduleHistory = rescheduleHistoryResult.data.flatMap((row) => {
    const id = text(row, ["id"]);
    const matchId = text(row, ["match_id"]);
    const originalMatchweek = number(row, ["original_matchweek"]);
    const fromMatchweek = number(row, ["from_scheduled_matchweek"]);
    const toMatchweek = number(row, ["to_scheduled_matchweek"]);
    const reason = text(row, ["reason"]);
    const changedAt = text(row, ["changed_at"]);

    if (!id || !matchId || !originalMatchweek || !fromMatchweek || !toMatchweek || !reason || !changedAt) {
      console.error("invalid standard league reschedule history row", row);
      return [];
    }

    return [{
      changedAt,
      changedBy: text(row, ["changed_by"]) || null,
      changedByLabel: text(row, ["changed_by_label"]) || null,
      fromMatchweek,
      id,
      matchId,
      originalMatchweek,
      reason,
      toMatchweek,
    } satisfies StandardLeagueRescheduleHistory];
  });
  const engineV2TreeNodes = engineV2TreeResult.data.map(asCompetitionTreeNode).filter((node) => node.id);
  const councilWorkflowPartitions = (["division_1", "division_2"] as const).map((partitionKey) => {
    const partition = councilPartitionsResult.data.find((row) => text(row, ["partition_key"]) === partitionKey);
    const status = text(partition, ["status"]) || null;
    return {
      approvalStatus: text(partition, ["approval_status"]) || null,
      bracketConfirmed: ["reviewed", "fixtures_created", "active", "completed"].includes(status ?? ""),
      championTeamId: text(partition, ["champion_team_id"]) || null,
      partitionKey,
      status,
    };
  });
  const engineV2TreeValidation = engineV2TreeResult.ok && engineV2Config && engineV2TreeNodes.length
    ? validateCompetitionTree(engineV2TreeNodes, engineV2Config.entrantCount ?? 0)
    : null;
  const engineV2TreeSummary = engineV2TreeValidation
    ? engineV2TreeValidation.summary
    : null;
  const engineV2Workflow = deriveCompetitionEngineV2Integrity({
    engineVersion: isCup ? 2 : null,
    hasConfig: Boolean(engineV2Config),
    hasLinkedMatches: engineV2TreeResult.data.some((node) => text(node, ["linked_match_id"], "") !== ""),
    hasValidTree: engineV2TreeValidation?.valid === true,
    status: engineV2Config?.status ?? null,
  });
  const matchTeams = teamIds.length
    ? await runQuery(
        "workspace_match_teams",
        supabase.from("teams").select(teamColumns).in("id", teamIds),
      )
    : [];

  return {
    competition,
    groupDataReady: groupResult.ok && competitionTeamResult.ok,
    groupTeams,
    leagueConfig,
    leagueMatchweeks,
    rescheduleHistory,
    groups,
    engineV2Config,
    councilWorkflowPartitions,
    engineV2TreeNodes,
    engineV2TreeSummary,
    engineV2Workflow,
    matchTeams,
    matches,
    teams,
  };
}

function DetailCard({ items, title }: { items: Array<[string, string]>; title: string }) {
  return (
    <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10">
      <div className="mb-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
      <h2 className="text-xl font-black text-[#061426]">{title}</h2>
      <dl className="mt-4 grid gap-3">
        {items.map(([label, value]) => (
          <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2" key={label}>
            <dt className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</dt>
            <dd className="mt-1 break-words text-sm font-black text-[#061426]">{value || "Not set"}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-center">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-[#061426]">{value}</p>
    </div>
  );
}

export default async function AdminCompetitionWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { competition, councilWorkflowPartitions, engineV2Config, engineV2TreeNodes, engineV2TreeSummary, engineV2Workflow, groupDataReady, groupTeams, groups, leagueConfig, leagueMatchweeks, matchTeams, matches, rescheduleHistory, teams } = await loadWorkspaceData(id);

  if (!competition) {
    notFound();
  }

  const competitionName = text(competition, ["name"], "Competition");
  const season = text(competition, ["season"], "");
  const competitionType = normalizeCompetitionType(text(competition, ["competition_type"], ""));
  const competitionTypeLabel = getCompetitionTypeLabel(competitionType);
  const isCup = isCupCompetition(competitionType);
  const seasonStatus = text(competition, ["season_status"], "Not set");
  const slug = text(competition, ["slug"], "");
  const coverImageUrl = text(competition, ["cover_image_url"], "");
  const shortDescription = text(competition, ["short_description"], "");
  const isPublished = competition.is_published === true;
  const isFeatured = competition.is_featured === true;
  const isActive = competition.is_active === true;
  const displayOrder = number(competition, ["display_order"]);
  const kswTeamCount = teams.filter((team) => team.is_ksw === true).length;
  const workspaceMatches = matches.map(asMatch);
  const workspaceMatchTeams = mergeMatchTeams(teams, matchTeams);
  const isStandardLeague = competitionType === "league" && (leagueConfig !== null || workspaceMatches.length === 0);
  const groupedTeamCount = groupTeams.filter((team) => team.group_id).length;
  const unassignedGroupTeamCount = Math.max(groupTeams.length - groupedTeamCount, 0);
  const publicPath = slug && isPublished ? `/competitions/${slug}` : "";

  const detailItems: Array<[string, string]> = [
    ["Type", competitionTypeLabel],
    ["Status", statusLabel(seasonStatus)],
    ["Season", season || "Not set"],
    ["Edition", text(competition, ["edition_number"], "Not set")],
    ["Start date", formatDate(competition.start_date)],
    ["End date", formatDate(competition.end_date)],
    ["Location", text(competition, ["location"], "Not set")],
  ];
  const publishingItems: Array<[string, string]> = [
    ["Published", booleanLabel(isPublished)],
    ["Featured", booleanLabel(isFeatured)],
    ["Display order", String(displayOrder)],
    ["Active flag", booleanLabel(isActive)],
  ];
  const contentItems: Array<[string, string]> = [
    ["Cover image", coverImageUrl ? "Available" : "Not set"],
    ["Short description", shortDescription ? "Available" : "Not set"],
    ["Full description", text(competition, ["description"], "") ? "Available" : "Not set"],
    ["Public slug", slug || "Not set"],
  ];
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f6f2ea] text-[#061426]">
      {!isStandardLeague ? <section className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-10">
        <details className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer text-xl font-black text-[#061426]">ข้อมูลรายการแข่งขัน</summary>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <StatCard label="ชื่อรายการ" value={competitionName} />
            <StatCard label="ประเภท" value={competitionTypeLabel} />
            <StatCard label="สถานะ" value={seasonStatus} />
          </div>
        </details>
      </section> : null}

      {!isCup && !isStandardLeague ? <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10">
        <article className="min-w-0 scroll-mt-28 rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10" id="teams-summary">
          <div className="mb-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-2xl font-black">Teams</h2>
              <p className="mt-1 text-sm font-semibold text-slate-600">
                Manage teams participating in this competition.
              </p>
            </div>
            <Link className="inline-flex rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] hover:bg-[#091f39]" href={`/admin/teams?competition=${encodeURIComponent(id)}`}>
              Manage Teams
            </Link>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <StatCard label="Total Teams" value={teams.length} />
            <StatCard label="KSW Teams" value={kswTeamCount} />
          </div>
          <div className="mt-5 grid gap-2">
            {teams.length ? (
              teams.map((team) => (
                <div className="flex min-w-0 items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2" key={text(team, ["id"])}>
                  <TeamLogo
                    className="!size-10 shrink-0"
                    initials={teamInitials(team)}
                    logoUrl={text(team, ["logo_url"], "")}
                    teamName={teamName(team)}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-[#061426]">{teamName(team)}</p>
                    {team.is_ksw === true ? (
                      <p className="text-xs font-bold text-[#8a6418]">KSW team</p>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
                No teams assigned yet. Use Manage Teams to assign participants for this competition.
              </p>
            )}
          </div>
        </article>
      </section> : null}

      <AdminCompetitionPublicationControl competitionId={id} initiallyPublished={competition.is_published === true} seasonStatus={seasonStatus} />

      {isCup ? (
        <AdminCupCompetitionWorkspace
          competitionId={id}
          competitionStatus={seasonStatus}
          councilWorkflowPartitions={councilWorkflowPartitions}
          engineConfig={engineV2Config}
          engineSummary={engineV2TreeSummary}
          engineWorkflow={engineV2Workflow}
          groupDataReady={groupDataReady}
          groupTeams={groupTeams}
          groups={groups}
          initialMatches={workspaceMatches}
          matchTeams={workspaceMatchTeams}
          nodes={engineV2TreeNodes}
          teams={teams.map((team) => asMatchTeam(team))}
        />
      ) : isStandardLeague ? (
        <AdminLeagueCompetitionWorkspace
          competitionId={id}
          competitionName={competitionName}
          competitionStatus={seasonStatus}
          initialConfig={leagueConfig}
          initialMatches={workspaceMatches}
          initialMatchweeks={leagueMatchweeks}
          key={`standard-league-${leagueConfig?.fixtureVersion ?? "draft"}-${workspaceMatches.map((match) => `${match.id}:${match.status}:${match.home_score}:${match.away_score}`).join("|")}`}
          rescheduleHistory={rescheduleHistory}
          teams={teams.map((team) => asMatchTeam(team, true))}
        />
      ) : (
        <AdminCompetitionMatchManager
          competition={{
            id,
            name: competitionName,
            season,
            status: seasonStatus,
            type: competitionType,
          }}
          cupGroupCount={groups.length}
          cupGroupsReady={groupDataReady}
          cupUnassignedTeamCount={unassignedGroupTeamCount}
          groups={groups}
          groupTeams={groupTeams}
          initialMatches={workspaceMatches}
          initialTeams={workspaceMatchTeams}
        />
      )}

      {!isCup && !isStandardLeague ? <>
        <section className="mx-auto grid w-full max-w-7xl scroll-mt-28 gap-4 px-4 pb-8 sm:px-6 lg:grid-cols-3 lg:px-10" id="publishing-summary">
          <DetailCard items={detailItems} title="Competition Details" />
          <DetailCard items={publishingItems} title="Publishing" />
          <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10">
            <div className="mb-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
            <h2 className="text-xl font-black text-[#061426]">Public Page</h2>
            <dl className="mt-4 grid gap-3">
              {contentItems.map(([label, value]) => (
                <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2" key={label}>
                  <dt className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</dt>
                  <dd className="mt-1 break-words text-sm font-black text-[#061426]">{value || "Not set"}</dd>
                </div>
              ))}
              {publicPath ? (
                <div className="rounded-md border border-[#d8ad45]/25 bg-[#fff7e6] px-3 py-2">
                  <dt className="text-[10px] font-black uppercase tracking-[0.16em] text-[#8a6418]">Public URL</dt>
                  <dd className="mt-2 flex flex-col gap-2"><code className="break-all rounded bg-white px-2 py-1 text-xs font-bold text-[#061426]">{publicPath}</code><CopyPublicLinkButton path={publicPath} /></dd>
                </div>
              ) : <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2"><dt className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Public URL</dt><dd className="mt-1 text-sm font-semibold text-slate-600">Public page unavailable. Add a slug and publish this competition before sharing it.</dd></div>}
            </dl>
          </article>
        </section>
        <section className="mx-auto w-full max-w-7xl scroll-mt-28 px-4 pb-12 sm:px-6 lg:px-10" id="settings-summary"><article className="rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10"><div className="mb-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" /><h2 className="text-2xl font-black">Settings</h2><p className="mt-2 text-sm font-semibold leading-6 text-slate-600">Competition settings are edited from the existing Competitions module in Phase 1. Open the module and choose Edit for this competition.</p><Link className="mt-4 inline-flex rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] hover:bg-[#091f39]" href="/admin/competitions">Open Competitions</Link></article></section>
      </> : null}
    </main>
  );
}

"use server";

import { loadCompetitionParticipants } from "@/lib/competition-participants";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSession } from "@/lib/admin-server-auth";

type MatchStatus = "scheduled" | "finished";

type MatchPayload = {
  league_id: string;
  match_date: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  venue: string | null;
  status: MatchStatus;
};

type ActionResult = {
  ok: boolean;
  error?: string;
};

type LeagueRow = {
  id: string;
  name: string;
  season: string | null;
  competition_type: string | null;
  season_status: string | null;
  slug: string | null;
  is_published: boolean | null;
};

type MatchRow = {
  id: string;
  league_id: string;
  match_date: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  venue: string | null;
  status: string;
};

type MatchTeamRow = {
  id: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  is_ksw: boolean;
  participant_is_active?: boolean;
};

type AdminMatchesDataResult = ActionResult & {
  leagues?: LeagueRow[];
  matches?: MatchRow[];
  matchTeams?: MatchTeamRow[];
  teams?: MatchTeamRow[];
};

type MatchTeamsResult = ActionResult & {
  teams?: MatchTeamRow[];
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const leagueColumns = "id, name, season, competition_type, season_status, slug, is_published";
const matchColumns = "id, league_id, match_date, home_team_id, away_team_id, home_score, away_score, venue, status";
const teamColumns = "id, name, short_name, logo_url, is_ksw";

function getAdminClient() {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return {
      supabase: null,
      error: "SUPABASE_SERVICE_ROLE_KEY is missing or Supabase URL is not configured.",
    };
  }

  return { supabase, error: "" };
}

function matchTeamRow(team: Record<string, unknown>, participantIsActive = true): MatchTeamRow {
  return {
    id: String(team.id ?? ""),
    name: String(team.name ?? ""),
    short_name: typeof team.short_name === "string" ? team.short_name : null,
    logo_url: typeof team.logo_url === "string" ? team.logo_url : null,
    is_ksw: team.is_ksw === true,
    participant_is_active: participantIsActive,
  };
}

async function loadMatchTeamsForCompetition(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  competitionId: string,
  currentTeamIds: string[] = [],
) {
  const participants = await loadCompetitionParticipants(supabase, competitionId, {
    includeInactiveParticipants: false,
  });
  const activeTeams = participants
    .filter((team) => team.is_active !== false)
    .map((team) => matchTeamRow(team, true));
  const activeTeamIds = new Set(activeTeams.map((team) => team.id));
  const missingCurrentTeamIds = Array.from(
    new Set(currentTeamIds.filter((teamId) => teamId && !activeTeamIds.has(teamId))),
  );

  if (missingCurrentTeamIds.length === 0) {
    return activeTeams;
  }

  const currentTeams = await supabase
    .from("teams")
    .select(teamColumns)
    .in("id", missingCurrentTeamIds);

  if (currentTeams.error) {
    console.error("admin match current team lookup failed", currentTeams.error);
    return activeTeams;
  }

  return [
    ...activeTeams,
    ...((currentTeams.data ?? []) as Array<Record<string, unknown>>).map((team) => matchTeamRow(team, false)),
  ];
}

export async function loadCompetitionMatchTeams(
  competitionId: string,
  currentTeamIds: string[] = [],
): Promise<MatchTeamsResult> {
  await requireAdminSession();

  if (!competitionId || !uuidPattern.test(competitionId)) {
    return { ok: false, error: "Competition is required." };
  }

  const normalizedCurrentTeamIds = Array.from(new Set(currentTeamIds.filter(Boolean)));

  if (normalizedCurrentTeamIds.some((teamId) => !uuidPattern.test(teamId))) {
    return { ok: false, error: "Current team id is invalid." };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  return {
    ok: true,
    teams: await loadMatchTeamsForCompetition(supabase, competitionId, normalizedCurrentTeamIds),
  };
}

export async function loadAdminMatchesData(competitionId = ""): Promise<AdminMatchesDataResult> {
  await requireAdminSession();

  const normalizedCompetitionId = competitionId.trim();

  if (normalizedCompetitionId && !uuidPattern.test(normalizedCompetitionId)) {
    return { ok: false, error: "Competition id is invalid." };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const matchesQuery = normalizedCompetitionId
    ? supabase
        .from("matches")
        .select(matchColumns)
        .eq("league_id", normalizedCompetitionId)
        .order("match_date", { ascending: false })
    : supabase.from("matches").select(matchColumns).order("match_date", { ascending: false });
  const leaguesQuery = normalizedCompetitionId
    ? supabase
        .from("leagues")
        .select(leagueColumns)
        .eq("id", normalizedCompetitionId)
        .order("created_at", { ascending: false })
        .limit(1)
    : supabase
        .from("leagues")
        .select(leagueColumns)
        .eq("is_active", true)
        .order("created_at", { ascending: false });
  const [matchesResult, leaguesResult] = await Promise.all([matchesQuery, leaguesQuery]);

  if (matchesResult.error) {
    console.error("admin matches query failed", matchesResult.error);
    return { ok: false, error: "Could not load matches. Confirm the matches table exists and is readable." };
  }

  if (leaguesResult.error) {
    console.error("admin leagues query failed", leaguesResult.error);
    return { ok: false, error: "Could not load competitions for the match form." };
  }

  const matches = (matchesResult.data ?? []) as MatchRow[];
  const currentTeamIds = matches.flatMap((match) => [match.home_team_id, match.away_team_id]);
  let matchTeams: MatchTeamRow[] = [];

  if (!normalizedCompetitionId && currentTeamIds.length > 0) {
    const currentTeams = await supabase
      .from("teams")
      .select(teamColumns)
      .in("id", Array.from(new Set(currentTeamIds.filter(Boolean))));

    if (currentTeams.error) {
      console.error("admin match list team lookup failed", currentTeams.error);
    } else {
      matchTeams = ((currentTeams.data ?? []) as Array<Record<string, unknown>>).map((team) =>
        matchTeamRow(team, false),
      );
    }
  }

  const competitionTeams = normalizedCompetitionId
    ? await loadMatchTeamsForCompetition(supabase, normalizedCompetitionId, currentTeamIds)
    : [];

  return {
    ok: true,
    leagues: (leaguesResult.data ?? []) as LeagueRow[],
    matchTeams: normalizedCompetitionId ? competitionTeams : matchTeams,
    matches,
    teams: competitionTeams,
  };
}

function validatePayload(payload: MatchPayload): string {
  if (!payload.league_id) {
    return "Competition is required.";
  }

  if (payload.home_team_id === payload.away_team_id) {
    return "Home team and away team must be different.";
  }

  if (
    payload.status === "finished" &&
    (payload.home_score === null || payload.away_score === null)
  ) {
    return "Finished matches require both scores.";
  }

  return "";
}

async function validateCompetitionTeamRelationship(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  payload: MatchPayload,
  currentMatch?: { away_team_id: string; home_team_id: string },
) {
  const competition = await supabase
    .from("leagues")
    .select("id", { count: "exact", head: true })
    .eq("id", payload.league_id);

  if (competition.error) {
    console.error("admin match competition validation failed", competition.error);
    return "Could not verify the selected competition.";
  }

  if ((competition.count ?? 0) < 1) {
    return "Selected competition does not exist.";
  }

  const selectedTeamIds = [payload.home_team_id, payload.away_team_id];
  const teams = await supabase
    .from("teams")
    .select("id, is_active")
    .in("id", selectedTeamIds);

  if (teams.error) {
    console.error("admin match team validation failed", teams.error);
    return "Could not verify selected teams.";
  }

  const teamRows = teams.data ?? [];
  const homeTeam = teamRows.find((team) => team.id === payload.home_team_id);
  const awayTeam = teamRows.find((team) => team.id === payload.away_team_id);

  if (!homeTeam || !awayTeam) {
    return "Selected home or away team does not exist.";
  }

  const homeIsCurrentLegacy = currentMatch?.home_team_id === payload.home_team_id;
  const awayIsCurrentLegacy = currentMatch?.away_team_id === payload.away_team_id;

  if (
    (homeTeam.is_active === false && !homeIsCurrentLegacy) ||
    (awayTeam.is_active === false && !awayIsCurrentLegacy)
  ) {
    return "ทีมที่เลือกไม่ได้อยู่ในรายการแข่งขันนี้ กรุณาเลือกทีมใหม่";
  }

  const participants = await supabase
    .from("competition_teams")
    .select("team_id")
    .eq("competition_id", payload.league_id)
    .eq("is_active", true)
    .in("team_id", selectedTeamIds);

  if (participants.error) {
    console.error("admin match participant validation failed", participants.error);
    return "Could not verify selected teams for this competition.";
  }

  const activeParticipantIds = new Set((participants.data ?? []).map((participant) => participant.team_id as string));
  const homeAllowed =
    activeParticipantIds.has(payload.home_team_id) ||
    homeIsCurrentLegacy;
  const awayAllowed =
    activeParticipantIds.has(payload.away_team_id) ||
    awayIsCurrentLegacy;

  if (!homeAllowed || !awayAllowed) {
    return "ทีมที่เลือกไม่ได้อยู่ในรายการแข่งขันนี้ กรุณาเลือกทีมใหม่";
  }

  return "";
}

async function getExistingMatch(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  id: string,
) {
  const match = await supabase
    .from("matches")
    .select("id, league_id, home_team_id, away_team_id")
    .eq("id", id)
    .maybeSingle();

  if (match.error) {
    console.error("admin match lookup failed", match.error);
    return {
      awayTeamId: "",
      homeTeamId: "",
      leagueId: "",
      error: "Could not verify the selected match.",
    };
  }

  if (!match.data) {
    return {
      awayTeamId: "",
      homeTeamId: "",
      leagueId: "",
      error: "Match was not found.",
    };
  }

  return {
    awayTeamId: match.data.away_team_id as string,
    homeTeamId: match.data.home_team_id as string,
    leagueId: match.data.league_id as string,
    error: "",
  };
}

export async function createMatch(payload: MatchPayload): Promise<ActionResult> {
  await requireAdminSession();

  const validationError = validatePayload(payload);

  if (validationError) {
    return { ok: false, error: validationError };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const relationshipError = await validateCompetitionTeamRelationship(supabase, payload);

  if (relationshipError) {
    return { ok: false, error: relationshipError };
  }

  const result = await supabase.rpc("admin_create_match_with_standings_snapshot", {
    p_away_score: payload.away_score,
    p_away_team_id: payload.away_team_id,
    p_home_score: payload.home_score,
    p_home_team_id: payload.home_team_id,
    p_league_id: payload.league_id,
    p_match_date: payload.match_date,
    p_status: payload.status,
    p_venue: payload.venue,
  });

  if (result.error) {
    console.error("admin match insert failed", result.error);
    return { ok: false, error: result.error.message };
  }

  return { ok: true };
}

export async function updateMatch(
  id: string,
  payload: MatchPayload,
  expectedLeagueId?: string,
): Promise<ActionResult> {
  await requireAdminSession();

  if (!id) {
    return { ok: false, error: "Match id is required." };
  }

  const validationError = validatePayload(payload);

  if (validationError) {
    return { ok: false, error: validationError };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const existingMatch = await getExistingMatch(supabase, id);

  if (existingMatch.error) {
    return { ok: false, error: existingMatch.error };
  }

  if (expectedLeagueId && (existingMatch.leagueId !== expectedLeagueId || payload.league_id !== expectedLeagueId)) {
    return { ok: false, error: "This match does not belong to the selected competition." };
  }

  if (existingMatch.leagueId !== payload.league_id) {
    return { ok: false, error: "Match competition cannot be changed from the match editor." };
  }

  const relationshipError = await validateCompetitionTeamRelationship(supabase, payload, {
    away_team_id: existingMatch.awayTeamId,
    home_team_id: existingMatch.homeTeamId,
  });

  if (relationshipError) {
    return { ok: false, error: relationshipError };
  }

  const result = await supabase.rpc("admin_update_match_with_standings_snapshot", {
    p_away_score: payload.away_score,
    p_away_team_id: payload.away_team_id,
    p_home_score: payload.home_score,
    p_home_team_id: payload.home_team_id,
    p_league_id: payload.league_id,
    p_match_date: payload.match_date,
    p_match_id: id,
    p_status: payload.status,
    p_venue: payload.venue,
  });

  if (result.error) {
    console.error("admin match update failed", result.error);
    return { ok: false, error: result.error.message };
  }

  return { ok: true };
}

export async function deleteMatchById(id: string, expectedLeagueId?: string): Promise<ActionResult> {
  await requireAdminSession();

  if (!id) {
    return { ok: false, error: "Match id is required." };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const existingMatch = await getExistingMatch(supabase, id);

  if (existingMatch.error) {
    return { ok: false, error: existingMatch.error };
  }

  if (expectedLeagueId && existingMatch.leagueId !== expectedLeagueId) {
    return { ok: false, error: "This match does not belong to the selected competition." };
  }

  const result = await supabase.rpc("admin_delete_match_with_standings_snapshot", {
    p_match_id: id,
  });

  if (result.error) {
    console.error("admin match delete failed", result.error);
    return { ok: false, error: result.error.message };
  }

  return { ok: true };
}

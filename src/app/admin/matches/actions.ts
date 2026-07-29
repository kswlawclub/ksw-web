"use server";

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

  const teams = await supabase
    .from("teams")
    .select("id, league_id")
    .in("id", [payload.home_team_id, payload.away_team_id]);

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

  if (homeTeam.league_id !== payload.league_id || awayTeam.league_id !== payload.league_id) {
    return "Selected teams must belong to the selected competition.";
  }

  return "";
}

async function getExistingMatchLeague(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  id: string,
) {
  const match = await supabase
    .from("matches")
    .select("id, league_id")
    .eq("id", id)
    .maybeSingle();

  if (match.error) {
    console.error("admin match lookup failed", match.error);
    return {
      leagueId: "",
      error: "Could not verify the selected match.",
    };
  }

  if (!match.data) {
    return {
      leagueId: "",
      error: "Match was not found.",
    };
  }

  return {
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

  const existingMatch = await getExistingMatchLeague(supabase, id);

  if (existingMatch.error) {
    return { ok: false, error: existingMatch.error };
  }

  if (expectedLeagueId && (existingMatch.leagueId !== expectedLeagueId || payload.league_id !== expectedLeagueId)) {
    return { ok: false, error: "This match does not belong to the selected competition." };
  }

  if (existingMatch.leagueId !== payload.league_id) {
    return { ok: false, error: "Match competition cannot be changed from the match editor." };
  }

  const relationshipError = await validateCompetitionTeamRelationship(supabase, payload);

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

  const existingMatch = await getExistingMatchLeague(supabase, id);

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

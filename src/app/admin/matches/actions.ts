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

export async function updateMatch(id: string, payload: MatchPayload): Promise<ActionResult> {
  await requireAdminSession();

  const validationError = validatePayload(payload);

  if (validationError) {
    return { ok: false, error: validationError };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
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

export async function deleteMatchById(id: string): Promise<ActionResult> {
  await requireAdminSession();

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
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

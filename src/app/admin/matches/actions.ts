"use server";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

type MatchPayload = {
  league_id: string;
  match_date: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  status: "scheduled" | "completed" | "finished";
};

type ActionResult = {
  ok: boolean;
  error?: string;
};

function normalizeStatusForDb(status: MatchPayload["status"]): "scheduled" | "completed" {
  return status === "finished" || status === "completed" ? "completed" : "scheduled";
}

function normalizeMatchPayload(payload: MatchPayload) {
  return {
    ...payload,
    status: normalizeStatusForDb(payload.status),
  };
}

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

export async function createMatch(payload: MatchPayload): Promise<ActionResult> {
  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("matches").insert(normalizeMatchPayload(payload));

  if (result.error) {
    console.error("admin match insert failed", result.error.message);
    return { ok: false, error: result.error.message };
  }

  return { ok: true };
}

export async function updateMatch(id: string, payload: MatchPayload): Promise<ActionResult> {
  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase
    .from("matches")
    .update(normalizeMatchPayload(payload))
    .eq("id", id);

  if (result.error) {
    console.error("admin match update failed", result.error.message);
    return { ok: false, error: result.error.message };
  }

  return { ok: true };
}

export async function deleteMatchById(id: string): Promise<ActionResult> {
  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("matches").delete().eq("id", id);

  if (result.error) {
    console.error("admin match delete failed", result.error.message);
    return { ok: false, error: result.error.message };
  }

  return { ok: true };
}

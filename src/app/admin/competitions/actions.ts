"use server";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

type CompetitionType = "league" | "cup" | "friendly" | "tournament";

type CompetitionPayload = {
  name: string;
  season: string | null;
  competition_type: CompetitionType;
  is_active: boolean;
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

function validatePayload(payload: CompetitionPayload) {
  if (!payload.name.trim()) {
    return "Competition name is required.";
  }

  return "";
}

export async function createCompetition(payload: CompetitionPayload): Promise<ActionResult> {
  const validationError = validatePayload(payload);

  if (validationError) {
    return { ok: false, error: validationError };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("leagues").insert(payload);

  if (result.error) {
    console.error("admin competition insert failed", result.error);
    return { ok: false, error: result.error.message };
  }

  return { ok: true };
}

export async function updateCompetition(
  id: string,
  payload: CompetitionPayload,
): Promise<ActionResult> {
  const validationError = validatePayload(payload);

  if (validationError) {
    return { ok: false, error: validationError };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("leagues").update(payload).eq("id", id);

  if (result.error) {
    console.error("admin competition update failed", result.error);
    return { ok: false, error: result.error.message };
  }

  return { ok: true };
}

export async function deleteCompetitionById(id: string): Promise<ActionResult> {
  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("leagues").delete().eq("id", id);

  if (result.error) {
    console.error("admin competition delete failed", result.error);
    return { ok: false, error: result.error.message };
  }

  return { ok: true };
}

"use server";

import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSession } from "@/lib/admin-server-auth";

type CompetitionType = "league" | "cup" | "friendly" | "tournament";
type SeasonStatus = "upcoming" | "active" | "completed";

type CompetitionPayload = {
  name: string;
  season: string | null;
  slug: string | null;
  short_description: string | null;
  description: string | null;
  cover_image_url: string | null;
  edition_number: number | null;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  display_order: number;
  competition_type: CompetitionType;
  season_status: SeasonStatus;
  is_active: boolean;
  is_featured: boolean;
  is_published: boolean;
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

  if (payload.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.slug)) {
    return "Slug must use lowercase English letters, numbers, and hyphens only.";
  }

  if (payload.edition_number !== null && (!Number.isInteger(payload.edition_number) || payload.edition_number < 1)) {
    return "Edition number must be a positive whole number.";
  }

  if (!Number.isInteger(payload.display_order)) {
    return "Display order must be a whole number.";
  }

  return "";
}

function normalizeSlug(value: string | null) {
  if (!value) {
    return null;
  }

  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || null;
}

function normalizePayload(payload: CompetitionPayload): CompetitionPayload {
  return {
    ...payload,
    name: payload.name.trim(),
    slug: normalizeSlug(payload.slug),
  };
}

function competitionErrorMessage(message: string) {
  if (message.toLowerCase().includes("duplicate") || message.toLowerCase().includes("leagues_slug_unique_idx")) {
    return "Slug is already used by another competition.";
  }

  if (
    message.includes("slug") ||
    message.includes("short_description") ||
    message.includes("description") ||
    message.includes("cover_image_url") ||
    message.includes("edition_number") ||
    message.includes("start_date") ||
    message.includes("end_date") ||
    message.includes("location") ||
    message.includes("display_order") ||
    message.includes("is_featured") ||
    message.includes("is_published")
  ) {
    return `${message} Apply the competition metadata migration before saving these fields.`;
  }

  return message;
}

export async function createCompetition(payload: CompetitionPayload): Promise<ActionResult> {
  await requireAdminSession();
  const normalizedPayload = normalizePayload(payload);

  const validationError = validatePayload(normalizedPayload);

  if (validationError) {
    return { ok: false, error: validationError };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("leagues").insert(normalizedPayload);

  if (result.error) {
    console.error("admin competition insert failed", result.error);
    return { ok: false, error: competitionErrorMessage(result.error.message) };
  }

  return { ok: true };
}

export async function updateCompetition(
  id: string,
  payload: CompetitionPayload,
): Promise<ActionResult> {
  await requireAdminSession();
  const normalizedPayload = normalizePayload(payload);

  const validationError = validatePayload(normalizedPayload);

  if (validationError) {
    return { ok: false, error: validationError };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("leagues").update(normalizedPayload).eq("id", id);

  if (result.error) {
    console.error("admin competition update failed", result.error);
    return { ok: false, error: competitionErrorMessage(result.error.message) };
  }

  return { ok: true };
}

export async function deleteCompetitionById(id: string): Promise<ActionResult> {
  await requireAdminSession();

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

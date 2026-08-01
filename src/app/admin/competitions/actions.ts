"use server";

import {
  imagePathFromPublicUrl,
  safeImageSlug,
  uploadProcessedImageVariants,
} from "@/lib/admin-storage-images";
import { isCompetitionType, type CompetitionType } from "@/lib/competition-format";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSession } from "@/lib/admin-server-auth";

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
  id?: string;
};

const bucketName = "gallery-images";
const coverPathPrefix = "competitions/covers/";
const maxCoverImageSize = 6 * 1024 * 1024;

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

  if (!isCompetitionType(payload.competition_type)) {
    return "Competition type must be league, cup, friendly, or tournament.";
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

function coverFileFromFormData(formData?: FormData | null) {
  const file = formData?.get("cover");
  return file instanceof File && file.size > 0 ? file : null;
}

function coverPathFromPublicUrl(publicUrl: string | null | undefined) {
  return publicUrl ? imagePathFromPublicUrl(bucketName, publicUrl, coverPathPrefix) : "";
}

async function removeCompetitionCover(publicUrl: string | null | undefined) {
  const { supabase } = getAdminClient();
  const path = coverPathFromPublicUrl(publicUrl);

  if (!supabase || !path) {
    return;
  }

  const result = await supabase.storage.from(bucketName).remove([path]);

  if (result.error) {
    console.error("admin competition cover delete failed", result.error);
  }
}

async function uploadCompetitionCover(competitionId: string, file: File) {
  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const timestamp = Date.now();
  const slug = safeImageSlug(file.name || "cover", "cover");
  const path = `${coverPathPrefix}${competitionId}-${timestamp}-${slug}.webp`;
  const uploadResult = await uploadProcessedImageVariants({
    bucketName,
    file,
    maxFileSize: maxCoverImageSize,
    maxFileSizeLabel: "6MB",
    supabase,
    variants: [{ key: "cover", path, width: 1920 }],
  });

  if (!uploadResult.ok || !uploadResult.uploads?.cover) {
    return { ok: false, error: uploadResult.error ?? "Cover image upload failed." };
  }

  return {
    ok: true,
    path: uploadResult.uploads.cover.path,
    publicUrl: uploadResult.uploads.cover.publicUrl,
  };
}

export async function createCompetition(
  payload: CompetitionPayload,
  coverFormData?: FormData | null,
): Promise<ActionResult> {
  await requireAdminSession();
  const normalizedPayload = normalizePayload(payload);
  const coverFile = coverFileFromFormData(coverFormData);

  const validationError = validatePayload(normalizedPayload);

  if (validationError) {
    return { ok: false, error: validationError };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const initialPayload = {
    ...(coverFile ? { ...normalizedPayload, cover_image_url: null } : normalizedPayload),
    competition_engine_version: normalizedPayload.competition_type === "cup" ? 2 : 1,
  };
  const result = await supabase.from("leagues").insert(initialPayload).select("id").single();

  if (result.error) {
    console.error("admin competition insert failed", result.error);
    return { ok: false, error: competitionErrorMessage(result.error.message) };
  }

  const competitionId = String(result.data?.id ?? "");

  if (!competitionId) {
    return { ok: false, error: "Competition was created, but its id was not returned." };
  }

  if (!coverFile) {
    return { ok: true, id: competitionId };
  }

  const upload = await uploadCompetitionCover(competitionId, coverFile);

  if (!upload.ok || !upload.publicUrl) {
    await supabase.from("leagues").delete().eq("id", competitionId);
    return {
      ok: false,
      error: `${upload.error ?? "Cover image upload failed."} Competition was not saved.`,
    };
  }

  const coverUpdate = await supabase
    .from("leagues")
    .update({ cover_image_url: upload.publicUrl })
    .eq("id", competitionId);

  if (coverUpdate.error) {
    console.error("admin competition cover update failed", coverUpdate.error);
    await supabase.storage.from(bucketName).remove([upload.path]);
    await supabase.from("leagues").delete().eq("id", competitionId);
    return {
      ok: false,
      error: `${competitionErrorMessage(coverUpdate.error.message)} Competition was not saved.`,
    };
  }

  return { ok: true, id: competitionId };
}

export async function updateCompetition(
  id: string,
  payload: CompetitionPayload,
  coverFormData?: FormData | null,
): Promise<ActionResult> {
  await requireAdminSession();
  const normalizedPayload = normalizePayload(payload);
  const coverFile = coverFileFromFormData(coverFormData);

  const validationError = validatePayload(normalizedPayload);

  if (validationError) {
    return { ok: false, error: validationError };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const current = await supabase.from("leagues").select("cover_image_url").eq("id", id).single();
  const oldCoverUrl =
    !current.error && typeof current.data?.cover_image_url === "string"
      ? current.data.cover_image_url
      : null;
  let uploadedCover: { path: string; publicUrl: string } | null = null;

  if (coverFile) {
    const upload = await uploadCompetitionCover(id, coverFile);

    if (!upload.ok || !upload.publicUrl || !upload.path) {
      return { ok: false, error: upload.error ?? "Cover image upload failed." };
    }

    uploadedCover = {
      path: upload.path,
      publicUrl: upload.publicUrl,
    };
  }

  const finalPayload = uploadedCover
    ? { ...normalizedPayload, cover_image_url: uploadedCover.publicUrl }
    : normalizedPayload;
  const result = await supabase.from("leagues").update(finalPayload).eq("id", id);

  if (result.error) {
    console.error("admin competition update failed", result.error);
    if (uploadedCover) {
      await supabase.storage.from(bucketName).remove([uploadedCover.path]);
    }
    return { ok: false, error: competitionErrorMessage(result.error.message) };
  }

  if (uploadedCover || normalizedPayload.cover_image_url !== oldCoverUrl) {
    await removeCompetitionCover(oldCoverUrl);
  }

  return { ok: true };
}

export async function deleteCompetitionById(id: string): Promise<ActionResult> {
  await requireAdminSession();

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const current = await supabase.from("leagues").select("cover_image_url").eq("id", id).single();
  const oldCoverUrl =
    !current.error && typeof current.data?.cover_image_url === "string"
      ? current.data.cover_image_url
      : null;
  const result = await supabase.from("leagues").delete().eq("id", id);

  if (result.error) {
    console.error("admin competition delete failed", result.error);
    return { ok: false, error: result.error.message };
  }

  await removeCompetitionCover(oldCoverUrl);

  return { ok: true };
}

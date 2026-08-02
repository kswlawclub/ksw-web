"use server";

import { revalidatePath } from "next/cache";
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
  deletedCount?: number;
  ok: boolean;
  error?: string;
  id?: string;
};

type CompetitionDeletionReport = {
  code?: string;
  competition_id?: string;
  competition_name?: string;
  deleted?: Record<string, number>;
  dry_run?: boolean;
  success?: boolean;
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

function competitionDeletionErrorMessage(error: { code?: string | null; message?: string | null }) {
  if (error.code === "23503") return "ลบรายการไม่ได้ เพราะพบข้อมูลอื่นที่ยังอ้างอิงอยู่ ระบบยังไม่ได้ลบข้อมูลใด ๆ";
  if (error.code === "42883") return "ระบบลบรายการยังไม่พร้อมใช้งาน กรุณา apply migration สำหรับการลบรายการแข่งขันก่อน";
  return error.message || "ไม่สามารถลบรายการแข่งขันได้ ระบบยังไม่ได้ลบข้อมูลใด ๆ";
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

export async function setCompetitionPublication(id: string, published: boolean): Promise<ActionResult> {
  await requireAdminSession();
  if (!id) return { ok: false, error: "ไม่พบรายการแข่งขันที่ต้องการอัปเดต" };
  const { supabase, error } = getAdminClient();
  if (!supabase) return { ok: false, error };
  const competition = await supabase.from("leagues").select("id, name, slug").eq("id", id).maybeSingle();
  if (competition.error || !competition.data) {
    console.error("competition publication lookup failed", competition.error);
    return { ok: false, error: "ไม่พบรายการแข่งขันที่ต้องการอัปเดต" };
  }
  if (published) {
    if (!competition.data.name?.trim() || !competition.data.slug?.trim()) return { ok: false, error: "ต้องมีชื่อรายการและ slug ก่อนเผยแพร่สู่เว็บไซต์" };
    const participants = await supabase.from("competition_teams").select("id", { count: "exact", head: true }).eq("competition_id", id).eq("is_active", true);
    if (participants.error) {
      console.error("competition publication readiness lookup failed", participants.error);
      return { ok: false, error: "ไม่สามารถตรวจสอบทีมที่เข้าร่วมการแข่งขันได้" };
    }
    if ((participants.count ?? 0) < 1) return { ok: false, error: "ต้องมีทีมเข้าร่วมอย่างน้อย 1 ทีมก่อนเผยแพร่" };
  }
  const updated = await supabase.from("leagues").update({ is_published: published }).eq("id", id).select("id").maybeSingle();
  if (updated.error || !updated.data) {
    console.error("competition publication update failed", updated.error);
    return { ok: false, error: "ไม่สามารถอัปเดตสถานะการเผยแพร่ได้" };
  }
  revalidatePath("/");
  revalidatePath("/competitions");
  revalidatePath(`/competitions/${competition.data.slug}`);
  revalidatePath("/admin/competitions");
  revalidatePath(`/admin/competitions/${id}`);
  return { id, ok: true };
}

export async function deleteCompetitionById(id: string): Promise<ActionResult> {
  await requireAdminSession();

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const current = await supabase.from("leagues").select("cover_image_url").eq("id", id).maybeSingle();
  const oldCoverUrl =
    !current.error && typeof current.data?.cover_image_url === "string"
      ? current.data.cover_image_url
      : null;
  const result = await supabase.rpc("delete_competition_cascade_v1", {
    p_competition_id: id,
    p_dry_run: false,
  });

  if (result.error) {
    console.error("admin competition transactional delete failed", {
      code: result.error.code,
      details: result.error.details,
      hint: result.error.hint,
      message: result.error.message,
      competitionId: id,
    });
    return { ok: false, error: competitionDeletionErrorMessage(result.error) };
  }

  const report = result.data as CompetitionDeletionReport | null;
  if (!report?.success) {
    return {
      ok: false,
      error: report?.code === "not_found" ? "ไม่พบรายการที่ต้องการลบ หรือรายการถูกลบไปแล้ว" : "ไม่สามารถลบรายการแข่งขันได้ ระบบยังไม่ได้ลบข้อมูลใด ๆ",
      deletedCount: 0,
    };
  }

  await removeCompetitionCover(oldCoverUrl);

  revalidatePath("/admin/competitions");
  revalidatePath("/competitions");

  return { ok: true, deletedCount: report.deleted?.leagues ?? 0 };
}

export async function previewCompetitionDeletion(id: string): Promise<ActionResult & { report?: CompetitionDeletionReport }> {
  await requireAdminSession();

  const { supabase, error } = getAdminClient();
  if (!supabase) return { ok: false, error };

  const result = await supabase.rpc("delete_competition_cascade_v1", {
    p_competition_id: id,
    p_dry_run: true,
  });
  if (result.error) {
    console.error("admin competition deletion preview failed", {
      code: result.error.code,
      details: result.error.details,
      hint: result.error.hint,
      message: result.error.message,
      competitionId: id,
    });
    return { ok: false, error: competitionDeletionErrorMessage(result.error) };
  }

  const report = result.data as CompetitionDeletionReport | null;
  if (!report?.success) return { ok: false, error: "ไม่พบรายการที่ต้องการลบ", report: report ?? undefined };
  return { ok: true, report };
}

"use server";

import sharp from "sharp";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type TeamPayload = {
  league_id: string;
  name: string;
  short_name: string;
  logo_url: string | null;
  is_ksw: boolean;
  is_active: boolean;
};

type ActionResult = {
  ok: boolean;
  error?: string;
};

type UploadResult = ActionResult & {
  publicUrl?: string;
  path?: string;
};

const maxLogoSize = 2 * 1024 * 1024;
const bucketName = "team-logos";
const rasterLogoTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const allowedLogoTypes = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/webp", "webp"],
  ["image/svg+xml", "svg"],
]);

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

function validatePayload(payload: TeamPayload) {
  if (!payload.name.trim()) {
    return "Team name is required.";
  }

  if (!payload.short_name.trim()) {
    return "Short name is required.";
  }

  if (!payload.league_id) {
    return "Competition is required.";
  }

  return "";
}

export async function createTeam(payload: TeamPayload): Promise<ActionResult> {
  const validationError = validatePayload(payload);

  if (validationError) {
    return { ok: false, error: validationError };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("teams").insert(payload);

  if (result.error) {
    console.error("admin team insert failed", result.error);
    return { ok: false, error: result.error.message };
  }

  return { ok: true };
}

export async function updateTeam(id: string, payload: TeamPayload): Promise<ActionResult> {
  const validationError = validatePayload(payload);

  if (validationError) {
    return { ok: false, error: validationError };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("teams").update(payload).eq("id", id);

  if (result.error) {
    console.error("admin team update failed", result.error);
    return { ok: false, error: result.error.message };
  }

  return { ok: true };
}

export async function deleteTeamById(id: string): Promise<ActionResult> {
  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const homeMatches = await supabase
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("home_team_id", id);
  const awayMatches = await supabase
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("away_team_id", id);

  if (homeMatches.error || awayMatches.error) {
    console.error("admin team match usage check failed", homeMatches.error ?? awayMatches.error);
    return { ok: false, error: "Could not verify whether this team is used in matches." };
  }

  const usageCount = (homeMatches.count ?? 0) + (awayMatches.count ?? 0);

  if (usageCount > 0) {
    return {
      ok: false,
      error: `This team is used in ${usageCount} match${usageCount === 1 ? "" : "es"} and cannot be deleted.`,
    };
  }

  const result = await supabase.from("teams").delete().eq("id", id);

  if (result.error) {
    console.error("admin team delete failed", result.error);
    return { ok: false, error: result.error.message };
  }

  return { ok: true };
}

export async function uploadTeamLogo(formData: FormData): Promise<UploadResult> {
  const file = formData.get("file");
  const shortName = String(formData.get("shortName") ?? "team");
  const teamId = String(formData.get("teamId") ?? "");

  if (!(file instanceof File)) {
    return { ok: false, error: "Please choose an image file." };
  }

  if (!allowedLogoTypes.has(file.type)) {
    return { ok: false, error: "Logo must be a png, jpg, jpeg, webp, or svg image." };
  }

  if (file.type === "image/svg+xml" && file.size > maxLogoSize) {
    return { ok: false, error: "Logo file must be 2MB or smaller." };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const isRasterLogo = rasterLogoTypes.has(file.type);
  const extension = isRasterLogo ? "webp" : allowedLogoTypes.get(file.type) ?? "png";
  const baseName =
    (shortName || teamId || "team")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "team";
  const objectPath = `${baseName}-${Date.now()}.${extension}`;
  let inputBytes: Buffer<ArrayBufferLike>;

  try {
    inputBytes = Buffer.from(await file.arrayBuffer());
  } catch (readError) {
    console.error("admin team logo file read failed", readError);
    return { ok: false, error: "Logo file could not be read." };
  }

  let bytes: Buffer<ArrayBufferLike> = inputBytes;
  let contentType = file.type;

  if (isRasterLogo) {
    try {
      bytes = await sharp(inputBytes)
        .rotate()
        .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
      contentType = "image/webp";
    } catch (processingError) {
      console.error("admin team logo processing failed", processingError);
      return { ok: false, error: "Logo could not be processed." };
    }

    if (bytes.length > maxLogoSize) {
      return {
        ok: false,
        error: "Logo could not be compressed below 2MB. Please choose a smaller image.",
      };
    }
  }

  const upload = await supabase.storage.from(bucketName).upload(objectPath, bytes, {
    contentType,
    upsert: false,
  });

  if (upload.error) {
    console.error("admin team logo upload failed", {
      bucketName,
      objectPath,
      contentType,
      fileSize: bytes.length,
      error: upload.error,
    });
    return {
      ok: false,
      error: `Logo upload failed for bucket "${bucketName}": ${upload.error.message}`,
    };
  }

  const { data } = supabase.storage.from(bucketName).getPublicUrl(objectPath);

  if (!data.publicUrl) {
    console.error("admin team logo public URL missing", {
      bucketName,
      objectPath,
    });
    return { ok: false, error: "Logo uploaded, but no public URL was returned." };
  }

  return {
    ok: true,
    path: objectPath,
    publicUrl: data.publicUrl,
  };
}

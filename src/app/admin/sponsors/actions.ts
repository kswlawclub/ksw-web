"use server";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

type SponsorTier = "main" | "official" | "matchday" | "community" | "partner" | "supporter";

type SponsorPayload = {
  name: string;
  logo_url: string | null;
  website_url: string | null;
  tier: SponsorTier;
  sort_order: number | null;
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

const bucketName = "sponsor-logos";
const maxLogoSize = 2 * 1024 * 1024;
const allowedLogoTypes = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
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

function validatePayload(payload: SponsorPayload) {
  if (!payload.name.trim()) {
    return "Sponsor name is required.";
  }

  if (!payload.tier) {
    return "Tier is required.";
  }

  return "";
}

function safeSlug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "sponsor"
  );
}

export async function createSponsor(payload: SponsorPayload): Promise<ActionResult> {
  const validationError = validatePayload(payload);

  if (validationError) {
    return { ok: false, error: validationError };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("sponsors").insert(payload);

  if (result.error) {
    console.error("admin sponsor insert failed", result.error);
    return { ok: false, error: result.error.message };
  }

  return { ok: true };
}

export async function updateSponsor(
  id: string,
  payload: SponsorPayload,
): Promise<ActionResult> {
  const validationError = validatePayload(payload);

  if (validationError) {
    return { ok: false, error: validationError };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("sponsors").update(payload).eq("id", id);

  if (result.error) {
    console.error("admin sponsor update failed", result.error);
    return { ok: false, error: result.error.message };
  }

  return { ok: true };
}

export async function deleteSponsorById(id: string): Promise<ActionResult> {
  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("sponsors").delete().eq("id", id);

  if (result.error) {
    console.error("admin sponsor delete failed", result.error);
    return { ok: false, error: result.error.message };
  }

  return { ok: true };
}

export async function uploadSponsorLogo(formData: FormData): Promise<UploadResult> {
  const file = formData.get("file");
  const sponsorName = String(formData.get("sponsorName") ?? "sponsor");

  if (!(file instanceof File)) {
    return { ok: false, error: "Please choose an image file." };
  }

  if (!allowedLogoTypes.has(file.type)) {
    return { ok: false, error: "Logo must be a png, jpg, jpeg, or webp image." };
  }

  if (file.size > maxLogoSize) {
    return { ok: false, error: "Logo file must be 2MB or smaller." };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const extension = allowedLogoTypes.get(file.type) ?? "png";
  const objectPath = `${safeSlug(sponsorName)}-${Date.now()}.${extension}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const upload = await supabase.storage.from(bucketName).upload(objectPath, bytes, {
    contentType: file.type,
    upsert: false,
  });

  if (upload.error) {
    console.error("admin sponsor logo upload failed", upload.error);
    return { ok: false, error: upload.error.message };
  }

  const { data } = supabase.storage.from(bucketName).getPublicUrl(objectPath);

  return {
    ok: true,
    path: objectPath,
    publicUrl: data.publicUrl,
  };
}

"use server";

import sharp from "sharp";
import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin-server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getMemberActivePatch, isMemberId, parseMemberPayload, type ClubMember, type MemberPayload } from "@/lib/club-members";

type ActionResult = {
  ok: boolean;
  error?: string;
};

type ListResult = ActionResult & {
  members?: ClubMember[];
};

type UploadResult = ActionResult & {
  publicUrl?: string;
  path?: string;
};

const bucketName = "member-photos";
const maxOriginalSize = 5 * 1024 * 1024;
const maxUploadSize = 2 * 1024 * 1024;
const allowedPhotoTypes = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
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

function revalidateMemberViews() {
  for (const path of ["/admin/members", "/admin/members/registration", "/team", "/lineup-builder"]) {
    revalidatePath(path);
  }
}

function safeSlug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "member"
  );
}

function memberPhotoObjectPath(photoUrl: string | null) {
  if (!photoUrl) {
    return "";
  }

  const marker = `/${bucketName}/`;
  const markerIndex = photoUrl.indexOf(marker);

  if (markerIndex === -1) {
    return "";
  }

  const objectPath = photoUrl.slice(markerIndex + marker.length).split("?")[0];

  try {
    return decodeURIComponent(objectPath);
  } catch {
    return objectPath;
  }
}

export async function listMembers(): Promise<ListResult> {
  await requireAdminSession();

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase
    .from("club_members")
    .select(
      "id, first_name, last_name, nickname, birth_day, birth_month, birth_year_be, shirt_number, lawyer_license_no, phone, photo_url, membership_type, club_role, is_active, lineup_enabled, created_at, updated_at",
    )
    .order("created_at", { ascending: false });

  if (result.error) {
    console.error("admin club members list failed", result.error);
    return { ok: false, error: result.error.message };
  }

  return { ok: true, members: (result.data ?? []) as ClubMember[] };
}

export async function createMember(payload: MemberPayload): Promise<ActionResult> {
  await requireAdminSession();

  const validation = parseMemberPayload(payload);

  if (!validation.ok) {
    return validation;
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("club_members").insert(validation.payload);

  if (result.error) {
    console.error("admin club member insert failed", result.error);
    return { ok: false, error: result.error.message };
  }

  revalidateMemberViews();
  return { ok: true };
}

export async function updateMember(id: string, payload: MemberPayload): Promise<ActionResult> {
  await requireAdminSession();

  if (!isMemberId(id)) return { ok: false, error: "Invalid member ID." };
  const validation = parseMemberPayload(payload);

  if (!validation.ok) {
    return validation;
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("club_members").update(validation.payload).eq("id", id).select("id").maybeSingle();

  if (result.error) {
    console.error("admin club member update failed", result.error);
    return { ok: false, error: result.error.message };
  }

  if (!result.data) return { ok: false, error: "Member not found. Refresh the list and try again." };
  revalidateMemberViews();
  return { ok: true };
}

export async function setMemberActive(id: string, isActive: boolean): Promise<ActionResult> {
  await requireAdminSession();

  const patch = getMemberActivePatch(isActive);
  if (!isMemberId(id) || !patch) return { ok: false, error: "Invalid member status change." };
  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("club_members").update(patch).eq("id", id).select("id").maybeSingle();

  if (result.error) {
    console.error("admin club member status update failed", result.error);
    return { ok: false, error: result.error.message };
  }

  if (!result.data) return { ok: false, error: "Member not found. Refresh the list and try again." };
  revalidateMemberViews();
  return { ok: true };
}

export async function removeMemberPhoto(memberId: string): Promise<ActionResult> {
  await requireAdminSession();

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const current = await supabase
    .from("club_members")
    .select("photo_url")
    .eq("id", memberId)
    .maybeSingle();

  if (current.error) {
    console.error("admin club member photo lookup failed", current.error);
    return { ok: false, error: current.error.message };
  }

  const update = await supabase.from("club_members").update({ photo_url: null }).eq("id", memberId);

  if (update.error) {
    console.error("admin club member photo clear failed", update.error);
    return { ok: false, error: update.error.message };
  }

  const objectPath = memberPhotoObjectPath(current.data?.photo_url ?? null);

  if (objectPath) {
    const storageResult = await supabase.storage.from(bucketName).remove([objectPath]);

    if (storageResult.error) {
      console.error("admin club member photo storage remove failed", {
        bucketName,
        objectPath,
        error: storageResult.error,
      });
    }
  }

  return { ok: true };
}

export async function uploadMemberPhoto(formData: FormData): Promise<UploadResult> {
  await requireAdminSession();

  const file = formData.get("file");
  const nickname = String(formData.get("nickname") ?? "member");
  const memberId = String(formData.get("memberId") ?? "");

  if (!(file instanceof File)) {
    return { ok: false, error: "Please choose a photo file." };
  }

  if (!allowedPhotoTypes.has(file.type)) {
    return { ok: false, error: "Photo must be a png, jpg, jpeg, or webp image." };
  }

  if (file.size > maxOriginalSize) {
    return { ok: false, error: "Photo file must be 5MB or smaller before processing." };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  let inputBytes: Buffer<ArrayBufferLike>;

  try {
    inputBytes = Buffer.from(await file.arrayBuffer());
  } catch (readError) {
    console.error("admin club member photo read failed", readError);
    return { ok: false, error: "Photo file could not be read." };
  }

  let bytes: Buffer<ArrayBufferLike>;

  try {
    bytes = await sharp(inputBytes)
      .rotate()
      .resize({ width: 900, height: 900, fit: "cover" })
      .webp({ quality: 85 })
      .toBuffer();
  } catch (processingError) {
    console.error("admin club member photo processing failed", processingError);
    return { ok: false, error: "Photo could not be processed." };
  }

  if (bytes.length > maxUploadSize) {
    return {
      ok: false,
      error: "Photo could not be compressed below 2MB. Please choose a smaller image.",
    };
  }

  const baseName = safeSlug(nickname || memberId);
  const objectPath = `${baseName}-${Date.now()}.webp`;
  const upload = await supabase.storage.from(bucketName).upload(objectPath, bytes, {
    contentType: "image/webp",
    upsert: false,
  });

  if (upload.error) {
    console.error("admin club member photo upload failed", {
      bucketName,
      objectPath,
      fileSize: bytes.length,
      error: upload.error,
    });
    return {
      ok: false,
      error: `Photo upload failed for bucket "${bucketName}": ${upload.error.message}`,
    };
  }

  const { data } = supabase.storage.from(bucketName).getPublicUrl(objectPath);

  if (!data.publicUrl) {
    return { ok: false, error: "Photo uploaded, but no public URL was returned." };
  }

  return {
    ok: true,
    path: objectPath,
    publicUrl: data.publicUrl,
  };
}

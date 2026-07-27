"use server";

import {
  imagePathFromPublicUrl,
  safeImageSlug,
  uploadProcessedImageVariants,
} from "@/lib/admin-storage-images";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSession } from "@/lib/admin-server-auth";

type GalleryCategory =
  | "team-photo"
  | "matchday"
  | "team-spirit"
  | "sideline"
  | "community"
  | "training"
  | "other";

type GalleryPayload = {
  title: string;
  category: GalleryCategory;
  image_url: string;
  thumbnail_url: string;
  sort_order: number | null;
  is_featured: boolean;
  is_active: boolean;
};

type ActionResult = {
  ok: boolean;
  error?: string;
};

type UploadResult = ActionResult & {
  publicUrl?: string;
  thumbnailUrl?: string;
  path?: string;
  thumbnailPath?: string;
};

type GalleryItem = {
  id: string;
  title: string;
  category: GalleryCategory;
  image_url: string;
  thumbnail_url: string | null;
  sort_order: number | null;
  is_featured: boolean;
  is_active: boolean;
  created_at: string;
};

type GalleryListResult = ActionResult & {
  items?: GalleryItem[];
};

const bucketName = "gallery-images";
const maxImageSize = 5 * 1024 * 1024;

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

function validatePayload(payload: GalleryPayload) {
  if (!payload.title.trim()) {
    return "Title is required.";
  }

  if (!payload.category) {
    return "Category is required.";
  }

  if (!payload.image_url) {
    return "Image is required.";
  }

  return "";
}

function pathFromPublicUrl(publicUrl: string) {
  return imagePathFromPublicUrl(bucketName, publicUrl);
}

export async function uploadGalleryImage(formData: FormData): Promise<UploadResult> {
  await requireAdminSession();

  const file = formData.get("file");
  const category = String(formData.get("category") ?? "other");

  if (!(file instanceof File)) {
    return { ok: false, error: "Please choose an image file." };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const safeCategory = category.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "gallery";
  const timestamp = Date.now();
  const slug = safeImageSlug(file.name || safeCategory, "gallery");
  const fullPath = `full/${timestamp}-${slug}.webp`;
  const thumbnailPath = `thumb/${timestamp}-${slug}.webp`;
  const uploadResult = await uploadProcessedImageVariants({
    bucketName,
    file,
    maxFileSize: maxImageSize,
    maxFileSizeLabel: "5MB",
    supabase,
    variants: [
      { key: "full", path: fullPath, width: 1600 },
      { key: "thumbnail", path: thumbnailPath, width: 500 },
    ],
  });

  if (!uploadResult.ok || !uploadResult.uploads?.full || !uploadResult.uploads.thumbnail) {
    return { ok: false, error: uploadResult.error ?? "Image upload failed." };
  }

  return {
    ok: true,
    path: fullPath,
    thumbnailPath,
    publicUrl: uploadResult.uploads.full.publicUrl,
    thumbnailUrl: uploadResult.uploads.thumbnail.publicUrl,
  };
}

export async function listGalleryItems(): Promise<GalleryListResult> {
  await requireAdminSession();

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase
    .from("gallery_items")
    .select("id, title, category, image_url, thumbnail_url, sort_order, is_featured, is_active, created_at")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (result.error) {
    console.error("admin gallery list failed", result.error);
    return { ok: false, error: result.error.message };
  }

  return {
    ok: true,
    items: (result.data ?? []) as GalleryItem[],
  };
}

export async function createGalleryItem(payload: GalleryPayload): Promise<ActionResult> {
  await requireAdminSession();

  const validationError = validatePayload(payload);

  if (validationError) {
    return { ok: false, error: validationError };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("gallery_items").insert(payload);

  if (result.error) {
    console.error("admin gallery insert failed", result.error);
    return { ok: false, error: result.error.message };
  }

  return { ok: true };
}

export async function updateGalleryItem(
  id: string,
  payload: GalleryPayload,
): Promise<ActionResult> {
  await requireAdminSession();

  const validationError = validatePayload(payload);

  if (validationError) {
    return { ok: false, error: validationError };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("gallery_items").update(payload).eq("id", id);

  if (result.error) {
    console.error("admin gallery update failed", result.error);
    return { ok: false, error: result.error.message };
  }

  return { ok: true };
}

export async function deleteGalleryItemById(
  id: string,
  imageUrl: string,
  thumbnailUrl?: string | null,
): Promise<ActionResult> {
  await requireAdminSession();

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("gallery_items").delete().eq("id", id);

  if (result.error) {
    console.error("admin gallery delete failed", result.error);
    return { ok: false, error: result.error.message };
  }

  const objectPaths = Array.from(
    new Set([pathFromPublicUrl(imageUrl), thumbnailUrl ? pathFromPublicUrl(thumbnailUrl) : ""]),
  ).filter(Boolean);

  if (objectPaths.length > 0) {
    const storageResult = await supabase.storage.from(bucketName).remove(objectPaths);

    if (storageResult.error) {
      console.error("admin gallery storage delete failed", storageResult.error);
      return {
        ok: false,
        error: "Gallery row was deleted, but the storage image could not be removed.",
      };
    }
  }

  return { ok: true };
}

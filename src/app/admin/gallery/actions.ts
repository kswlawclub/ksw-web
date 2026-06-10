"use server";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

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
  path?: string;
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
const maxImageSize = 2 * 1024 * 1024;
const allowedImageTypes = new Map([
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
  const marker = `/storage/v1/object/public/${bucketName}/`;
  const index = publicUrl.indexOf(marker);

  if (index === -1) {
    return "";
  }

  return decodeURIComponent(publicUrl.slice(index + marker.length));
}

export async function uploadGalleryImage(formData: FormData): Promise<UploadResult> {
  const file = formData.get("file");
  const category = String(formData.get("category") ?? "other");

  if (!(file instanceof File)) {
    return { ok: false, error: "Please choose an image file." };
  }

  if (!allowedImageTypes.has(file.type)) {
    return { ok: false, error: "Image must be a png, jpg, jpeg, or webp file." };
  }

  if (file.size > maxImageSize) {
    return { ok: false, error: "Image file must be 2MB or smaller." };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const extension = allowedImageTypes.get(file.type) ?? "jpg";
  const safeCategory = category.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "gallery";
  const objectPath = `${safeCategory}-${Date.now()}.${extension}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const upload = await supabase.storage.from(bucketName).upload(objectPath, bytes, {
    contentType: file.type,
    upsert: false,
  });

  if (upload.error) {
    console.error("admin gallery image upload failed", upload.error);
    return { ok: false, error: upload.error.message };
  }

  const { data } = supabase.storage.from(bucketName).getPublicUrl(objectPath);

  return {
    ok: true,
    path: objectPath,
    publicUrl: data.publicUrl,
  };
}

export async function listGalleryItems(): Promise<GalleryListResult> {
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
): Promise<ActionResult> {
  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("gallery_items").delete().eq("id", id);

  if (result.error) {
    console.error("admin gallery delete failed", result.error);
    return { ok: false, error: result.error.message };
  }

  const objectPath = pathFromPublicUrl(imageUrl);

  if (objectPath) {
    const storageResult = await supabase.storage.from(bucketName).remove([objectPath]);

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

import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";

type ImageVariant = {
  key: string;
  path: string;
  width: number;
  quality?: number;
};

type UploadImageVariantsOptions = {
  bucketName: string;
  file: File;
  maxFileSize: number;
  maxFileSizeLabel: string;
  supabase: SupabaseClient;
  variants: ImageVariant[];
};

type UploadImageVariantsResult = {
  ok: boolean;
  error?: string;
  uploads?: Record<string, { path: string; publicUrl: string }>;
};

const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export function imagePathFromPublicUrl(bucketName: string, publicUrl: string, requiredPrefix?: string) {
  const marker = `/storage/v1/object/public/${bucketName}/`;
  const index = publicUrl.indexOf(marker);

  if (index === -1) {
    return "";
  }

  const path = decodeURIComponent(publicUrl.slice(index + marker.length));

  if (requiredPrefix && !path.startsWith(requiredPrefix)) {
    return "";
  }

  return path;
}

export function safeImageSlug(value: string, fallback = "image") {
  const slug = value
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

export function validateImageFile(file: File, maxFileSize: number, maxFileSizeLabel: string) {
  if (file.size <= 0) {
    return "Image file is empty.";
  }

  if (!allowedImageTypes.has(file.type)) {
    return "Image must be a png, jpg, jpeg, or webp file.";
  }

  if (file.size > maxFileSize) {
    return `Image file must be ${maxFileSizeLabel} or smaller.`;
  }

  return "";
}

export async function uploadProcessedImageVariants({
  bucketName,
  file,
  maxFileSize,
  maxFileSizeLabel,
  supabase,
  variants,
}: UploadImageVariantsOptions): Promise<UploadImageVariantsResult> {
  const validationError = validateImageFile(file, maxFileSize, maxFileSizeLabel);

  if (validationError) {
    return { ok: false, error: validationError };
  }

  const inputBuffer = Buffer.from(await file.arrayBuffer());
  const uploadedPaths: string[] = [];
  const uploads: Record<string, { path: string; publicUrl: string }> = {};

  try {
    for (const variant of variants) {
      const bytes = await sharp(inputBuffer)
        .rotate()
        .resize({ width: variant.width, withoutEnlargement: true })
        .webp({ quality: variant.quality ?? 82 })
        .toBuffer();

      const upload = await supabase.storage.from(bucketName).upload(variant.path, bytes, {
        contentType: "image/webp",
        upsert: false,
      });

      if (upload.error) {
        console.error("admin image upload failed", upload.error);
        if (uploadedPaths.length > 0) {
          await supabase.storage.from(bucketName).remove(uploadedPaths);
        }
        return { ok: false, error: upload.error.message };
      }

      uploadedPaths.push(variant.path);
      const { data } = supabase.storage.from(bucketName).getPublicUrl(variant.path);
      uploads[variant.key] = {
        path: variant.path,
        publicUrl: data.publicUrl,
      };
    }
  } catch (processingError) {
    console.error("admin image processing failed", processingError);
    if (uploadedPaths.length > 0) {
      await supabase.storage.from(bucketName).remove(uploadedPaths);
    }
    return { ok: false, error: "Image could not be processed." };
  }

  return { ok: true, uploads };
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import {
  createGalleryItem,
  deleteGalleryItemById,
  updateGalleryItem,
  uploadGalleryImage,
} from "./actions";

const storageKey = "ksw-admin-authenticated";

type GalleryCategory =
  | "team-photo"
  | "matchday"
  | "team-spirit"
  | "sideline"
  | "community"
  | "training"
  | "other";

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

type GalleryForm = {
  id: string;
  title: string;
  category: GalleryCategory;
  imageUrl: string;
  thumbnailUrl: string;
  sortOrder: string;
  isFeatured: boolean;
  isActive: boolean;
};

const categories: GalleryCategory[] = [
  "team-photo",
  "matchday",
  "team-spirit",
  "sideline",
  "community",
  "training",
  "other",
];

const emptyForm: GalleryForm = {
  id: "",
  title: "",
  category: "matchday",
  imageUrl: "",
  thumbnailUrl: "",
  sortOrder: "",
  isFeatured: false,
  isActive: true,
};

const maxImageSize = 2 * 1024 * 1024;
const allowedImageTypes = ["image/png", "image/jpeg", "image/webp"];

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function isGalleryCategory(value: string): value is GalleryCategory {
  return categories.includes(value as GalleryCategory);
}

function toGalleryCategory(value: string): GalleryCategory {
  return isGalleryCategory(value) ? value : "other";
}

function sortOrderValue(value: string) {
  return value.trim() === "" ? null : Number(value);
}

export default function AdminGalleryPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [form, setForm] = useState<GalleryForm>(emptyForm);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (window.localStorage.getItem(storageKey) !== "true") {
      router.replace("/admin/login");
      return;
    }

    setReady(true);
  }, [router]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    void loadData();
  }, [ready]);

  useEffect(() => {
    if (!imageFile) {
      setImagePreview("");
      return;
    }

    const previewUrl = URL.createObjectURL(imageFile);
    setImagePreview(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [imageFile]);

  async function loadData() {
    const supabase = getSupabase();

    setLoading(true);
    setError("");

    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const result = await supabase
      .from("gallery_items")
      .select("id, title, category, image_url, thumbnail_url, sort_order, is_featured, is_active, created_at")
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (result.error) {
      console.error("admin gallery query failed", result.error.message);
      setError("Could not load gallery items.");
    } else {
      setItems(
        ((result.data ?? []) as GalleryItem[]).map((item) => ({
          ...item,
          category: toGalleryCategory(item.category),
        })),
      );
    }

    setLoading(false);
  }

  function resetForm() {
    setForm(emptyForm);
    setImageFile(null);
    setMessage("");
    setError("");
  }

  function editItem(item: GalleryItem) {
    setForm({
      id: item.id,
      title: item.title,
      category: item.category,
      imageUrl: item.image_url,
      thumbnailUrl: item.thumbnail_url ?? item.image_url,
      sortOrder: item.sort_order === null ? "" : String(item.sort_order),
      isFeatured: item.is_featured,
      isActive: item.is_active,
    });
    setImageFile(null);
    setMessage("");
    setError("");
  }

  function selectImage(file: File | null) {
    if (!file) {
      setImageFile(null);
      return;
    }

    if (!allowedImageTypes.includes(file.type)) {
      setError("Image must be a png, jpg, jpeg, or webp file.");
      setImageFile(null);
      return;
    }

    if (file.size > maxImageSize) {
      setError("Image file must be 2MB or smaller.");
      setImageFile(null);
      return;
    }

    setError("");
    setImageFile(file);
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let imageUrl = form.imageUrl;

    setSaving(true);
    setMessage("");
    setError("");

    if (!form.id && !imageFile) {
      setSaving(false);
      setError("Image is required when creating a gallery item.");
      return;
    }

    if (imageFile) {
      const uploadData = new FormData();
      uploadData.append("file", imageFile);
      uploadData.append("category", form.category);

      const uploadResult = await uploadGalleryImage(uploadData);

      if (!uploadResult.ok || !uploadResult.publicUrl) {
        setSaving(false);
        setError(uploadResult.error ?? "Image upload failed.");
        return;
      }

      imageUrl = uploadResult.publicUrl;
    }

    const payload = {
      title: form.title.trim(),
      category: form.category,
      image_url: imageUrl,
      thumbnail_url: imageUrl,
      sort_order: sortOrderValue(form.sortOrder),
      is_featured: form.isFeatured,
      is_active: form.isActive,
    };

    const result = form.id
      ? await updateGalleryItem(form.id, payload)
      : await createGalleryItem(payload);

    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "Could not save gallery item.");
      return;
    }

    setMessage(form.id ? "Gallery item updated." : "Gallery item added.");
    setForm(emptyForm);
    setImageFile(null);
    await loadData();
  }

  async function deleteItem(item: GalleryItem) {
    const confirmed = window.confirm(`Delete ${item.title}?`);

    if (!confirmed) {
      return;
    }

    const result = await deleteGalleryItemById(item.id, item.image_url);

    if (!result.ok) {
      setError(result.error ?? "Could not delete gallery item.");
      return;
    }

    setMessage("Gallery item deleted.");
    await loadData();
  }

  if (!ready) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.16),transparent_34%),linear-gradient(135deg,#061426,#091f39)] px-4 py-12 text-white">
        <div className="mx-auto w-full max-w-7xl">Loading admin...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f6f2ea] text-[#061426]">
      <section className="bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.16),transparent_34%),linear-gradient(135deg,#061426,#091f39)] px-4 py-12 text-white sm:px-6 lg:px-10">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
          <Link className="text-sm font-bold text-[#f4d58a] hover:text-white" href="/admin">
            Back to Admin
          </Link>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ad45]">
              KSW Admin
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-tight">Manage Gallery</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
              Upload and organize official KSW gallery images.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[380px_1fr] lg:px-10">
        <form
          className="rounded-lg border border-[#d8ad45]/30 bg-white p-5 shadow-xl shadow-slate-900/10"
          onSubmit={saveItem}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
              <h2 className="text-2xl font-black">
                {form.id ? "Edit Gallery Item" : "Add Gallery Item"}
              </h2>
            </div>
            {form.id ? (
              <button className="text-sm font-black text-[#9b1c1f]" onClick={resetForm} type="button">
                Cancel
              </button>
            ) : null}
          </div>

          <div className="grid gap-4">
            <label className="grid gap-2 text-sm font-black">
              Title
              <input
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                required
                value={form.title}
              />
            </label>

            <label className="grid gap-2 text-sm font-black">
              Category
              <select
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    category: toGalleryCategory(event.target.value),
                  }))
                }
                required
                value={form.category}
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2 text-sm font-black">
              Sort Order
              <input
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))}
                type="number"
                value={form.sortOrder}
              />
            </label>

            <label className="grid gap-2 text-sm font-black">
              Image Upload
              <input
                accept="image/png,image/jpeg,image/webp"
                className="rounded-md border border-dashed border-[#d8ad45]/50 bg-[#f8f3e7] px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#061426] file:px-3 file:py-2 file:text-xs file:font-black file:text-[#f4d58a]"
                onChange={(event) => selectImage(event.target.files?.[0] ?? null)}
                required={!form.id}
                type="file"
              />
            </label>

            {imagePreview || form.imageUrl ? (
              <div className="rounded-md border border-slate-200 bg-[#f8f3e7] p-3">
                <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                  Image Preview
                </p>
                <img
                  alt="Gallery preview"
                  className="aspect-video w-full rounded-md object-cover"
                  src={imagePreview || form.imageUrl}
                />
              </div>
            ) : null}

            <label className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-sm font-black">
              <input
                checked={form.isFeatured}
                className="size-4 accent-[#d8ad45]"
                onChange={(event) =>
                  setForm((current) => ({ ...current, isFeatured: event.target.checked }))
                }
                type="checkbox"
              />
              Featured
            </label>

            <label className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-sm font-black">
              <input
                checked={form.isActive}
                className="size-4 accent-[#d8ad45]"
                onChange={(event) =>
                  setForm((current) => ({ ...current, isActive: event.target.checked }))
                }
                type="checkbox"
              />
              Active
            </label>

            {error ? (
              <p className="rounded-md border border-[#9b1c1f]/25 bg-[#9b1c1f]/10 px-3 py-2 text-sm font-bold text-[#9b1c1f]">
                {error}
              </p>
            ) : null}
            {message ? (
              <p className="rounded-md border border-emerald-700/20 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
                {message}
              </p>
            ) : null}

            <button
              className="rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/20 transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving}
              type="submit"
            >
              {saving ? "Saving..." : form.id ? "Update Gallery Item" : "Add Gallery Item"}
            </button>
          </div>
        </form>

        <div className="rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="flex flex-col gap-2 border-b border-slate-200 p-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
              <h2 className="text-2xl font-black">Gallery List</h2>
            </div>
            <p className="text-sm font-bold text-slate-500">{items.length} items</p>
          </div>

          {loading ? (
            <p className="p-5 text-sm font-bold text-slate-600">Loading gallery...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                <thead className="bg-[#061426] text-xs uppercase tracking-[0.14em] text-[#f4d58a]">
                  <tr>
                    <th className="px-4 py-3">Thumbnail</th>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Sort Order</th>
                    <th className="px-4 py-3">Featured</th>
                    <th className="px-4 py-3">Active</th>
                    <th className="px-4 py-3">Created At</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr className="border-b border-slate-100 last:border-b-0 hover:bg-[#f8f3e7]" key={item.id}>
                      <td className="px-4 py-3">
                        <img
                          alt=""
                          className="h-14 w-24 rounded-md object-cover"
                          src={item.thumbnail_url ?? item.image_url}
                        />
                      </td>
                      <td className="px-4 py-3 font-black">{item.title}</td>
                      <td className="px-4 py-3">{item.category}</td>
                      <td className="px-4 py-3">{item.sort_order ?? "-"}</td>
                      <td className="px-4 py-3">{item.is_featured ? "Yes" : "No"}</td>
                      <td className="px-4 py-3">{item.is_active ? "Yes" : "No"}</td>
                      <td className="px-4 py-3">{formatDate(item.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            className="rounded-md border border-slate-200 px-3 py-2 text-xs font-black text-[#061426] hover:border-[#d8ad45]"
                            onClick={() => editItem(item)}
                            type="button"
                          >
                            Edit
                          </button>
                          <button
                            className="rounded-md border border-[#9b1c1f]/30 px-3 py-2 text-xs font-black text-[#9b1c1f] hover:bg-[#9b1c1f]/10"
                            onClick={() => void deleteItem(item)}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {items.length === 0 ? (
                <p className="p-5 text-sm font-bold text-slate-600">No gallery items found.</p>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

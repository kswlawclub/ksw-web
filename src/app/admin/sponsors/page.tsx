"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import {
  createSponsor,
  deleteSponsorById,
  updateSponsor,
  uploadSponsorLogo,
} from "./actions";

const storageKey = "ksw-admin-authenticated";

type SponsorTier = "main" | "official" | "matchday" | "community" | "partner" | "supporter";

type Sponsor = {
  id: string;
  name: string;
  logo_url: string | null;
  website_url: string | null;
  tier: SponsorTier;
  sort_order: number | null;
  is_active: boolean;
  created_at: string;
};

type SponsorForm = {
  id: string;
  name: string;
  tier: SponsorTier;
  logoUrl: string;
  websiteUrl: string;
  sortOrder: string;
  isActive: boolean;
};

const tiers: SponsorTier[] = ["main", "official", "matchday", "community", "partner", "supporter"];

const emptyForm: SponsorForm = {
  id: "",
  name: "",
  tier: "partner",
  logoUrl: "",
  websiteUrl: "",
  sortOrder: "",
  isActive: true,
};

const maxLogoSize = 2 * 1024 * 1024;
const allowedLogoTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"];

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

function isSponsorTier(value: string): value is SponsorTier {
  return tiers.includes(value as SponsorTier);
}

function toSponsorTier(value: string): SponsorTier {
  return isSponsorTier(value) ? value : "partner";
}

function sortOrderValue(value: string) {
  return value.trim() === "" ? null : Number(value);
}

export default function AdminSponsorsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [form, setForm] = useState<SponsorForm>(emptyForm);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

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
    if (!logoFile) {
      setLogoPreview("");
      return;
    }

    const previewUrl = URL.createObjectURL(logoFile);
    setLogoPreview(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [logoFile]);

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
      .from("sponsors")
      .select("id, name, logo_url, website_url, tier, sort_order, is_active, created_at")
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (result.error) {
      console.error("admin sponsors query failed", result.error.message);
      setError("Could not load sponsors.");
    } else {
      setSponsors(
        ((result.data ?? []) as Sponsor[]).map((sponsor) => ({
          ...sponsor,
          tier: toSponsorTier(sponsor.tier),
        })),
      );
    }

    setLoading(false);
  }

  function resetForm() {
    setForm(emptyForm);
    setLogoFile(null);
    setMessage("");
    setError("");
  }

  function scrollToEditForm() {
    window.setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      firstFieldRef.current?.focus({ preventScroll: true });
    }, 50);
  }

  function editSponsor(sponsor: Sponsor) {
    setForm({
      id: sponsor.id,
      name: sponsor.name,
      tier: toSponsorTier(sponsor.tier),
      logoUrl: sponsor.logo_url ?? "",
      websiteUrl: sponsor.website_url ?? "",
      sortOrder: sponsor.sort_order === null ? "" : String(sponsor.sort_order),
      isActive: sponsor.is_active,
    });
    setLogoFile(null);
    setMessage("");
    setError("");
    scrollToEditForm();
  }

  function selectLogo(file: File | null) {
    if (!file) {
      setLogoFile(null);
      return;
    }

    if (!allowedLogoTypes.includes(file.type)) {
      setError("Logo must be a png, jpg, jpeg, webp, or svg image.");
      setLogoFile(null);
      return;
    }

    if (file.size > maxLogoSize) {
      setError("Logo file must be 2MB or smaller.");
      setLogoFile(null);
      return;
    }

    setError("");
    setLogoFile(file);
  }

  async function saveSponsor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let logoUrl = form.logoUrl.trim();

    setSaving(true);
    setMessage("");
    setError("");

    if (logoFile) {
      const uploadData = new FormData();
      uploadData.append("file", logoFile);
      uploadData.append("sponsorName", form.name || "sponsor");

      const uploadResult = await uploadSponsorLogo(uploadData);

      if (!uploadResult.ok || !uploadResult.publicUrl) {
        setSaving(false);
        setError(uploadResult.error ?? "Logo upload failed. You can still use the manual Logo URL field.");
        return;
      }

      logoUrl = uploadResult.publicUrl;
    }

    const payload = {
      name: form.name.trim(),
      tier: form.tier,
      logo_url: logoUrl || null,
      website_url: form.websiteUrl.trim() || null,
      sort_order: sortOrderValue(form.sortOrder),
      is_active: form.isActive,
    };

    const result = form.id
      ? await updateSponsor(form.id, payload)
      : await createSponsor(payload);

    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "Could not save sponsor.");
      return;
    }

    setMessage(form.id ? "Sponsor updated." : "Sponsor added.");
    setForm(emptyForm);
    setLogoFile(null);
    await loadData();
  }

  async function deleteSponsor(sponsor: Sponsor) {
    const confirmed = window.confirm(`Delete ${sponsor.name}?`);

    if (!confirmed) {
      return;
    }

    const result = await deleteSponsorById(sponsor.id);

    if (!result.ok) {
      setError(result.error ?? "Could not delete sponsor.");
      return;
    }

    setMessage("Sponsor deleted.");
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
    <main className="min-h-screen overflow-x-auto bg-[#f6f2ea] text-[#061426]">
      <section className="bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.16),transparent_34%),linear-gradient(135deg,#061426,#091f39)] px-4 py-12 text-white sm:px-6 lg:px-10">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
          <Link className="text-sm font-bold text-[#f4d58a] hover:text-white" href="/admin">
            Back to Admin
          </Link>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ad45]">
              KSW Admin
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-tight">Manage Sponsors</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
              Add, edit, and organize KSW partners and supporters.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:px-10">
        <form
          className="min-w-0 rounded-lg border border-[#d8ad45]/30 bg-white p-5 shadow-xl shadow-slate-900/10"
          onSubmit={saveSponsor}
          ref={formRef}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
              <h2 className="text-2xl font-black">
                {form.id ? "Edit Sponsor" : "Add Sponsor"}
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
              Name
              <input
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                ref={firstFieldRef}
                required
                value={form.name}
              />
            </label>

            <label className="grid gap-2 text-sm font-black">
              Tier
              <select
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    tier: toSponsorTier(event.target.value),
                  }))
                }
                required
                value={form.tier}
              >
                {tiers.map((tier) => (
                  <option key={tier} value={tier}>
                    {tier}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2 text-sm font-black">
              Logo URL
              <input
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) => setForm((current) => ({ ...current, logoUrl: event.target.value }))}
                placeholder="https://..."
                value={form.logoUrl}
              />
            </label>

            <label className="grid gap-2 text-sm font-black">
              Upload Logo
              <input
                accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
                className="rounded-md border border-dashed border-[#d8ad45]/50 bg-[#f8f3e7] px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#061426] file:px-3 file:py-2 file:text-xs file:font-black file:text-[#f4d58a]"
                onChange={(event) => selectLogo(event.target.files?.[0] ?? null)}
                type="file"
              />
            </label>

            {logoPreview || form.logoUrl ? (
              <div className="rounded-md border border-slate-200 bg-[#f8f3e7] p-3">
                <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                  Logo Preview
                </p>
                <div className="flex h-28 items-center justify-center rounded-md bg-white p-4">
                  <img
                    alt="Sponsor logo preview"
                    className="max-h-full max-w-full object-contain"
                    src={logoPreview || form.logoUrl}
                  />
                </div>
              </div>
            ) : null}

            <label className="grid gap-2 text-sm font-black">
              Website URL
              <input
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) => setForm((current) => ({ ...current, websiteUrl: event.target.value }))}
                placeholder="https://..."
                value={form.websiteUrl}
              />
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
              {saving ? "Saving..." : form.id ? "Update Sponsor" : "Add Sponsor"}
            </button>
          </div>
        </form>

        <div className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="flex flex-col gap-2 border-b border-slate-200 p-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
              <h2 className="text-2xl font-black">Sponsor List</h2>
            </div>
            <p className="text-sm font-bold text-slate-500">{sponsors.length} sponsors</p>
          </div>

          {loading ? (
            <p className="p-5 text-sm font-bold text-slate-600">Loading sponsors...</p>
          ) : (
            <div className="w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                <thead className="bg-[#061426] text-xs uppercase tracking-[0.14em] text-[#f4d58a]">
                  <tr>
                    <th className="px-4 py-3">Logo</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Tier</th>
                    <th className="px-4 py-3">Website URL</th>
                    <th className="px-4 py-3">Sort Order</th>
                    <th className="px-4 py-3">Active</th>
                    <th className="px-4 py-3">Created At</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sponsors.map((sponsor) => (
                    <tr className="border-b border-slate-100 last:border-b-0 hover:bg-[#f8f3e7]" key={sponsor.id}>
                      <td className="px-4 py-3">
                        <div className="flex h-12 w-20 items-center justify-center rounded-md border border-slate-200 bg-white p-2">
                          {sponsor.logo_url ? (
                            <img
                              alt=""
                              className="max-h-full max-w-full object-contain"
                              src={sponsor.logo_url}
                            />
                          ) : (
                            <span className="text-[10px] font-black text-slate-400">NO LOGO</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-black">{sponsor.name}</td>
                      <td className="px-4 py-3">{sponsor.tier}</td>
                      <td className="max-w-[220px] truncate px-4 py-3">
                        {sponsor.website_url ?? "-"}
                      </td>
                      <td className="px-4 py-3">{sponsor.sort_order ?? "-"}</td>
                      <td className="px-4 py-3">{sponsor.is_active ? "Yes" : "No"}</td>
                      <td className="px-4 py-3">{formatDate(sponsor.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            className="rounded-md border border-slate-200 px-3 py-2 text-xs font-black text-[#061426] hover:border-[#d8ad45]"
                            onClick={() => editSponsor(sponsor)}
                            type="button"
                          >
                            Edit
                          </button>
                          <button
                            className="rounded-md border border-[#9b1c1f]/30 px-3 py-2 text-xs font-black text-[#9b1c1f] hover:bg-[#9b1c1f]/10"
                            onClick={() => void deleteSponsor(sponsor)}
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
              {sponsors.length === 0 ? (
                <p className="p-5 text-sm font-bold text-slate-600">No sponsors found.</p>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

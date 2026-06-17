"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import {
  createCompetition,
  deleteCompetitionById,
  updateCompetition,
} from "./actions";

const storageKey = "ksw-admin-authenticated";

type CompetitionType = "league" | "cup" | "friendly" | "tournament";

type Competition = {
  id: string;
  name: string;
  season: string | null;
  competition_type: CompetitionType;
  is_active: boolean;
  created_at: string;
};

type CompetitionForm = {
  id: string;
  name: string;
  season: string;
  competitionType: CompetitionType;
  isActive: boolean;
};

const emptyForm: CompetitionForm = {
  id: "",
  name: "",
  season: "",
  competitionType: "league",
  isActive: true,
};

function isCompetitionType(value: string): value is CompetitionType {
  return ["league", "cup", "friendly", "tournament"].includes(value);
}

function toCompetitionType(value: string | null): CompetitionType {
  return value && isCompetitionType(value) ? value : "league";
}

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

export default function AdminCompetitionsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [form, setForm] = useState<CompetitionForm>(emptyForm);
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
      .from("leagues")
      .select("id, name, season, competition_type, is_active, created_at")
      .order("created_at", { ascending: false });

    if (result.error) {
      console.error("admin competitions query failed", result.error.message);
      setError("Could not load competitions from leagues.");
    } else {
      setCompetitions(
        ((result.data ?? []) as Competition[]).map((competition) => ({
          ...competition,
          competition_type: toCompetitionType(competition.competition_type),
        })),
      );
    }

    setLoading(false);
  }

  function resetForm() {
    setForm(emptyForm);
    setMessage("");
    setError("");
  }

  function scrollToEditForm() {
    window.setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      firstFieldRef.current?.focus({ preventScroll: true });
    }, 50);
  }

  function editCompetition(competition: Competition) {
    setForm({
      id: competition.id,
      name: competition.name,
      season: competition.season ?? "",
      competitionType: competition.competition_type,
      isActive: competition.is_active,
    });
    setMessage("");
    setError("");
    scrollToEditForm();
  }

  async function saveCompetition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload = {
      name: form.name.trim(),
      season: form.season.trim() || null,
      competition_type: form.competitionType,
      is_active: form.isActive,
    };

    setSaving(true);
    setMessage("");
    setError("");

    const result = form.id
      ? await updateCompetition(form.id, payload)
      : await createCompetition(payload);

    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "Could not save competition.");
      return;
    }

    setMessage(form.id ? "Competition updated." : "Competition added.");
    setForm(emptyForm);
    await loadData();
  }

  async function deleteCompetition(competition: Competition) {
    const confirmed = window.confirm(`Delete ${competition.name}?`);

    if (!confirmed) {
      return;
    }

    const result = await deleteCompetitionById(competition.id);

    if (!result.ok) {
      setError(result.error ?? "Could not delete competition.");
      return;
    }

    setMessage("Competition deleted.");
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
            <h1 className="mt-3 text-4xl font-black tracking-tight">
              Manage Competitions
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
              Manage league, cup, friendly, and tournament records from the leagues table.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:px-10">
        <form
          className="min-w-0 rounded-lg border border-[#d8ad45]/30 bg-white p-5 shadow-xl shadow-slate-900/10"
          onSubmit={saveCompetition}
          ref={formRef}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
              <h2 className="text-2xl font-black">
                {form.id ? "Edit Competition" : "Add Competition"}
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
              Season
              <input
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) => setForm((current) => ({ ...current, season: event.target.value }))}
                value={form.season}
              />
            </label>

            <label className="grid gap-2 text-sm font-black">
              Type
              <select
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    competitionType: toCompetitionType(event.target.value),
                  }))
                }
                value={form.competitionType}
              >
                <option value="league">league</option>
                <option value="cup">cup</option>
                <option value="friendly">friendly</option>
                <option value="tournament">tournament</option>
              </select>
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
              {saving ? "Saving..." : form.id ? "Update Competition" : "Add Competition"}
            </button>
          </div>
        </form>

        <div className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="flex flex-col gap-2 border-b border-slate-200 p-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
              <h2 className="text-2xl font-black">Competition List</h2>
            </div>
            <p className="text-sm font-bold text-slate-500">
              {competitions.length} competitions
            </p>
          </div>

          {loading ? (
            <p className="p-5 text-sm font-bold text-slate-600">Loading competitions...</p>
          ) : (
            <div className="w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-[780px] border-collapse text-left text-sm">
                <thead className="bg-[#061426] text-xs uppercase tracking-[0.14em] text-[#f4d58a]">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Season</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Active</th>
                    <th className="px-4 py-3">Created At</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {competitions.map((competition) => (
                    <tr
                      className="border-b border-slate-100 last:border-b-0 hover:bg-[#f8f3e7]"
                      key={competition.id}
                    >
                      <td className="px-4 py-3 font-black">{competition.name}</td>
                      <td className="px-4 py-3">{competition.season ?? "-"}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full border border-[#d8ad45]/40 bg-[#d8ad45]/10 px-3 py-1 text-xs font-black text-[#061426]">
                          {competition.competition_type}
                        </span>
                      </td>
                      <td className="px-4 py-3">{competition.is_active ? "Yes" : "No"}</td>
                      <td className="px-4 py-3">{formatDate(competition.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            className="rounded-md border border-slate-200 px-3 py-2 text-xs font-black text-[#061426] hover:border-[#d8ad45]"
                            onClick={() => editCompetition(competition)}
                            type="button"
                          >
                            Edit
                          </button>
                          <button
                            className="rounded-md border border-[#9b1c1f]/30 px-3 py-2 text-xs font-black text-[#9b1c1f] hover:bg-[#9b1c1f]/10"
                            onClick={() => void deleteCompetition(competition)}
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
              {competitions.length === 0 ? (
                <p className="p-5 text-sm font-bold text-slate-600">
                  No competitions found.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

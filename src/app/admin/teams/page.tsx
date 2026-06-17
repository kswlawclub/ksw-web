"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { createTeam, deleteTeamById, updateTeam, uploadTeamLogo } from "./actions";

const storageKey = "ksw-admin-authenticated";

type Competition = {
  id: string;
  name: string;
  season: string | null;
  competition_type: string | null;
};

type Team = {
  id: string;
  league_id: string | null;
  name: string;
  short_name: string;
  logo_url: string | null;
  is_ksw: boolean;
  is_active: boolean;
  created_at: string;
};

type TeamForm = {
  id: string;
  leagueId: string;
  name: string;
  shortName: string;
  logoUrl: string;
  isKsw: boolean;
  isActive: boolean;
};

const emptyForm: TeamForm = {
  id: "",
  leagueId: "",
  name: "",
  shortName: "",
  logoUrl: "",
  isKsw: false,
  isActive: true,
};

const maxLogoSize = 2 * 1024 * 1024;
const allowedLogoTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"];
const rasterLogoTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];

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

function competitionLabel(competition: Competition) {
  return [competition.name, competition.season, competition.competition_type]
    .filter(Boolean)
    .join(" - ");
}

function teamInitials(team: Team) {
  return (team.short_name || team.name).slice(0, 3).toUpperCase();
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Logo image could not be loaded."));
    };
    image.src = objectUrl;
  });
}

async function compressRasterLogo(file: File) {
  const image = await loadImageFromFile(file);
  const scale = Math.min(800 / image.naturalWidth, 800 / image.naturalHeight, 1);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Logo image could not be processed.");
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/webp", 0.85);
  });

  if (!blob) {
    throw new Error("Logo image could not be compressed.");
  }

  const outputName = file.name.replace(/\.[^.]+$/, "") || "team-logo";

  return new File([blob], `${outputName}.webp`, { type: "image/webp" });
}

export default function AdminTeamsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [form, setForm] = useState<TeamForm>(emptyForm);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const competitionsById = useMemo(
    () => new Map(competitions.map((competition) => [competition.id, competition])),
    [competitions],
  );

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

    const [teamsResult, competitionsResult] = await Promise.all([
      supabase
        .from("teams")
        .select("id, league_id, name, short_name, logo_url, is_ksw, is_active, created_at")
        .order("name"),
      supabase
        .from("leagues")
        .select("id, name, season, competition_type")
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
    ]);

    if (teamsResult.error) {
      console.error("admin teams query failed", teamsResult.error.message);
      setError("Could not load teams.");
    } else {
      setTeams((teamsResult.data ?? []) as Team[]);
    }

    if (competitionsResult.error) {
      console.error("admin team competitions query failed", competitionsResult.error.message);
      setError("Could not load competitions for the team form.");
    } else {
      const activeCompetitions = (competitionsResult.data ?? []) as Competition[];
      setCompetitions(activeCompetitions);
      setForm((current) =>
        current.leagueId || !activeCompetitions[0]
          ? current
          : { ...current, leagueId: activeCompetitions[0].id },
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

  function editTeam(team: Team) {
    setForm({
      id: team.id,
      leagueId: team.league_id ?? "",
      name: team.name,
      shortName: team.short_name,
      logoUrl: team.logo_url ?? "",
      isKsw: team.is_ksw,
      isActive: team.is_active,
    });
    setLogoFile(null);
    setMessage("");
    setError("");
    scrollToEditForm();
  }

  async function saveTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    try {
      let logoUrl = form.logoUrl.trim() || null;

      if (logoFile) {
        if (!allowedLogoTypes.includes(logoFile.type)) {
          setError("Logo must be a png, jpg, jpeg, webp, or svg image.");
          return;
        }

        if (logoFile.type === "image/svg+xml" && logoFile.size > maxLogoSize) {
          setError("Logo file must be 2MB or smaller.");
          return;
        }

        let fileToUpload = logoFile;

        if (rasterLogoTypes.includes(logoFile.type)) {
          try {
            fileToUpload = await compressRasterLogo(logoFile);
          } catch (compressionError) {
            console.error("admin team logo client compression failed", compressionError);
            setError("Logo could not be compressed. Please choose another image.");
            return;
          }

          if (fileToUpload.size > maxLogoSize) {
            setError("Logo is still larger than 2MB after compression. Please choose a smaller image.");
            return;
          }
        }

        const uploadData = new FormData();
        uploadData.append("file", fileToUpload);
        uploadData.append("shortName", form.shortName.trim() || form.name.trim());
        uploadData.append("teamId", form.id);

        const uploadResult = await uploadTeamLogo(uploadData);

        if (!uploadResult.ok || !uploadResult.publicUrl) {
          console.error("admin team logo upload returned error", uploadResult);
          setError(uploadResult.error ?? "Logo upload failed.");
          return;
        }

        logoUrl = uploadResult.publicUrl;
      }

      const payload = {
        league_id: form.leagueId,
        name: form.name.trim(),
        short_name: form.shortName.trim(),
        logo_url: logoUrl,
        is_ksw: form.isKsw,
        is_active: form.isActive,
      };

      const result = form.id ? await updateTeam(form.id, payload) : await createTeam(payload);

      if (!result.ok) {
        console.error("admin team save returned error", result);
        setError(result.error ?? "Could not save team.");
        return;
      }

      setMessage(form.id ? "Team updated." : "Team added.");
      setForm(emptyForm);
      setLogoFile(null);
      await loadData();
    } catch (saveError) {
      console.error("admin team save failed", saveError);
      setError("Could not save team. Please check the logo upload and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTeam(team: Team) {
    const confirmed = window.confirm(`Delete ${team.name}?`);

    if (!confirmed) {
      return;
    }

    const result = await deleteTeamById(team.id);

    if (!result.ok) {
      setError(result.error ?? "Could not delete team.");
      return;
    }

    setMessage("Team deleted.");
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
            <h1 className="mt-3 text-4xl font-black tracking-tight">Manage Teams</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
              Manage teams available for match scheduling and competition records.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:px-10">
        <form
          className="min-w-0 rounded-lg border border-[#d8ad45]/30 bg-white p-5 shadow-xl shadow-slate-900/10"
          onSubmit={saveTeam}
          ref={formRef}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
              <h2 className="text-2xl font-black">{form.id ? "Edit Team" : "Add Team"}</h2>
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
              Short Name
              <input
                className="rounded-md border border-slate-200 px-3 py-2 text-sm uppercase outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) => setForm((current) => ({ ...current, shortName: event.target.value }))}
                required
                value={form.shortName}
              />
            </label>

            <label className="grid gap-2 text-sm font-black">
              Logo URL
              <input
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) => setForm((current) => ({ ...current, logoUrl: event.target.value }))}
                placeholder="/team-logos/example.png"
                value={form.logoUrl}
              />
            </label>

            <label className="grid gap-2 text-sm font-black">
              Upload Logo
              <span className="text-xs font-semibold text-slate-500">
                ระบบจะย่อขนาดรูปอัตโนมัติก่อนอัปโหลด
              </span>
              <input
                accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
                className="rounded-md border border-dashed border-[#d8ad45]/50 bg-[#f8f3e7] px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#061426] file:px-3 file:py-2 file:text-xs file:font-black file:text-[#f4d58a]"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;

                  if (!file) {
                    setLogoFile(null);
                    return;
                  }

                  if (!allowedLogoTypes.includes(file.type)) {
                    setError("Logo must be a png, jpg, jpeg, webp, or svg image.");
                    setLogoFile(null);
                    return;
                  }

                  if (file.type === "image/svg+xml" && file.size > maxLogoSize) {
                    setError("Logo file must be 2MB or smaller.");
                    setLogoFile(null);
                    return;
                  }

                  setError("");
                  setLogoFile(file);
                }}
                type="file"
              />
            </label>

            {logoPreview || form.logoUrl ? (
              <div className="rounded-md border border-slate-200 bg-[#f8f3e7] p-3">
                <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                  Logo Preview
                </p>
                <div className="flex size-24 items-center justify-center overflow-hidden rounded-full border border-[#d8ad45]/60 bg-[#061426]">
                  <img
                    alt="Team logo preview"
                    className="h-full w-full object-contain p-2"
                    src={logoPreview || form.logoUrl}
                  />
                </div>
              </div>
            ) : null}

            <label className="grid gap-2 text-sm font-black">
              Competition
              <select
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) => setForm((current) => ({ ...current, leagueId: event.target.value }))}
                required
                value={form.leagueId}
              >
                <option value="">Select competition</option>
                {competitions.map((competition) => (
                  <option key={competition.id} value={competition.id}>
                    {competitionLabel(competition)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-sm font-black">
              <input
                checked={form.isKsw}
                className="size-4 accent-[#d8ad45]"
                onChange={(event) => setForm((current) => ({ ...current, isKsw: event.target.checked }))}
                type="checkbox"
              />
              Is KSW
            </label>

            <label className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-sm font-black">
              <input
                checked={form.isActive}
                className="size-4 accent-[#d8ad45]"
                onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
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
              {saving ? "Saving..." : form.id ? "Update Team" : "Add Team"}
            </button>
          </div>
        </form>

        <div className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="flex flex-col gap-2 border-b border-slate-200 p-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
              <h2 className="text-2xl font-black">Team List</h2>
            </div>
            <p className="text-sm font-bold text-slate-500">{teams.length} teams</p>
          </div>

          {loading ? (
            <p className="p-5 text-sm font-bold text-slate-600">Loading teams...</p>
          ) : (
            <div className="w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                <thead className="bg-[#061426] text-xs uppercase tracking-[0.14em] text-[#f4d58a]">
                  <tr>
                    <th className="px-4 py-3">Logo</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Short Name</th>
                    <th className="px-4 py-3">Competition</th>
                    <th className="px-4 py-3">KSW?</th>
                    <th className="px-4 py-3">Active?</th>
                    <th className="px-4 py-3">Created At</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((team) => {
                    const competition = team.league_id
                      ? competitionsById.get(team.league_id)
                      : undefined;

                    return (
                      <tr className="border-b border-slate-100 last:border-b-0 hover:bg-[#f8f3e7]" key={team.id}>
                        <td className="px-4 py-3">
                          <div className="flex size-11 items-center justify-center overflow-hidden rounded-full border border-[#d8ad45]/50 bg-[#061426] text-xs font-black text-[#f4d58a]">
                            {team.logo_url ? (
                              <img alt="" className="h-full w-full object-contain p-1" src={team.logo_url} />
                            ) : (
                              teamInitials(team)
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-black">{team.name}</td>
                        <td className="px-4 py-3">{team.short_name}</td>
                        <td className="px-4 py-3">
                          {competition ? competitionLabel(competition) : "No competition"}
                        </td>
                        <td className="px-4 py-3">{team.is_ksw ? "Yes" : "No"}</td>
                        <td className="px-4 py-3">{team.is_active ? "Yes" : "No"}</td>
                        <td className="px-4 py-3">{formatDate(team.created_at)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              className="rounded-md border border-slate-200 px-3 py-2 text-xs font-black text-[#061426] hover:border-[#d8ad45]"
                              onClick={() => editTeam(team)}
                              type="button"
                            >
                              Edit
                            </button>
                            <button
                              className="rounded-md border border-[#9b1c1f]/30 px-3 py-2 text-xs font-black text-[#9b1c1f] hover:bg-[#9b1c1f]/10"
                              onClick={() => void deleteTeam(team)}
                              type="button"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {teams.length === 0 ? (
                <p className="p-5 text-sm font-bold text-slate-600">No teams found.</p>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

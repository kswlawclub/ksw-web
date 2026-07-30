"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  assignTeamsToCompetition,
  createTeam,
  deleteTeamById,
  loadAdminTeamsData,
  removeTeamFromCompetition,
  updateTeam,
  uploadTeamLogo,
} from "./actions";

type Competition = {
  id: string;
  name: string;
  season: string | null;
  competition_type: string | null;
  season_status: string | null;
  slug: string | null;
  is_published: boolean | null;
};

type Team = {
  id: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  is_ksw: boolean;
  is_active: boolean;
  created_at: string | null;
  display_order?: number;
  participant_is_active?: boolean;
  participant_source?: string;
};

type TeamForm = {
  id: string;
  name: string;
  shortName: string;
  logoUrl: string;
  isKsw: boolean;
  isActive: boolean;
};

const emptyForm: TeamForm = {
  id: "",
  name: "",
  shortName: "",
  logoUrl: "",
  isKsw: false,
  isActive: true,
};

const maxLogoSize = 2 * 1024 * 1024;
const allowedLogoTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"];
const rasterLogoTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

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

function competitionLabel(competition: Competition | undefined) {
  if (!competition) {
    return "Unknown competition";
  }

  return [competition.name, competition.season, competition.competition_type]
    .filter(Boolean)
    .join(" - ");
}

function readCompetitionParam() {
  if (typeof window === "undefined") {
    return "";
  }

  return new URLSearchParams(window.location.search).get("competition")?.trim() ?? "";
}

function teamInitials(team: Team) {
  return (team.short_name || team.name || "FC").slice(0, 3).toUpperCase();
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [unassignedTeams, setUnassignedTeams] = useState<Team[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [form, setForm] = useState<TeamForm>(emptyForm);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [contextCompetitionId, setContextCompetitionId] = useState<string | null>(null);
  const [selectedAssignTeamIds, setSelectedAssignTeamIds] = useState<string[]>([]);
  const [relationshipWarning, setRelationshipWarning] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const competitionsById = useMemo(
    () => new Map(competitions.map((competition) => [competition.id, competition])),
    [competitions],
  );
  const isContextMode = Boolean(contextCompetitionId);
  const contextCompetition = contextCompetitionId ? competitionsById.get(contextCompetitionId) : undefined;
  const contextIsInvalid = Boolean(contextCompetitionId && !contextCompetition && !loading);
  const kswTeamCount = teams.filter((team) => team.is_ksw).length;
  const canSubmit =
    !contextIsInvalid &&
    (!isContextMode || Boolean(form.id)) &&
    Boolean(form.name.trim() && form.shortName.trim());

  useEffect(() => {
    function syncCompetitionParam() {
      setContextCompetitionId(readCompetitionParam());
    }

    syncCompetitionParam();
    window.addEventListener("popstate", syncCompetitionParam);

    return () => {
      window.removeEventListener("popstate", syncCompetitionParam);
    };
  }, []);

  useEffect(() => {
    if (contextCompetitionId === null) {
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void loadData(contextCompetitionId, () => cancelled);
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [contextCompetitionId]);

  useEffect(() => {
    if (!logoFile) {
      const timeout = window.setTimeout(() => {
        setLogoPreview("");
      }, 0);

      return () => {
        window.clearTimeout(timeout);
      };
    }

    const previewUrl = URL.createObjectURL(logoFile);
    const timeout = window.setTimeout(() => {
      setLogoPreview(previewUrl);
    }, 0);

    return () => {
      window.clearTimeout(timeout);
      URL.revokeObjectURL(previewUrl);
    };
  }, [logoFile]);

  async function loadData(
    competitionId: string,
    isCancelled = () => false,
    options: { preserveMessages?: boolean } = {},
  ) {
    let refreshOk = true;

    setLoading(true);
    if (!options.preserveMessages) {
      setError("");
      setMessage("");
      setRelationshipWarning("");
    }
    setSelectedAssignTeamIds([]);
    setLogoFile(null);
    setForm(emptyForm);

    let result: Awaited<ReturnType<typeof loadAdminTeamsData>>;

    try {
      result = await loadAdminTeamsData(competitionId);
    } catch (loadError) {
      console.error("admin teams server read failed", loadError);
      if (isCancelled()) return;
      setError("Could not load teams. Please sign in again or reload the page.");
      setLoading(false);
      return false;
    }

    if (isCancelled()) return;

    if (!result.ok) {
      setError(result.error ?? "Could not load teams.");
      refreshOk = false;
    } else {
      const activeCompetitions = result.competitions ?? [];
      setCompetitions(activeCompetitions);
      const validContext = competitionId
        ? activeCompetitions.some((competition) => competition.id === competitionId)
        : true;

      if (competitionId && !validContext) {
        setError("Competition context was not found. Return to Competitions and choose a valid record.");
      }

      setForm((current) => {
        if (competitionId) {
          return validContext ? current : emptyForm;
        }

        return current;
      });
      setTeams((result.teams ?? []) as Team[]);
      setUnassignedTeams((result.availableTeams ?? []) as Team[]);
    }

    setLoading(false);
    return refreshOk;
  }

  function resetForm() {
    setForm(emptyForm);
    setLogoFile(null);
    setMessage("");
    setError("");
    setRelationshipWarning("");
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
      name: team.name,
      shortName: team.short_name ?? "",
      logoUrl: team.logo_url ?? "",
      isKsw: team.is_ksw,
      isActive: team.is_active,
    });
    setLogoFile(null);
    setMessage("");
    setError("");
    setRelationshipWarning(
      contextCompetitionId
        ? "Editing updates canonical team details only. Competition participation is managed by Assign and Remove."
        : "Competition participation is managed from each Competition Workspace.",
    );
    scrollToEditForm();
  }

  function prepareAddTeam() {
    setForm(emptyForm);
    setLogoFile(null);
    setMessage("");
    setError("");
    setRelationshipWarning(
      "Create the canonical team here, then open a Competition Workspace to assign it as a participant.",
    );
    scrollToEditForm();
  }

  function contextAddTeamMessage() {
    setMessage("");
    setError(
      "Create new canonical teams in Team Center first, then assign them from Available Teams in this competition.",
    );
    setRelationshipWarning("");
    setForm(emptyForm);
    setLogoFile(null);
    scrollToEditForm();
  }

  function teamParticipantDisplay(team: Team) {
    if (contextCompetitionId) {
      return team.participant_is_active === false
        ? "Hidden participant"
        : `Active participant${typeof team.display_order === "number" ? ` · Order ${team.display_order}` : ""}`;
    }

    return "Canonical team";
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

      if (contextCompetitionId && contextIsInvalid) {
        setError("Competition context was not found. This team cannot be saved.");
        return;
      }

      if (contextCompetitionId && !form.id) {
        setError("Create the canonical team in Team Center first, then assign it to this competition.");
        return;
      }

      const payload = {
        name: form.name.trim(),
        short_name: form.shortName.trim(),
        logo_url: logoUrl,
        is_ksw: form.isKsw,
        is_active: form.isActive,
      };

      const result = form.id
        ? await updateTeam(form.id, payload, contextCompetitionId || undefined)
        : await createTeam(payload);

      if (!result.ok) {
        console.error("admin team save returned error", result);
        setError(result.error ?? "Could not save team.");
        return;
      }

      setMessage(form.id ? "Team updated." : "Team added.");
      setForm(emptyForm);
      setLogoFile(null);
      const refreshed = await loadData(contextCompetitionId ?? "", () => false, { preserveMessages: true });
      if (!refreshed) {
        setError("Team saved, but the list could not be refreshed. Please reload the page.");
      }
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

    const result = await deleteTeamById(team.id, contextCompetitionId || undefined);

    if (!result.ok) {
      setError(result.error ?? "Could not delete team.");
      return;
    }

    setMessage("Team deleted.");
    const refreshed = await loadData(contextCompetitionId ?? "", () => false, { preserveMessages: true });
    if (!refreshed) {
      setError("Team deleted, but the list could not be refreshed. Please reload the page.");
    }
  }

  async function assignSelectedTeams() {
    if (!contextCompetitionId || contextIsInvalid) {
      setError("Competition context was not found. Teams cannot be assigned.");
      return;
    }

    if (selectedAssignTeamIds.length === 0) {
      setError("Select at least one team to assign.");
      return;
    }

    const confirmed = window.confirm(`Assign ${selectedAssignTeamIds.length} selected team(s) to this competition?`);

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    const result = await assignTeamsToCompetition(selectedAssignTeamIds, contextCompetitionId);

    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "Could not assign selected teams.");
      return;
    }

    const assignedCount = result.assignedCount ?? 0;
    const reactivatedCount = result.reactivatedCount ?? 0;
    const alreadyAssignedCount = result.alreadyAssignedCount ?? 0;
    const summary = [
      assignedCount ? `${assignedCount} assigned` : "",
      reactivatedCount ? `${reactivatedCount} reactivated` : "",
      alreadyAssignedCount ? `${alreadyAssignedCount} already assigned` : "",
    ].filter(Boolean);

    const successMessage = summary.length ? summary.join(", ") + "." : "No participant changes were needed.";
    const refreshed = await loadData(contextCompetitionId, () => false, { preserveMessages: true });
    if (refreshed) {
      setMessage(successMessage);
      setError("");
    } else {
      setMessage(successMessage);
      setError("Team assignment succeeded, but the list could not be refreshed. Please reload the page.");
    }
  }

  async function removeTeam(team: Team) {
    if (!contextCompetitionId || contextIsInvalid) {
      setError("Competition context was not found. This team cannot be removed.");
      return;
    }

    const confirmed = window.confirm(`Remove ${team.name} from this competition? The team record will not be deleted.`);

    if (!confirmed) {
      return;
    }

    const result = await removeTeamFromCompetition(team.id, contextCompetitionId);

    if (!result.ok) {
      setError(result.error ?? "Could not remove team from competition.");
      return;
    }

    setMessage("Team removed from competition.");
    setForm(emptyForm);
    const refreshed = await loadData(contextCompetitionId, () => false, { preserveMessages: true });
    if (refreshed) {
      setMessage("Team removed from competition.");
      setError("");
    } else {
      setError("Team removal succeeded, but the list could not be refreshed. Please reload the page.");
    }
  }

  function toggleAssignTeam(teamId: string) {
    setSelectedAssignTeamIds((current) =>
      current.includes(teamId)
        ? current.filter((id) => id !== teamId)
        : [...current, teamId],
    );
  }

  return (
    <main className="min-h-screen overflow-x-auto bg-[#f6f2ea] text-[#061426]">
      <section className="bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.16),transparent_34%),linear-gradient(135deg,#061426,#091f39)] px-4 py-12 text-white sm:px-6 lg:px-10">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
          <Link
            className="text-sm font-bold text-[#f4d58a] hover:text-white"
            href={contextCompetition ? `/admin/competitions/${contextCompetition.id}` : "/admin"}
          >
            {contextCompetition ? "Back to Workspace" : "Back to Admin"}
          </Link>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ad45]">
              KSW Admin
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-tight">Manage Teams</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
              Manage canonical teams and competition participant relationships.
            </p>
            {contextCompetition ? (
              <div className="mt-5 rounded-lg border border-[#d8ad45]/35 bg-white/[0.08] p-4">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-[#d8ad45]">
                  Managing Teams for
                </p>
                <h2 className="mt-2 text-2xl font-black text-white">{contextCompetition.name}</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {contextCompetition.season ? (
                    <span className="rounded-full border border-white/15 bg-white/[0.08] px-3 py-1 text-xs font-black text-slate-100">
                      {contextCompetition.season}
                    </span>
                  ) : null}
                  {contextCompetition.competition_type ? (
                    <span className="rounded-full border border-white/15 bg-white/[0.08] px-3 py-1 text-xs font-black uppercase text-slate-100">
                      {contextCompetition.competition_type}
                    </span>
                  ) : null}
                  {contextCompetition.season_status ? (
                    <span className="rounded-full border border-white/15 bg-white/[0.08] px-3 py-1 text-xs font-black uppercase text-slate-100">
                      {contextCompetition.season_status}
                    </span>
                  ) : null}
                </div>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <Link
                    className="inline-flex items-center justify-center rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-4 py-2 text-sm font-black text-[#061426]"
                    href={`/admin/competitions/${contextCompetition.id}`}
                  >
                    Back to Workspace
                  </Link>
                  {contextCompetition.slug && contextCompetition.is_published ? (
                    <Link
                      className="inline-flex items-center justify-center rounded-md border border-[#d8ad45]/50 bg-white/[0.03] px-4 py-2 text-sm font-black text-[#f4d58a] hover:bg-[#d8ad45]/10"
                      href={`/competitions/${contextCompetition.slug}`}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      View Public Page
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}
            {contextIsInvalid ? (
              <div className="mt-5 rounded-lg border border-[#9b1c1f]/30 bg-[#9b1c1f]/10 p-4 text-sm font-bold text-red-100">
                Competition context was not found. Return to Competitions and choose a valid record.
                <div className="mt-3">
                  <Link className="text-[#f4d58a] underline-offset-4 hover:underline" href="/admin/competitions">
                    Back to Competitions
                  </Link>
                </div>
              </div>
            ) : null}
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
              {isContextMode && !form.id ? (
                <p className="mt-1 text-sm font-semibold text-slate-600">
                  Create teams in Team Center first, then assign them to this competition.
                </p>
              ) : null}
            </div>
            {form.id ? (
              <button className="text-sm font-black text-[#9b1c1f]" onClick={resetForm} type="button">
                Cancel
              </button>
            ) : isContextMode ? (
              <button className="text-sm font-black text-[#8a6418]" onClick={contextAddTeamMessage} type="button">
                Add via Team Center
              </button>
            ) : (
              <button className="text-sm font-black text-[#8a6418]" onClick={prepareAddTeam} type="button">
                New Canonical Team
              </button>
            )}
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

            <div className="grid gap-2 text-sm font-black">
              Competition Assignment
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                {contextCompetition
                  ? competitionLabel(contextCompetition)
                  : "Managed from each Competition Workspace"}
              </div>
              <span className="text-xs font-semibold text-slate-500">
                Team details are canonical. Competition participation is stored separately.
              </span>
            </div>

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
            {relationshipWarning ? (
              <p className="rounded-md border border-[#d8ad45]/35 bg-[#fff7e6] px-3 py-2 text-sm font-bold text-[#8a6418]">
                {relationshipWarning}
              </p>
            ) : null}
            {message ? (
              <p className="rounded-md border border-emerald-700/20 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
                {message}
              </p>
            ) : null}

            <button
              className="rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/20 transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving || !canSubmit}
              type="submit"
            >
              {saving ? "Saving..." : form.id ? "Update Team" : "Add Team"}
            </button>
          </div>
        </form>

        <div className="grid min-w-0 gap-6">
        <div className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="flex flex-col gap-2 border-b border-slate-200 p-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
              <h2 className="text-2xl font-black">Team List</h2>
            </div>
            <p className="text-sm font-bold text-slate-500">
              {teams.length} {isContextMode ? "active participants" : "teams"}
            </p>
          </div>

          {isContextMode && kswTeamCount > 1 ? (
            <div className="border-b border-slate-200 bg-[#fff7e6] px-5 py-3 text-sm font-bold text-[#8a6418]">
              This competition has more than one KSW team. No data was changed automatically.
            </div>
          ) : null}

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
                    <th className="px-4 py-3">{isContextMode ? "Participant" : "Registry"}</th>
                    <th className="px-4 py-3">KSW?</th>
                    <th className="px-4 py-3">Active?</th>
                    <th className="px-4 py-3">Created At</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((team) => (
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
                        <td className="px-4 py-3">{teamParticipantDisplay(team)}</td>
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
                            {isContextMode ? (
                              <button
                                className="rounded-md border border-[#8a6418]/30 px-3 py-2 text-xs font-black text-[#8a6418] hover:bg-[#d8ad45]/10"
                                onClick={() => void removeTeam(team)}
                                type="button"
                              >
                                Remove from Competition
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {teams.length === 0 ? (
                <p className="p-5 text-sm font-bold text-slate-600">
                  {isContextMode ? "No teams linked to this competition." : "No teams found."}
                </p>
              ) : null}
            </div>
          )}
        </div>

          {isContextMode ? (
            <div className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
              <div className="flex flex-col gap-2 border-b border-slate-200 p-5 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
                  <h2 className="text-2xl font-black">Available Teams</h2>
                  <p className="mt-1 text-sm font-semibold text-slate-600">
                    Assign active canonical teams that are not active participants in this competition.
                  </p>
                </div>
                <button
                  className="inline-flex rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={saving || contextIsInvalid || selectedAssignTeamIds.length === 0}
                  onClick={() => void assignSelectedTeams()}
                  type="button"
                >
                  Assign Selected Teams
                </button>
              </div>
              <div className="grid gap-2 p-5">
                {unassignedTeams.length ? (
                  unassignedTeams.map((team) => (
                    <label
                      className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-bold"
                      key={team.id}
                    >
                      <input
                        checked={selectedAssignTeamIds.includes(team.id)}
                        className="size-4 accent-[#d8ad45]"
                        onChange={() => toggleAssignTeam(team.id)}
                        type="checkbox"
                      />
                      <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#d8ad45]/50 bg-[#061426] text-[10px] font-black text-[#f4d58a]">
                        {team.logo_url ? (
                          <img alt="" className="h-full w-full object-contain p-1" src={team.logo_url} />
                        ) : (
                          teamInitials(team)
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-black text-[#061426]">{team.name}</span>
                        <span className="block text-xs font-bold text-slate-500">
                          {team.short_name}{team.is_ksw ? " - KSW team" : ""}
                        </span>
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
                    No available teams for this competition.
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

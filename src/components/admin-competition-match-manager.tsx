"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TeamLogo } from "@/components/team-logo";
import {
  createMatch,
  deleteMatchById,
  updateMatch,
} from "@/app/admin/matches/actions";

type MatchStatus = "scheduled" | "finished";
type MatchStatusFilter = "all" | "scheduled" | "finished" | "other";

export type AdminCompetitionMatch = {
  id: string;
  match_date: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  venue: string | null;
  status: string;
};

export type AdminCompetitionMatchTeam = {
  id: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  is_ksw: boolean;
  participant_is_active?: boolean;
};

type MatchForm = {
  id: string;
  matchDate: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: string;
  awayScore: string;
  venueOption: string;
  customVenue: string;
  originalStatus: string;
  status: MatchStatus | "";
};

type CompetitionSummary = {
  id: string;
  name: string;
  season: string;
  status: string;
  type?: string;
};

const standardVenues = ["V1", "V2", "V3"];

const emptyForm: MatchForm = {
  id: "",
  matchDate: "",
  homeTeamId: "",
  awayTeamId: "",
  homeScore: "",
  awayScore: "",
  venueOption: "",
  customVenue: "",
  originalStatus: "",
  status: "scheduled",
};

function toBangkokDateInput(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).formatToParts(date);
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));

  return `${valueByType.get("year")}-${valueByType.get("month")}-${valueByType.get("day")}T${valueByType.get("hour")}:${valueByType.get("minute")}`;
}

function bangkokDateInputToIso(value: string) {
  return new Date(`${value}:00+07:00`).toISOString();
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value || "Date not set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function formatTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Time not set";
  }

  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function scoreValue(value: string) {
  return value.trim() === "" ? null : Number(value);
}

function isMatchStatus(value: string): value is MatchStatus {
  return value === "scheduled" || value === "finished";
}

function toMatchStatus(value: string): MatchStatus {
  return isMatchStatus(value) ? value : "scheduled";
}

function editableStatus(value: string): MatchStatus | "" {
  return isMatchStatus(value) ? value : "";
}

function isLegacyStatus(value: string) {
  return Boolean(value) && !isMatchStatus(value);
}

function venueFields(value: string | null) {
  if (!value) {
    return { customVenue: "", venueOption: "" };
  }

  if (standardVenues.includes(value)) {
    return { customVenue: "", venueOption: value };
  }

  return { customVenue: value, venueOption: "Other" };
}

function venueValue(form: MatchForm) {
  if (form.venueOption === "Other") {
    return form.customVenue.trim() || null;
  }

  return form.venueOption || null;
}

function teamInitials(team: AdminCompetitionMatchTeam | undefined) {
  return (team?.short_name || team?.name || "FC").slice(0, 3).toUpperCase();
}

function teamName(team: AdminCompetitionMatchTeam | undefined) {
  return team?.name || team?.short_name || "Unknown team";
}

function teamOptionLabel(team: AdminCompetitionMatchTeam) {
  return team.participant_is_active === false
    ? `${team.name} (ไม่ได้อยู่ในรายการปัจจุบัน)`
    : team.name;
}

function statusBadgeClass(status: string) {
  if (status === "scheduled") return "border-[#d8ad45]/35 bg-[#d8ad45]/10 text-[#8a6418]";
  if (status === "finished") return "border-emerald-700/20 bg-emerald-50 text-emerald-800";
  return "border-slate-200 bg-slate-100 text-slate-600";
}

function matchScore(match: AdminCompetitionMatch) {
  if (match.status !== "finished") {
    return "VS";
  }

  if (typeof match.home_score !== "number" || typeof match.away_score !== "number") {
    return "Score not set";
  }

  return `${match.home_score} - ${match.away_score}`;
}

function matchStatusGroup(status: string): MatchStatusFilter {
  if (status === "scheduled" || status === "finished") return status;
  return "other";
}

function sortGroup(match: AdminCompetitionMatch) {
  if (match.status === "scheduled") return 0;
  if (match.status === "finished") return 2;
  return 1;
}

function matchTime(match: AdminCompetitionMatch) {
  const value = match.match_date;
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function sortMatches(matches: AdminCompetitionMatch[]) {
  return [...matches].sort((a, b) => {
    const groupDiff = sortGroup(a) - sortGroup(b);
    if (groupDiff) return groupDiff;

    const timeDiff = matchTime(a) - matchTime(b);
    return a.status === "finished" ? -timeDiff : timeDiff;
  });
}

function formFromMatch(match: AdminCompetitionMatch): MatchForm {
  const venue = venueFields(match.venue);

  return {
    id: match.id,
    matchDate: toBangkokDateInput(match.match_date),
    homeTeamId: match.home_team_id,
    awayTeamId: match.away_team_id,
    homeScore: match.home_score === null ? "" : String(match.home_score),
    awayScore: match.away_score === null ? "" : String(match.away_score),
    originalStatus: match.status,
    status: editableStatus(match.status),
    ...venue,
  };
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-center">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-[#061426]">{value}</p>
    </div>
  );
}

export function AdminCompetitionMatchManager({
  competition,
  cupGroupCount = 0,
  cupGroupsReady = true,
  cupUnassignedTeamCount = 0,
  initialMatches,
  initialTeams,
}: {
  competition: CompetitionSummary;
  cupGroupCount?: number;
  cupGroupsReady?: boolean;
  cupUnassignedTeamCount?: number;
  initialMatches: AdminCompetitionMatch[];
  initialTeams: AdminCompetitionMatchTeam[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const [form, setForm] = useState<MatchForm>(emptyForm);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<MatchStatusFilter>("all");
  const matches = initialMatches;
  const teams = initialTeams;

  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const activeTeams = useMemo(
    () => teams.filter((team) => team.participant_is_active !== false),
    [teams],
  );
  const scheduledCount = matches.filter((match) => match.status === "scheduled").length;
  const finishedCount = matches.filter((match) => match.status === "finished").length;
  const otherCount = matches.length - scheduledCount - finishedCount;
  const visibleMatches = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return sortMatches(matches).filter((match) => {
      const homeTeam = teamsById.get(match.home_team_id);
      const awayTeam = teamsById.get(match.away_team_id);
      const searchableTeams = [
        homeTeam?.name,
        homeTeam?.short_name,
        awayTeam?.name,
        awayTeam?.short_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = !normalizedSearch || searchableTeams.includes(normalizedSearch);
      const matchesStatus = statusFilter === "all" || matchStatusGroup(match.status) === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [matches, searchTerm, statusFilter, teamsById]);
  const preservingLegacyStatus = form.id && isLegacyStatus(form.originalStatus) && !form.status;
  const effectiveStatus = form.status || form.originalStatus;
  const filtersActive = searchTerm.trim() || statusFilter !== "all";
  const isCup = competition.type === "cup";
  const matchCreationBlocked = isCup && cupGroupsReady && cupGroupCount === 0;
  const matchCreationUnavailable = isCup && !cupGroupsReady;
  const canSubmit =
    form.homeTeamId &&
    form.awayTeamId &&
    form.homeTeamId !== form.awayTeamId &&
    form.matchDate &&
    effectiveStatus &&
    (form.id || (!matchCreationBlocked && !matchCreationUnavailable)) &&
    (form.id ? teamsById.has(form.homeTeamId) && teamsById.has(form.awayTeamId) : activeTeams.length >= 2);

  function resetForm() {
    setForm(emptyForm);
    setMessage("");
    setError("");
  }

  function startNewMatch() {
    resetForm();
    if (matchCreationBlocked || matchCreationUnavailable) return;
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function clearFilters() {
    setSearchTerm("");
    setStatusFilter("all");
  }

  function updateScore(field: "awayScore" | "homeScore", value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
      status: value.trim() ? "finished" : current.status,
    }));
  }

  function editMatch(match: AdminCompetitionMatch) {
    setForm(formFromMatch(match));
    setMessage("");
    setError("");
    window.setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      firstFieldRef.current?.focus({ preventScroll: true });
    }, 50);
  }

  async function refreshWorkspace() {
    router.refresh();
  }

  async function saveMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    const homeScore = scoreValue(form.homeScore);
    const awayScore = scoreValue(form.awayScore);

    if (!form.homeTeamId || !form.awayTeamId) {
      setError("Home team and away team are required.");
      setSaving(false);
      return;
    }

    if (form.homeTeamId === form.awayTeamId) {
      setError("Home team and away team must be different.");
      setSaving(false);
      return;
    }

    if (form.status === "finished" && (homeScore === null || awayScore === null)) {
      setError("Finished matches require both scores.");
      setSaving(false);
      return;
    }

    if (!effectiveStatus) {
      setError("Match status is required.");
      setSaving(false);
      return;
    }

    const payload = {
      away_score: effectiveStatus === "scheduled" ? null : awayScore,
      away_team_id: form.awayTeamId,
      home_score: effectiveStatus === "scheduled" ? null : homeScore,
      home_team_id: form.homeTeamId,
      league_id: competition.id,
      match_date: bangkokDateInputToIso(form.matchDate),
      status: effectiveStatus,
      venue: venueValue(form),
    };
    const result = form.id
      ? await updateMatch(form.id, payload, competition.id)
      : await createMatch(payload, competition.id);

    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "Could not save match.");
      return;
    }

    setMessage(form.id ? "Match updated." : "Match added.");
    setForm(emptyForm);
    await refreshWorkspace();
  }

  async function deleteMatch(match: AdminCompetitionMatch) {
    const confirmed = window.confirm("Delete this match?");

    if (!confirmed) return;

    setMessage("");
    setError("");
    const result = await deleteMatchById(match.id, competition.id);

    if (!result.ok) {
      setError(result.error ?? "Could not delete match.");
      return;
    }

    setMessage("Match deleted.");
    setForm(emptyForm);
    await refreshWorkspace();
  }

  return (
    <section className="mx-auto w-full max-w-7xl scroll-mt-28 px-4 pb-10 sm:px-6 lg:px-10" id="matches-summary">
      <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10">
        <div className="mb-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#8a6418]">
              Matches Workspace
            </p>
            <h2 className="mt-2 text-2xl font-black">{competition.name}</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              {[competition.season, competition.status].filter(Boolean).join(" - ")}
            </p>
          </div>
          <button
            className="inline-flex w-fit rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] hover:bg-[#091f39]"
            disabled={matchCreationBlocked || matchCreationUnavailable}
            onClick={startNewMatch}
            type="button"
          >
            Add Match
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total" value={matches.length} />
          <StatCard label="Scheduled" value={scheduledCount} />
          <StatCard label="Finished" value={finishedCount} />
          {otherCount > 0 ? <StatCard label="Other" value={otherCount} /> : null}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <form
            className="min-w-0 scroll-mt-28 rounded-lg border border-[#d8ad45]/30 bg-slate-50 p-4"
            id="match-form"
            onSubmit={saveMatch}
            ref={formRef}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-black">{form.id ? "Edit Match" : "Add Match"}</h3>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  Teams are restricted to this competition.
                </p>
              </div>
              {form.id ? (
                <button className="text-sm font-black text-[#9b1c1f]" onClick={resetForm} type="button">
                  Cancel
                </button>
              ) : null}
            </div>

            <div className="grid gap-4">
              {matchCreationUnavailable && !form.id ? (
                <p className="rounded-md border border-[#9b1c1f]/25 bg-[#9b1c1f]/10 px-3 py-2 text-sm font-bold text-[#9b1c1f]">
                  Group data is unavailable. Apply the M13C migration before adding cup matches.
                </p>
              ) : null}
              {matchCreationBlocked && !form.id ? (
                <p className="rounded-md border border-[#d8ad45]/35 bg-[#fff7e6] px-3 py-2 text-sm font-bold text-[#8a6418]">
                  สร้างกลุ่มและจัดทีมก่อนเพิ่มการแข่งขันรอบแบ่งกลุ่ม
                </p>
              ) : null}
              {isCup && cupGroupCount > 0 && cupUnassignedTeamCount > 0 ? (
                <p className="rounded-md border border-[#d8ad45]/35 bg-[#fff7e6] px-3 py-2 text-sm font-bold text-[#8a6418]">
                  This cup still has {cupUnassignedTeamCount} unassigned team{cupUnassignedTeamCount === 1 ? "" : "s"}. You can edit existing matches, but finish group assignment before building group-stage fixtures.
                </p>
              ) : null}
              {!form.id && activeTeams.length < 2 ? (
                <p className="rounded-md border border-[#d8ad45]/35 bg-[#fff7e6] px-3 py-2 text-sm font-bold text-[#8a6418]">
                  ยังไม่มีทีมในรายการแข่งขันนี้ กรุณาเพิ่มทีมที่ Manage Teams
                </p>
              ) : null}

              <label className="grid gap-2 text-sm font-black">
                Match Date & Time
                <input
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                  onChange={(event) => setForm((current) => ({ ...current, matchDate: event.target.value }))}
                  required
                  type="datetime-local"
                  value={form.matchDate}
                />
              </label>

              <label className="grid gap-2 text-sm font-black">
                Home Team
                <select
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                  onChange={(event) => setForm((current) => ({ ...current, homeTeamId: event.target.value }))}
                  ref={firstFieldRef}
                  required
                  value={form.homeTeamId}
                >
                  <option value="">Select home team</option>
                  {teams.map((team) => (
                    <option
                      disabled={team.participant_is_active === false && team.id !== form.homeTeamId}
                      key={team.id}
                      value={team.id}
                    >
                      {teamOptionLabel(team)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm font-black">
                Away Team
                <select
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                  onChange={(event) => setForm((current) => ({ ...current, awayTeamId: event.target.value }))}
                  required
                  value={form.awayTeamId}
                >
                  <option value="">Select away team</option>
                  {teams.map((team) => (
                    <option
                      disabled={team.participant_is_active === false && team.id !== form.awayTeamId}
                      key={team.id}
                      value={team.id}
                    >
                      {teamOptionLabel(team)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-black">
                  Home Score
                  <input
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                    max="999"
                    min="0"
                    onChange={(event) => updateScore("homeScore", event.target.value)}
                    required={form.status === "finished"}
                    step="1"
                    type="number"
                    value={form.homeScore}
                  />
                </label>
                <label className="grid gap-2 text-sm font-black">
                  Away Score
                  <input
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                    max="999"
                    min="0"
                    onChange={(event) => updateScore("awayScore", event.target.value)}
                    required={form.status === "finished"}
                    step="1"
                    type="number"
                    value={form.awayScore}
                  />
                </label>
              </div>
              <p className="-mt-2 text-xs font-bold text-slate-500">
                Entering a score will mark this match as finished.
              </p>

              <label className="grid gap-2 text-sm font-black">
                Venue
                <select
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      customVenue: event.target.value === "Other" ? current.customVenue : "",
                      venueOption: event.target.value,
                    }))
                  }
                  value={form.venueOption}
                >
                  <option value="">Select venue</option>
                  {standardVenues.map((venue) => (
                    <option key={venue} value={venue}>
                      {venue}
                    </option>
                  ))}
                  <option value="Other">Other</option>
                </select>
              </label>

              {form.venueOption === "Other" ? (
                <label className="grid gap-2 text-sm font-black">
                  Custom Venue
                  <input
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                    onChange={(event) => setForm((current) => ({ ...current, customVenue: event.target.value }))}
                    placeholder="Enter venue"
                    value={form.customVenue}
                  />
                </label>
              ) : null}

              <label className="grid gap-2 text-sm font-black">
                Status
                <select
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                  onChange={(event) => {
                    const status = event.target.value === "" ? "" : toMatchStatus(event.target.value);
                    setForm((current) => ({
                      ...current,
                      awayScore: status === "scheduled" ? "" : current.awayScore,
                      homeScore: status === "scheduled" ? "" : current.homeScore,
                      status,
                    }));
                  }}
                  value={form.status}
                >
                  {form.id && isLegacyStatus(form.originalStatus) ? (
                    <option value="">Keep current status: {form.originalStatus}</option>
                  ) : null}
                  <option value="scheduled">scheduled</option>
                  <option value="finished">finished</option>
                </select>
              </label>

              {preservingLegacyStatus ? (
                <p className="rounded-md border border-[#d8ad45]/35 bg-[#fff7e6] px-3 py-2 text-sm font-bold text-[#8a6418]">
                  This match uses legacy status &quot;{form.originalStatus}&quot;. Saving now will keep that status unless you
                  choose scheduled or finished.
                </p>
              ) : null}

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
                disabled={saving || !canSubmit}
                type="submit"
              >
                {saving ? "Saving..." : form.id ? "Update Match" : "Add Match"}
              </button>
            </div>
          </form>

          <div className="min-w-0 rounded-lg border border-slate-200 bg-white">
            <div className="flex flex-col gap-2 border-b border-slate-200 p-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-xl font-black">Match List</h3>
                <p className="mt-1 text-sm font-semibold text-slate-600">
                  Showing {visibleMatches.length} of {matches.length} linked matches
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="min-h-11 rounded-md border border-[#d8ad45]/45 px-3 py-2 text-xs font-black text-[#061426] hover:bg-[#fff4dc]"
                  disabled={matchCreationBlocked || matchCreationUnavailable}
                  onClick={startNewMatch}
                  type="button"
                >
                  Add Match
                </button>
                <button
                  className="min-h-11 rounded-md border border-slate-200 px-3 py-2 text-xs font-black text-[#061426] hover:border-[#d8ad45]"
                  onClick={() => setStatusFilter("scheduled")}
                  type="button"
                >
                  Upcoming
                </button>
                <button
                  className="min-h-11 rounded-md border border-slate-200 px-3 py-2 text-xs font-black text-[#061426] hover:border-[#d8ad45]"
                  onClick={() => setStatusFilter("finished")}
                  type="button"
                >
                  Finished
                </button>
              </div>
            </div>

            <div className="grid gap-3 border-b border-slate-100 p-4 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
              <label className="grid gap-2 text-sm font-black">
                Search matches
                <input
                  className="min-h-11 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search home or away team"
                  type="search"
                  value={searchTerm}
                />
              </label>
              <label className="grid gap-2 text-sm font-black">
                Status
                <select
                  className="min-h-11 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                  onChange={(event) => setStatusFilter(event.target.value as MatchStatusFilter)}
                  value={statusFilter}
                >
                  <option value="all">All</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="finished">Finished</option>
                  {otherCount > 0 ? <option value="other">Other</option> : null}
                </select>
              </label>
              <button
                className="min-h-11 rounded-md border border-slate-200 px-3 py-2 text-sm font-black text-[#061426] hover:border-[#d8ad45] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!filtersActive}
                onClick={clearFilters}
                type="button"
              >
                Clear filters
              </button>
            </div>

            <div className="grid gap-3 p-4">
              {visibleMatches.length ? (
                visibleMatches.map((match) => {
                  const homeTeam = teamsById.get(match.home_team_id);
                  const awayTeam = teamsById.get(match.away_team_id);

                  return (
                    <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3" key={match.id}>
                      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                        <div className="flex min-w-0 items-center gap-3">
                          <TeamLogo
                            className="!size-10 shrink-0 bg-[#061426]"
                            initials={teamInitials(homeTeam)}
                            logoUrl={homeTeam?.logo_url ?? ""}
                            teamName={teamName(homeTeam)}
                          />
                          <p className="min-w-0 break-words text-sm font-black text-[#061426]">{teamName(homeTeam)}</p>
                        </div>
                        <div className="flex items-center justify-center">
                          <span className="min-w-16 rounded-md border border-[#d8ad45]/35 bg-white px-3 py-2 text-center text-sm font-black text-[#8a6418] shadow-sm">
                            {matchScore(match)}
                          </span>
                        </div>
                        <div className="flex min-w-0 items-center gap-3 sm:justify-end">
                          <TeamLogo
                            className="!size-10 shrink-0 bg-[#061426]"
                            initials={teamInitials(awayTeam)}
                            logoUrl={awayTeam?.logo_url ?? ""}
                            teamName={teamName(awayTeam)}
                          />
                          <p className="min-w-0 break-words text-sm font-black text-[#061426] sm:text-right">
                            {teamName(awayTeam)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                        <span>{formatDate(match.match_date)} · {formatTime(match.match_date)}</span>
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${statusBadgeClass(match.status)}`}>
                          {match.status || "other"}
                        </span>
                        {match.venue ? <span>Venue: {match.venue}</span> : null}
                      </div>
                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <button
                          className="rounded-md border border-slate-200 px-3 py-2 text-xs font-black text-[#061426] hover:border-[#d8ad45]"
                          onClick={() => editMatch(match)}
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="rounded-md border border-[#9b1c1f]/30 px-3 py-2 text-xs font-black text-[#9b1c1f] hover:bg-[#9b1c1f]/10"
                          onClick={() => void deleteMatch(match)}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
                  {matches.length
                    ? "No matches match your search or filter."
                    : "No matches yet. Use Add Match to create the first fixture."}
                </p>
              )}
            </div>
          </div>
        </div>
      </article>
    </section>
  );
}

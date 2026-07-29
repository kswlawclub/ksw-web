"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createMatch,
  deleteMatchById,
  loadAdminMatchesData,
  loadCompetitionMatchTeams,
  updateMatch,
} from "./actions";

type MatchStatus = "scheduled" | "finished";

type Team = {
  id: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  is_ksw: boolean;
  participant_is_active?: boolean;
};

type League = {
  id: string;
  name: string;
  season: string | null;
  competition_type: string | null;
  season_status: string | null;
  slug: string | null;
  is_published: boolean | null;
};

type Match = {
  id: string;
  league_id: string;
  match_date: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  venue: string | null;
  status: string;
};

type MatchForm = {
  id: string;
  leagueId: string;
  matchDate: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: string;
  awayScore: string;
  venueOption: string;
  customVenue: string;
  status: MatchStatus;
};

const emptyForm: MatchForm = {
  id: "",
  leagueId: "",
  matchDate: "",
  homeTeamId: "",
  awayTeamId: "",
  homeScore: "",
  awayScore: "",
  venueOption: "",
  customVenue: "",
  status: "scheduled",
};

const standardVenues = ["V1", "V2", "V3"];

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

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
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

function venueFields(value: string | null) {
  if (!value) {
    return {
      venueOption: "",
      customVenue: "",
    };
  }

  if (standardVenues.includes(value)) {
    return {
      venueOption: value,
      customVenue: "",
    };
  }

  return {
    venueOption: "Other",
    customVenue: value,
  };
}

function venueValue(form: MatchForm) {
  if (form.venueOption === "Other") {
    return form.customVenue.trim() || null;
  }

  return form.venueOption || null;
}

function readCompetitionParam() {
  if (typeof window === "undefined") {
    return "";
  }

  return new URLSearchParams(window.location.search).get("competition")?.trim() ?? "";
}

function competitionLabel(league: League | undefined) {
  if (!league) {
    return "Unknown competition";
  }

  return [league.name, league.season, league.competition_type].filter(Boolean).join(" - ");
}

function formForCompetition(competitionId: string) {
  return {
    ...emptyForm,
    leagueId: competitionId,
  };
}

function teamOptionLabel(team: Team) {
  return team.participant_is_active === false
    ? `${team.name} (ไม่ได้อยู่ในรายการปัจจุบัน)`
    : team.name;
}

export default function AdminMatchesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchListTeams, setMatchListTeams] = useState<Team[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [form, setForm] = useState<MatchForm>(emptyForm);
  const [contextCompetitionId, setContextCompetitionId] = useState<string | null>(null);
  const [relationshipWarning, setRelationshipWarning] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  const teamsById = useMemo(
    () => new Map(teams.map((team) => [team.id, team])),
    [teams],
  );
  const matchListTeamsById = useMemo(
    () => new Map(matchListTeams.map((team) => [team.id, team])),
    [matchListTeams],
  );
  const leaguesById = useMemo(
    () => new Map(leagues.map((league) => [league.id, league])),
    [leagues],
  );
  const isContextMode = Boolean(contextCompetitionId);
  const contextCompetition = contextCompetitionId ? leaguesById.get(contextCompetitionId) : undefined;
  const contextIsInvalid = Boolean(contextCompetitionId && !contextCompetition && !loading);
  const selectedCompetitionId = isContextMode ? contextCompetitionId ?? "" : form.leagueId;
  const formTeamsBelongToSelectedCompetition = Boolean(
    selectedCompetitionId &&
      form.homeTeamId &&
      form.awayTeamId &&
      teamsById.has(form.homeTeamId) &&
      teamsById.has(form.awayTeamId),
  );
  const filteredTeams = useMemo(
    () => (selectedCompetitionId ? teams : []),
    [selectedCompetitionId, teams],
  );
  const activeSelectableTeams = useMemo(
    () => filteredTeams.filter((team) => team.participant_is_active !== false),
    [filteredTeams],
  );
  const relationshipIssueCount = matches.filter((match) => {
    if (!selectedCompetitionId || match.league_id !== selectedCompetitionId) {
      return false;
    }

    const homeTeam = teamsById.get(match.home_team_id);
    const awayTeam = teamsById.get(match.away_team_id);
    return !homeTeam || !awayTeam;
  }).length;
  const unknownStatusCount = matches.filter((match) => !isMatchStatus(match.status)).length;
  const canSubmit =
    !contextIsInvalid &&
    (form.id
      ? formTeamsBelongToSelectedCompetition
      : Boolean(selectedCompetitionId && activeSelectableTeams.length >= 2));

  async function loadData(competitionId: string, isCancelled = () => false) {
    setLoading(true);
    setError("");
    setMessage("");
    setRelationshipWarning("");
    setForm(formForCompetition(competitionId));

    const result = await loadAdminMatchesData(competitionId);

    if (isCancelled()) return;

    if (!result.ok) {
      setMatches([]);
      setMatchListTeams([]);
      setTeams([]);
      setLeagues([]);
      setError(result.error ?? "Could not load matches.");
      setLoading(false);
      return;
    }

    const loadedLeagues = result.leagues ?? [];
    const validContext = competitionId ? loadedLeagues.some((league) => league.id === competitionId) : true;
    const defaultLeagueId = competitionId || loadedLeagues[0]?.id || "";

    setMatches(result.matches ?? []);
    setMatchListTeams(result.matchTeams ?? result.teams ?? []);
    setLeagues(loadedLeagues);
    setTeams(result.teams ?? []);

    if (competitionId && !validContext) {
      setError("Competition context was not found. Return to Competitions and choose a valid record.");
    }

    setForm(validContext ? formForCompetition(defaultLeagueId) : emptyForm);
    setLoading(false);

    if (!competitionId && defaultLeagueId) {
      await loadTeamsForCompetition(defaultLeagueId, isCancelled);
    }
  }

  async function loadTeamsForCompetition(competitionId: string, isCancelled = () => false) {
    if (!competitionId) {
      setTeams([]);
      return;
    }

    const result = await loadCompetitionMatchTeams(competitionId);

    if (isCancelled()) return;

    if (!result.ok) {
      setTeams([]);
      setError(result.error ?? "Could not load teams for the selected competition.");
      return;
    }

    setTeams(result.teams ?? []);
  }

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

  function resetForm() {
    setForm(formForCompetition(contextCompetitionId ?? ""));
    setMessage("");
    setError("");
    setRelationshipWarning("");
  }

  function changeCompetition(leagueId: string) {
    setForm((current) => ({
      ...current,
      leagueId,
      homeTeamId: "",
      awayTeamId: "",
    }));
    setRelationshipWarning("");
    setError("");
    void loadTeamsForCompetition(leagueId);
  }

  function scrollToEditForm() {
    window.setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      firstFieldRef.current?.focus({ preventScroll: true });
    }, 50);
  }

  async function editMatch(match: Match) {
    if (contextCompetitionId && match.league_id !== contextCompetitionId) {
      setError("This match does not belong to the selected competition context.");
      setMessage("");
      setForm(formForCompetition(contextCompetitionId));
      return;
    }

    let matchTeams = teams;

    if (
      selectedCompetitionId !== match.league_id ||
      !teamsById.has(match.home_team_id) ||
      !teamsById.has(match.away_team_id)
    ) {
      const result = await loadCompetitionMatchTeams(match.league_id, [
        match.home_team_id,
        match.away_team_id,
      ]);

      if (!result.ok) {
        setError(result.error ?? "Could not load teams for this match.");
        setMessage("");
        return;
      }

      matchTeams = result.teams ?? [];
      setTeams(matchTeams);
    }

    const venue = venueFields(match.venue);
    const nextTeamsById = new Map(matchTeams.map((team) => [team.id, team]));
    const homeTeam = nextTeamsById.get(match.home_team_id);
    const awayTeam = nextTeamsById.get(match.away_team_id);
    const invalidRelationship =
      !homeTeam ||
      !awayTeam ||
      homeTeam.participant_is_active === false ||
      awayTeam.participant_is_active === false;
    const legacyStatusWarning = !isMatchStatus(match.status)
      ? "This match has a legacy or unknown status. Saving will require choosing scheduled or finished."
      : "";

    setForm({
      id: match.id,
      leagueId: match.league_id,
      matchDate: toBangkokDateInput(match.match_date),
      homeTeamId: match.home_team_id,
      awayTeamId: match.away_team_id,
      homeScore: match.home_score === null ? "" : String(match.home_score),
      awayScore: match.away_score === null ? "" : String(match.away_score),
      venueOption: venue.venueOption,
      customVenue: venue.customVenue,
      status: toMatchStatus(match.status),
    });
    setMessage("");
    setError("");
    setRelationshipWarning(
      [
        invalidRelationship
          ? "This match references a team outside its competition. Review the team relationship before saving."
          : "",
        legacyStatusWarning,
      ]
        .filter(Boolean)
        .join(" "),
    );
    scrollToEditForm();
  }

  async function saveMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const homeScore = scoreValue(form.homeScore);
    const awayScore = scoreValue(form.awayScore);

    setSaving(true);
    setMessage("");
    setError("");

    const payloadLeagueId = contextCompetitionId || form.leagueId;

    if (contextCompetitionId && contextIsInvalid) {
      setError("Competition context was not found. This match cannot be saved.");
      setSaving(false);
      return;
    }

    if (!payloadLeagueId) {
      setError("Competition is required.");
      setSaving(false);
      return;
    }

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

    const homeTeam = teamsById.get(form.homeTeamId);
    const awayTeam = teamsById.get(form.awayTeamId);

    if (!homeTeam || !awayTeam) {
      setError("ทีมที่เลือกไม่ได้อยู่ในรายการแข่งขันนี้ กรุณาเลือกทีมใหม่");
      setSaving(false);
      return;
    }

    if (form.status === "finished" && (homeScore === null || awayScore === null)) {
      setError("Finished matches require both scores.");
      setSaving(false);
      return;
    }

    const payload = {
      league_id: payloadLeagueId,
      match_date: bangkokDateInputToIso(form.matchDate),
      home_team_id: form.homeTeamId,
      away_team_id: form.awayTeamId,
      home_score: homeScore,
      away_score: awayScore,
      venue: venueValue(form),
      status: form.status,
    };

    const result = form.id
      ? await updateMatch(form.id, payload, contextCompetitionId || undefined)
      : await createMatch(payload);

    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "Could not save match.");
      return;
    }

    setMessage(form.id ? "Match updated." : "Match added.");
    setForm(formForCompetition(contextCompetitionId ?? ""));
    await loadData(contextCompetitionId ?? "");
  }

  async function deleteMatch(match: Match) {
    if (contextCompetitionId && match.league_id !== contextCompetitionId) {
      setError("This match does not belong to the selected competition context.");
      return;
    }

    const confirmed = window.confirm("Delete this match?");

    if (!confirmed) {
      return;
    }

    const result = await deleteMatchById(match.id, contextCompetitionId || undefined);

    if (!result.ok) {
      setError(result.error ?? "Could not delete match.");
      return;
    }

    setMessage("Match deleted.");
    setForm(formForCompetition(contextCompetitionId ?? ""));
    await loadData(contextCompetitionId ?? "");
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
            <h1 className="mt-3 text-4xl font-black tracking-tight">Manage Matches</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
              Add, edit, and remove match fixtures and results.
            </p>
            {contextCompetition ? (
              <div className="mt-5 rounded-lg border border-[#d8ad45]/35 bg-white/[0.08] p-4">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-[#d8ad45]">
                  Managing Matches For
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
          onSubmit={saveMatch}
          ref={formRef}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
              <h2 className="text-2xl font-black">{form.id ? "Edit Match" : "Add Match"}</h2>
            </div>
            {form.id ? (
              <button className="text-sm font-black text-[#9b1c1f]" onClick={resetForm} type="button">
                Cancel
              </button>
            ) : null}
          </div>

          <div className="grid gap-4">
            {isContextMode || form.id ? (
              <div className="grid gap-2 text-sm font-black">
                Competition
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                  {contextCompetition
                    ? competitionLabel(contextCompetition)
                    : form.id
                      ? competitionLabel(leaguesById.get(form.leagueId))
                      : "Invalid competition context"}
                </div>
              </div>
            ) : (
              <label className="grid gap-2 text-sm font-black">
                Competition
                <select
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                  onChange={(event) => changeCompetition(event.target.value)}
                  ref={firstFieldRef}
                  required
                  value={form.leagueId}
                >
                  <option value="">Select competition</option>
                  {leagues.map((league) => (
                    <option key={league.id} value={league.id}>
                      {competitionLabel(league)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {!form.id && selectedCompetitionId && activeSelectableTeams.length < 2 ? (
              <div className="rounded-md border border-[#d8ad45]/35 bg-[#fff7e6] px-3 py-2 text-sm font-bold text-[#8a6418]">
                ยังไม่มีทีมในรายการแข่งขันนี้ กรุณาเพิ่มทีมที่ Manage Teams
                <div className="mt-2">
                  <Link
                    className="text-[#061426] underline-offset-4 hover:underline"
                    href={`/admin/teams?competition=${encodeURIComponent(selectedCompetitionId)}`}
                  >
                    Manage Teams for this Competition
                  </Link>
                </div>
              </div>
            ) : null}

            <label className="grid gap-2 text-sm font-black">
              Match Date & Time
              <input
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) => setForm((current) => ({ ...current, matchDate: event.target.value }))}
                required
                type="datetime-local"
                value={form.matchDate}
              />
            </label>

            <label className="grid gap-2 text-sm font-black">
              Home Team
              <select
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                disabled={!selectedCompetitionId}
                onChange={(event) => setForm((current) => ({ ...current, homeTeamId: event.target.value }))}
                required
                value={form.homeTeamId}
              >
                <option value="">{selectedCompetitionId ? "Select home team" : "Select competition first"}</option>
                {filteredTeams.map((team) => (
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
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                disabled={!selectedCompetitionId}
                onChange={(event) => setForm((current) => ({ ...current, awayTeamId: event.target.value }))}
                required
                value={form.awayTeamId}
              >
                <option value="">{selectedCompetitionId ? "Select away team" : "Select competition first"}</option>
                {filteredTeams.map((team) => (
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
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                  min="0"
                  onChange={(event) => setForm((current) => ({ ...current, homeScore: event.target.value }))}
                  required={form.status === "finished"}
                  type="number"
                  value={form.homeScore}
                />
              </label>
              <label className="grid gap-2 text-sm font-black">
                Away Score
                <input
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                  min="0"
                  onChange={(event) => setForm((current) => ({ ...current, awayScore: event.target.value }))}
                  required={form.status === "finished"}
                  type="number"
                  value={form.awayScore}
                />
              </label>
            </div>

            <label className="grid gap-2 text-sm font-black">
              Venue
              <select
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    venueOption: event.target.value,
                    customVenue: event.target.value === "Other" ? current.customVenue : "",
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
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, customVenue: event.target.value }))
                  }
                  placeholder="Enter venue"
                  value={form.customVenue}
                />
              </label>
            ) : null}

            <label className="grid gap-2 text-sm font-black">
              Status
              <select
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: toMatchStatus(event.target.value),
                  }))
                }
                value={form.status}
              >
                <option value="scheduled">scheduled</option>
                <option value="finished">finished</option>
              </select>
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
              {saving ? "Saving..." : form.id ? "Update Match" : "Add Match"}
            </button>
          </div>
        </form>

        <div className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="flex flex-col gap-2 border-b border-slate-200 p-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
              <h2 className="text-2xl font-black">Match List</h2>
            </div>
            <p className="text-sm font-bold text-slate-500">
              {matches.length} {isContextMode ? "linked matches" : "matches"}
            </p>
          </div>

          {relationshipIssueCount || unknownStatusCount ? (
            <div className="border-b border-slate-200 bg-[#fff7e6] px-5 py-3 text-sm font-bold text-[#8a6418]">
              {relationshipIssueCount ? (
                <p>{relationshipIssueCount} match record references a team outside its competition.</p>
              ) : null}
              {unknownStatusCount ? (
                <p>{unknownStatusCount} match record uses a status outside scheduled/finished.</p>
              ) : null}
              <p className="mt-1 text-xs font-semibold">No data was changed automatically.</p>
            </div>
          ) : null}

          {loading ? (
            <p className="p-5 text-sm font-bold text-slate-600">Loading matches...</p>
          ) : (
            <div className="w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-[880px] border-collapse text-left text-sm">
                <thead className="bg-[#061426] text-xs uppercase tracking-[0.14em] text-[#f4d58a]">
                  <tr>
                    <th className="px-4 py-3">Competition</th>
                    <th className="px-4 py-3">Match Date</th>
                    <th className="px-4 py-3">Home Team</th>
                    <th className="px-4 py-3">Away Team</th>
                    <th className="px-4 py-3 text-center">Home Score</th>
                    <th className="px-4 py-3 text-center">Away Score</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((match) => {
                    const homeTeam = matchListTeamsById.get(match.home_team_id);
                    const awayTeam = matchListTeamsById.get(match.away_team_id);
                    const league = leaguesById.get(match.league_id);

                    return (
                      <tr className="border-b border-slate-100 last:border-b-0 hover:bg-[#f8f3e7]" key={match.id}>
                        <td className="px-4 py-3">
                          <div className="font-black">{league?.name ?? "Unknown competition"}</div>
                          <div className="mt-1 text-xs font-bold text-slate-500">
                            {[league?.season, league?.competition_type].filter(Boolean).join(" - ")}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-bold">{formatDateTime(match.match_date)}</div>
                          {match.venue ? (
                            <div className="mt-1 text-xs font-bold text-slate-500">
                              Venue: {match.venue}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">{homeTeam?.name ?? "Unknown team"}</td>
                        <td className="px-4 py-3">{awayTeam?.name ?? "Unknown team"}</td>
                        <td className="px-4 py-3 text-center font-black">{match.home_score ?? "-"}</td>
                        <td className="px-4 py-3 text-center font-black">{match.away_score ?? "-"}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full border border-[#d8ad45]/40 bg-[#d8ad45]/10 px-3 py-1 text-xs font-black text-[#061426]">
                            {match.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              className="rounded-md border border-slate-200 px-3 py-2 text-xs font-black text-[#061426] hover:border-[#d8ad45]"
                              onClick={() => void editMatch(match)}
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
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {matches.length === 0 ? (
                <p className="p-5 text-sm font-bold text-slate-600">
                  {isContextMode ? "No matches linked to this competition." : "No matches found."}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

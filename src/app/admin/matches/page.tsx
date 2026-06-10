"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { createMatch, deleteMatchById, updateMatch } from "./actions";

const storageKey = "ksw-admin-authenticated";

type MatchStatus = "scheduled" | "finished";

type Team = {
  id: string;
  name: string;
  short_name: string | null;
  league_id: string | null;
};

type League = {
  id: string;
  name: string;
  season: string | null;
  competition_type: string | null;
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
  status: MatchStatus;
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

export default function AdminMatchesPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [form, setForm] = useState<MatchForm>(emptyForm);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const teamsById = useMemo(
    () => new Map(teams.map((team) => [team.id, team])),
    [teams],
  );
  const leaguesById = useMemo(
    () => new Map(leagues.map((league) => [league.id, league])),
    [leagues],
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

  async function loadData() {
    const supabase = getSupabase();

    setLoading(true);
    setError("");

    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const [matchesResult, teamsResult, leaguesResult] = await Promise.all([
      supabase
        .from("matches")
        .select("id, league_id, match_date, home_team_id, away_team_id, home_score, away_score, venue, status")
        .order("match_date", { ascending: false }),
      supabase.from("teams").select("id, name, short_name, league_id").order("name"),
      supabase
        .from("leagues")
        .select("id, name, season, competition_type")
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
    ]);

    if (matchesResult.error) {
      console.error("admin matches query failed", matchesResult.error.message);
      setError("Could not load matches. Confirm the matches table exists and is readable.");
    } else {
      setMatches(
        ((matchesResult.data ?? []) as Match[]).map((match) => ({
          ...match,
          status: toMatchStatus(match.status),
        })),
      );
    }

    if (teamsResult.error) {
      console.error("admin teams query failed", teamsResult.error.message);
      setError("Could not load teams for the match form.");
    } else {
      setTeams((teamsResult.data ?? []) as Team[]);
    }

    if (leaguesResult.error) {
      console.error("admin leagues query failed", leaguesResult.error.message);
    } else {
      const activeLeagues = (leaguesResult.data ?? []) as League[];
      setLeagues(activeLeagues);
      setForm((current) =>
        current.leagueId || !activeLeagues[0]
          ? current
          : { ...current, leagueId: activeLeagues[0].id },
      );
    }

    setLoading(false);
  }

  function resetForm() {
    setForm(emptyForm);
    setMessage("");
    setError("");
  }

  function editMatch(match: Match) {
    const venue = venueFields(match.venue);

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
      status: match.status,
    });
    setMessage("");
    setError("");
  }

  async function saveMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const homeScore = scoreValue(form.homeScore);
    const awayScore = scoreValue(form.awayScore);

    setSaving(true);
    setMessage("");
    setError("");

    if (!form.leagueId) {
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

    if (form.status === "finished" && (homeScore === null || awayScore === null)) {
      setError("Finished matches require both scores.");
      setSaving(false);
      return;
    }

    const payload = {
      league_id: form.leagueId,
      match_date: bangkokDateInputToIso(form.matchDate),
      home_team_id: form.homeTeamId,
      away_team_id: form.awayTeamId,
      home_score: homeScore,
      away_score: awayScore,
      venue: venueValue(form),
      status: form.status,
    };

    const result = form.id
      ? await updateMatch(form.id, payload)
      : await createMatch(payload);

    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "Could not save match.");
      return;
    }

    setMessage(form.id ? "Match updated." : "Match added.");
    setForm(emptyForm);
    await loadData();
  }

  async function deleteMatch(match: Match) {
    const confirmed = window.confirm("Delete this match?");

    if (!confirmed) {
      return;
    }

    const result = await deleteMatchById(match.id);

    if (!result.ok) {
      setError(result.error ?? "Could not delete match.");
      return;
    }

    setMessage("Match deleted.");
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
            <h1 className="mt-3 text-4xl font-black tracking-tight">Manage Matches</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
              Add, edit, and remove match fixtures and results.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[380px_1fr] lg:px-10">
        <form
          className="rounded-lg border border-[#d8ad45]/30 bg-white p-5 shadow-xl shadow-slate-900/10"
          onSubmit={saveMatch}
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
            <label className="grid gap-2 text-sm font-black">
              Competition
              <select
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) => setForm((current) => ({ ...current, leagueId: event.target.value }))}
                required
                value={form.leagueId}
              >
                <option value="">Select competition</option>
                {leagues.map((league) => (
                  <option key={league.id} value={league.id}>
                    {[league.name, league.season, league.competition_type]
                      .filter(Boolean)
                      .join(" - ")}
                  </option>
                ))}
              </select>
            </label>

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
                onChange={(event) => setForm((current) => ({ ...current, homeTeamId: event.target.value }))}
                required
                value={form.homeTeamId}
              >
                <option value="">Select home team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2 text-sm font-black">
              Away Team
              <select
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) => setForm((current) => ({ ...current, awayTeamId: event.target.value }))}
                required
                value={form.awayTeamId}
              >
                <option value="">Select away team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3">
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
              {saving ? "Saving..." : form.id ? "Update Match" : "Add Match"}
            </button>
          </div>
        </form>

        <div className="rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="flex flex-col gap-2 border-b border-slate-200 p-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
              <h2 className="text-2xl font-black">Match List</h2>
            </div>
            <p className="text-sm font-bold text-slate-500">{matches.length} matches</p>
          </div>

          {loading ? (
            <p className="p-5 text-sm font-bold text-slate-600">Loading matches...</p>
          ) : (
            <div className="overflow-x-auto">
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
                    const homeTeam = teamsById.get(match.home_team_id);
                    const awayTeam = teamsById.get(match.away_team_id);
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
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {matches.length === 0 ? (
                <p className="p-5 text-sm font-bold text-slate-600">No matches found.</p>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

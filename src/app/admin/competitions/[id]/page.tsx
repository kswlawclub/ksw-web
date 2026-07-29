import Link from "next/link";
import { notFound } from "next/navigation";
import { TeamLogo } from "@/components/team-logo";
import { loadCompetitionParticipants } from "@/lib/competition-participants";
import { getSupabase } from "@/lib/supabase";

type Row = Record<string, unknown>;

const competitionColumns =
  "id, name, season, slug, short_description, description, cover_image_url, edition_number, start_date, end_date, location, display_order, competition_type, season_status, is_active, is_featured, is_published, created_at";
const matchColumns =
  "id, match_date, home_team_id, away_team_id, home_score, away_score, venue, status";

function text(row: Row | undefined, keys: string[], fallback = "") {
  if (!row) return fallback;

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }

  return fallback;
}

function number(row: Row | undefined, keys: string[]) {
  if (!row) return 0;

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }

  return 0;
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "Not set";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function formatDateTime(value: unknown) {
  if (typeof value !== "string" || !value) return "Not set";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "short",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).format(date);
}

function matchTime(match: Row) {
  const value = text(match, ["match_date"], "");
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function statusLabel(value: string) {
  return value ? value : "Not set";
}

function booleanLabel(value: unknown) {
  return value === true ? "Yes" : "No";
}

function teamInitials(team: Row) {
  return text(team, ["short_name", "name"], "FC").slice(0, 3).toUpperCase();
}

function teamById(teams: Row[]) {
  return new Map(teams.map((team) => [text(team, ["id"], ""), team]));
}

function teamName(team: Row | undefined) {
  return text(team, ["name", "short_name"], "Unknown team");
}

function scoreText(match: Row) {
  const homeScore = match.home_score;
  const awayScore = match.away_score;

  if (typeof homeScore !== "number" || typeof awayScore !== "number") {
    return "Score not set";
  }

  return `${homeScore} - ${awayScore}`;
}

async function runQuery<T>(
  source: string,
  query: PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  try {
    const result = await query;
    if (result.error) console.error("admin competition workspace query failed", source, result.error);
    return result.data ?? [];
  } catch (error) {
    console.error("admin competition workspace query failed", source, error);
    return [];
  }
}

async function loadWorkspaceData(id: string) {
  const supabase = getSupabase();

  if (!supabase) {
    return {
      competition: undefined,
      matches: [] as Row[],
      teams: [] as Row[],
    };
  }

  const competitionRows = await runQuery(
    "workspace_competition",
    supabase.from("leagues").select(competitionColumns).eq("id", id).limit(1),
  );
  const competition = competitionRows[0];

  if (!competition) {
    return {
      competition: undefined,
      matches: [] as Row[],
      teams: [] as Row[],
    };
  }

  const [teams, matches] = await Promise.all([
    loadCompetitionParticipants(supabase, id, { includeInactiveParticipants: false }),
    runQuery(
      "workspace_matches",
      supabase.from("matches").select(matchColumns).eq("league_id", id).order("match_date", { ascending: true }),
    ),
  ]);

  return { competition, matches, teams };
}

function DetailCard({ items, title }: { items: Array<[string, string]>; title: string }) {
  return (
    <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10">
      <div className="mb-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
      <h2 className="text-xl font-black text-[#061426]">{title}</h2>
      <dl className="mt-4 grid gap-3">
        {items.map(([label, value]) => (
          <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2" key={label}>
            <dt className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</dt>
            <dd className="mt-1 break-words text-sm font-black text-[#061426]">{value || "Not set"}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-center">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-[#061426]">{value}</p>
    </div>
  );
}

export default async function AdminCompetitionWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { competition, matches, teams } = await loadWorkspaceData(id);

  if (!competition) {
    notFound();
  }

  const competitionName = text(competition, ["name"], "Competition");
  const season = text(competition, ["season"], "");
  const competitionType = text(competition, ["competition_type"], "Not set");
  const seasonStatus = text(competition, ["season_status"], "Not set");
  const slug = text(competition, ["slug"], "");
  const coverImageUrl = text(competition, ["cover_image_url"], "");
  const shortDescription = text(competition, ["short_description"], "");
  const isPublished = competition.is_published === true;
  const isFeatured = competition.is_featured === true;
  const isActive = competition.is_active === true;
  const displayOrder = number(competition, ["display_order"]);
  const teamsById = teamById(teams);
  const kswTeamCount = teams.filter((team) => team.is_ksw === true).length;
  const scheduledMatches = matches.filter((match) => text(match, ["status"], "") === "scheduled");
  const finishedMatches = matches.filter((match) => text(match, ["status"], "") === "finished");
  const unknownStatusMatches = matches.length - scheduledMatches.length - finishedMatches.length;
  const nextMatch = [...scheduledMatches].sort((a, b) => matchTime(a) - matchTime(b))[0];
  const latestResult = [...finishedMatches].sort((a, b) => matchTime(b) - matchTime(a))[0];
  const hasLinkedData = teams.length > 0 || matches.length > 0;
  const statusAndActiveMisaligned =
    (seasonStatus === "completed" && isActive) || (seasonStatus === "active" && !isActive);

  const detailItems: Array<[string, string]> = [
    ["Type", statusLabel(competitionType)],
    ["Status", statusLabel(seasonStatus)],
    ["Season", season || "Not set"],
    ["Edition", text(competition, ["edition_number"], "Not set")],
    ["Start date", formatDate(competition.start_date)],
    ["End date", formatDate(competition.end_date)],
    ["Location", text(competition, ["location"], "Not set")],
  ];
  const publishingItems: Array<[string, string]> = [
    ["Published", booleanLabel(isPublished)],
    ["Featured", booleanLabel(isFeatured)],
    ["Display order", String(displayOrder)],
    ["Active flag", booleanLabel(isActive)],
  ];
  const contentItems: Array<[string, string]> = [
    ["Cover image", coverImageUrl ? "Available" : "Not set"],
    ["Short description", shortDescription ? "Available" : "Not set"],
    ["Full description", text(competition, ["description"], "") ? "Available" : "Not set"],
    ["Public slug", slug || "Not set"],
  ];

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f6f2ea] text-[#061426]">
      <section className="bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.16),transparent_34%),linear-gradient(135deg,#061426,#091f39)] px-4 py-12 text-white sm:px-6 lg:px-10">
        <div className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
          <div className="min-w-0">
            <Link className="text-sm font-bold text-[#f4d58a] hover:text-white" href="/admin/competitions">
              Back to Competitions
            </Link>
            <p className="mt-6 text-xs font-black uppercase tracking-[0.24em] text-[#d8ad45]">
              Competition Workspace
            </p>
            <h1 className="mt-3 break-words text-4xl font-black tracking-tight">{competitionName}</h1>
            <div className="mt-4 flex flex-wrap gap-2">
              {season ? (
                <span className="rounded-full border border-[#d8ad45]/35 bg-[#d8ad45]/10 px-3 py-1 text-xs font-black text-[#f4d58a]">
                  {season}
                </span>
              ) : null}
              <span className="rounded-full border border-white/15 bg-white/[0.08] px-3 py-1 text-xs font-black uppercase text-slate-100">
                {competitionType}
              </span>
              <span className="rounded-full border border-white/15 bg-white/[0.08] px-3 py-1 text-xs font-black uppercase text-slate-100">
                {seasonStatus}
              </span>
            </div>
            {shortDescription ? (
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300">{shortDescription}</p>
            ) : null}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              {slug && isPublished ? (
                <Link
                  className="inline-flex items-center justify-center rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/15 transition-transform hover:scale-[1.02]"
                  href={`/competitions/${slug}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  View Public Page
                </Link>
              ) : null}
              <Link
                className="inline-flex items-center justify-center rounded-md border border-[#d8ad45]/50 bg-white/[0.03] px-5 py-3 text-sm font-black text-[#f4d58a] transition-colors hover:bg-[#d8ad45]/10"
                href="/admin/competitions"
              >
                Back to Competitions
              </Link>
            </div>
          </div>
          {coverImageUrl ? (
            <div
              aria-label={`${competitionName} cover image`}
              className="aspect-video w-full overflow-hidden rounded-lg border border-[#d8ad45]/35 bg-white/10 bg-cover bg-center shadow-xl shadow-black/20"
              role="img"
              style={{ backgroundImage: `url("${coverImageUrl}")` }}
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-[#d8ad45]/35 bg-white/[0.06] text-xs font-black uppercase tracking-[0.18em] text-slate-400">
              No Cover
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-10">
        <nav aria-label="Competition workspace sections" className="grid gap-3 sm:grid-cols-4">
          <span className="rounded-lg border border-[#d8ad45]/45 bg-[#061426] px-4 py-3 text-center text-sm font-black text-[#f4d58a]">
            Overview
          </span>
          <a className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-center text-sm font-black text-[#061426] shadow-lg shadow-slate-900/5 hover:border-[#d8ad45]" href="#teams-summary">
            Teams
          </a>
          <Link className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-center text-sm font-black text-[#061426] shadow-lg shadow-slate-900/5 hover:border-[#d8ad45]" href={`/admin/matches?competition=${encodeURIComponent(id)}`}>
            Matches
          </Link>
          <a className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-center text-sm font-black text-[#061426] shadow-lg shadow-slate-900/5 hover:border-[#d8ad45]" href="#settings-summary">
            Settings
          </a>
        </nav>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-4 px-4 pb-8 sm:px-6 lg:grid-cols-3 lg:px-10">
        <DetailCard items={detailItems} title="Competition Details" />
        <DetailCard items={publishingItems} title="Publishing" />
        <DetailCard items={contentItems} title="Content" />
      </section>

      {(hasLinkedData || statusAndActiveMisaligned) ? (
        <section className="mx-auto grid w-full max-w-7xl gap-3 px-4 pb-8 sm:px-6 lg:px-10">
          {hasLinkedData ? (
            <p className="rounded-lg border border-[#d8ad45]/35 bg-[#fff7e6] px-4 py-3 text-sm font-bold text-[#8a6418]">
              This competition contains linked teams or matches. Review linked data before deleting it.
            </p>
          ) : null}
          {statusAndActiveMisaligned ? (
            <p className="rounded-lg border border-[#9b1c1f]/25 bg-[#9b1c1f]/10 px-4 py-3 text-sm font-bold text-[#9b1c1f]">
              Season status and active flag are not aligned.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 pb-10 sm:px-6 lg:grid-cols-2 lg:px-10">
        <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10" id="teams-summary">
          <div className="mb-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-2xl font-black">Teams</h2>
              <p className="mt-1 text-sm font-semibold text-slate-600">
                Manage teams participating in this competition.
              </p>
            </div>
            <Link className="inline-flex rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] hover:bg-[#091f39]" href={`/admin/teams?competition=${encodeURIComponent(id)}`}>
              Manage Teams
            </Link>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <StatCard label="Total Teams" value={teams.length} />
            <StatCard label="KSW Teams" value={kswTeamCount} />
          </div>
          <div className="mt-5 grid gap-2">
            {teams.length ? (
              teams.map((team) => (
                <div className="flex min-w-0 items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2" key={text(team, ["id"])}>
                  <TeamLogo
                    className="!size-10 shrink-0"
                    initials={teamInitials(team)}
                    logoUrl={text(team, ["logo_url"], "")}
                    teamName={teamName(team)}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-[#061426]">{teamName(team)}</p>
                    {team.is_ksw === true ? (
                      <p className="text-xs font-bold text-[#8a6418]">KSW team</p>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
                No teams linked to this competition.
              </p>
            )}
          </div>
        </article>

        <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10" id="matches-summary">
          <div className="mb-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-2xl font-black">Matches</h2>
              <p className="mt-1 text-sm font-semibold text-slate-600">
                Manage matches for this competition.
              </p>
            </div>
            <Link className="inline-flex rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] hover:bg-[#091f39]" href={`/admin/matches?competition=${encodeURIComponent(id)}`}>
              Manage Matches
            </Link>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Total" value={matches.length} />
            <StatCard label="Scheduled" value={scheduledMatches.length} />
            <StatCard label="Finished" value={finishedMatches.length} />
            <StatCard label="Other" value={unknownStatusMatches} />
          </div>
          <div className="mt-5 grid gap-3">
            {nextMatch ? (
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Next match</p>
                <p className="mt-1 text-sm font-black text-[#061426]">
                  {teamName(teamsById.get(text(nextMatch, ["home_team_id"], "")))} vs{" "}
                  {teamName(teamsById.get(text(nextMatch, ["away_team_id"], "")))}
                </p>
                <p className="mt-1 text-xs font-bold text-slate-500">{formatDateTime(nextMatch.match_date)}</p>
              </div>
            ) : null}
            {latestResult ? (
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Latest result</p>
                <p className="mt-1 text-sm font-black text-[#061426]">
                  {teamName(teamsById.get(text(latestResult, ["home_team_id"], "")))}{" "}
                  <span className="text-[#8a6418]">{scoreText(latestResult)}</span>{" "}
                  {teamName(teamsById.get(text(latestResult, ["away_team_id"], "")))}
                </p>
                <p className="mt-1 text-xs font-bold text-slate-500">{formatDateTime(latestResult.match_date)}</p>
              </div>
            ) : null}
            {!nextMatch && !latestResult ? (
              <p className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
                No matches linked to this competition.
              </p>
            ) : null}
          </div>
        </article>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 lg:px-10" id="settings-summary">
        <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10">
          <div className="mb-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
          <h2 className="text-2xl font-black">Settings</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
            Competition settings are edited from the existing Competitions module in Phase 1. Open the module and choose Edit for this competition.
          </p>
          <Link className="mt-4 inline-flex rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] hover:bg-[#091f39]" href="/admin/competitions">
            Open Competitions
          </Link>
        </article>
      </section>
    </main>
  );
}

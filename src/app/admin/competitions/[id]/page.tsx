import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AdminCompetitionMatchManager,
  type AdminCompetitionMatch,
  type AdminCompetitionMatchTeam,
} from "@/components/admin-competition-match-manager";
import {
  AdminCompetitionGroupsManager,
  type AdminCompetitionGroup,
  type AdminCompetitionGroupTeam,
} from "@/components/admin-competition-groups-manager";
import { AdminCompetitionKnockoutManager } from "@/components/admin-competition-knockout-manager";
import type {
  KnockoutMatchSlot,
  KnockoutSlotSource,
  KnockoutSourceType,
} from "@/app/admin/competitions/[id]/knockout-actions";
import { CopyPublicLinkButton } from "@/components/copy-public-link-button";
import { TeamLogo } from "@/components/team-logo";
import { loadCompetitionParticipants } from "@/lib/competition-participants";
import { requireAdminSession } from "@/lib/admin-server-auth";
import { getCompetitionTypeLabel, isCupCompetition, normalizeCompetitionType } from "@/lib/competition-format";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type Row = Record<string, unknown>;

const competitionColumns =
  "id, name, season, slug, short_description, description, cover_image_url, edition_number, start_date, end_date, location, display_order, competition_type, season_status, is_active, is_featured, is_published, created_at";
const matchColumns =
  "id, group_id, competition_stage, fixture_source, match_date, home_team_id, away_team_id, home_score, away_score, venue, status";
const teamColumns = "id, name, short_name, logo_url, is_ksw";
const groupColumns = "id, competition_id, name, label, sort_order, qualifiers_count, created_at, updated_at";
const competitionTeamGroupColumns = "id, competition_id, team_id, group_id, is_active, display_order";
const knockoutColumns =
  "id, competition_id, bracket_size, round_index, round_key, round_label, match_order, home_source_type, home_group_id, home_group_rank, home_team_id, home_source_round_index, home_source_match_order, away_source_type, away_group_id, away_group_rank, away_team_id, away_source_round_index, away_source_match_order, is_manual_edited, created_at, updated_at";

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

function formatCompactDate(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).format(date);
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

function teamName(team: Row | undefined) {
  return text(team, ["name", "short_name"], "Unknown team");
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

async function runQueryStatus<T>(
  source: string,
  query: PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  try {
    const result = await query;
    if (result.error) {
      console.error("admin competition workspace query failed", source, result.error);
      return { data: [] as T[], ok: false };
    }
    return { data: result.data ?? [], ok: true };
  } catch (error) {
    console.error("admin competition workspace query failed", source, error);
    return { data: [] as T[], ok: false };
  }
}

function matchTeamIds(matches: Row[]) {
  return Array.from(
    new Set(
      matches
        .flatMap((match) => [text(match, ["home_team_id"], ""), text(match, ["away_team_id"], "")])
        .filter(Boolean),
    ),
  );
}

function asMatch(row: Row): AdminCompetitionMatch {
  return {
    away_score: typeof row.away_score === "number" ? row.away_score : null,
    away_team_id: text(row, ["away_team_id"], ""),
    competition_stage: text(row, ["competition_stage"], "") || null,
    fixture_source: text(row, ["fixture_source"], "") || null,
    group_id: text(row, ["group_id"], "") || null,
    home_score: typeof row.home_score === "number" ? row.home_score : null,
    home_team_id: text(row, ["home_team_id"], ""),
    id: text(row, ["id"], ""),
    match_date: text(row, ["match_date"], "") || null,
    status: text(row, ["status"], ""),
    venue: text(row, ["venue"], "") || null,
  };
}

function asMatchTeam(row: Row, participantIsActive = false): AdminCompetitionMatchTeam {
  return {
    id: text(row, ["id"], ""),
    is_ksw: row.is_ksw === true,
    logo_url: text(row, ["logo_url"], "") || null,
    name: text(row, ["name", "short_name"], "Unknown team"),
    participant_is_active: participantIsActive,
    short_name: text(row, ["short_name"], "") || null,
  };
}

function asCompetitionGroup(row: Row): AdminCompetitionGroup {
  const name = text(row, ["name"], "");
  return {
    id: text(row, ["id"], ""),
    label: text(row, ["label"], "") || (name ? `Group ${name}` : "Group"),
    name,
    qualifiers_count: number(row, ["qualifiers_count"]) || 2,
    sort_order: number(row, ["sort_order"]),
  };
}

function asGroupTeam(row: Row, team: Row | undefined): AdminCompetitionGroupTeam {
  return {
    competition_team_id: text(row, ["id"], ""),
    display_order: number(row, ["display_order"]),
    group_id: text(row, ["group_id"], "") || null,
    is_active: row.is_active !== false,
    is_ksw: team?.is_ksw === true,
    logo_url: text(team, ["logo_url"], "") || null,
    name: teamName(team),
    short_name: text(team, ["short_name"], "") || null,
    team_id: text(row, ["team_id"], ""),
  };
}

function asKnockoutSource(row: Row, side: "away" | "home"): KnockoutSlotSource {
  const sourceType = text(row, [`${side}_source_type`], "unassigned") as KnockoutSourceType;

  if (sourceType === "group_rank") {
    return {
      groupId: text(row, [`${side}_group_id`], "") || undefined,
      rank: number(row, [`${side}_group_rank`]) || undefined,
      type: sourceType,
    };
  }

  if (sourceType === "manual_team") {
    return {
      teamId: text(row, [`${side}_team_id`], "") || undefined,
      type: sourceType,
    };
  }

  if (sourceType === "match_winner") {
    return {
      sourceMatchOrder: number(row, [`${side}_source_match_order`]) || undefined,
      sourceRoundIndex: number(row, [`${side}_source_round_index`]) || undefined,
      type: sourceType,
    };
  }

  if (sourceType === "bye") return { type: "bye" };
  return { type: "unassigned" };
}

function asKnockoutMatch(row: Row): KnockoutMatchSlot {
  return {
    away: asKnockoutSource(row, "away"),
    bracketSize: number(row, ["bracket_size"]),
    home: asKnockoutSource(row, "home"),
    id: text(row, ["id"], ""),
    isManualEdited: row.is_manual_edited === true,
    matchOrder: number(row, ["match_order"]),
    roundIndex: number(row, ["round_index"]),
    roundKey: text(row, ["round_key"], ""),
    roundLabel: text(row, ["round_label"], ""),
  };
}

function mergeMatchTeams(activeTeams: Row[], matchTeams: Row[]) {
  const merged = new Map<string, AdminCompetitionMatchTeam>();

  matchTeams.forEach((team) => {
    const id = text(team, ["id"], "");
    if (id) merged.set(id, asMatchTeam(team, false));
  });
  activeTeams.forEach((team) => {
    const id = text(team, ["id"], "");
    if (id) merged.set(id, asMatchTeam(team, true));
  });

  return Array.from(merged.values()).sort((a, b) => {
    if (a.participant_is_active !== b.participant_is_active) {
      return a.participant_is_active === false ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });
}

function matchTimeValue(match: AdminCompetitionMatch) {
  const time = match.match_date ? new Date(match.match_date).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function workspaceMatchStats(matches: AdminCompetitionMatch[]) {
  const scheduled = matches.filter((match) => match.status === "scheduled");
  const finished = matches.filter((match) => match.status === "finished");
  const other = matches.length - scheduled.length - finished.length;
  const finishedWithScores = finished.filter(
    (match) => typeof match.home_score === "number" && typeof match.away_score === "number",
  );
  const totalGoals = finishedWithScores.reduce(
    (sum, match) => sum + (match.home_score ?? 0) + (match.away_score ?? 0),
    0,
  );
  const nextScheduled = [...scheduled]
    .filter((match) => matchTimeValue(match) > 0)
    .sort((a, b) => matchTimeValue(a) - matchTimeValue(b))[0];
  const latestFinished = [...finished]
    .filter((match) => matchTimeValue(match) > 0)
    .sort((a, b) => matchTimeValue(b) - matchTimeValue(a))[0];

  return {
    averageGoals: finishedWithScores.length ? (totalGoals / finishedWithScores.length).toFixed(1) : "—",
    finished: finished.length,
    latestFinishedDate: latestFinished ? formatCompactDate(latestFinished.match_date) : "—",
    nextScheduledDate: nextScheduled ? formatCompactDate(nextScheduled.match_date) : "—",
    other,
    scheduled: scheduled.length,
    total: matches.length,
    totalGoals: finishedWithScores.length ? totalGoals : "—",
  };
}

async function loadWorkspaceData(id: string) {
  await requireAdminSession();

  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return {
      competition: undefined,
      groupDataReady: false,
      groupTeams: [] as AdminCompetitionGroupTeam[],
      groups: [] as AdminCompetitionGroup[],
      knockoutDataReady: false,
      knockoutMatches: [] as KnockoutMatchSlot[],
      matchTeams: [] as Row[],
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
      groupDataReady: false,
      groupTeams: [] as AdminCompetitionGroupTeam[],
      groups: [] as AdminCompetitionGroup[],
      knockoutDataReady: false,
      knockoutMatches: [] as KnockoutMatchSlot[],
      matchTeams: [] as Row[],
      matches: [] as Row[],
      teams: [] as Row[],
    };
  }

  const competitionType = normalizeCompetitionType(competition.competition_type);
  const isCup = isCupCompetition(competitionType);

  const [teams, matches, groupResult, competitionTeamResult, knockoutResult] = await Promise.all([
    loadCompetitionParticipants(supabase, id, {
      includeInactiveParticipants: false,
    }),
    runQuery(
      "workspace_matches",
      supabase.from("matches").select(matchColumns).eq("league_id", id).order("match_date", { ascending: true }),
    ),
    isCup
      ? runQueryStatus<Row>(
          "workspace_competition_groups",
          supabase.from("competition_groups").select(groupColumns).eq("competition_id", id).order("sort_order", { ascending: true }),
        )
      : Promise.resolve({ data: [] as Row[], ok: true }),
    isCup
      ? runQueryStatus<Row>(
          "workspace_competition_team_groups",
          supabase
            .from("competition_teams")
            .select(competitionTeamGroupColumns)
            .eq("competition_id", id)
            .eq("is_active", true)
            .order("display_order", { ascending: true }),
        )
      : Promise.resolve({ data: [] as Row[], ok: true }),
    isCup
      ? runQueryStatus<Row>(
          "workspace_competition_knockout_matches",
          supabase
            .from("competition_knockout_matches")
            .select(knockoutColumns)
            .eq("competition_id", id)
            .order("round_index", { ascending: true })
            .order("match_order", { ascending: true }),
        )
      : Promise.resolve({ data: [] as Row[], ok: true }),
  ]);
  const teamIds = matchTeamIds(matches);
  const groupTeamIds = competitionTeamResult.data.map((row) => text(row, ["team_id"], "")).filter(Boolean);
  const groupCanonicalTeams = groupTeamIds.length
    ? await runQuery(
        "workspace_group_teams",
        supabase.from("teams").select(teamColumns).in("id", groupTeamIds),
      )
    : [];
  const groupCanonicalTeamMap = new Map(groupCanonicalTeams.map((team) => [text(team, ["id"], ""), team]));
  const groupTeams = competitionTeamResult.data
    .map((row) => asGroupTeam(row, groupCanonicalTeamMap.get(text(row, ["team_id"], ""))))
    .filter((team) => team.competition_team_id && team.team_id && team.is_active);
  const groups = groupResult.data.map(asCompetitionGroup).filter((group) => group.id);
  const matchTeams = teamIds.length
    ? await runQuery(
        "workspace_match_teams",
        supabase.from("teams").select(teamColumns).in("id", teamIds),
      )
    : [];

  return {
    competition,
    groupDataReady: groupResult.ok && competitionTeamResult.ok,
    groupTeams,
    groups,
    knockoutDataReady: knockoutResult.ok,
    knockoutMatches: knockoutResult.data.map(asKnockoutMatch).filter((match) => match.roundIndex && match.matchOrder),
    matchTeams,
    matches,
    teams,
  };
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

function CommandStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.07] px-4 py-3">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#d8ad45]">{label}</p>
      <p className="mt-1 text-2xl font-black text-white">{value}</p>
    </div>
  );
}

export default async function AdminCompetitionWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { competition, groupDataReady, groupTeams, groups, knockoutDataReady, knockoutMatches, matchTeams, matches, teams } = await loadWorkspaceData(id);

  if (!competition) {
    notFound();
  }

  const competitionName = text(competition, ["name"], "Competition");
  const season = text(competition, ["season"], "");
  const competitionType = normalizeCompetitionType(text(competition, ["competition_type"], ""));
  const competitionTypeLabel = getCompetitionTypeLabel(competitionType);
  const isCup = isCupCompetition(competitionType);
  const seasonStatus = text(competition, ["season_status"], "Not set");
  const slug = text(competition, ["slug"], "");
  const coverImageUrl = text(competition, ["cover_image_url"], "");
  const shortDescription = text(competition, ["short_description"], "");
  const isPublished = competition.is_published === true;
  const isFeatured = competition.is_featured === true;
  const isActive = competition.is_active === true;
  const displayOrder = number(competition, ["display_order"]);
  const kswTeamCount = teams.filter((team) => team.is_ksw === true).length;
  const hasLinkedData = teams.length > 0 || matches.length > 0;
  const workspaceMatches = matches.map(asMatch);
  const workspaceMatchTeams = mergeMatchTeams(teams, matchTeams);
  const matchStats = workspaceMatchStats(workspaceMatches);
  const groupedTeamCount = groupTeams.filter((team) => team.group_id).length;
  const unassignedGroupTeamCount = Math.max(groupTeams.length - groupedTeamCount, 0);
  const cupMatchCreationBlocked = isCup && groups.length === 0;
  const publicPath = slug && isPublished ? `/competitions/${slug}` : "";
  const statusAndActiveMisaligned =
    (seasonStatus === "completed" && isActive) || (seasonStatus === "active" && !isActive);

  const detailItems: Array<[string, string]> = [
    ["Type", competitionTypeLabel],
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
  const groupSummaryItems: Array<[string, string]> = [
    ["Groups", String(groups.length)],
    ["Assigned teams", String(groupedTeamCount)],
    ["Unassigned teams", String(unassignedGroupTeamCount)],
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
                {competitionTypeLabel}
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
        <nav
          aria-label="Competition workspace sections"
          className="flex gap-3 overflow-x-auto pb-2"
        >
            {[
              ["Overview", "#overview-summary"],
              ["Teams", "#teams-summary"],
              ...(isCup ? ([["Groups", "#groups-summary"]] as Array<[string, string]>) : []),
              ...(isCup ? ([["Knockout", "#knockout-summary"]] as Array<[string, string]>) : []),
              ["Matches", "#matches-summary"],
              ["Publishing", "#publishing-summary"],
              ["Settings", "#settings-summary"],
          ].map(([label, href]) => (
            <a
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-3 text-center text-sm font-black text-[#061426] shadow-lg shadow-slate-900/5 hover:border-[#d8ad45] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d8ad45]"
              href={href}
              key={href}
            >
              {label}
            </a>
          ))}
        </nav>
      </section>

      <section className="mx-auto w-full max-w-7xl scroll-mt-28 px-4 pb-8 sm:px-6 lg:px-10" id="overview-summary">
        <article className="rounded-lg border border-[#d8ad45]/30 bg-[linear-gradient(135deg,#061426,#0b2644)] p-5 text-white shadow-xl shadow-slate-900/15">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[#d8ad45]">
                Command Center
              </p>
              <h2 className="mt-2 break-words text-3xl font-black">{competitionName}</h2>
              <p className="mt-2 text-sm font-semibold text-slate-300">
                {[season, competitionTypeLabel, seasonStatus, isPublished ? "Public" : "Private"]
                  .filter(Boolean)
                  .join(" - ")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {cupMatchCreationBlocked ? (
                <a
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-[#d8ad45]/50 bg-white/[0.04] px-4 py-2 text-sm font-black text-[#f4d58a] hover:bg-[#d8ad45]/10"
                  href="#groups-summary"
                >
                  Set Up Groups
                </a>
              ) : (
                <a
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-4 py-2 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/20"
                  href="#match-form"
                >
                  Add Match
                </a>
              )}
              <a
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-[#d8ad45]/50 bg-white/[0.04] px-4 py-2 text-sm font-black text-[#f4d58a] hover:bg-[#d8ad45]/10"
                href="#teams-summary"
              >
                Manage Teams
              </a>
              {publicPath ? (
                <Link
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-white/20 bg-white/[0.08] px-4 py-2 text-sm font-black text-white hover:bg-white/[0.14]"
                  href={publicPath}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  View Public Page
                </Link>
              ) : null}
              {publicPath ? <CopyPublicLinkButton path={publicPath} variant="dark" /> : null}
            </div>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <CommandStat label="Teams" value={teams.length} />
            {isCup ? <CommandStat label="Groups" value={groups.length} /> : null}
            <CommandStat label="Total Matches" value={matchStats.total} />
            <CommandStat label="Scheduled" value={matchStats.scheduled} />
            <CommandStat label="Finished" value={matchStats.finished} />
            {matchStats.other > 0 ? <CommandStat label="Other" value={matchStats.other} /> : null}
            <CommandStat label="Goals" value={matchStats.totalGoals} />
            <CommandStat label="Avg Goals" value={matchStats.averageGoals} />
            <CommandStat label="Next Match" value={matchStats.nextScheduledDate} />
            <CommandStat label="Latest Result" value={matchStats.latestFinishedDate} />
          </div>
        </article>
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
          {isCup && groupDataReady && groups.length > 0 && unassignedGroupTeamCount > 0 ? (
            <p className="rounded-lg border border-[#d8ad45]/35 bg-[#fff7e6] px-4 py-3 text-sm font-bold text-[#8a6418]">
              This cup has {unassignedGroupTeamCount} unassigned team{unassignedGroupTeamCount === 1 ? "" : "s"}. Finish group assignments before creating group-stage fixtures.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10">
        <article className="min-w-0 scroll-mt-28 rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10" id="teams-summary">
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
                No teams assigned yet. Use Manage Teams to assign participants for this competition.
              </p>
            )}
          </div>
        </article>
      </section>

      {isCup ? (
        <AdminCompetitionGroupsManager
          competitionId={id}
          groups={groups}
          matches={workspaceMatches}
          schemaReady={groupDataReady}
          teams={groupTeams}
        />
      ) : null}

      {isCup ? (
        <AdminCompetitionKnockoutManager
          competitionId={id}
          groups={groups}
          initialMatches={knockoutMatches}
          schemaReady={knockoutDataReady}
          teams={groupTeams}
        />
      ) : null}

      <AdminCompetitionMatchManager
        competition={{
          id,
          name: competitionName,
          season,
          status: seasonStatus,
          type: competitionType,
        }}
        cupGroupCount={groups.length}
        cupGroupsReady={groupDataReady}
        cupUnassignedTeamCount={unassignedGroupTeamCount}
        groups={groups}
        groupTeams={groupTeams}
        initialMatches={workspaceMatches}
        initialTeams={workspaceMatchTeams}
      />

      <section className="mx-auto grid w-full max-w-7xl scroll-mt-28 gap-4 px-4 pb-8 sm:px-6 lg:grid-cols-3 lg:px-10" id="publishing-summary">
        <DetailCard items={detailItems} title="Competition Details" />
        <DetailCard items={publishingItems} title="Publishing" />
        {isCup ? <DetailCard items={groupSummaryItems} title="Group Stage" /> : null}
        <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10">
          <div className="mb-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
          <h2 className="text-xl font-black text-[#061426]">Public Page</h2>
          <dl className="mt-4 grid gap-3">
            {contentItems.map(([label, value]) => (
              <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2" key={label}>
                <dt className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</dt>
                <dd className="mt-1 break-words text-sm font-black text-[#061426]">{value || "Not set"}</dd>
              </div>
            ))}
            {publicPath ? (
              <div className="rounded-md border border-[#d8ad45]/25 bg-[#fff7e6] px-3 py-2">
                <dt className="text-[10px] font-black uppercase tracking-[0.16em] text-[#8a6418]">Public URL</dt>
                <dd className="mt-2 flex flex-col gap-2">
                  <code className="break-all rounded bg-white px-2 py-1 text-xs font-bold text-[#061426]">
                    {publicPath}
                  </code>
                  <CopyPublicLinkButton path={publicPath} />
                </dd>
              </div>
            ) : (
              <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                <dt className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Public URL</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-600">
                  Public page unavailable. Add a slug and publish this competition before sharing it.
                </dd>
              </div>
            )}
          </dl>
        </article>
      </section>

      <section className="mx-auto w-full max-w-7xl scroll-mt-28 px-4 pb-12 sm:px-6 lg:px-10" id="settings-summary">
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

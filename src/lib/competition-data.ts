import { getSupabase, getSupabaseConfig } from "@/lib/supabase";
import { loadCompetitionParticipants } from "@/lib/competition-participants";

export type Row = Record<string, unknown>;

export const competitionColumns =
  "id, name, season, slug, short_description, description, cover_image_url, edition_number, start_date, end_date, location, display_order, competition_type, season_status, is_active, is_featured, is_published, created_at";
export const standingsColumns =
  "team_id, league_id, team_name, short_name, logo_url, is_ksw, played, won, drawn, lost, goals_for, goals_against, goal_difference, points";
export const matchColumns =
  "id, league_id, match_date, home_team_id, away_team_id, home_score, away_score, venue, status, match_type";
export const snapshotColumns =
  "snapshot_id, league_id, team_id, position, played, won, drawn, lost, goals_for, goals_against, goal_difference, points, matchday, created_at";
export const sponsorColumns = "id, name, logo_url, website_url, tier, sort_order, is_active";

export const legacySeasonSlug = "thai-lawyers-league-season-6";

export function text(row: Row | undefined, keys: string[], fallback = "") {
  if (!row) return fallback;

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }

  return fallback;
}

export function number(row: Row | undefined, keys: string[]) {
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

export function matchTime(match: Row) {
  const value = text(match, ["match_date", "date", "kickoff_at"], "");
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

export function sortStandings(rows: Row[]) {
  return [...rows].sort((a, b) => {
    const pointsDiff = number(b, ["points", "pts"]) - number(a, ["points", "pts"]);
    if (pointsDiff) return pointsDiff;

    const goalDiff = number(b, ["goal_difference", "gd"]) - number(a, ["goal_difference", "gd"]);
    if (goalDiff) return goalDiff;

    const goalsForDiff = number(b, ["goals_for", "gf"]) - number(a, ["goals_for", "gf"]);
    if (goalsForDiff) return goalsForDiff;

    return text(a, ["team_name", "name", "team"]).localeCompare(text(b, ["team_name", "name", "team"]));
  });
}

function teamById(teams: Row[]) {
  return new Map(
    teams.map((team) => [
      text(team, ["id"], ""),
      {
        isKsw: team.is_ksw === true,
        name: text(team, ["name", "short_name"], "Team unavailable"),
        shortName: text(team, ["short_name"], ""),
        logoUrl: text(team, ["logo_url"], ""),
      },
    ]),
  );
}

export function withMatchTeams(matches: Row[], teams: Row[]): Row[] {
  const teamsById = teamById(teams);

  return matches.map((match) => {
    const homeTeam = teamsById.get(text(match, ["home_team_id"], ""));
    const awayTeam = teamsById.get(text(match, ["away_team_id"], ""));
    const homeScore = match.home_score;
    const awayScore = match.away_score;
    const hasScore = typeof homeScore === "number" && typeof awayScore === "number";

    return {
      ...match,
      away_team_logo_url: awayTeam?.logoUrl ?? "",
      away_team_is_ksw: awayTeam?.isKsw === true,
      away_team_name: awayTeam?.name ?? "Away team unavailable",
      away_team_short_name: awayTeam?.shortName ?? "",
      home_team_logo_url: homeTeam?.logoUrl ?? "",
      home_team_is_ksw: homeTeam?.isKsw === true,
      home_team_name: homeTeam?.name ?? "Home team unavailable",
      home_team_short_name: homeTeam?.shortName ?? "",
      score: hasScore ? `${homeScore} - ${awayScore}` : "VS",
    };
  });
}

async function runSupabaseQuery<T>(source: string, query: PromiseLike<{ data: T[] | null; error: unknown }>) {
  try {
    const result = await query;
    if (result.error) console.error("Supabase competition query failed", source, result.error);
    return result.data ?? [];
  } catch (error) {
    console.error("Supabase competition query failed", source, error, getSupabaseConfig().diagnostics);
    return [];
  }
}

export async function loadCompetitionBySlug(slug: string, publishedOnly = true) {
  const supabase = getSupabase();
  if (!supabase) return undefined;

  let query = supabase.from("leagues").select(competitionColumns).eq("slug", slug);
  if (publishedOnly) {
    query = query.eq("is_published", true);
  }

  const rows = await runSupabaseQuery("competition_by_slug", query.order("created_at", { ascending: false }).limit(1));
  return rows[0];
}

export async function loadLegacySeasonCompetition() {
  const supabase = getSupabase();
  if (!supabase) return undefined;

  const bySlug = await loadCompetitionBySlug(legacySeasonSlug, false);
  if (bySlug) return bySlug;

  const byName = await runSupabaseQuery(
    "legacy_competition_by_name",
    supabase
      .from("leagues")
      .select(competitionColumns)
      .eq("name", "Thai Lawyers League Season 6")
      .eq("competition_type", "league")
      .order("created_at", { ascending: false })
      .limit(1),
  );
  if (byName[0]) return byName[0];

  const bySeason = await runSupabaseQuery(
    "legacy_competition_by_season",
    supabase
      .from("leagues")
      .select(competitionColumns)
      .eq("season", "Season 6")
      .eq("competition_type", "league")
      .order("created_at", { ascending: false })
      .limit(1),
  );

  return bySeason[0];
}

export async function loadCompetitionDetailData(competition: Row) {
  const supabase = getSupabase();
  const leagueId = text(competition, ["id"], "");

  if (!supabase || !leagueId) {
    return {
      competition,
      matches: [] as Row[],
      scheduledMatches: [] as Row[],
      snapshots: [] as Row[],
      sponsors: [] as Row[],
      standings: [] as Row[],
      teams: [] as Row[],
    };
  }

  const [standings, finishedMatches, scheduledMatches, snapshots, teams, sponsors] = await Promise.all([
    runSupabaseQuery(
      "competition_standings",
      supabase.from("league_standings_view").select(standingsColumns).eq("league_id", leagueId),
    ),
    runSupabaseQuery(
      "competition_finished_matches",
      supabase
        .from("matches")
        .select(matchColumns)
        .eq("league_id", leagueId)
        .eq("status", "finished")
        .order("match_date", { ascending: false }),
    ),
    runSupabaseQuery(
      "competition_scheduled_matches",
      supabase
        .from("matches")
        .select(matchColumns)
        .eq("league_id", leagueId)
        .eq("status", "scheduled")
        .order("match_date", { ascending: true }),
    ),
    runSupabaseQuery(
      "competition_snapshots",
      supabase
        .from("league_standings_snapshots")
        .select(snapshotColumns)
        .eq("league_id", leagueId)
        .order("created_at", { ascending: false })
        .limit(100),
    ),
    loadCompetitionParticipants(supabase, leagueId, { includeInactiveParticipants: false }),
    runSupabaseQuery(
      "competition_sponsors",
      supabase.from("sponsors").select(sponsorColumns).order("sort_order", { ascending: true, nullsFirst: false }),
    ),
  ]);

  return {
    competition,
    matches: withMatchTeams(finishedMatches, teams),
    scheduledMatches: withMatchTeams(scheduledMatches, teams),
    snapshots,
    sponsors,
    standings,
    teams,
  };
}

export async function loadPublishedCompetitions() {
  const supabase = getSupabase();
  if (!supabase) return [];

  return runSupabaseQuery(
    "published_competitions",
    supabase
      .from("leagues")
      .select(competitionColumns)
      .eq("is_published", true)
      .order("created_at", { ascending: false }),
  );
}

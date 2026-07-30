import "server-only";

import { loadCompetitionParticipants } from "@/lib/competition-participants";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export type HomeRow = Record<string, unknown>;

export type HomeCompetitionError = {
  code?: string;
  details?: string;
  hint?: string;
  message: string;
  source: string;
};

export type HomeCompetitionSummary = {
  drawnCount: number;
  finishedCount: number;
  lostCount: number;
  totalKswMatches: number;
  upcomingCount: number;
  wonCount: number;
};

export type HomeMappedMatch = HomeRow & {
  awayFound: boolean;
  awayIsKsw: boolean;
  awayName: string;
  exclusionReason: string;
  homeFound: boolean;
  homeIsKsw: boolean;
  homeName: string;
  isKswFixture: boolean;
};

export type HomeCompetitionData = {
  allFinishedMatches: HomeMappedMatch[];
  allMappedMatches: HomeMappedMatch[];
  allParticipants: HomeRow[];
  allRecentResults: HomeMappedMatch[];
  allScheduledMatches: HomeMappedMatch[];
  configured: boolean;
  currentCompetition: HomeRow | undefined;
  errors: HomeCompetitionError[];
  finishedKswMatches: HomeMappedMatch[];
  kswParticipants: HomeRow[];
  nextKswFixture: HomeMappedMatch | undefined;
  rawJunctionRows: HomeRow[];
  rawMatches: HomeRow[];
  rawPublishedCompetitions: HomeRow[];
  recentKswResults: HomeMappedMatch[];
  scheduledKswMatches: HomeMappedMatch[];
  sponsors: HomeRow[];
  standings: HomeRow[];
  summary: HomeCompetitionSummary;
};

type QueryResult<T> = {
  data: T[];
  error: HomeCompetitionError | null;
};

type SupabaseQueryError = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

const leagueColumns =
  "id, name, season, slug, competition_type, season_status, is_active, is_published, is_featured, display_order, start_date, end_date, created_at";
const standingsColumns =
  "team_id, league_id, team_name, short_name, logo_url, is_ksw, played, won, drawn, lost, goals_for, goals_against, goal_difference, points";
const matchColumns =
  "id, league_id, match_date, home_team_id, away_team_id, home_score, away_score, venue, status, match_type";
const junctionColumns = "id, competition_id, team_id, is_active, display_order, created_at";
const sponsorColumns = "id, name, logo_url, website_url, tier, sort_order, is_active";

export function homeText(row: HomeRow | undefined, keys: string[], fallback = "") {
  if (!row) return fallback;

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }

  return fallback;
}

function numberValue(row: HomeRow, key: string) {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return 0;
}

function competitionStatusPriority(status: string) {
  if (status === "active") return 0;
  if (status === "upcoming") return 1;
  if (status === "completed") return 2;
  return 3;
}

function dateSortValue(row: HomeRow) {
  const value = homeText(row, ["start_date", "end_date", "created_at"], "");
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function displayOrderValue(row: HomeRow) {
  return numberValue(row, "display_order");
}

function createdAtValue(row: HomeRow) {
  const value = homeText(row, ["created_at"], "");
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

export function selectCurrentHomeCompetition(rows: HomeRow[]) {
  return [...rows]
    .filter((row) => row.is_published === true)
    .sort((a, b) => {
      const statusDiff =
        competitionStatusPriority(homeText(a, ["season_status"], "active").toLowerCase()) -
        competitionStatusPriority(homeText(b, ["season_status"], "active").toLowerCase());
      if (statusDiff) return statusDiff;

      const featuredDiff = Number(b.is_featured === true) - Number(a.is_featured === true);
      if (featuredDiff) return featuredDiff;

      const displayOrderDiff = displayOrderValue(a) - displayOrderValue(b);
      if (displayOrderDiff) return displayOrderDiff;

      const dateDiff = dateSortValue(b) - dateSortValue(a);
      if (dateDiff) return dateDiff;

      return createdAtValue(b) - createdAtValue(a);
    })[0];
}

export function homeFixtureTimeValue(match: HomeRow) {
  const value = match.match_date ?? match.date ?? match.kickoff_at;
  const date = typeof value === "string" ? new Date(value) : null;

  return date && !Number.isNaN(date.getTime()) ? date.getTime() : Number.MAX_SAFE_INTEGER;
}

function venueNumber(match: HomeRow) {
  const venue = homeText(match, ["venue"], "");
  const matchValue = venue.match(/v\s*(\d+)/i);

  return matchValue ? Number(matchValue[1]) : Number.MAX_SAFE_INTEGER;
}

function sortUpcomingFixtures(fixtures: HomeMappedMatch[]) {
  return [...fixtures].sort((a, b) => {
    const timeDiff = homeFixtureTimeValue(a) - homeFixtureTimeValue(b);
    if (timeDiff) return timeDiff;

    const venueDiff = venueNumber(a) - venueNumber(b);
    if (venueDiff) return venueDiff;

    return homeText(a, ["home_team_name"], "").localeCompare(homeText(b, ["home_team_name"], ""));
  });
}

export function isHomeKswFixture(match: HomeRow) {
  return match.home_team_is_ksw === true || match.away_team_is_ksw === true;
}

export function homeKswOutcome(match: HomeRow) {
  const homeScore = match.home_score;
  const awayScore = match.away_score;
  const hasScore = typeof homeScore === "number" && typeof awayScore === "number";
  const homeIsKsw = match.home_team_is_ksw === true;
  const awayIsKsw = match.away_team_is_ksw === true;

  if (!hasScore || (!homeIsKsw && !awayIsKsw)) return "";
  if (homeScore === awayScore) return "DRAW";

  const kswWon = homeIsKsw ? homeScore > awayScore : awayScore > homeScore;
  return kswWon ? "WIN" : "LOSS";
}

function teamById(teams: HomeRow[]) {
  return new Map(
    teams.map((team) => [
      homeText(team, ["id"], ""),
      {
        isKsw: team.is_ksw === true,
        name: homeText(team, ["name", "short_name"], "Team unavailable"),
        participantIsActive: team.participant_is_active !== false,
        shortName: homeText(team, ["short_name"], ""),
        logoUrl: homeText(team, ["logo_url"], ""),
      },
    ]),
  );
}

export function mapHomeMatch(match: HomeRow, teams: HomeRow[]): HomeMappedMatch {
  const teamsById = teamById(teams);
  const homeTeamId = homeText(match, ["home_team_id"], "");
  const awayTeamId = homeText(match, ["away_team_id"], "");
  const homeTeam = teamsById.get(homeTeamId);
  const awayTeam = teamsById.get(awayTeamId);
  const status = homeText(match, ["status"], "");
  const mapped = {
    ...match,
    away_team_is_ksw: awayTeam?.isKsw === true,
    away_team_logo_url: awayTeam?.logoUrl ?? "",
    away_team_name: awayTeam?.name ?? "Away team unavailable",
    away_team_short_name: awayTeam?.shortName ?? "",
    home_team_is_ksw: homeTeam?.isKsw === true,
    home_team_logo_url: homeTeam?.logoUrl ?? "",
    home_team_name: homeTeam?.name ?? "Home team unavailable",
    home_team_short_name: homeTeam?.shortName ?? "",
  };
  const mappedIsKsw = isHomeKswFixture(mapped);
  const reasons: string[] = [];

  if (!homeTeamId) reasons.push("invalid/missing home team id");
  if (!awayTeamId) reasons.push("invalid/missing away team id");
  if (homeTeamId && !homeTeam) reasons.push("home team not found in participants");
  if (awayTeamId && !awayTeam) reasons.push("away team not found in participants");
  if (homeTeam && homeTeam.participantIsActive === false) reasons.push("home participant inactive");
  if (awayTeam && awayTeam.participantIsActive === false) reasons.push("away participant inactive");
  if (homeTeam && awayTeam && !mappedIsKsw) reasons.push("neither team has is_ksw=true");
  if (status !== "scheduled" && status !== "finished") reasons.push("status not scheduled/finished");

  return {
    ...mapped,
    awayFound: Boolean(awayTeam),
    awayIsKsw: awayTeam?.isKsw === true,
    awayName: awayTeam?.name ?? "Away team unavailable",
    exclusionReason: reasons.length ? reasons.join("; ") : "included as KSW fixture",
    homeFound: Boolean(homeTeam),
    homeIsKsw: homeTeam?.isKsw === true,
    homeName: homeTeam?.name ?? "Home team unavailable",
    isKswFixture: mappedIsKsw,
  };
}

function emptySummary(): HomeCompetitionSummary {
  return {
    drawnCount: 0,
    finishedCount: 0,
    lostCount: 0,
    totalKswMatches: 0,
    upcomingCount: 0,
    wonCount: 0,
  };
}

function createError(source: string, error: unknown): HomeCompetitionError {
  const queryError = error as SupabaseQueryError | null;

  return {
    code: queryError?.code,
    details: queryError?.details,
    hint: queryError?.hint,
    message: queryError?.message ?? String(error),
    source,
  };
}

async function runQuery<T>(
  source: string,
  query: PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<QueryResult<T>> {
  try {
    const result = await query;
    return {
      data: result.data ?? [],
      error: result.error ? createError(source, result.error) : null,
    };
  } catch (error) {
    return {
      data: [],
      error: createError(source, error),
    };
  }
}

function withResultErrors<T extends QueryResult<unknown>[]>(...results: T) {
  return results.map((result) => result.error).filter((error): error is HomeCompetitionError => Boolean(error));
}

export async function loadHomeCompetitionData(): Promise<HomeCompetitionData> {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return {
      allFinishedMatches: [],
      allMappedMatches: [],
      allParticipants: [],
      allRecentResults: [],
      allScheduledMatches: [],
      configured: false,
      currentCompetition: undefined,
      errors: [
        {
          message: "Supabase admin client is not configured.",
          source: "supabase_admin_client",
        },
      ],
      finishedKswMatches: [],
      kswParticipants: [],
      nextKswFixture: undefined,
      rawJunctionRows: [],
      rawMatches: [],
      rawPublishedCompetitions: [],
      recentKswResults: [],
      scheduledKswMatches: [],
      sponsors: [],
      standings: [],
      summary: emptySummary(),
    };
  }

  const competitionsResult = await runQuery<HomeRow>(
    "current_competitions",
    supabase.from("leagues").select(leagueColumns).eq("is_published", true).order("created_at", { ascending: false }),
  );
  const currentCompetition = selectCurrentHomeCompetition(competitionsResult.data);
  const currentCompetitionId = homeText(currentCompetition, ["id"], "");

  if (!currentCompetitionId) {
    const sponsorsResult = await runQuery<HomeRow>(
      "sponsors",
      supabase.from("sponsors").select(sponsorColumns).order("sort_order", { ascending: true, nullsFirst: false }),
    );
    const errors = withResultErrors(competitionsResult, sponsorsResult);

    return {
      allFinishedMatches: [],
      allMappedMatches: [],
      allParticipants: [],
      allRecentResults: [],
      allScheduledMatches: [],
      configured: errors.length === 0,
      currentCompetition,
      errors,
      finishedKswMatches: [],
      kswParticipants: [],
      nextKswFixture: undefined,
      rawJunctionRows: [],
      rawMatches: [],
      rawPublishedCompetitions: competitionsResult.data,
      recentKswResults: [],
      scheduledKswMatches: [],
      sponsors: sponsorsResult.data,
      standings: [],
      summary: emptySummary(),
    };
  }

  const [standingsResult, matchesResult, junctionResult, sponsorsResult] = await Promise.all([
    runQuery<HomeRow>(
      "league_standings_view",
      supabase.from("league_standings_view").select(standingsColumns).eq("league_id", currentCompetitionId),
    ),
    runQuery<HomeRow>(
      "matches",
      supabase
        .from("matches")
        .select(matchColumns)
        .eq("league_id", currentCompetitionId)
        .order("match_date", { ascending: true }),
    ),
    runQuery<HomeRow>(
      "competition_teams",
      supabase
        .from("competition_teams")
        .select(junctionColumns)
        .eq("competition_id", currentCompetitionId)
        .order("display_order", { ascending: true }),
    ),
    runQuery<HomeRow>(
      "sponsors",
      supabase.from("sponsors").select(sponsorColumns).order("sort_order", { ascending: true, nullsFirst: false }),
    ),
  ]);
  const allParticipants = await loadCompetitionParticipants(supabase, currentCompetitionId, {
    includeInactiveParticipants: false,
    includeLegacyFallback: false,
  });
  const participantRows = allParticipants as HomeRow[];
  const kswParticipants = participantRows.filter((participant) => participant.is_ksw === true);
  const mappedMatches = matchesResult.data.map((match) => mapHomeMatch(match, participantRows));
  const allScheduledMatches = sortUpcomingFixtures(
    mappedMatches.filter((match) => homeText(match, ["status"], "") === "scheduled"),
  );
  const allFinishedMatches = mappedMatches
    .filter((match) => homeText(match, ["status"], "") === "finished")
    .sort((a, b) => homeFixtureTimeValue(b) - homeFixtureTimeValue(a));
  const scheduledKswMatches = allScheduledMatches.filter((match) => match.isKswFixture);
  const finishedKswMatches = allFinishedMatches
    .filter(
      (match) =>
        match.isKswFixture &&
        typeof match.home_score === "number" &&
        typeof match.away_score === "number",
    );
  const allRecentResults = allFinishedMatches.slice(0, 5);
  const recentKswResults = finishedKswMatches.slice(0, 5);
  const now = new Date().getTime();
  const nextKswFixture = scheduledKswMatches.find((match) => homeFixtureTimeValue(match) >= now);
  const summary = finishedKswMatches.reduce<HomeCompetitionSummary>(
    (record, match) => {
      const outcome = homeKswOutcome(match);
      if (outcome === "WIN") record.wonCount += 1;
      if (outcome === "DRAW") record.drawnCount += 1;
      if (outcome === "LOSS") record.lostCount += 1;
      return record;
    },
    {
      drawnCount: 0,
      finishedCount: finishedKswMatches.length,
      lostCount: 0,
      totalKswMatches: finishedKswMatches.length + scheduledKswMatches.length,
      upcomingCount: scheduledKswMatches.length,
      wonCount: 0,
    },
  );
  const errors = withResultErrors(competitionsResult, standingsResult, matchesResult, junctionResult, sponsorsResult);

  return {
    allFinishedMatches,
    allMappedMatches: mappedMatches,
    allParticipants: participantRows,
    allRecentResults,
    allScheduledMatches,
    configured: errors.length === 0,
    currentCompetition,
    errors,
    finishedKswMatches,
    kswParticipants,
    nextKswFixture,
    rawJunctionRows: junctionResult.data,
    rawMatches: matchesResult.data,
    rawPublishedCompetitions: competitionsResult.data,
    recentKswResults,
    scheduledKswMatches,
    sponsors: sponsorsResult.data,
    standings: standingsResult.data,
    summary,
  };
}

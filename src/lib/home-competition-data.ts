import "server-only";

import { normalizeCompetitionType, supportsLeagueStandings } from "@/lib/competition-format";
import { isPublicCompetition } from "@/lib/competition-publication";
import { homeFixturePartitionLabel, isHomeFinishedFixture } from "@/lib/home-competition-contract";
import { calculateStandardLeagueStandings } from "@/lib/league-template/standings";
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

export type HomeChampion = {
  competitionId: string;
  competitionName: string;
  competitionSlug: string;
  label: string;
  teamName: string;
};

export type HomeCompetitionSelectionReason =
  | "active_featured"
  | "active_priority"
  | "latest_completed"
  | "nearest_upcoming"
  | "none";

export type HomeCompetitionSelection = {
  isNextCompetitionComingSoon: boolean;
  isPrimaryCompetitionComingSoon: boolean;
  nextCompetition: HomeRow | undefined;
  nextCompetitionStartsInDays: number | undefined;
  primaryCompetition: HomeRow | undefined;
  primaryCompetitionStartsInDays: number | undefined;
  primarySelectionReason: HomeCompetitionSelectionReason;
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
  latestChampions: HomeChampion[];
  kswParticipants: HomeRow[];
  nextKswFixture: HomeMappedMatch | undefined;
  nextCompetition: HomeRow | undefined;
  nextCompetitionStartsInDays: number | undefined;
  primaryCompetitionStartsInDays: number | undefined;
  primarySelectionReason: HomeCompetitionSelectionReason;
  isNextCompetitionComingSoon: boolean;
  isPrimaryCompetitionComingSoon: boolean;
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
  "id, league_id, match_date, home_team_id, away_team_id, home_score, away_score, penalty_home_score, penalty_away_score, winner_team_id, venue, status, match_type, competition_stage, knockout_partition_key, matchweek, scheduled_matchweek, league_fixture_version";
const junctionColumns = "id, competition_id, team_id, is_active, display_order, created_at";
const sponsorColumns = "id, name, logo_url, website_url, tier, sort_order, is_active";
const DAY_MS = 24 * 60 * 60 * 1000;
const COMING_SOON_DAYS = 30;

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

function displayOrderValue(row: HomeRow) {
  return numberValue(row, "display_order");
}

function dateTimeValue(row: HomeRow, key: string) {
  const value = homeText(row, [key], "");
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function createdAtValue(row: HomeRow) {
  return dateTimeValue(row, "created_at");
}

function startDateValue(row: HomeRow) {
  return dateTimeValue(row, "start_date");
}

function endDateValue(row: HomeRow) {
  return dateTimeValue(row, "end_date");
}

function utcDayValue(time: number) {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function daysUntilStart(row: HomeRow, now: number) {
  const startTime = startDateValue(row);
  if (!startTime) return undefined;

  return Math.floor((utcDayValue(startTime) - utcDayValue(now)) / DAY_MS);
}

function isComingSoon(row: HomeRow | undefined, now: number) {
  if (!row) return false;

  const days = daysUntilStart(row, now);
  return typeof days === "number" && days >= 0 && days <= COMING_SOON_DAYS;
}

function activeCompetitionSort(a: HomeRow, b: HomeRow) {
  const featuredDiff = Number(b.is_featured === true) - Number(a.is_featured === true);
  if (featuredDiff) return featuredDiff;

  const displayOrderDiff = displayOrderValue(a) - displayOrderValue(b);
  if (displayOrderDiff) return displayOrderDiff;

  const startDateDiff = startDateValue(b) - startDateValue(a);
  if (startDateDiff) return startDateDiff;

  const endDateDiff = endDateValue(b) - endDateValue(a);
  if (endDateDiff) return endDateDiff;

  return createdAtValue(b) - createdAtValue(a);
}

function upcomingCompetitionSort(now: number) {
  return (a: HomeRow, b: HomeRow) => {
    const aDays = daysUntilStart(a, now);
    const bDays = daysUntilStart(b, now);
    const aHasFutureDate = typeof aDays === "number" && aDays >= 0;
    const bHasFutureDate = typeof bDays === "number" && bDays >= 0;

    if (aHasFutureDate !== bHasFutureDate) return aHasFutureDate ? -1 : 1;
    if (aHasFutureDate && bHasFutureDate && aDays !== bDays) return aDays - bDays;

    const aStart = startDateValue(a);
    const bStart = startDateValue(b);
    if (aStart !== bStart) {
      if (!aStart) return 1;
      if (!bStart) return -1;
      return aStart - bStart;
    }

    const featuredDiff = Number(b.is_featured === true) - Number(a.is_featured === true);
    if (featuredDiff) return featuredDiff;

    const displayOrderDiff = displayOrderValue(a) - displayOrderValue(b);
    if (displayOrderDiff) return displayOrderDiff;

    return createdAtValue(b) - createdAtValue(a);
  };
}

function completedCompetitionSort(a: HomeRow, b: HomeRow) {
  const endDateDiff = endDateValue(b) - endDateValue(a);
  if (endDateDiff) return endDateDiff;

  const startDateDiff = startDateValue(b) - startDateValue(a);
  if (startDateDiff) return startDateDiff;

  return createdAtValue(b) - createdAtValue(a);
}

export function selectHomeCompetition(rows: HomeRow[], now = new Date().getTime()): HomeCompetitionSelection {
  const publishedRows = rows.filter((row) => isPublicCompetition(row));
  const activeRows = publishedRows.filter((row) => homeText(row, ["season_status"], "active").toLowerCase() === "active");
  const upcomingRows = publishedRows.filter((row) => homeText(row, ["season_status"], "").toLowerCase() === "upcoming");
  const completedRows = publishedRows.filter((row) => homeText(row, ["season_status"], "").toLowerCase() === "completed");
  const primaryActive = [...activeRows].sort(activeCompetitionSort)[0];
  const primaryUpcoming = [...upcomingRows].sort(upcomingCompetitionSort(now))[0];
  const primaryCompleted = [...completedRows].sort(completedCompetitionSort)[0];
  const primaryCompetition = primaryActive ?? primaryUpcoming ?? primaryCompleted;
  const primarySelectionReason: HomeCompetitionSelectionReason = primaryActive
    ? primaryActive.is_featured === true
      ? "active_featured"
      : "active_priority"
    : primaryUpcoming
      ? "nearest_upcoming"
      : primaryCompleted
        ? "latest_completed"
        : "none";
  const nextCompetition =
    primaryActive
      ? [...upcomingRows]
          .filter((row) => isComingSoon(row, now))
          .sort(upcomingCompetitionSort(now))[0]
      : undefined;
  const nextCompetitionStartsInDays = daysUntilStart(nextCompetition ?? {}, now);
  const primaryCompetitionStartsInDays = daysUntilStart(primaryCompetition ?? {}, now);

  return {
    isNextCompetitionComingSoon: isComingSoon(nextCompetition, now),
    isPrimaryCompetitionComingSoon: primarySelectionReason === "nearest_upcoming" && isComingSoon(primaryCompetition, now),
    nextCompetition,
    nextCompetitionStartsInDays,
    primaryCompetition,
    primaryCompetitionStartsInDays,
    primarySelectionReason,
  };
}

export function selectCurrentHomeCompetition(rows: HomeRow[]) {
  return selectHomeCompetition(rows).primaryCompetition;
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
      latestChampions: [],
      kswParticipants: [],
      isNextCompetitionComingSoon: false,
      isPrimaryCompetitionComingSoon: false,
      nextCompetition: undefined,
      nextCompetitionStartsInDays: undefined,
      nextKswFixture: undefined,
      primaryCompetitionStartsInDays: undefined,
      primarySelectionReason: "none",
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
  const selection = selectHomeCompetition(competitionsResult.data);
  let currentCompetition = selection.primaryCompetition;
  let currentCompetitionId = homeText(currentCompetition, ["id"], "");
  let currentCompetitionType = normalizeCompetitionType(currentCompetition?.competition_type);
  let loadStandings = supportsLeagueStandings(currentCompetitionType);

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
      latestChampions: [],
      kswParticipants: [],
      isNextCompetitionComingSoon: selection.isNextCompetitionComingSoon,
      isPrimaryCompetitionComingSoon: selection.isPrimaryCompetitionComingSoon,
      nextCompetition: selection.nextCompetition,
      nextCompetitionStartsInDays: selection.nextCompetitionStartsInDays,
      nextKswFixture: undefined,
      primaryCompetitionStartsInDays: selection.primaryCompetitionStartsInDays,
      primarySelectionReason: selection.primarySelectionReason,
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

  const competitionIds = competitionsResult.data.map((competition) => homeText(competition, ["id"], "")).filter(Boolean);
  const [matchesResult, junctionResult, configsResult, cupConfigsResult, partitionsResult, nodesResult, sponsorsResult] = await Promise.all([
    runQuery<HomeRow>("matches", supabase.from("matches").select(matchColumns).in("league_id", competitionIds).order("match_date", { ascending: true })),
    runQuery<HomeRow>("competition_teams", supabase.from("competition_teams").select(junctionColumns).in("competition_id", competitionIds).eq("is_active", true)),
    runQuery<HomeRow>("competition_league_configs", supabase.from("competition_league_configs").select("competition_id, template_key, fixture_version, win_points, draw_points, loss_points, champion_team_id, champion_at").in("competition_id", competitionIds)),
    runQuery<HomeRow>("competition_knockout_configs", supabase.from("competition_knockout_configs").select("competition_id, template_key, entrant_count, bracket_capacity, status").in("competition_id", competitionIds)),
    runQuery<HomeRow>("competition_knockout_partitions", supabase.from("competition_knockout_partitions").select("competition_id, partition_key, partition_label, champion_team_id, champion_at, status").in("competition_id", competitionIds)),
    runQuery<HomeRow>("competition_bracket_nodes", supabase.from("competition_bracket_nodes").select("competition_id, partition_key, round_index, round_label, match_order, linked_match_id").in("competition_id", competitionIds).not("linked_match_id", "is", null)),
    runQuery<HomeRow>("sponsors", supabase.from("sponsors").select(sponsorColumns).order("sort_order", { ascending: true, nullsFirst: false })),
  ]);
  const participantIds = Array.from(new Set(junctionResult.data.map((row) => homeText(row, ["team_id"], "")).filter(Boolean)));
  const teamsResult = participantIds.length
    ? await runQuery<HomeRow>("teams", supabase.from("teams").select("id, name, short_name, logo_url, is_ksw").in("id", participantIds))
    : { data: [] as HomeRow[], error: null };
  const participantsByCompetition = new Map<string, HomeRow[]>();
  const teamRowsById = new Map(teamsResult.data.map((team) => [homeText(team, ["id"], ""), team]));
  junctionResult.data.forEach((junction) => {
    const competitionId = homeText(junction, ["competition_id"], "");
    const team = teamRowsById.get(homeText(junction, ["team_id"], ""));
    if (!competitionId || !team) return;
    participantsByCompetition.set(competitionId, [...(participantsByCompetition.get(competitionId) ?? []), { ...team, participant_is_active: junction.is_active }]);
  });
  const competitionsById = new Map(competitionsResult.data.map((competition) => [homeText(competition, ["id"], ""), competition]));
  const configByCompetition = new Map(configsResult.data.map((config) => [homeText(config, ["competition_id"], ""), config]));
  const cupConfigByCompetition = new Map(cupConfigsResult.data.map((config) => [homeText(config, ["competition_id"], ""), config]));
  if (selection.primarySelectionReason === "latest_completed") {
    const completedWithChampion = competitionsResult.data
      .filter((competition) => homeText(competition, ["season_status"], "") === "completed")
      .sort(completedCompetitionSort)
      .find((competition) => {
        const competitionId = homeText(competition, ["id"], "");
        return Boolean(homeText(configByCompetition.get(competitionId), ["champion_team_id"], ""))
          || partitionsResult.data.some((partition) => homeText(partition, ["competition_id"], "") === competitionId && Boolean(homeText(partition, ["champion_team_id"], "")));
      });
    if (completedWithChampion) {
      currentCompetition = completedWithChampion;
      currentCompetitionId = homeText(currentCompetition, ["id"], "");
      currentCompetitionType = normalizeCompetitionType(currentCompetition.competition_type);
      loadStandings = supportsLeagueStandings(currentCompetitionType);
    }
  }
  const nodeByMatchId = new Map(nodesResult.data.map((node) => [homeText(node, ["linked_match_id"], ""), node]));
  const mappedMatches = matchesResult.data.map((match) => {
    const competitionId = homeText(match, ["league_id"], "");
    const competition = competitionsById.get(competitionId);
    const node = nodeByMatchId.get(homeText(match, ["id"], ""));
    const originalMatchweek = match.matchweek;
    const scheduledMatchweek = match.scheduled_matchweek;
    const effectiveMatchweek = scheduledMatchweek ?? originalMatchweek;
    return mapHomeMatch({
      ...match,
      competition_id: competitionId,
      competition_name: homeText(competition, ["name"], "Competition"),
      competition_slug: homeText(competition, ["slug"], ""),
      competition_type: homeText(competition, ["competition_type"], ""),
      template_key: homeText(cupConfigByCompetition.get(competitionId), ["template_key"], homeText(configByCompetition.get(competitionId), ["template_key"], "")),
      effective_matchweek: effectiveMatchweek,
      original_matchweek: originalMatchweek,
      partition_key: homeText(node, ["partition_key"], homeText(match, ["knockout_partition_key"], "main")),
      partition_label: homeFixturePartitionLabel(homeText(node, ["partition_key"], "") || null) ?? "",
      round_index: node?.round_index ?? null,
      round_label: homeText(node, ["round_label"], ""),
    }, participantsByCompetition.get(competitionId) ?? []);
  });
  const now = new Date().getTime();
  const allScheduledMatches = sortUpcomingFixtures(mappedMatches.filter((match) => {
    const status = homeText(match, ["status"], "").toLowerCase();
    return !isHomeFinishedFixture(status) && homeFixtureTimeValue(match) >= now;
  })).slice(0, 8);
  const allFinishedMatches = mappedMatches.filter((match) => isHomeFinishedFixture(homeText(match, ["status"], ""))).sort((a, b) => homeFixtureTimeValue(b) - homeFixtureTimeValue(a));
  const participantRows = participantsByCompetition.get(currentCompetitionId) ?? [];
  const kswParticipants = participantRows.filter((participant) => participant.is_ksw === true);
  const scheduledKswMatches = allScheduledMatches.filter((match) => match.isKswFixture);
  const finishedKswMatches = allFinishedMatches
    .filter(
      (match) =>
        match.isKswFixture &&
        typeof match.home_score === "number" &&
        typeof match.away_score === "number",
    );
  const allRecentResults = allFinishedMatches.slice(0, 8);
  const recentKswResults = finishedKswMatches.slice(0, 5);
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
  let standings: HomeRow[] = [];
  let standingsError: HomeCompetitionError | null = null;
  const standardConfig = configByCompetition.get(currentCompetitionId);
  if (standardConfig && homeText(standardConfig, ["template_key"], "") === "standard_league") {
    const fixtureVersion = numberValue(standardConfig, "fixture_version");
    standings = calculateStandardLeagueStandings({
      config: { drawPoints: numberValue(standardConfig, "draw_points") || 1, lossPoints: numberValue(standardConfig, "loss_points"), winPoints: numberValue(standardConfig, "win_points") || 3 },
      matches: mappedMatches.filter((match) => homeText(match, ["competition_id"], "") === currentCompetitionId && numberValue(match, "league_fixture_version") === fixtureVersion).map((match) => ({ awayScore: typeof match.away_score === "number" ? match.away_score : null, awayTeamId: homeText(match, ["away_team_id"], ""), fixtureKey: null, homeScore: typeof match.home_score === "number" ? match.home_score : null, homeTeamId: homeText(match, ["home_team_id"], ""), status: homeText(match, ["status"], "") })),
      teams: participantRows.map((team) => ({ id: homeText(team, ["id"], ""), name: homeText(team, ["name"], "Team") })),
    }).rows.map((row) => ({ team_id: row.teamId, team_name: row.teamName, is_ksw: participantRows.find((team) => homeText(team, ["id"], "") === row.teamId)?.is_ksw === true, played: row.played, won: row.wins, drawn: row.draws, lost: row.losses, goals_for: row.goalsFor, goals_against: row.goalsAgainst, goal_difference: row.goalDifference, points: row.points }));
  } else if (loadStandings) {
    const standingsResult = await runQuery<HomeRow>("league_standings_view", supabase.from("league_standings_view").select(standingsColumns).eq("league_id", currentCompetitionId));
    standings = standingsResult.data;
    standingsError = standingsResult.error;
  }
  const championTeamIds = new Set<string>();
  configsResult.data.forEach((config) => championTeamIds.add(homeText(config, ["champion_team_id"], "")));
  partitionsResult.data.forEach((partition) => championTeamIds.add(homeText(partition, ["champion_team_id"], "")));
  const championTeamsResult = championTeamIds.size
    ? await runQuery<HomeRow>("champion_teams", supabase.from("teams").select("id, name").in("id", Array.from(championTeamIds).filter(Boolean)))
    : { data: [] as HomeRow[], error: null };
  const championNameById = new Map(championTeamsResult.data.map((team) => [homeText(team, ["id"], ""), homeText(team, ["name"], "")]));
  const latestChampions = competitionsResult.data.filter((competition) => homeText(competition, ["season_status"], "") === "completed").flatMap((competition) => {
    const competitionId = homeText(competition, ["id"], "");
    const base = { competitionId, competitionName: homeText(competition, ["name"], "Competition"), competitionSlug: homeText(competition, ["slug"], "") };
    const leagueChampion = championNameById.get(homeText(configByCompetition.get(competitionId), ["champion_team_id"], ""));
    if (leagueChampion) return [{ ...base, label: "Champion", teamName: leagueChampion }];
    return partitionsResult.data.filter((partition) => homeText(partition, ["competition_id"], "") === competitionId).flatMap((partition) => {
      const teamName = championNameById.get(homeText(partition, ["champion_team_id"], ""));
      if (!teamName) return [];
      const key = homeText(partition, ["partition_key"], "");
      return [{ ...base, label: key === "division_1" ? "Champion Division 1" : key === "division_2" ? "Champion Division 2" : "Champion", teamName }];
    });
  }).slice(0, 4);
  const errors = withResultErrors(competitionsResult, matchesResult, junctionResult, configsResult, cupConfigsResult, partitionsResult, nodesResult, sponsorsResult, teamsResult, championTeamsResult, { data: [], error: standingsError });

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
    latestChampions,
    isNextCompetitionComingSoon: selection.isNextCompetitionComingSoon,
    isPrimaryCompetitionComingSoon: selection.isPrimaryCompetitionComingSoon,
    kswParticipants,
    nextCompetition: selection.nextCompetition,
    nextCompetitionStartsInDays: selection.nextCompetitionStartsInDays,
    nextKswFixture,
    primaryCompetitionStartsInDays: selection.primaryCompetitionStartsInDays,
    primarySelectionReason: selection.primarySelectionReason,
    rawJunctionRows: junctionResult.data,
    rawMatches: matchesResult.data,
    rawPublishedCompetitions: competitionsResult.data,
    recentKswResults,
    scheduledKswMatches,
    sponsors: sponsorsResult.data,
    standings,
    summary,
  };
}

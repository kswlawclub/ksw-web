"use server";

import { revalidatePath } from "next/cache";
import { calculateCupGroupStandings, type CupGroupRow } from "@/lib/cup-group-standings";
import { requireAdminSession } from "@/lib/admin-server-auth";
import { isCupCompetition, normalizeCompetitionType } from "@/lib/competition-format";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export type KnockoutSourceType = "bye" | "group_rank" | "manual_team" | "match_winner" | "unassigned";

export type KnockoutSlotSource = {
  groupId?: string;
  rank?: number;
  sourceMatchOrder?: number;
  sourceRoundIndex?: number;
  teamId?: string;
  type: KnockoutSourceType;
};

export type KnockoutMatchSlot = {
  away: KnockoutSlotSource;
  bracketSize: number;
  home: KnockoutSlotSource;
  id?: string;
  isManualEdited?: boolean;
  matchId?: string;
  matchOrder: number;
  roundIndex: number;
  roundKey: string;
  roundLabel: string;
};

export type KnockoutRealMatch = {
  awayScore: number | null;
  awayTeamId: string;
  homeScore: number | null;
  homeTeamId: string;
  id: string;
  manualWinnerTeamId: string | null;
  matchDate: string | null;
  penaltyAwayScore: number | null;
  penaltyHomeScore: number | null;
  status: string;
  venue: string | null;
  winnerTeamId: string | null;
};

export type KnockoutResultPayload = {
  awayScore: number | null;
  manualWinnerTeamId?: string | null;
  matchDate?: string | null;
  matchId: string;
  homeScore: number | null;
  penaltyAwayScore?: number | null;
  penaltyHomeScore?: number | null;
  status: "scheduled" | "finished";
  venue?: string | null;
};

export type KnockoutActionResult = {
  matches?: KnockoutMatchSlot[];
  ok: boolean;
  realMatches?: KnockoutRealMatch[];
  warnings?: string[];
  error?: string;
};

export type KnockoutSavePayload = {
  bracketSize: number;
  competitionId: string;
  matches: KnockoutMatchSlot[];
  overwriteManualEdits?: boolean;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const supportedBracketSizes = new Set([4, 8, 16, 32, 64]);
const groupColumns = "id, competition_id, name, label, sort_order, qualifiers_count";
const matchColumns =
  "id, league_id, group_id, competition_stage, fixture_source, match_date, home_team_id, away_team_id, home_score, away_score, venue, status, penalty_home_score, penalty_away_score, manual_winner_team_id, winner_team_id";
const teamColumns = "id, name, short_name, is_ksw";
const competitionTeamColumns = "id, competition_id, team_id, group_id, is_active, display_order";

async function getAdminClient() {
  await requireAdminSession();
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return {
      error: "SUPABASE_SERVICE_ROLE_KEY is missing or Supabase URL is not configured.",
      supabase: null,
    };
  }

  return { error: "", supabase };
}

async function verifyCupCompetition(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  competitionId: string,
) {
  if (!uuidPattern.test(competitionId)) {
    return { error: "Competition id is invalid." };
  }

  const result = await supabase
    .from("leagues")
    .select("id, competition_type")
    .eq("id", competitionId)
    .limit(1)
    .maybeSingle();

  if (result.error) {
    console.error("knockout competition lookup failed", result.error);
    return { error: "Could not verify competition." };
  }

  if (!result.data) {
    return { error: "Competition was not found." };
  }

  if (!isCupCompetition(normalizeCompetitionType(result.data.competition_type))) {
    return { error: "Knockout setup is available for cup competitions only." };
  }

  return { competition: result.data };
}

function roundLabelForTeams(teamCount: number) {
  if (teamCount === 2) return { key: "final", label: "Final" };
  if (teamCount === 4) return { key: "semifinals", label: "Semifinals" };
  if (teamCount === 8) return { key: "quarterfinals", label: "Quarterfinals" };
  return { key: `round_of_${teamCount}`, label: `Round of ${teamCount}` };
}

function bracketRounds(bracketSize: number) {
  const rounds: Array<{ matchCount: number; roundIndex: number; roundKey: string; roundLabel: string }> = [];
  let teamCount = bracketSize;
  let roundIndex = 1;

  while (teamCount >= 2) {
    const label = roundLabelForTeams(teamCount);
    rounds.push({
      matchCount: teamCount / 2,
      roundIndex,
      roundKey: label.key,
      roundLabel: label.label,
    });
    teamCount /= 2;
    roundIndex += 1;
  }

  return rounds;
}

function emptySource(): KnockoutSlotSource {
  return { type: "unassigned" };
}

function byeSource(): KnockoutSlotSource {
  return { type: "bye" };
}

function groupRankSource(groupId: string, rank: number): KnockoutSlotSource {
  return { groupId, rank, type: "group_rank" };
}

function matchWinnerSource(roundIndex: number, matchOrder: number): KnockoutSlotSource {
  return { sourceMatchOrder: matchOrder, sourceRoundIndex: roundIndex, type: "match_winner" };
}

function sourceKey(source: KnockoutSlotSource) {
  if (source.type === "group_rank") return `group_rank:${source.groupId}:${source.rank}`;
  if (source.type === "manual_team") return `manual_team:${source.teamId}`;
  if (source.type === "match_winner") return `match_winner:${source.sourceRoundIndex}:${source.sourceMatchOrder}`;
  return source.type;
}

function sourceGroupId(source: KnockoutSlotSource) {
  return source.type === "group_rank" ? source.groupId : undefined;
}

function rowText(row: CupGroupRow | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value : "";
}

function rowNumber(row: CupGroupRow | undefined, key: string, fallback = 0) {
  const value = row?.[key];
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  return fallback;
}

function mapSavedSource(row: CupGroupRow, side: "away" | "home"): KnockoutSlotSource {
  const type = rowText(row, `${side}_source_type`) as KnockoutSourceType;
  if (type === "group_rank") {
    return {
      groupId: rowText(row, `${side}_group_id`),
      rank: rowNumber(row, `${side}_group_rank`),
      type,
    };
  }
  if (type === "manual_team") {
    return {
      teamId: rowText(row, `${side}_team_id`),
      type,
    };
  }
  if (type === "match_winner") {
    return {
      sourceMatchOrder: rowNumber(row, `${side}_source_match_order`),
      sourceRoundIndex: rowNumber(row, `${side}_source_round_index`),
      type,
    };
  }
  if (type === "bye") return byeSource();
  return emptySource();
}

function mapSavedMatch(row: CupGroupRow): KnockoutMatchSlot {
  return {
    away: mapSavedSource(row, "away"),
    bracketSize: rowNumber(row, "bracket_size"),
    home: mapSavedSource(row, "home"),
    id: rowText(row, "id"),
    isManualEdited: row.is_manual_edited === true,
    matchId: rowText(row, "match_id") || undefined,
    matchOrder: rowNumber(row, "match_order"),
    roundIndex: rowNumber(row, "round_index"),
    roundKey: rowText(row, "round_key"),
    roundLabel: rowText(row, "round_label"),
  };
}

function mapRealMatch(row: CupGroupRow): KnockoutRealMatch {
  return {
    awayScore: rowNumber(row, "away_score", Number.NaN),
    awayTeamId: rowText(row, "away_team_id"),
    homeScore: rowNumber(row, "home_score", Number.NaN),
    homeTeamId: rowText(row, "home_team_id"),
    id: rowText(row, "id"),
    manualWinnerTeamId: rowText(row, "manual_winner_team_id") || null,
    matchDate: rowText(row, "match_date") || null,
    penaltyAwayScore: rowNumber(row, "penalty_away_score", Number.NaN),
    penaltyHomeScore: rowNumber(row, "penalty_home_score", Number.NaN),
    status: rowText(row, "status"),
    venue: rowText(row, "venue") || null,
    winnerTeamId: rowText(row, "winner_team_id") || null,
  };
}

function nullableNumber(row: KnockoutRealMatch, key: "awayScore" | "homeScore" | "penaltyAwayScore" | "penaltyHomeScore") {
  const value = row[key];
  return Number.isFinite(value) ? value : null;
}

function normalizeRealMatch(row: CupGroupRow): KnockoutRealMatch {
  const match = mapRealMatch(row);
  return {
    ...match,
    awayScore: nullableNumber(match, "awayScore"),
    homeScore: nullableNumber(match, "homeScore"),
    penaltyAwayScore: nullableNumber(match, "penaltyAwayScore"),
    penaltyHomeScore: nullableNumber(match, "penaltyHomeScore"),
  };
}

async function loadCupData(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>, competitionId: string) {
  const [groupsResult, participantsResult, matchesResult] = await Promise.all([
    supabase.from("competition_groups").select(groupColumns).eq("competition_id", competitionId).order("sort_order", { ascending: true }),
    supabase
      .from("competition_teams")
      .select(competitionTeamColumns)
      .eq("competition_id", competitionId)
      .eq("is_active", true)
      .order("display_order", { ascending: true }),
    supabase.from("matches").select(matchColumns).eq("league_id", competitionId),
  ]);

  if (groupsResult.error) {
    console.error("knockout groups query failed", groupsResult.error);
    return { error: "Could not load cup groups." };
  }
  if (participantsResult.error) {
    console.error("knockout participants query failed", participantsResult.error);
    return { error: "Could not load cup teams." };
  }
  if (matchesResult.error) {
    console.error("knockout matches query failed", matchesResult.error);
    return { error: "Could not load cup matches." };
  }

  const participantRows = (participantsResult.data ?? []) as CupGroupRow[];
  const teamIds = participantRows.map((row) => rowText(row, "team_id")).filter(Boolean);
  const teamsResult = teamIds.length ? await supabase.from("teams").select(teamColumns).in("id", teamIds) : { data: [], error: null };

  if (teamsResult.error) {
    console.error("knockout teams query failed", teamsResult.error);
    return { error: "Could not load team details." };
  }

  const teamsById = new Map(((teamsResult.data ?? []) as CupGroupRow[]).map((team) => [rowText(team, "id"), team]));
  const groupTeams = participantRows
    .map((row) => {
      const team = teamsById.get(rowText(row, "team_id"));
      return team
        ? {
            ...row,
            is_ksw: team.is_ksw === true,
            name: rowText(team, "name"),
            short_name: rowText(team, "short_name") || null,
        }
        : undefined;
    })
    .filter(Boolean) as CupGroupRow[];

  return {
    groupTeams,
    groups: (groupsResult.data ?? []) as CupGroupRow[],
    matches: (matchesResult.data ?? []) as CupGroupRow[],
  };
}

function blankBracket(bracketSize: number): KnockoutMatchSlot[] {
  const slots: KnockoutMatchSlot[] = [];

  bracketRounds(bracketSize).forEach((round) => {
    for (let index = 1; index <= round.matchCount; index += 1) {
      const homeSourceMatchOrder = index * 2 - 1;
      const awaySourceMatchOrder = index * 2;
      slots.push({
        away: round.roundIndex === 1 ? emptySource() : matchWinnerSource(round.roundIndex - 1, awaySourceMatchOrder),
        bracketSize,
        home: round.roundIndex === 1 ? emptySource() : matchWinnerSource(round.roundIndex - 1, homeSourceMatchOrder),
        matchOrder: index,
        roundIndex: round.roundIndex,
        roundKey: round.roundKey,
        roundLabel: round.roundLabel,
      });
    }
  });

  return slots;
}

function validateBracketSize(bracketSize: number) {
  return Number.isInteger(bracketSize) && supportedBracketSizes.has(bracketSize);
}

function buildSuggestedFirstRound(
  groups: CupGroupRow[],
  groupTeams: CupGroupRow[],
  matches: CupGroupRow[],
  bracketSize: number,
) {
  const warnings: string[] = [];
  const standings = calculateCupGroupStandings({ groups, matches, teams: groupTeams });
  const nonStandardGroup = standings.find((group) => group.qualifiers_count !== 2);

  if (nonStandardGroup) {
    return {
      error: "Suggested pairing supports groups with exactly 2 qualifying teams. Use Custom pairing for this setup.",
      warnings,
    };
  }

  if (standings.some((group) => group.rows.length < 2)) {
    return {
      error: "Suggested pairing requires at least 2 teams in every group. Use Custom pairing for this setup.",
      warnings,
    };
  }

  const winners = standings
    .filter((group) => group.rows.some((row) => row.position === 1))
    .map((group) => groupRankSource(group.group_id, 1));
  const runners = standings
    .filter((group) => group.rows.some((row) => row.position === 2))
    .map((group) => groupRankSource(group.group_id, 2));
  const qualifierCount = winners.length + runners.length;

  if (qualifierCount < 2) {
    return { error: "Not enough qualified teams for suggested pairing.", warnings };
  }
  if (qualifierCount > bracketSize) {
    return { error: "Bracket size is smaller than the current qualified teams.", warnings };
  }

  const firstRoundMatchCount = bracketSize / 2;
  const firstRound: Array<{ away: KnockoutSlotSource; home: KnockoutSlotSource }> = [];
  let rotation = runners.length > 1 ? 1 : 0;
  let paired = false;

  while (rotation < Math.max(runners.length, 1) && !paired) {
    const pairings = winners.map((winner, index) => ({
      away: runners[(index + rotation) % runners.length],
      home: winner,
    }));
    paired = pairings.every((pair) => pair.away && sourceGroupId(pair.home) !== sourceGroupId(pair.away));
    if (paired) firstRound.push(...pairings);
    rotation += 1;
  }

  if (!paired) {
    return {
      error: "Could not create suggested pairing without same-group first-round matches. Use Custom pairing.",
      warnings,
    };
  }

  while (firstRound.length < firstRoundMatchCount) {
    firstRound.push({ away: byeSource(), home: emptySource() });
  }

  if (qualifierCount < bracketSize) {
    warnings.push("Suggested pairing includes Bye/unassigned slots because the bracket is larger than current qualifiers.");
  }

  return { firstRound, warnings };
}

function applyFirstRound(bracket: KnockoutMatchSlot[], firstRound: Array<{ away: KnockoutSlotSource; home: KnockoutSlotSource }>) {
  return bracket.map((match) => {
    if (match.roundIndex !== 1) return match;
    const slot = firstRound[match.matchOrder - 1];
    return slot ? { ...match, away: slot.away, home: slot.home } : match;
  });
}

type ResolvedSource = {
  teamId?: string;
  waiting?: string;
  type: "bye" | "team" | "unresolved";
};

type KnockoutContext = {
  matchesById: Map<string, KnockoutRealMatch>;
  setupByPosition: Map<string, KnockoutMatchSlot>;
  standingsByGroupId: Map<string, ReturnType<typeof calculateCupGroupStandings>[number]>;
};

type LoadedKnockoutState = {
  groupTeams: CupGroupRow[];
  groups: CupGroupRow[];
  matches: CupGroupRow[];
  realMatches: KnockoutRealMatch[];
  setupMatches: KnockoutMatchSlot[];
};

function setupPosition(roundIndex: number | undefined, matchOrder: number | undefined) {
  return `${roundIndex ?? 0}:${matchOrder ?? 0}`;
}

function resolveSlotSource(source: KnockoutSlotSource, context: KnockoutContext, depth = 0): ResolvedSource {
  if (depth > 10) return { type: "unresolved", waiting: "Knockout source loop detected." };
  if (source.type === "bye") return { type: "bye" };
  if (source.type === "unassigned") return { type: "unresolved", waiting: "Slot is unassigned." };
  if (source.type === "manual_team") {
    return source.teamId
      ? { teamId: source.teamId, type: "team" }
      : { type: "unresolved", waiting: "Manual team is not selected." };
  }
  if (source.type === "group_rank") {
    const row = context.standingsByGroupId
      .get(source.groupId ?? "")
      ?.rows.find((standingRow) => standingRow.position === source.rank);
    return row
      ? { teamId: row.team_id, type: "team" }
      : { type: "unresolved", waiting: "Waiting for group standings." };
  }

  const sourceSetup = context.setupByPosition.get(setupPosition(source.sourceRoundIndex, source.sourceMatchOrder));
  if (!sourceSetup) return { type: "unresolved", waiting: "Source match was not found." };
  return resolveSetupWinner(sourceSetup, context, depth + 1);
}

function resolveSetupWinner(setup: KnockoutMatchSlot, context: KnockoutContext, depth = 0): ResolvedSource {
  const home = resolveSlotSource(setup.home, context, depth + 1);
  const away = resolveSlotSource(setup.away, context, depth + 1);

  if (home.type === "bye" && away.type === "team") return away;
  if (away.type === "bye" && home.type === "team") return home;

  const realMatch = setup.matchId ? context.matchesById.get(setup.matchId) : undefined;
  if (realMatch?.winnerTeamId) return { teamId: realMatch.winnerTeamId, type: "team" };

  return { type: "unresolved", waiting: `Waiting for winner of Match ${setup.matchOrder}.` };
}

function createKnockoutContext(groups: CupGroupRow[], groupTeams: CupGroupRow[], groupMatches: CupGroupRow[], setup: KnockoutMatchSlot[], realMatches: KnockoutRealMatch[]): KnockoutContext {
  const standings = calculateCupGroupStandings({ groups, matches: groupMatches, teams: groupTeams });
  return {
    matchesById: new Map(realMatches.map((match) => [match.id, match])),
    setupByPosition: new Map(setup.map((match) => [setupPosition(match.roundIndex, match.matchOrder), match])),
    standingsByGroupId: new Map(standings.map((standing) => [standing.group_id, standing])),
  };
}

function validateSlot(source: KnockoutSlotSource, label: string, groupIds: Set<string>, teamIds: Set<string>) {
  if (source.type === "group_rank") {
    if (!source.groupId || !groupIds.has(source.groupId) || !Number.isInteger(source.rank) || (source.rank ?? 0) < 1) {
      return `${label} group-rank source is invalid.`;
    }
  }
  if (source.type === "manual_team" && (!source.teamId || !teamIds.has(source.teamId))) {
    return `${label} manual-team source is invalid.`;
  }
  if (source.type === "match_winner" && (!Number.isInteger(source.sourceRoundIndex) || !Number.isInteger(source.sourceMatchOrder))) {
    return `${label} match-winner source is invalid.`;
  }
  return "";
}

function validateMatchWinnerSource(source: KnockoutSlotSource, match: KnockoutMatchSlot, positions: Set<string>) {
  if (source.type !== "match_winner") return "";

  const sourceRoundIndex = source.sourceRoundIndex ?? 0;
  const sourceMatchOrder = source.sourceMatchOrder ?? 0;

  if (sourceRoundIndex >= match.roundIndex) {
    return `Round ${match.roundIndex} Match ${match.matchOrder} winner source must come from an earlier round.`;
  }

  if (!positions.has(`${sourceRoundIndex}:${sourceMatchOrder}`)) {
    return `Round ${match.roundIndex} Match ${match.matchOrder} winner source points to an invalid match.`;
  }

  return "";
}

function validateSlotWarnings(matches: KnockoutMatchSlot[]) {
  const warnings: string[] = [];
  const firstRoundSources = new Map<string, number>();

  matches
    .filter((match) => match.roundIndex === 1)
    .forEach((match) => {
      [match.home, match.away].forEach((source) => {
        if (source.type === "bye" || source.type === "unassigned") return;
        const key = sourceKey(source);
        firstRoundSources.set(key, (firstRoundSources.get(key) ?? 0) + 1);
      });

      if (sourceKey(match.home) === sourceKey(match.away) && match.home.type !== "unassigned") {
        warnings.push(`Match ${match.matchOrder} uses the same source on both sides.`);
      }
      if (sourceGroupId(match.home) && sourceGroupId(match.home) === sourceGroupId(match.away)) {
        warnings.push(`Match ${match.matchOrder} pairs sources from the same group.`);
      }
    });

  firstRoundSources.forEach((count, key) => {
    if (count > 1) warnings.push(`First round source is used more than once: ${key}.`);
  });

  return warnings;
}

function sourceColumns(source: KnockoutSlotSource, side: "away" | "home") {
  return {
    [`${side}_group_id`]: source.type === "group_rank" ? source.groupId : null,
    [`${side}_group_rank`]: source.type === "group_rank" ? source.rank : null,
    [`${side}_source_match_order`]: source.type === "match_winner" ? source.sourceMatchOrder : null,
    [`${side}_source_round_index`]: source.type === "match_winner" ? source.sourceRoundIndex : null,
    [`${side}_source_type`]: source.type,
    [`${side}_team_id`]: source.type === "manual_team" ? source.teamId : null,
  };
}

async function loadSavedMatches(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>, competitionId: string) {
  const result = await supabase
    .from("competition_knockout_matches")
    .select("*")
    .eq("competition_id", competitionId)
    .order("round_index", { ascending: true })
    .order("match_order", { ascending: true });

  if (result.error) {
    console.error("knockout saved matches query failed", result.error);
    return { error: "Could not load knockout setup." };
  }

  return { matches: ((result.data ?? []) as CupGroupRow[]).map(mapSavedMatch) };
}

async function loadRealKnockoutMatches(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  setupMatches: KnockoutMatchSlot[],
) {
  const matchIds = Array.from(new Set(setupMatches.map((match) => match.matchId).filter(Boolean))) as string[];

  if (!matchIds.length) return { realMatches: [] as KnockoutRealMatch[] };

  const result = await supabase
    .from("matches")
    .select(matchColumns)
    .in("id", matchIds);

  if (result.error) {
    console.error("knockout real matches query failed", result.error);
    return { error: "Could not load knockout matches." };
  }

  return {
    realMatches: ((result.data ?? []) as CupGroupRow[]).map(normalizeRealMatch),
  };
}

async function loadKnockoutState(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  competitionId: string,
): Promise<{ ok: false; error: string } | ({ ok: true } & LoadedKnockoutState)> {
  const saved = await loadSavedMatches(supabase, competitionId);
  if (saved.error) return { ok: false, error: saved.error };

  const data = await loadCupData(supabase, competitionId);
  if (data.error) return { ok: false, error: data.error };

  const real = await loadRealKnockoutMatches(supabase, saved.matches ?? []);
  if (real.error) return { ok: false, error: real.error };

  return {
    groupTeams: data.groupTeams ?? [],
    groups: data.groups ?? [],
    matches: data.matches ?? [],
    ok: true,
    realMatches: real.realMatches ?? [],
    setupMatches: saved.matches ?? [],
  };
}

export async function loadKnockoutSetup(competitionId: string): Promise<KnockoutActionResult> {
  const { supabase, error } = await getAdminClient();
  if (!supabase) return { ok: false, error };

  const competitionCheck = await verifyCupCompetition(supabase, competitionId);
  if (competitionCheck.error) return { ok: false, error: competitionCheck.error };

  const saved = await loadSavedMatches(supabase, competitionId);
  if (saved.error) return { ok: false, error: saved.error };

  const real = await loadRealKnockoutMatches(supabase, saved.matches ?? []);
  if (real.error) return { ok: false, error: real.error };

  return { ok: true, matches: saved.matches ?? [], realMatches: real.realMatches ?? [] };
}

export async function previewSuggestedKnockout(
  competitionId: string,
  bracketSize: number,
): Promise<KnockoutActionResult> {
  const { supabase, error } = await getAdminClient();
  if (!supabase) return { ok: false, error };

  if (!validateBracketSize(bracketSize)) {
    return { ok: false, error: "Bracket size must be 4, 8, 16, 32, or 64." };
  }

  const competitionCheck = await verifyCupCompetition(supabase, competitionId);
  if (competitionCheck.error) return { ok: false, error: competitionCheck.error };

  const data = await loadCupData(supabase, competitionId);
  if (data.error) return { ok: false, error: data.error };

  const firstRound = buildSuggestedFirstRound(data.groups ?? [], data.groupTeams ?? [], data.matches ?? [], bracketSize);
  if (firstRound.error || !firstRound.firstRound) return { ok: false, error: firstRound.error, warnings: firstRound.warnings };

  return {
    matches: applyFirstRound(blankBracket(bracketSize), firstRound.firstRound),
    ok: true,
    warnings: firstRound.warnings,
  };
}

export async function previewBlankKnockout(bracketSize: number): Promise<KnockoutActionResult> {
  if (!validateBracketSize(bracketSize)) {
    return { ok: false, error: "Bracket size must be 4, 8, 16, 32, or 64." };
  }

  return { matches: blankBracket(bracketSize), ok: true };
}

export async function saveKnockoutSetup(payload: KnockoutSavePayload): Promise<KnockoutActionResult> {
  const { supabase, error } = await getAdminClient();
  if (!supabase) return { ok: false, error };

  if (!validateBracketSize(payload.bracketSize)) {
    return { ok: false, error: "Bracket size must be 4, 8, 16, 32, or 64." };
  }

  const competitionCheck = await verifyCupCompetition(supabase, payload.competitionId);
  if (competitionCheck.error) return { ok: false, error: competitionCheck.error };

  const data = await loadCupData(supabase, payload.competitionId);
  if (data.error) return { ok: false, error: data.error };

  const groupIds = new Set((data.groups ?? []).map((group) => rowText(group, "id")));
  const teamIds = new Set((data.groupTeams ?? []).map((team) => rowText(team, "team_id")).filter(Boolean));
  const expectedPositions = new Set(blankBracket(payload.bracketSize).map((match) => `${match.roundIndex}:${match.matchOrder}`));
  const seenPositions = new Set<string>();

  for (const match of payload.matches) {
    const position = `${match.roundIndex}:${match.matchOrder}`;
    if (!expectedPositions.has(position) || seenPositions.has(position)) {
      return { ok: false, error: "Bracket contains invalid or duplicate match positions." };
    }
    seenPositions.add(position);

    const homeError = validateSlot(match.home, `Round ${match.roundIndex} Match ${match.matchOrder} home`, groupIds, teamIds);
    const awayError = validateSlot(match.away, `Round ${match.roundIndex} Match ${match.matchOrder} away`, groupIds, teamIds);
    if (homeError || awayError) return { ok: false, error: homeError || awayError };

    const homeWinnerError = validateMatchWinnerSource(match.home, match, expectedPositions);
    const awayWinnerError = validateMatchWinnerSource(match.away, match, expectedPositions);
    if (homeWinnerError || awayWinnerError) return { ok: false, error: homeWinnerError || awayWinnerError };

    if (match.home.type === "bye" && match.away.type === "bye") {
      return { ok: false, error: "A knockout match cannot have Bye on both sides." };
    }
  }

  if (seenPositions.size !== expectedPositions.size) {
    return { ok: false, error: "Bracket is incomplete." };
  }

  const saved = await loadSavedMatches(supabase, payload.competitionId);
  if (saved.error) return { ok: false, error: saved.error };
  const hasManualEdits = (saved.matches ?? []).some((match) => match.isManualEdited);

  if (hasManualEdits && !payload.overwriteManualEdits) {
    return {
      ok: false,
      error: "Existing knockout setup contains manual edits. Confirm regenerate before overwriting.",
      warnings: validateSlotWarnings(payload.matches),
    };
  }

  const insertRows = payload.matches.map((match) => ({
    ...sourceColumns(match.home, "home"),
    ...sourceColumns(match.away, "away"),
    bracket_size: payload.bracketSize,
    competition_id: payload.competitionId,
    is_manual_edited: true,
    match_order: match.matchOrder,
    round_index: match.roundIndex,
    round_key: match.roundKey,
    round_label: match.roundLabel,
  }));
  const insertResult = await supabase
    .from("competition_knockout_matches")
    .upsert(insertRows, { onConflict: "competition_id,round_index,match_order" });

  if (insertResult.error) {
    console.error("knockout setup upsert failed", insertResult.error);
    return { ok: false, error: "Could not save knockout setup." };
  }

  const cleanupResult = await supabase
    .from("competition_knockout_matches")
    .delete()
    .eq("competition_id", payload.competitionId)
    .neq("bracket_size", payload.bracketSize);

  if (cleanupResult.error) {
    console.error("knockout setup cleanup failed", cleanupResult.error);
    return { ok: false, error: "Knockout setup was saved, but old bracket rows could not be cleaned up." };
  }

  revalidatePath(`/admin/competitions/${payload.competitionId}`);
  return {
    matches: payload.matches.map((match) => ({ ...match, isManualEdited: true })),
    ok: true,
    warnings: validateSlotWarnings(payload.matches),
  };
}

function scoreError(value: number | null | undefined, label: string) {
  if (value === null || value === undefined) return "";
  if (!Number.isFinite(value) || !Number.isInteger(value)) return `${label} must be a whole number.`;
  if (value < 0 || value > 999) return `${label} must be between 0 and 999.`;
  return "";
}

function deriveWinner(payload: KnockoutResultPayload, match: KnockoutRealMatch) {
  if (payload.status === "scheduled") {
    return { winnerTeamId: null, error: "" };
  }

  const homeScore = payload.homeScore;
  const awayScore = payload.awayScore;
  const penaltyHomeScore = payload.penaltyHomeScore ?? null;
  const penaltyAwayScore = payload.penaltyAwayScore ?? null;
  const manualWinnerTeamId = payload.manualWinnerTeamId?.trim() || null;

  const errors = [
    scoreError(homeScore, "Home score"),
    scoreError(awayScore, "Away score"),
    scoreError(penaltyHomeScore, "Home penalty score"),
    scoreError(penaltyAwayScore, "Away penalty score"),
  ].filter(Boolean);
  if (errors.length) return { winnerTeamId: null, error: errors[0] };

  if (homeScore === null || awayScore === null) {
    return { winnerTeamId: null, error: "Finished knockout matches require both scores." };
  }

  if (manualWinnerTeamId && manualWinnerTeamId !== match.homeTeamId && manualWinnerTeamId !== match.awayTeamId) {
    return { winnerTeamId: null, error: "Manual winner must be one of the match teams." };
  }

  if (homeScore > awayScore) return { winnerTeamId: match.homeTeamId, error: "" };
  if (awayScore > homeScore) return { winnerTeamId: match.awayTeamId, error: "" };
  if (manualWinnerTeamId) return { winnerTeamId: manualWinnerTeamId, error: "" };

  if (penaltyHomeScore === null || penaltyAwayScore === null) {
    return { winnerTeamId: null, error: "Drawn knockout matches require penalties or a manual winner." };
  }

  if (penaltyHomeScore === penaltyAwayScore) {
    return { winnerTeamId: null, error: "Penalty score must produce a winner." };
  }

  return {
    error: "",
    winnerTeamId: penaltyHomeScore > penaltyAwayScore ? match.homeTeamId : match.awayTeamId,
  };
}

function matchHasStartedOrResult(match: KnockoutRealMatch | undefined) {
  if (!match) return false;
  return (
    match.status === "finished" ||
    match.homeScore !== null ||
    match.awayScore !== null ||
    match.winnerTeamId !== null
  );
}

async function ensureKnockoutMatches(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  competitionId: string,
  options: { strictFirstRound?: boolean } = {},
) {
  const state = await loadKnockoutState(supabase, competitionId);
  if (!state.ok) return { ok: false, error: state.error };

  const setupMatches = state.setupMatches ?? [];
  if (!setupMatches.length) return { ok: false, error: "Save knockout setup before creating matches." };

  const realMatches = [...(state.realMatches ?? [])];
  const context = createKnockoutContext(
    state.groups ?? [],
    state.groupTeams ?? [],
    state.matches ?? [],
    setupMatches,
    realMatches,
  );
  let createdCount = 0;
  let advancedByes = 0;

  for (const setup of setupMatches.sort((a, b) => a.roundIndex - b.roundIndex || a.matchOrder - b.matchOrder)) {
    const home = resolveSlotSource(setup.home, context);
    const away = resolveSlotSource(setup.away, context);

    if (home.type === "unresolved" || away.type === "unresolved") {
      if (options.strictFirstRound && setup.roundIndex === 1) {
        return { ok: false, error: `Round ${setup.roundIndex} Match ${setup.matchOrder} has unresolved knockout slots.` };
      }
      continue;
    }

    if ((home.type === "bye" && away.type === "team") || (away.type === "bye" && home.type === "team")) {
      advancedByes += 1;
      continue;
    }

    if (home.type !== "team" || away.type !== "team" || !home.teamId || !away.teamId) {
      return { ok: false, error: `Round ${setup.roundIndex} Match ${setup.matchOrder} has unresolved knockout slots.` };
    }

    if (home.teamId === away.teamId) {
      return { ok: false, error: `Round ${setup.roundIndex} Match ${setup.matchOrder} has the same team on both sides.` };
    }

    const currentMatch = setup.matchId ? context.matchesById.get(setup.matchId) : undefined;
    if (currentMatch) {
      if (
        !matchHasStartedOrResult(currentMatch) &&
        (currentMatch.homeTeamId !== home.teamId || currentMatch.awayTeamId !== away.teamId)
      ) {
        const updateResult = await supabase
          .from("matches")
          .update({
            away_team_id: away.teamId,
            home_team_id: home.teamId,
          })
          .eq("id", currentMatch.id);

        if (updateResult.error) {
          console.error("knockout match team update failed", updateResult.error);
          return { ok: false, error: "Could not update knockout match teams." };
        }

        currentMatch.homeTeamId = home.teamId;
        currentMatch.awayTeamId = away.teamId;
      }
      continue;
    }

    const insertResult = await supabase
      .from("matches")
      .insert({
        away_score: null,
        away_team_id: away.teamId,
        competition_stage: "knockout",
        fixture_source: "generated",
        group_id: null,
        home_score: null,
        home_team_id: home.teamId,
        league_id: competitionId,
        match_date: null,
        status: "scheduled",
        venue: null,
      })
      .select(matchColumns)
      .single();

    if (insertResult.error || !insertResult.data) {
      console.error("knockout match insert failed", insertResult.error);
      return { ok: false, error: "Could not create knockout match." };
    }

    const newMatch = normalizeRealMatch(insertResult.data as CupGroupRow);
    const linkResult = await supabase
      .from("competition_knockout_matches")
      .update({ match_id: newMatch.id })
      .eq("competition_id", competitionId)
      .eq("round_index", setup.roundIndex)
      .eq("match_order", setup.matchOrder);

    if (linkResult.error) {
      console.error("knockout setup match link failed", linkResult.error);
      return { ok: false, error: "Could not link knockout match to setup." };
    }

    setup.matchId = newMatch.id;
    context.matchesById.set(newMatch.id, newMatch);
    realMatches.push(newMatch);
    createdCount += 1;
  }

  return { ok: true, createdCount, advancedByes };
}

export async function createKnockoutMatches(competitionId: string): Promise<KnockoutActionResult & { createdCount?: number; advancedByes?: number }> {
  const { supabase, error } = await getAdminClient();
  if (!supabase) return { ok: false, error };

  const competitionCheck = await verifyCupCompetition(supabase, competitionId);
  if (competitionCheck.error) return { ok: false, error: competitionCheck.error };

  const result = await ensureKnockoutMatches(supabase, competitionId, { strictFirstRound: true });
  if (!result.ok) return result;

  revalidatePath(`/admin/competitions/${competitionId}`);
  return { ok: true, createdCount: result.createdCount, advancedByes: result.advancedByes };
}

async function protectDownstreamStartedMatches(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  competitionId: string,
  sourceSetup: KnockoutMatchSlot,
  newWinnerTeamId: string | null,
) {
  if (!newWinnerTeamId) return "";

  const state = await loadKnockoutState(supabase, competitionId);
  if (!state.ok) return state.error;
  const setupMatches = state.setupMatches ?? [];
  const realMatchesById = new Map((state.realMatches ?? []).map((match) => [match.id, match]));
  const context = createKnockoutContext(
    state.groups ?? [],
    state.groupTeams ?? [],
    state.matches ?? [],
    setupMatches,
    state.realMatches ?? [],
  );

  const downstreamRows = setupMatches.filter((setup) =>
    [setup.home, setup.away].some(
      (source) =>
        source.type === "match_winner" &&
        source.sourceRoundIndex === sourceSetup.roundIndex &&
        source.sourceMatchOrder === sourceSetup.matchOrder,
    ),
  );

  for (const downstream of downstreamRows) {
    const downstreamMatch = downstream.matchId ? realMatchesById.get(downstream.matchId) : undefined;
    if (!downstreamMatch) continue;

    const nextHome =
      downstream.home.type === "match_winner" &&
      downstream.home.sourceRoundIndex === sourceSetup.roundIndex &&
      downstream.home.sourceMatchOrder === sourceSetup.matchOrder
        ? { teamId: newWinnerTeamId, type: "team" as const }
        : resolveSlotSource(downstream.home, context);
    const nextAway =
      downstream.away.type === "match_winner" &&
      downstream.away.sourceRoundIndex === sourceSetup.roundIndex &&
      downstream.away.sourceMatchOrder === sourceSetup.matchOrder
        ? { teamId: newWinnerTeamId, type: "team" as const }
        : resolveSlotSource(downstream.away, context);
    const homeTeamId = nextHome.type === "team" ? nextHome.teamId : "";
    const awayTeamId = nextAway.type === "team" ? nextAway.teamId : "";

    if (
      ((homeTeamId && homeTeamId !== downstreamMatch.homeTeamId) ||
        (awayTeamId && awayTeamId !== downstreamMatch.awayTeamId)) &&
      matchHasStartedOrResult(downstreamMatch)
    ) {
      return "Cannot change this winner because the next round match already has a result.";
    }
  }

  return "";
}

export async function updateKnockoutMatchResult(
  competitionId: string,
  payload: KnockoutResultPayload,
): Promise<KnockoutActionResult> {
  const { supabase, error } = await getAdminClient();
  if (!supabase) return { ok: false, error };

  const competitionCheck = await verifyCupCompetition(supabase, competitionId);
  if (competitionCheck.error) return { ok: false, error: competitionCheck.error };

  const state = await loadKnockoutState(supabase, competitionId);
  if (!state.ok) return { ok: false, error: state.error };

  const setup = (state.setupMatches ?? []).find((match) => match.matchId === payload.matchId);
  const match = (state.realMatches ?? []).find((realMatch) => realMatch.id === payload.matchId);

  if (!setup || !match) {
    return { ok: false, error: "Knockout match was not found." };
  }

  const winner = deriveWinner(payload, match);
  if (winner.error) return { ok: false, error: winner.error };

  if (match.winnerTeamId && winner.winnerTeamId && match.winnerTeamId !== winner.winnerTeamId) {
    const downstreamError = await protectDownstreamStartedMatches(supabase, competitionId, setup, winner.winnerTeamId);
    if (downstreamError) return { ok: false, error: downstreamError };
  }

  const updateResult = await supabase
    .from("matches")
    .update({
      away_score: payload.status === "scheduled" ? null : payload.awayScore,
      home_score: payload.status === "scheduled" ? null : payload.homeScore,
      manual_winner_team_id: payload.status === "scheduled" ? null : payload.manualWinnerTeamId?.trim() || null,
      match_date: payload.matchDate?.trim() || null,
      penalty_away_score: payload.status === "scheduled" ? null : payload.penaltyAwayScore ?? null,
      penalty_home_score: payload.status === "scheduled" ? null : payload.penaltyHomeScore ?? null,
      status: payload.status,
      venue: payload.venue?.trim() || null,
      winner_team_id: winner.winnerTeamId,
    })
    .eq("id", payload.matchId)
    .eq("league_id", competitionId);

  if (updateResult.error) {
    console.error("knockout match result update failed", updateResult.error);
    return { ok: false, error: "Could not update knockout match result." };
  }

  const progressionResult = await ensureKnockoutMatches(supabase, competitionId);
  if (!progressionResult.ok) return progressionResult;

  revalidatePath(`/admin/competitions/${competitionId}`);
  return { ok: true };
}

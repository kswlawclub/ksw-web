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
  matchOrder: number;
  roundIndex: number;
  roundKey: string;
  roundLabel: string;
};

export type KnockoutActionResult = {
  matches?: KnockoutMatchSlot[];
  ok: boolean;
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
const matchColumns = "id, league_id, group_id, competition_stage, match_date, home_team_id, away_team_id, home_score, away_score, venue, status";
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
    matchOrder: rowNumber(row, "match_order"),
    roundIndex: rowNumber(row, "round_index"),
    roundKey: rowText(row, "round_key"),
    roundLabel: rowText(row, "round_label"),
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
      const priorMatchOrder = Math.ceil(index / 2);
      slots.push({
        away: round.roundIndex === 1 ? emptySource() : matchWinnerSource(round.roundIndex - 1, priorMatchOrder * 2),
        bracketSize,
        home: round.roundIndex === 1 ? emptySource() : matchWinnerSource(round.roundIndex - 1, priorMatchOrder * 2 - 1),
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

export async function loadKnockoutSetup(competitionId: string): Promise<KnockoutActionResult> {
  const { supabase, error } = await getAdminClient();
  if (!supabase) return { ok: false, error };

  const competitionCheck = await verifyCupCompetition(supabase, competitionId);
  if (competitionCheck.error) return { ok: false, error: competitionCheck.error };

  const saved = await loadSavedMatches(supabase, competitionId);
  if (saved.error) return { ok: false, error: saved.error };

  return { ok: true, matches: saved.matches ?? [] };
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

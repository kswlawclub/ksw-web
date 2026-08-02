"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin-server-auth";
import { isLeagueCompetition, normalizeCompetitionType } from "@/lib/competition-format";
import { loadCompetitionParticipants } from "@/lib/competition-participants";
import { updateMatch } from "@/app/admin/matches/actions";
import { resolveStandardLeagueChampion } from "@/lib/league-template/champion-resolver";
import { applyLeagueFixtureOverrides, type LeagueFixtureOverride } from "@/lib/league-template/fixture-overrides";
import { generateRoundRobinFixtures } from "@/lib/league-template/round-robin";
import { calculateStandardLeagueStandings, type StandardLeagueMatch } from "@/lib/league-template/standings";
import { getLeagueStandingsPolicy } from "@/lib/league-template/standings-policies";
import {
  STANDARD_LEAGUE_TEMPLATE_KEY,
  type LeagueFixturePlan,
  type StandardLeagueConfig,
  type StandardLeagueMatchweek,
  type StandardLeagueRescheduleActionResult,
} from "@/lib/league-template/types";
import {
  mapStandardLeagueRescheduledMatch,
  parseStandardLeagueRescheduleRpcResult,
  validateStandardLeagueRescheduleInput,
} from "@/lib/league-template/reschedule-action-contract";
import { effectiveMatchweekOrNull } from "@/lib/league-matchweek-rescheduling";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { sortTeamsByName } from "@/lib/team-sort";

type Row = Record<string, unknown>;
type LeagueSettingsInput = Pick<StandardLeagueConfig, "drawPoints" | "lossPoints" | "standingsPolicyKey" | "winPoints">;

export type LeagueConfigActionResult = {
  config?: StandardLeagueConfig | null;
  error?: string;
  ok: boolean;
};

export type LeagueFixturePreviewResult = LeagueConfigActionResult & {
  plan?: LeagueFixturePlan;
};

export type LeagueFixtureConfirmationResult = LeagueConfigActionResult & {
  createdCount?: number;
  fixtureVersion?: number;
  existingCount?: number;
};

export type LeagueMatchSaveResult = LeagueConfigActionResult & {
  champion?: { championAt: string | null; championTeamId: string | null };
};

export type LeagueMatchweekActionResult = LeagueConfigActionResult & {
  matchweekState?: StandardLeagueMatchweek;
  matches?: LeagueMatchweekDraftMatch[];
};

export type LeagueMatchweekDraftMatch = {
  awayTeamId: string;
  homeTeamId: string;
  matchDate: string | null;
  matchId: string;
  venue: string | null;
};

export type LeagueMatchweekConfirmationFixture = {
  awayTeamId: string;
  homeTeamId: string;
  matchId: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const configColumns = "competition_id, template_key, legs, win_points, draw_points, loss_points, standings_policy_key, fixture_status, fixture_version, confirmed_at, confirmed_by, confirmed_by_label, champion_team_id, champion_at";
const matchweekColumns = "matchweek, status, confirmed_at, confirmed_by_label, updated_at";
const rescheduledMatchColumns = "id, league_id, league_fixture_key, league_fixture_version, league_leg, matchweek, scheduled_matchweek, reschedule_reason, rescheduled_at, rescheduled_by, group_id, competition_stage, fixture_source, match_date, home_team_id, away_team_id, home_score, away_score, venue, status";

function text(row: Row | null | undefined, key: string) {
  return typeof row?.[key] === "string" ? row[key] as string : "";
}

function integer(row: Row | null | undefined, key: string, fallback: number) {
  return typeof row?.[key] === "number" && Number.isInteger(row[key]) ? row[key] as number : fallback;
}

function configFromRow(row: Row | null | undefined): StandardLeagueConfig | null {
  if (!row || text(row, "template_key") !== STANDARD_LEAGUE_TEMPLATE_KEY) return null;
  const fixtureStatus = text(row, "fixture_status") === "confirmed" ? "confirmed" : "draft";
  const policy = text(row, "standings_policy_key");
  return {
    championAt: text(row, "champion_at") || null,
    championTeamId: text(row, "champion_team_id") || null,
    competitionId: text(row, "competition_id"),
    confirmedAt: text(row, "confirmed_at") || null,
    confirmedBy: text(row, "confirmed_by") || null,
    confirmedByLabel: text(row, "confirmed_by_label") || null,
    drawPoints: integer(row, "draw_points", 1),
    fixtureStatus,
    fixtureVersion: integer(row, "fixture_version", 0),
    legs: 1,
    lossPoints: integer(row, "loss_points", 0),
    standingsPolicyKey: policy === "legacy_season6" ? "legacy_season6" : "standard_league_v1",
    templateKey: STANDARD_LEAGUE_TEMPLATE_KEY,
    winPoints: integer(row, "win_points", 3),
  };
}

function matchweekFromRow(row: Row | null | undefined): StandardLeagueMatchweek | null {
  if (!row) return null;
  const status = text(row, "status");
  if (!Number.isInteger(row.matchweek) || !["unconfigured", "draft", "confirmed", "completed"].includes(status)) return null;
  return {
    confirmedAt: text(row, "confirmed_at") || null,
    confirmedBy: text(row, "confirmed_by_label") || null,
    matchweek: row.matchweek as number,
    status: status as StandardLeagueMatchweek["status"],
    updatedAt: text(row, "updated_at") || null,
  };
}

function validateSettings(input: LeagueSettingsInput) {
  if (![input.winPoints, input.drawPoints, input.lossPoints].every((value) => Number.isInteger(value) && value >= 0 && value <= 9)) {
    return "คะแนนชนะ เสมอ และแพ้ ต้องเป็นจำนวนเต็มระหว่าง 0 ถึง 9";
  }
  if (!getLeagueStandingsPolicy(input.standingsPolicyKey) || input.standingsPolicyKey === "legacy_season6") {
    return "ลีกมาตรฐานต้องใช้กติกาตารางคะแนน standard_league_v1";
  }
  return "";
}

async function verifyLeagueCompetition(competitionId: string, allowCompleted = false) {
  await requireAdminSession();
  const supabase = getSupabaseAdmin();
  if (!supabase) return { error: "SUPABASE_SERVICE_ROLE_KEY is missing or Supabase URL is not configured.", supabase: null };
  if (!uuidPattern.test(competitionId)) return { error: "Competition id is invalid.", supabase };

  const competition = await supabase
    .from("leagues")
    .select("id, competition_type, season_status")
    .eq("id", competitionId)
    .maybeSingle();
  if (competition.error) {
    console.error("league template competition lookup failed", competition.error);
    return { error: "ไม่สามารถตรวจสอบรายการแข่งขันได้", supabase };
  }
  if (!competition.data) return { error: "ไม่พบรายการแข่งขัน", supabase };
  if (!isLeagueCompetition(normalizeCompetitionType(competition.data.competition_type))) {
    return { error: "League template ใช้ได้กับการแข่งขันประเภทลีกเท่านั้น", supabase };
  }
  if (!allowCompleted && competition.data.season_status === "completed") return { error: "การแข่งขันปิดแล้ว ต้องเปิดการแข่งขันเพื่อแก้ไขก่อน", supabase };
  return { error: "", supabase };
}

async function loadConfigRow(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>, competitionId: string) {
  const result = await supabase
    .from("competition_league_configs")
    .select(configColumns)
    .eq("competition_id", competitionId)
    .maybeSingle();
  if (result.error) {
    console.error("league template config lookup failed", result.error);
    return { error: "ไม่สามารถโหลดการตั้งค่าลีกได้", row: null };
  }
  return { error: "", row: result.data as Row | null };
}

async function loadMatchweekState(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>, competitionId: string, fixtureVersion: number) {
  const result = await supabase.from("competition_league_matchweeks").select(matchweekColumns).eq("competition_id", competitionId).eq("fixture_version", fixtureVersion).order("matchweek");
  if (result.error) {
    console.error("standard league matchweek state lookup failed", result.error);
    return { error: "ไม่สามารถโหลดสถานะ Matchweek ได้", states: [] as StandardLeagueMatchweek[] };
  }
  return { error: "", states: (result.data ?? []).map((row) => matchweekFromRow(row as Row)).filter((row): row is StandardLeagueMatchweek => Boolean(row)) };
}

async function completeMatchweekIfFinished(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>, competitionId: string, fixtureVersion: number, matchweek: number) {
  const matches = await supabase.from("matches").select("status").eq("league_id", competitionId).eq("league_fixture_version", fixtureVersion).eq("matchweek", matchweek);
  if (matches.error || !matches.data?.length || matches.data.some((match) => !["finished", "completed"].includes(match.status))) return;
  const completed = await supabase.from("competition_league_matchweeks").upsert({ competition_id: competitionId, fixture_version: fixtureVersion, matchweek, status: "completed", updated_at: new Date().toISOString() }, { onConflict: "competition_id,fixture_version,matchweek" });
  if (completed.error) console.error("standard league matchweek completion persistence failed", completed.error);
}

async function buildFixturePlan(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>, competitionId: string) {
  const participants = await loadCompetitionParticipants(supabase, competitionId, { includeInactiveParticipants: false });
  const teams = sortTeamsByName(participants)
    .filter((team) => team.participant_is_active !== false)
    .map((team) => ({ id: team.id, name: team.name }));
  if (teams.length < 2) return { error: "ต้องมีทีมที่เข้าร่วมอย่างน้อย 2 ทีมก่อนสร้างโปรแกรม", plan: null };
  try {
    return { error: "", plan: generateRoundRobinFixtures(teams, 1) };
  } catch (error) {
    console.error("league fixture plan generation failed", error);
    return { error: "ไม่สามารถสร้างแผนโปรแกรมการแข่งขันได้", plan: null };
  }
}

export async function loadStandardLeagueConfig(competitionId: string): Promise<LeagueConfigActionResult> {
  const verified = await verifyLeagueCompetition(competitionId, true);
  if (verified.error || !verified.supabase) return { error: verified.error, ok: false };
  const loaded = await loadConfigRow(verified.supabase, competitionId);
  if (loaded.error) return { error: loaded.error, ok: false };
  return { config: configFromRow(loaded.row), ok: true };
}

export async function saveStandardLeagueConfigDraft(competitionId: string, settings: LeagueSettingsInput): Promise<LeagueConfigActionResult> {
  const verified = await verifyLeagueCompetition(competitionId);
  if (verified.error || !verified.supabase) return { error: verified.error, ok: false };
  const validationError = validateSettings(settings);
  if (validationError) return { error: validationError, ok: false };
  const loaded = await loadConfigRow(verified.supabase, competitionId);
  if (loaded.error) return { error: loaded.error, ok: false };
  const existing = configFromRow(loaded.row);
  if (existing?.fixtureStatus === "confirmed") return { error: "ยืนยันโปรแกรมแล้ว ไม่สามารถเปลี่ยนกติกาหรือสร้างโปรแกรมใหม่ได้", ok: false };
  if (!existing) {
    const existingMatches = await verified.supabase
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("league_id", competitionId);
    if (existingMatches.error) {
      console.error("league template existing match guard failed", existingMatches.error);
      return { error: "ไม่สามารถตรวจสอบโปรแกรมเดิมของรายการได้", ok: false };
    }
    if ((existingMatches.count ?? 0) > 0) {
      return { error: "รายการนี้มีโปรแกรมเดิมอยู่แล้ว จึงไม่สามารถเริ่ม League Template ใหม่โดยอัตโนมัติได้", ok: false };
    }
  }

  const saved = await verified.supabase
    .from("competition_league_configs")
    .upsert({
      competition_id: competitionId,
      draw_points: settings.drawPoints,
      fixture_status: "draft",
      fixture_version: existing?.fixtureVersion ?? 0,
      legs: 1,
      loss_points: settings.lossPoints,
      standings_policy_key: settings.standingsPolicyKey,
      template_key: STANDARD_LEAGUE_TEMPLATE_KEY,
      updated_at: new Date().toISOString(),
      win_points: settings.winPoints,
    }, { onConflict: "competition_id" })
    .select(configColumns)
    .single();
  if (saved.error) {
    console.error("league template config save failed", saved.error);
    return { error: "ไม่สามารถบันทึกการตั้งค่าลีกได้", ok: false };
  }
  revalidatePath(`/admin/competitions/${competitionId}`);
  return { config: configFromRow(saved.data as Row), ok: true };
}

export async function generateStandardLeagueFixturePreview(competitionId: string): Promise<LeagueFixturePreviewResult> {
  const verified = await verifyLeagueCompetition(competitionId);
  if (verified.error || !verified.supabase) return { error: verified.error, ok: false };
  const loaded = await loadConfigRow(verified.supabase, competitionId);
  const config = configFromRow(loaded.row);
  if (loaded.error || !config) return { error: loaded.error || "บันทึกการตั้งค่าลีกก่อนสร้างตัวอย่างโปรแกรม", ok: false };
  const built = await buildFixturePlan(verified.supabase, competitionId);
  if (built.error || !built.plan) return { config, error: built.error, ok: false };
  return { config, ok: true, plan: built.plan };
}

export async function confirmStandardLeagueFixtures(competitionId: string, overrides: LeagueFixtureOverride[] = []): Promise<LeagueFixtureConfirmationResult> {
  const verified = await verifyLeagueCompetition(competitionId);
  if (verified.error || !verified.supabase) return { error: verified.error, ok: false };
  const loaded = await loadConfigRow(verified.supabase, competitionId);
  const config = configFromRow(loaded.row);
  if (loaded.error || !config) return { error: loaded.error || "บันทึกการตั้งค่าลีกก่อนยืนยันโปรแกรม", ok: false };

  if (config.fixtureStatus === "confirmed") {
    const existing = await verified.supabase
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("league_id", competitionId)
      .eq("league_fixture_version", config.fixtureVersion);
    if (existing.error) {
      console.error("league template existing fixture lookup failed", existing.error);
      return { error: "ไม่สามารถตรวจสอบโปรแกรมที่ยืนยันแล้วได้", ok: false };
    }
    return { config, createdCount: 0, existingCount: existing.count ?? 0, fixtureVersion: config.fixtureVersion, ok: true };
  }

  const built = await buildFixturePlan(verified.supabase, competitionId);
  if (built.error || !built.plan) return { config, error: built.error, ok: false };
  const validatedOverrides = applyLeagueFixtureOverrides(built.plan, overrides);
  if (validatedOverrides.error) return { config, error: validatedOverrides.error, ok: false };
  const fixtureVersion = config.fixtureVersion + 1;
  const confirmed = await verified.supabase.rpc("confirm_standard_league_fixtures_v1", {
    p_competition_id: competitionId,
    p_confirmed_by_label: "Administrator session",
    p_expected_fixture_count: built.plan.summary.fixtureCount,
    p_fixture_version: fixtureVersion,
    p_fixtures: built.plan.fixtures,
    p_overrides: validatedOverrides.overrides.map((override) => ({
          awayTeamId: override.awayTeamId,
          fixtureKey: override.fixtureKey,
          homeTeamId: override.homeTeamId,
          matchDate: override.matchDate,
          venue: override.venue,
        })),
  });
  if (confirmed.error) {
    console.error("league template fixture confirmation failed", confirmed.error);
    return { config, error: "ไม่สามารถยืนยันโปรแกรมการแข่งขันได้", ok: false };
  }
  const report = confirmed.data as { created_count?: number; existing_count?: number; fixture_version?: number } | null;
  const refreshed = await loadConfigRow(verified.supabase, competitionId);
  if (refreshed.error || !configFromRow(refreshed.row)) return { error: refreshed.error || "ยืนยันโปรแกรมแล้วแต่ไม่สามารถโหลดสถานะล่าสุดได้", ok: false };
  revalidatePath(`/admin/competitions/${competitionId}`);
  return {
    config: configFromRow(refreshed.row),
    createdCount: typeof report?.created_count === "number" ? report.created_count : 0,
    existingCount: typeof report?.existing_count === "number" ? report.existing_count : 0,
    fixtureVersion: typeof report?.fixture_version === "number" ? report.fixture_version : fixtureVersion,
    ok: true,
  };
}

async function loadConfirmedLeagueState(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>, competitionId: string, config: StandardLeagueConfig) {
  const [participants, matchesResult] = await Promise.all([
    loadCompetitionParticipants(supabase, competitionId, { includeInactiveParticipants: false }),
    supabase
      .from("matches")
      .select("id, league_fixture_key, home_team_id, away_team_id, home_score, away_score, status")
      .eq("league_id", competitionId)
      .eq("league_fixture_version", config.fixtureVersion),
  ]);
  if (matchesResult.error) {
    console.error("standard league state match lookup failed", matchesResult.error);
    return { error: "ไม่สามารถโหลดผลการแข่งขันลีกได้", resolution: null, standings: null };
  }
  const teams = sortTeamsByName(participants)
    .filter((team) => team.participant_is_active !== false)
    .map((team) => ({ id: team.id, name: team.name }));
  let plan: LeagueFixturePlan;
  try {
    plan = generateRoundRobinFixtures(teams, 1);
  } catch (error) {
    console.error("standard league state fixture plan failed", error);
    return { error: "ไม่สามารถตรวจสอบชุดโปรแกรมลีกได้", resolution: null, standings: null };
  }
  const matches: StandardLeagueMatch[] = (matchesResult.data ?? []).map((match) => ({
    awayScore: match.away_score,
    awayTeamId: match.away_team_id,
    fixtureKey: match.league_fixture_key,
    homeScore: match.home_score,
    homeTeamId: match.home_team_id,
    status: match.status,
  }));
  const standings = calculateStandardLeagueStandings({ config, matches, teams });
  return {
    error: "",
    resolution: resolveStandardLeagueChampion({
      config,
      expectedFixtureCount: plan.summary.fixtureCount,
      matches,
      standings: standings.rows,
    }),
    standings,
  };
}

async function persistLeagueChampion(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>, competitionId: string, config: StandardLeagueConfig) {
  const state = await loadConfirmedLeagueState(supabase, competitionId, config);
  if (state.error || !state.resolution) return { config, error: state.error };
  const championTeamId = state.resolution.status === "champion" ? state.resolution.championTeamId : null;
  if (config.championTeamId === championTeamId) return { config, error: "" };
  const championAt = championTeamId ? new Date().toISOString() : null;
  const updated = await supabase
    .from("competition_league_configs")
    .update({ champion_at: championAt, champion_team_id: championTeamId, updated_at: new Date().toISOString() })
    .eq("competition_id", competitionId)
    .select(configColumns)
    .single();
  if (updated.error) {
    console.error("standard league champion persistence failed", updated.error);
    return { config, error: "ไม่สามารถบันทึกแชมป์ลีกได้" };
  }
  return { config: configFromRow(updated.data as Row) ?? config, error: "" };
}

export async function saveStandardLeagueMatch(competitionId: string, payload: {
  awayScore: number | null;
  homeScore: number | null;
  matchDate: string | null;
  matchId: string;
  status: "scheduled" | "finished";
  venue: string | null;
}): Promise<LeagueMatchSaveResult> {
  const verified = await verifyLeagueCompetition(competitionId);
  if (verified.error || !verified.supabase) return { error: verified.error, ok: false };
  const loaded = await loadConfigRow(verified.supabase, competitionId);
  const config = configFromRow(loaded.row);
  if (loaded.error || !config || config.fixtureStatus !== "confirmed") return { error: loaded.error || "ยังไม่ได้ยืนยันโปรแกรมลีก", ok: false };
  const match = await verified.supabase
    .from("matches")
    .select("id, league_fixture_version, matchweek, scheduled_matchweek, home_team_id, away_team_id, match_date, venue")
    .eq("id", payload.matchId)
    .eq("league_id", competitionId)
    .maybeSingle();
  if (match.error || !match.data) {
    console.error("standard league match scope lookup failed", match.error);
    return { error: "ไม่พบคู่แข่งขันลีกนี้", ok: false };
  }
  if (match.data.league_fixture_version !== config.fixtureVersion) return { error: "คู่นี้ไม่ได้อยู่ในชุดโปรแกรมลีกที่ยืนยันไว้", ok: false };
  const originalMatchweek = match.data.matchweek;
  const effectiveMatchweek = effectiveMatchweekOrNull(originalMatchweek, match.data.scheduled_matchweek);
  if (!Number.isInteger(effectiveMatchweek)) return { error: "คู่นี้ไม่มี Matchweek ที่ยืนยันได้", ok: false };
  const matchweeks = await loadMatchweekState(verified.supabase, competitionId, config.fixtureVersion);
  if (matchweeks.error) return { error: matchweeks.error, ok: false };
  const matchweekState = matchweeks.states.find((state) => state.matchweek === effectiveMatchweek);
  if (payload.status === "finished" && matchweekState?.status !== "confirmed") return { error: `ต้องยืนยันคู่แข่งขัน Matchweek ${effectiveMatchweek} ก่อนจึงจะบันทึกผลจบการแข่งขันได้`, ok: false };
  if (payload.status === "finished" && (!payload.matchDate || !payload.venue?.trim())) return { error: "ต้องกำหนดวัน เวลา และสนามของคู่นี้ก่อนจึงจะบันทึกผลจบการแข่งขันได้", ok: false };
  const saved = await updateMatch(payload.matchId, {
    away_score: payload.awayScore,
    away_team_id: match.data.away_team_id,
    home_score: payload.homeScore,
    home_team_id: match.data.home_team_id,
    league_id: competitionId,
    match_date: payload.matchDate,
    status: payload.status,
    venue: payload.venue,
  });
  if (!saved.ok) return { error: saved.error || "ไม่สามารถบันทึกผลการแข่งขันได้", ok: false };
  await completeMatchweekIfFinished(verified.supabase, competitionId, config.fixtureVersion, originalMatchweek);
  const persisted = await persistLeagueChampion(verified.supabase, competitionId, config);
  if (persisted.error) return { error: persisted.error, ok: false };
  revalidatePath(`/admin/competitions/${competitionId}`);
  return { champion: { championAt: persisted.config.championAt, championTeamId: persisted.config.championTeamId }, config: persisted.config, ok: true };
}

export async function saveStandardLeagueMatchweekDraft(competitionId: string, matchweek: number, updates: LeagueMatchweekDraftMatch[]): Promise<LeagueMatchweekActionResult> {
  const verified = await verifyLeagueCompetition(competitionId);
  if (verified.error || !verified.supabase) return { error: verified.error, ok: false };
  const loaded = await loadConfigRow(verified.supabase, competitionId);
  const config = configFromRow(loaded.row);
  if (loaded.error || !config || config.fixtureStatus !== "confirmed") return { error: loaded.error || "ยังไม่ได้ยืนยันโครงสร้างการแข่งขัน", ok: false };
  const saved = await verified.supabase.rpc("save_standard_league_matchweek_draft_v1", {
    p_competition_id: competitionId,
    p_fixture_version: config.fixtureVersion,
    p_matchweek: matchweek,
    p_updates: updates.map((update) => ({ awayTeamId: update.awayTeamId, homeTeamId: update.homeTeamId, matchDate: update.matchDate, matchId: update.matchId, venue: update.venue?.trim() || null })),
  });
  if (saved.error) {
    console.error("standard league matchweek draft save failed", saved.error);
    return { error: "ไม่สามารถบันทึกร่าง Matchweek นี้ได้", ok: false };
  }
  const [state, matches] = await Promise.all([
    loadMatchweekState(verified.supabase, competitionId, config.fixtureVersion),
    verified.supabase.from("matches").select("id, home_team_id, away_team_id, match_date, venue").eq("league_id", competitionId).eq("league_fixture_version", config.fixtureVersion).eq("matchweek", matchweek),
  ]);
  if (state.error || matches.error) return { error: state.error || "ไม่สามารถโหลดร่างที่บันทึกแล้ว", ok: false };
  revalidatePath(`/admin/competitions/${competitionId}`);
  return { config, matches: (matches.data ?? []).map((match) => ({ awayTeamId: match.away_team_id, homeTeamId: match.home_team_id, matchDate: match.match_date, matchId: match.id, venue: match.venue })), matchweekState: state.states.find((item) => item.matchweek === matchweek), ok: true };
}

export async function confirmStandardLeagueMatchweek(competitionId: string, matchweek: number, editableFixtures: LeagueMatchweekConfirmationFixture[]): Promise<LeagueMatchweekActionResult> {
  const verified = await verifyLeagueCompetition(competitionId);
  if (verified.error || !verified.supabase) return { error: verified.error, ok: false };
  const loaded = await loadConfigRow(verified.supabase, competitionId);
  const config = configFromRow(loaded.row);
  if (loaded.error || !config || config.fixtureStatus !== "confirmed") return { error: loaded.error || "ยังไม่ได้ยืนยันโครงสร้างการแข่งขัน", ok: false };
  const confirmed = await verified.supabase.rpc("confirm_standard_league_matchweek_v1", {
    p_competition_id: competitionId,
    p_confirmed_by_label: "Administrator session",
    p_editable_fixtures: editableFixtures,
    p_fixture_version: config.fixtureVersion,
    p_matchweek: matchweek,
  });
  if (confirmed.error) {
    console.error("standard league matchweek confirmation failed", {
      code: confirmed.error.code,
      details: confirmed.error.details,
      hint: confirmed.error.hint,
      message: confirmed.error.message,
    });
    return { error: matchweekConfirmationErrorMessage(confirmed.error.message), ok: false };
  }
  const state = await loadMatchweekState(verified.supabase, competitionId, config.fixtureVersion);
  if (state.error) return { error: state.error, ok: false };
  revalidatePath(`/admin/competitions/${competitionId}`);
  return { config, matchweekState: state.states.find((item) => item.matchweek === matchweek), ok: true };
}

function rescheduleRpcErrorMessage(message: string) {
  if (message.includes("competition_completed")) return "การแข่งขันปิดแล้ว ต้องเปิดการแข่งขันเพื่อแก้ไขก่อน";
  if (message.includes("fixture_not_confirmed")) return "ยังไม่ได้ยืนยันโครงสร้างการแข่งขันลีก";
  if (message.includes("match_not_in_fixture_set")) return "คู่นี้ไม่ได้อยู่ในชุดโปรแกรมลีกที่ยืนยันไว้";
  if (message.includes("match_finished")) return "การแข่งขันคู่นี้จบแล้ว จึงไม่สามารถเลื่อนได้";
  if (message.includes("invalid_reschedule_request")) return "ข้อมูลการเลื่อนการแข่งขันไม่ถูกต้อง";
  if (message.includes("invalid_standard_league")) return "รายการนี้ไม่ใช่ลีกมาตรฐานที่รองรับการเลื่อนการแข่งขัน";
  return "ไม่สามารถเลื่อนการแข่งขันได้";
}

function matchweekConfirmationErrorMessage(message: string) {
  if (message.includes("matchweek_empty")) return "Matchweek นี้ไม่มีคู่แข่งขันในโปรแกรมปัจจุบัน";
  if (message.includes("matchweek_duplicate_pairing")) return "มีคู่แข่งขันซ้ำใน Matchweek นี้";
  if (message.includes("editable_fixture_missing")) return "ข้อมูลคู่แข่งขันที่ยังแก้ไขได้ไม่ครบ กรุณาลองใหม่อีกครั้ง";
  if (message.includes("finished_fixture_modified")) return "ไม่สามารถแก้ไขคู่ที่จบการแข่งขันแล้วได้";
  if (message.includes("fixture_set_invalid")) return "ชุดคู่แข่งขันใน Matchweek นี้ไม่ถูกต้อง";
  if (message.includes("invalid_matchweek")) return "Matchweek ที่เลือกไม่ถูกต้อง";
  if (message.includes("invalid_standard_league_fixture_version")) return "ชุดโปรแกรมลีกนี้ไม่ตรงกับโครงสร้างที่ยืนยันไว้";
  if (message.includes("invalid_league_confirmation")) return "ไม่สามารถยืนยัน Matchweek ของรายการนี้ได้";
  return "ไม่สามารถยืนยันคู่แข่งขัน Matchweek นี้ได้";
}

export async function rescheduleStandardLeagueMatch(input: {
  acknowledgeConflict: boolean;
  competitionId: string;
  matchId: string;
  reason: string;
  targetMatchweek: number;
}): Promise<StandardLeagueRescheduleActionResult> {
  const validationError = validateStandardLeagueRescheduleInput(input);
  if (validationError) return { error: validationError, success: false };
  const verified = await verifyLeagueCompetition(input.competitionId);
  if (verified.error || !verified.supabase) return { error: verified.error, success: false };
  if (!uuidPattern.test(input.matchId)) return { error: "รหัสคู่แข่งขันไม่ถูกต้อง", success: false };

  const loaded = await loadConfigRow(verified.supabase, input.competitionId);
  const config = configFromRow(loaded.row);
  if (loaded.error || !config || config.fixtureStatus !== "confirmed") {
    return { error: loaded.error || "ยังไม่ได้ยืนยันโครงสร้างการแข่งขันลีก", success: false };
  }

  const rescheduled = await verified.supabase.rpc("reschedule_standard_league_match_v1", {
    p_acknowledge_conflict: input.acknowledgeConflict,
    p_changed_by: null,
    p_changed_by_label: "Administrator session",
    p_competition_id: input.competitionId,
    p_match_id: input.matchId,
    p_reason: input.reason.trim(),
    p_target_matchweek: input.targetMatchweek,
  });
  if (rescheduled.error) {
    console.error("standard league reschedule RPC failed", {
      code: rescheduled.error.code,
      details: rescheduled.error.details,
      hint: rescheduled.error.hint,
      message: rescheduled.error.message,
    });
    return { error: rescheduleRpcErrorMessage(rescheduled.error.message), success: false };
  }

  const rpcResult = parseStandardLeagueRescheduleRpcResult(rescheduled.data);
  if (rpcResult.kind === "conflict") {
    return {
      conflict: true,
      conflicts: rpcResult.conflicts,
      error: "พบทีมที่มีโปรแกรมแข่งขันซ้ำใน Matchweek ปลายทาง",
      success: false,
    };
  }
  if (rpcResult.kind === "error") return { error: rpcResult.error, success: false };

  const [updatedMatchResult, matchweekStates] = await Promise.all([
    verified.supabase
      .from("matches")
      .select(rescheduledMatchColumns)
      .eq("id", input.matchId)
      .eq("league_id", input.competitionId)
      .eq("league_fixture_version", config.fixtureVersion)
      .maybeSingle(),
    loadMatchweekState(verified.supabase, input.competitionId, config.fixtureVersion),
  ]);
  if (updatedMatchResult.error || !updatedMatchResult.data) {
    console.error("standard league reschedule match reload failed", updatedMatchResult.error);
    return { error: "เลื่อนการแข่งขันแล้ว แต่ไม่สามารถโหลดข้อมูลคู่แข่งขันล่าสุดได้", success: false };
  }
  if (matchweekStates.error) return { error: matchweekStates.error, success: false };
  const updatedMatch = mapStandardLeagueRescheduledMatch(updatedMatchResult.data);
  if (!updatedMatch) {
    console.error("standard league reschedule match mapping failed", updatedMatchResult.data);
    return { error: "ข้อมูลคู่แข่งขันล่าสุดไม่สมบูรณ์", success: false };
  }

  revalidatePath(`/admin/competitions/${input.competitionId}`);
  return {
    history: rpcResult.history,
    newEffectiveMatchweek: rpcResult.newEffectiveMatchweek,
    originalMatchweek: rpcResult.originalMatchweek,
    previousEffectiveMatchweek: rpcResult.previousEffectiveMatchweek,
    sourceMatchweekState: matchweekStates.states.find((state) => state.matchweek === rpcResult.previousEffectiveMatchweek) ?? null,
    success: true,
    targetMatchweekState: matchweekStates.states.find((state) => state.matchweek === rpcResult.newEffectiveMatchweek) ?? null,
    updatedMatch,
  };
}

export async function swapStandardLeagueMatchSides(competitionId: string, matchId: string): Promise<LeagueMatchSaveResult> {
  const verified = await verifyLeagueCompetition(competitionId);
  if (verified.error || !verified.supabase) return { error: verified.error, ok: false };
  const loaded = await loadConfigRow(verified.supabase, competitionId);
  const config = configFromRow(loaded.row);
  if (loaded.error || !config || config.fixtureStatus !== "confirmed") return { error: loaded.error || "ยังไม่ได้ยืนยันโปรแกรมลีก", ok: false };
  const match = await verified.supabase
    .from("matches")
    .select("id, home_team_id, away_team_id, home_score, away_score, status, league_fixture_version")
    .eq("id", matchId)
    .eq("league_id", competitionId)
    .maybeSingle();
  if (match.error || !match.data) {
    console.error("standard league side swap lookup failed", match.error);
    return { error: "ไม่พบคู่แข่งขันลีกนี้", ok: false };
  }
  if (match.data.league_fixture_version !== config.fixtureVersion) return { error: "คู่นี้ไม่ได้อยู่ในชุดโปรแกรมลีกที่ยืนยันไว้", ok: false };
  if (match.data.status !== "scheduled") return { error: "การแข่งขันเริ่มหรือจบแล้ว จึงไม่สามารถสลับเจ้าบ้านและทีมเยือนได้", ok: false };
  if (match.data.home_score !== null || match.data.away_score !== null) return { error: "คู่นี้มีสกอร์แล้ว จึงไม่สามารถสลับเจ้าบ้านและทีมเยือนได้", ok: false };
  const swapped = await verified.supabase
    .from("matches")
    .update({ away_team_id: match.data.home_team_id, home_team_id: match.data.away_team_id })
    .eq("id", matchId)
    .eq("league_id", competitionId)
    .eq("league_fixture_version", config.fixtureVersion)
    .select("id")
    .maybeSingle();
  if (swapped.error || !swapped.data) {
    console.error("standard league side swap update failed", swapped.error);
    return { error: "ไม่สามารถสลับเจ้าบ้านและทีมเยือนได้", ok: false };
  }
  revalidatePath(`/admin/competitions/${competitionId}`);
  return { config, ok: true };
}

export async function completeStandardLeagueCompetition(competitionId: string): Promise<LeagueConfigActionResult> {
  const verified = await verifyLeagueCompetition(competitionId);
  if (verified.error || !verified.supabase) return { error: verified.error, ok: false };
  const loaded = await loadConfigRow(verified.supabase, competitionId);
  const config = configFromRow(loaded.row);
  if (loaded.error || !config || config.fixtureStatus !== "confirmed") return { error: loaded.error || "ยังไม่ได้ยืนยันโปรแกรมลีก", ok: false };
  const persisted = await persistLeagueChampion(verified.supabase, competitionId, config);
  if (persisted.error) return { error: persisted.error, ok: false };
  if (!persisted.config.championTeamId) return { error: "ยังไม่สามารถปิดการแข่งขันได้จนกว่าจะได้แชมป์ที่ชัดเจน", ok: false };
  const completed = await verified.supabase
    .from("leagues")
    .update({ season_status: "completed" })
    .eq("id", competitionId);
  if (completed.error) {
    console.error("standard league completion failed", completed.error);
    return { error: "ไม่สามารถปิดการแข่งขันได้", ok: false };
  }
  revalidatePath(`/admin/competitions/${competitionId}`);
  revalidatePath("/competitions");
  return { config: persisted.config, ok: true };
}

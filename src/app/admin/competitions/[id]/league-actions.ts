"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin-server-auth";
import { isLeagueCompetition, normalizeCompetitionType } from "@/lib/competition-format";
import { loadCompetitionParticipants } from "@/lib/competition-participants";
import { updateMatch } from "@/app/admin/matches/actions";
import { resolveStandardLeagueChampion } from "@/lib/league-template/champion-resolver";
import { generateRoundRobinFixtures } from "@/lib/league-template/round-robin";
import { calculateStandardLeagueStandings, type StandardLeagueMatch } from "@/lib/league-template/standings";
import { getLeagueStandingsPolicy } from "@/lib/league-template/standings-policies";
import { STANDARD_LEAGUE_TEMPLATE_KEY, type LeagueFixturePlan, type StandardLeagueConfig } from "@/lib/league-template/types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { sortTeamsByName } from "@/lib/team-sort";

type Row = Record<string, unknown>;
type LeagueSettingsInput = Pick<StandardLeagueConfig, "drawPoints" | "legs" | "lossPoints" | "standingsPolicyKey" | "winPoints">;

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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const configColumns = "competition_id, template_key, legs, win_points, draw_points, loss_points, standings_policy_key, fixture_status, fixture_version, confirmed_at, confirmed_by, confirmed_by_label, champion_team_id, champion_at";

function text(row: Row | null | undefined, key: string) {
  return typeof row?.[key] === "string" ? row[key] as string : "";
}

function integer(row: Row | null | undefined, key: string, fallback: number) {
  return typeof row?.[key] === "number" && Number.isInteger(row[key]) ? row[key] as number : fallback;
}

function configFromRow(row: Row | null | undefined): StandardLeagueConfig | null {
  if (!row || text(row, "template_key") !== STANDARD_LEAGUE_TEMPLATE_KEY) return null;
  const legs = integer(row, "legs", 1);
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
    legs: legs === 2 ? 2 : 1,
    lossPoints: integer(row, "loss_points", 0),
    standingsPolicyKey: policy === "legacy_season6" ? "legacy_season6" : "standard_league_v1",
    templateKey: STANDARD_LEAGUE_TEMPLATE_KEY,
    winPoints: integer(row, "win_points", 3),
  };
}

function validateSettings(input: LeagueSettingsInput) {
  if (input.legs !== 1 && input.legs !== 2) return "จำนวนเลกต้องเป็น 1 หรือ 2";
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

async function buildFixturePlan(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>, competitionId: string, legs: 1 | 2) {
  const participants = await loadCompetitionParticipants(supabase, competitionId, { includeInactiveParticipants: false });
  const teams = sortTeamsByName(participants)
    .filter((team) => team.participant_is_active !== false)
    .map((team) => ({ id: team.id, name: team.name }));
  if (teams.length < 2) return { error: "ต้องมีทีมที่เข้าร่วมอย่างน้อย 2 ทีมก่อนสร้างโปรแกรม", plan: null };
  try {
    return { error: "", plan: generateRoundRobinFixtures(teams, legs) };
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
      legs: settings.legs,
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
  const built = await buildFixturePlan(verified.supabase, competitionId, config.legs);
  if (built.error || !built.plan) return { config, error: built.error, ok: false };
  return { config, ok: true, plan: built.plan };
}

export async function confirmStandardLeagueFixtures(competitionId: string): Promise<LeagueFixtureConfirmationResult> {
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

  const built = await buildFixturePlan(verified.supabase, competitionId, config.legs);
  if (built.error || !built.plan) return { config, error: built.error, ok: false };
  const fixtureVersion = config.fixtureVersion + 1;
  const confirmed = await verified.supabase.rpc("confirm_standard_league_fixtures_v1", {
    p_competition_id: competitionId,
    p_confirmed_by_label: "Administrator session",
    p_expected_fixture_count: built.plan.summary.fixtureCount,
    p_fixture_version: fixtureVersion,
    p_fixtures: built.plan.fixtures,
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
    plan = generateRoundRobinFixtures(teams, config.legs);
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
    .select("id, league_fixture_version, home_team_id, away_team_id")
    .eq("id", payload.matchId)
    .eq("league_id", competitionId)
    .maybeSingle();
  if (match.error || !match.data) {
    console.error("standard league match scope lookup failed", match.error);
    return { error: "ไม่พบคู่แข่งขันลีกนี้", ok: false };
  }
  if (match.data.league_fixture_version !== config.fixtureVersion) return { error: "คู่นี้ไม่ได้อยู่ในชุดโปรแกรมลีกที่ยืนยันไว้", ok: false };
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
  const persisted = await persistLeagueChampion(verified.supabase, competitionId, config);
  if (persisted.error) return { error: persisted.error, ok: false };
  revalidatePath(`/admin/competitions/${competitionId}`);
  return { champion: { championAt: persisted.config.championAt, championTeamId: persisted.config.championTeamId }, config: persisted.config, ok: true };
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

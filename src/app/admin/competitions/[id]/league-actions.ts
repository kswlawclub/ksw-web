"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin-server-auth";
import { isLeagueCompetition, normalizeCompetitionType } from "@/lib/competition-format";
import { loadCompetitionParticipants } from "@/lib/competition-participants";
import { generateRoundRobinFixtures } from "@/lib/league-template/round-robin";
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

"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin-server-auth";
import { calculateCupQualification } from "@/lib/cup-qualification";
import { isCupCompetition, normalizeCompetitionType } from "@/lib/competition-format";
import { calculateCompetitionStructure } from "@/lib/competition-structure";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export type ApprovedQualificationSummary = {
  bracketCapacity: number;
  byeCount: number;
  entrantCount: number;
  extraQualifierCount: number;
  knockoutMatchCount: number;
  playInCount: number;
  roundCount: number;
};

function qualificationLoadError(source: string, error?: { code?: string | null; message?: string | null } | null) {
  // Keep database details on the server while telling the admin which data set needs attention.
  console.error("cup qualification load failed", { code: error?.code, message: error?.message, source });

  if (error?.code === "42703") {
    return "ระบบทีมผ่านเข้ารอบยังไม่พร้อมใช้งาน โปรดตรวจสอบว่า migration ล่าสุดถูกใช้งานแล้ว";
  }

  const labels: Record<string, string> = {
    config: "การตั้งค่ารอบน็อกเอาต์",
    groups: "ข้อมูลกลุ่มการแข่งขัน",
    matches: "ผลและโปรแกรมการแข่งขัน",
    participants: "รายชื่อทีมในรายการ",
  };
  return `ไม่สามารถโหลด${labels[source] ?? "ข้อมูลทีมผ่านเข้ารอบ"}ได้ในขณะนี้`;
}

async function load(competitionId: string) {
  await requireAdminSession();
  const supabase = getSupabaseAdmin();
  if (!supabase) return { error: "ไม่สามารถเชื่อมต่อข้อมูลผู้ดูแล", supabase: null };
  const competition = await supabase.from("leagues").select("competition_type").eq("id", competitionId).maybeSingle();
  if (competition.error) return { error: qualificationLoadError("competition", competition.error), supabase: null };
  if (!competition.data || !isCupCompetition(normalizeCompetitionType(competition.data.competition_type))) return { error: "ไม่พบการแข่งขันแบบ Cup", supabase: null };
  const [config, groups, participants, matches] = await Promise.all([
    supabase.from("competition_knockout_configs").select("entrant_count, bracket_capacity, entry_mode, extra_rank_enabled, extra_rank, extra_qualifier_count, qualification_status").eq("competition_id", competitionId).maybeSingle(),
    supabase.from("competition_groups").select("id, name, label, sort_order, qualifiers_count").eq("competition_id", competitionId),
    supabase.from("competition_teams").select("team_id, group_id, teams!inner(id, name, short_name, is_ksw)").eq("competition_id", competitionId).eq("is_active", true),
    supabase.from("matches").select("id, group_id, competition_stage, home_team_id, away_team_id, home_score, away_score, status").eq("league_id", competitionId),
  ]);
  if (config.error) return { error: qualificationLoadError("config", config.error), supabase: null };
  if (groups.error) return { error: qualificationLoadError("groups", groups.error), supabase: null };
  if (participants.error) return { error: qualificationLoadError("participants", participants.error), supabase: null };
  if (matches.error) return { error: qualificationLoadError("matches", matches.error), supabase: null };
  const teams = (participants.data ?? []).map((row) => ({ ...(Array.isArray(row.teams) ? row.teams[0] : row.teams), group_id: row.group_id, team_id: row.team_id }));
  return { config: config.data, groups: groups.data ?? [], matches: matches.data ?? [], supabase, teams };
}

export async function approveCupQualification(competitionId: string) {
  const data = await load(competitionId);
  if (!data.supabase || !data.config) return { error: data.error, ok: false };
  const result = calculateCupQualification({ groups: data.groups, matches: data.matches, settings: { extraQualifierCount: data.config.extra_qualifier_count, extraRank: data.config.extra_rank, extraRankEnabled: data.config.extra_rank_enabled }, teams: data.teams });
  if (result.preview.some((entry) => entry.temporary) || result.confirmed.length !== (data.config.entrant_count ?? 0)) return { error: "รอผลการแข่งขันของทุกกลุ่มที่ใช้คัดเลือกก่อนยืนยัน", ok: false };
  const entrantCount = result.confirmed.length;
  const bracketCapacity = typeof data.config.bracket_capacity === "number" ? data.config.bracket_capacity : 0;
  const entryMode = data.config.entry_mode === "preliminary" ? "preliminary" : "bye";
  const playInCount = entryMode === "preliminary" ? Math.max(entrantCount - bracketCapacity, 0) : 0;
  const summary: ApprovedQualificationSummary = {
    bracketCapacity,
    byeCount: entryMode === "bye" ? Math.max(bracketCapacity - entrantCount, 0) : 0,
    entrantCount,
    extraQualifierCount: result.confirmed.filter((entry) => entry.type === "best_ranked").length,
    knockoutMatchCount: Math.max(bracketCapacity - 1, 0) + playInCount,
    playInCount,
    roundCount: bracketCapacity > 0 ? Math.log2(bracketCapacity) : 0,
  };
  const snapshot = result.confirmed.map((entry) => ({ ...entry, approvalSummary: summary }));
  const update = await data.supabase.from("competition_knockout_configs").update({ qualification_approved_at: new Date().toISOString(), qualification_approved_by: null, qualification_approved_by_label: "Administrator session", qualification_snapshot: snapshot, qualification_status: "approved" }).eq("competition_id", competitionId);
  if (update.error) return { error: "ไม่สามารถยืนยันทีมผ่านเข้ารอบ", ok: false };
  revalidatePath(`/admin/competitions/${competitionId}`);
  return { ok: true, summary };
}

export async function saveCupQualificationSettings(competitionId: string, extraRankEnabled: boolean, extraRank: number | null, extraQualifierCount: number) {
  const data = await load(competitionId);
  if (!data.supabase) return { error: data.error, ok: false };
  if (!Number.isInteger(extraQualifierCount) || extraQualifierCount < 0 || (extraRankEnabled && (!Number.isInteger(extraRank) || (extraRank ?? 0) < 1 || extraQualifierCount < 1))) return { error: "กรอกกติกาอันดับเพิ่มเติมให้ถูกต้อง", ok: false };
  const groupQualifiers = data.groups.reduce((total, group) => total + (typeof group.qualifiers_count === "number" ? group.qualifiers_count : 0), 0);
  const entrantCount = groupQualifiers + (extraRankEnabled ? extraQualifierCount : 0);
  let structure;
  try {
    structure = calculateCompetitionStructure({
      entrantCount,
      entryMode: "bye",
      groupCount: data.groups.length,
      groupStageEnabled: true,
      qualifiersPerGroup: null,
      totalParticipantCount: data.teams.length,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "ไม่สามารถคำนวณโครงสร้างรอบน็อกเอาต์", ok: false };
  }
  const update = await data.supabase.from("competition_knockout_configs").upsert({ bracket_capacity: structure.bracketCapacity, competition_id: competitionId, entrant_count: entrantCount, entry_mode: structure.entryMode, extra_qualifier_count: extraQualifierCount, extra_rank: extraRankEnabled ? extraRank : null, extra_rank_enabled: extraRankEnabled, group_stage_enabled: true, qualification_approved_at: null, qualification_approved_by: null, qualification_approved_by_label: null, qualification_snapshot: [], qualification_status: "pending", status: "draft", updated_at: new Date().toISOString() }, { onConflict: "competition_id" });
  if (update.error) return { error: "ไม่สามารถบันทึกกติกาทีมผ่านเข้ารอบ", ok: false };
  revalidatePath(`/admin/competitions/${competitionId}`);
  return { ok: true };
}

export async function reopenCupQualification(competitionId: string) {
  const data = await load(competitionId);
  if (!data.supabase) return { error: data.error, ok: false };
  const matches = await data.supabase.from("matches").select("id").eq("league_id", competitionId).eq("competition_stage", "knockout").or("status.eq.finished,home_score.not.is.null,away_score.not.is.null").limit(1);
  if (matches.error) return { error: "ไม่สามารถตรวจสอบผลรอบน็อกเอาต์", ok: false };
  if (matches.data?.length) return { error: "ยกเลิกการยืนยันไม่ได้ เพราะมีรอบน็อกเอาต์ที่เริ่มแข่งหรือมีผลแล้ว", ok: false };
  const update = await data.supabase.from("competition_knockout_configs").update({ qualification_approved_at: null, qualification_approved_by: null, qualification_approved_by_label: null, qualification_snapshot: [], qualification_status: "pending" }).eq("competition_id", competitionId);
  if (update.error) return { error: "ไม่สามารถยกเลิกการยืนยัน", ok: false };
  revalidatePath(`/admin/competitions/${competitionId}`);
  return { ok: true };
}

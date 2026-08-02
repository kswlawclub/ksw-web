"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin-server-auth";
import { isCupCompetition, normalizeCompetitionType } from "@/lib/competition-format";
import { getKnockoutTemplate } from "@/lib/knockout-templates/registry";
import type { KnockoutTemplateKey } from "@/lib/knockout-templates/types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { calculateCupGroupStandings } from "@/lib/cup-group-standings";

const capacities = [4, 8, 16, 32] as const;
const councilTemplateKey = "council_two_division" as const;

type SourceRow = Record<string, unknown>;

export type CouncilDivisionEntry = {
  bestOrder: number | null;
  groupId: string | null;
  label: string;
  rank: number | null;
  reason: string;
  sourceType: "admin_selected" | "best_ranked" | "group_rank";
  teamId: string;
  teamName: string;
};

export type CouncilDivisionState = {
  approvalStatus: "approved" | "draft";
  approvedAt: string | null;
  approvedByLabel: string | null;
  candidatePool: CouncilDivisionEntry[];
  division1: { bracketCapacity: number | null; entries: CouncilDivisionEntry[]; error: string | null };
  division2: { bracketCapacity: number | null; entries: CouncilDivisionEntry[]; extraCount: number; extraNeeded: number; error: string | null };
  recommendedExtraTeamIds: string[];
};

function asText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nextCapacity(count: number) {
  return capacities.find((capacity) => capacity >= count) ?? null;
}

async function loadCouncilData(competitionId: string) {
  await requireAdminSession();
  const supabase = getSupabaseAdmin();
  if (!supabase) return { error: "ไม่สามารถเชื่อมต่อข้อมูลผู้ดูแล" as const, supabase: null };

  const [competitionResult, configResult, groupsResult, participantsResult, matchesResult, partitionsResult] = await Promise.all([
    supabase.from("leagues").select("competition_type, season_status").eq("id", competitionId).maybeSingle(),
    supabase.from("competition_knockout_configs").select("qualification_status, qualification_snapshot, template_key").eq("competition_id", competitionId).maybeSingle(),
    supabase.from("competition_groups").select("id, name, label, sort_order, qualifiers_count").eq("competition_id", competitionId).order("sort_order").order("name"),
    supabase.from("competition_teams").select("team_id, group_id, teams!inner(id, name)").eq("competition_id", competitionId).eq("is_active", true),
    supabase.from("matches").select("group_id, competition_stage, home_team_id, away_team_id, home_score, away_score, status").eq("league_id", competitionId),
    supabase.from("competition_knockout_partitions").select("partition_key, entrant_count, bracket_capacity, qualification_snapshot, approval_status, approved_at, approved_by_label").eq("competition_id", competitionId).in("partition_key", ["division_1", "division_2"]),
  ]);
  if (competitionResult.error || configResult.error || groupsResult.error || participantsResult.error || matchesResult.error || partitionsResult.error) {
    console.error("council division load failed", { competition: competitionResult.error, config: configResult.error, groups: groupsResult.error, participants: participantsResult.error, matches: matchesResult.error, partitions: partitionsResult.error });
    return { error: "ไม่สามารถโหลดข้อมูลการแบ่งดิวิชั่นได้" as const, supabase: null };
  }
  if (!competitionResult.data || !isCupCompetition(normalizeCompetitionType(competitionResult.data.competition_type))) return { error: "ไม่พบการแข่งขันแบบ Cup" as const, supabase: null };
  if (!configResult.data || configResult.data.qualification_status !== "approved" || !Array.isArray(configResult.data.qualification_snapshot)) return { error: "ยืนยันทีมผ่านเข้ารอบก่อนเลือกคัพสภา" as const, supabase: null };
  return { competition: competitionResult.data, config: configResult.data, groups: groupsResult.data ?? [], matches: matchesResult.data ?? [], participants: participantsResult.data ?? [], partitions: partitionsResult.data ?? [], supabase };
}

function buildState(data: Exclude<Awaited<ReturnType<typeof loadCouncilData>>, { error: string; supabase: null }>, requestedExtraTeamIds?: string[]): CouncilDivisionState {
  const groupLabels = new Map(data.groups.map((group) => [asText(group.id), asText(group.label) || asText(group.name)]));
  const participantNames = new Map(data.participants.map((row) => {
    const team = Array.isArray(row.teams) ? row.teams[0] : row.teams;
    return [asText(row.team_id), asText((team as SourceRow | null)?.name) || "ทีมไม่ทราบชื่อ"];
  }));
  const rawSnapshot = Array.isArray(data.config.qualification_snapshot) ? data.config.qualification_snapshot as unknown[] : [];
  const snapshot = rawSnapshot.map((value: unknown) => value as SourceRow).filter((value) => participantNames.has(asText(value.teamId)));
  const entryFromSnapshot = (value: SourceRow, reason: string): CouncilDivisionEntry => {
    const groupId = asText(value.groupId) || null;
    const rank = typeof value.rank === "number" ? value.rank : null;
    const bestOrder = typeof value.bestOrder === "number" ? value.bestOrder : null;
    const type = value.type === "best_ranked" ? "best_ranked" : "group_rank";
    return {
      bestOrder,
      groupId,
      label: type === "best_ranked" ? `อันดับเพิ่มเติม #${bestOrder ?? "?"}` : `${groupLabels.get(groupId ?? "") ?? "กลุ่ม"}${rank ?? "?"}`,
      rank,
      reason,
      sourceType: type,
      teamId: asText(value.teamId),
      teamName: participantNames.get(asText(value.teamId)) ?? "ทีมไม่ทราบชื่อ",
    };
  };
  const division1Base = snapshot.filter((value) => value.type === "group_rank" && value.rank === 1).map((value) => entryFromSnapshot(value, "อันดับ 1 ของกลุ่ม"));
  const division2Base = snapshot.filter((value) => value.type === "group_rank" && value.rank === 2).map((value) => entryFromSnapshot(value, "อันดับ 2 ของกลุ่ม"));
  const standingTeams = data.participants.map((row) => {
    const team = Array.isArray(row.teams) ? row.teams[0] : row.teams;
    return { group_id: asText(row.group_id), name: asText((team as SourceRow | null)?.name), team_id: asText(row.team_id) };
  });
  const rankedCandidates = calculateCupGroupStandings({ groups: data.groups as SourceRow[], matches: data.matches as SourceRow[], teams: standingTeams })
    .flatMap((standing) => standing.rows.filter((row) => row.position >= 3).map((row) => ({ bestOrder: null, groupId: standing.group_id, label: `${standing.group_name}${row.position}`, rank: row.position, reason: "อันดับถัดไปของกลุ่ม", sourceType: "group_rank" as const, teamId: row.team_id, teamName: row.team_name })));
  const division1Capacity = nextCapacity(division1Base.length);
  const division2Capacity = nextCapacity(division2Base.length);
  const division1Error = division1Capacity === null || division1Capacity !== division1Base.length ? "Division 1 ต้องมีแชมป์กลุ่มจำนวน 4, 8, 16 หรือ 32 ทีม" : null;
  const extraNeeded = division2Capacity ? division2Capacity - division2Base.length : 0;
  const reserved = new Set([...division1Base, ...division2Base].map((entry) => entry.teamId));
  const bestCandidates = snapshot.filter((value) => value.type === "best_ranked" && !reserved.has(asText(value.teamId))).sort((a, b) => Number(a.bestOrder ?? 0) - Number(b.bestOrder ?? 0));
  const recommendedExtraTeamIds = bestCandidates.slice(0, extraNeeded).map((value) => asText(value.teamId));
  const selectedExtraTeamIds = requestedExtraTeamIds ?? recommendedExtraTeamIds;
  const uniqueSelectedExtraTeamIds = Array.from(new Set(selectedExtraTeamIds));
  const invalidSelection = uniqueSelectedExtraTeamIds.length !== selectedExtraTeamIds.length || uniqueSelectedExtraTeamIds.length !== extraNeeded;
  const extraEntries = uniqueSelectedExtraTeamIds.map((teamId) => {
    const best = bestCandidates.find((value) => asText(value.teamId) === teamId);
    if (best) return entryFromSnapshot(best, "ทีมอันดับเพิ่มเติมที่ดีที่สุด");
    const ranked = rankedCandidates.find((candidate) => candidate.teamId === teamId);
    if (ranked) return ranked;
    return {
      bestOrder: null,
      groupId: null,
      label: "Admin selected",
      rank: null,
      reason: "ผู้ดูแลเลือกเพิ่ม",
      sourceType: "admin_selected" as const,
      teamId,
      teamName: participantNames.get(teamId) ?? "",
    };
  }).filter((entry) => Boolean(entry.teamName) && !reserved.has(entry.teamId));
  const division2Error = division2Capacity === null
    ? "Division 2 ต้องมีทีมไม่เกิน 32 ทีม"
    : invalidSelection || extraEntries.length !== extraNeeded
      ? `Division 2 ต้องเลือกทีมเติมอีก ${extraNeeded} ทีม`
      : null;
  const candidatePool = Array.from(participantNames.entries())
    .filter(([teamId]) => !reserved.has(teamId) && !uniqueSelectedExtraTeamIds.includes(teamId))
    .map(([teamId, teamName]) => {
      const best = bestCandidates.find((value) => asText(value.teamId) === teamId);
      const ranked = rankedCandidates.find((candidate) => candidate.teamId === teamId);
      return best ? entryFromSnapshot(best, "ทีมอันดับเพิ่มเติมที่ดีที่สุด") : ranked ?? { bestOrder: null, groupId: null, label: "Admin selected", rank: null, reason: "ผู้ดูแลเลือกเพิ่ม", sourceType: "admin_selected" as const, teamId, teamName };
    });
  const saved = new Map(data.partitions.map((partition) => [asText(partition.partition_key), partition]));
  const division1Saved = saved.get("division_1");
  const division2Saved = saved.get("division_2");
  const approvalStatus = division1Saved?.approval_status === "approved" && division2Saved?.approval_status === "approved" ? "approved" : "draft";
  return {
    approvalStatus,
    approvedAt: approvalStatus === "approved" && typeof division1Saved?.approved_at === "string" ? division1Saved.approved_at : null,
    approvedByLabel: approvalStatus === "approved" && typeof division1Saved?.approved_by_label === "string" ? division1Saved.approved_by_label : null,
    candidatePool,
    division1: { bracketCapacity: division1Capacity, entries: division1Base, error: division1Error },
    division2: { bracketCapacity: division2Capacity, entries: [...division2Base, ...extraEntries], extraCount: extraEntries.length, extraNeeded, error: division2Error },
    recommendedExtraTeamIds,
  };
}

export async function selectKnockoutTemplateV2(competitionId: string, templateKey: KnockoutTemplateKey) {
  const template = getKnockoutTemplate(templateKey);
  if (!template) return { error: "ไม่พบรูปแบบการแข่งขันที่เลือก", ok: false };
  const data = await loadCouncilData(competitionId);
  if (!data.supabase) return { error: data.error, ok: false };
  if (data.competition.season_status === "completed") return { error: "การแข่งขันปิดแล้ว ต้องเปิดการแข่งขันเพื่อแก้ไขก่อน", ok: false };
  if (templateKey === councilTemplateKey) {
    const state = buildState(data);
    if (state.division1.error || state.division2.error) return { error: state.division1.error ?? state.division2.error, ok: false };
  }
  const [nodes, matches] = await Promise.all([
    data.supabase.from("competition_bracket_nodes").select("id").eq("competition_id", competitionId).limit(1),
    data.supabase.from("matches").select("id").eq("league_id", competitionId).eq("competition_stage", "knockout").limit(1),
  ]);
  if (nodes.error || matches.error) return { error: "ไม่สามารถตรวจสอบสถานะรอบน็อกเอาต์", ok: false };
  if (nodes.data?.length || matches.data?.length) return { error: "เปลี่ยนรูปแบบการแข่งขันไม่ได้ เพราะมีโครงสร้างหรือแมตช์รอบน็อกเอาต์แล้ว", ok: false };
  const update = await data.supabase.from("competition_knockout_configs").update({ template_key: templateKey, updated_at: new Date().toISOString() }).eq("competition_id", competitionId);
  if (update.error) return { error: "ไม่สามารถบันทึกรูปแบบการแข่งขัน", ok: false };
  revalidatePath(`/admin/competitions/${competitionId}`);
  return { ok: true, state: templateKey === councilTemplateKey ? buildState(data) : undefined };
}

export async function getCouncilDivisionStateV2(competitionId: string) {
  const data = await loadCouncilData(competitionId);
  if (!data.supabase) return { error: data.error, ok: false };
  if (data.config.template_key !== councilTemplateKey) return { error: "ยังไม่ได้เลือกคัพสภา – สองดิวิชั่น", ok: false };
  const savedDivision2 = data.partitions.find((partition) => asText(partition.partition_key) === "division_2");
  const savedEntries = Array.isArray(savedDivision2?.qualification_snapshot) ? savedDivision2.qualification_snapshot as SourceRow[] : [];
  const rawSnapshot = Array.isArray(data.config.qualification_snapshot) ? data.config.qualification_snapshot as unknown[] : [];
  const baseIds = rawSnapshot.map((entry: unknown) => entry as SourceRow).filter((entry) => entry.type === "group_rank" && entry.rank === 2).map((entry) => asText(entry.teamId));
  const extras = savedEntries.map((entry) => asText(entry.teamId)).filter((teamId) => teamId && !baseIds.includes(teamId));
  return { ok: true, state: buildState(data, extras.length ? extras : undefined) };
}

async function persistCouncilDivisions(competitionId: string, extraTeamIds: string[], approvalStatus: "approved" | "draft") {
  const data = await loadCouncilData(competitionId);
  if (!data.supabase) return { error: data.error, ok: false };
  if (data.competition.season_status === "completed") return { error: "การแข่งขันปิดแล้ว ต้องเปิดการแข่งขันเพื่อแก้ไขก่อน", ok: false };
  if (data.config.template_key !== councilTemplateKey) return { error: "กรุณาเลือกคัพสภา – สองดิวิชั่นก่อน", ok: false };
  if (data.partitions.some((partition) => partition.approval_status === "approved")) return { error: "เปิดการแบ่งดิวิชั่นเพื่อแก้ไขก่อนเปลี่ยนข้อมูลที่อนุมัติแล้ว", ok: false };
  const state = buildState(data, extraTeamIds);
  if (state.division1.error || state.division2.error || !state.division1.bracketCapacity || !state.division2.bracketCapacity) return { error: state.division1.error ?? state.division2.error ?? "ข้อมูลดิวิชั่นไม่สมบูรณ์", ok: false };
  const payload = [
    { bracketCapacity: state.division1.bracketCapacity, entrantCount: state.division1.entries.length, entries: state.division1.entries, pairingSnapshot: [], partitionKey: "division_1", partitionLabel: "Division 1" },
    { bracketCapacity: state.division2.bracketCapacity, entrantCount: state.division2.entries.length, entries: state.division2.entries, pairingSnapshot: [], partitionKey: "division_2", partitionLabel: "Division 2" },
  ];
  const result = await data.supabase.rpc("save_council_division_partitions_v1", { p_approval_status: approvalStatus, p_approved_by_label: "Administrator session", p_competition_id: competitionId, p_partitions: payload });
  if (result.error) {
    console.error("council division persistence failed", result.error);
    return { error: "ไม่สามารถบันทึกการแบ่งดิวิชั่นได้", ok: false };
  }
  revalidatePath(`/admin/competitions/${competitionId}`);
  return { ok: true, state: { ...state, approvalStatus, approvedAt: approvalStatus === "approved" ? new Date().toISOString() : null, approvedByLabel: approvalStatus === "approved" ? "Administrator session" : null } };
}

export async function saveCouncilDivisionDraftV2(competitionId: string, extraTeamIds: string[]) {
  return persistCouncilDivisions(competitionId, extraTeamIds, "draft");
}

export async function approveCouncilDivisionsV2(competitionId: string, extraTeamIds: string[]) {
  return persistCouncilDivisions(competitionId, extraTeamIds, "approved");
}

export async function reopenCouncilDivisionsV2(competitionId: string) {
  const data = await loadCouncilData(competitionId);
  if (!data.supabase) return { error: data.error, ok: false };
  if (data.competition.season_status === "completed") return { error: "การแข่งขันปิดแล้ว ต้องเปิดการแข่งขันเพื่อแก้ไขก่อน", ok: false };
  if (data.config.template_key !== councilTemplateKey) return { error: "ยังไม่ได้เลือกคัพสภา – สองดิวิชั่น", ok: false };
  const result = await data.supabase.rpc("reopen_council_division_partitions_v1", { p_competition_id: competitionId });
  if (result.error) return { error: "เปิดการแบ่งดิวิชั่นเพื่อแก้ไขไม่ได้ เพราะมีสายหรือแมตช์เริ่มแล้ว", ok: false };
  revalidatePath(`/admin/competitions/${competitionId}`);
  const savedDivision2 = data.partitions.find((partition) => asText(partition.partition_key) === "division_2");
  const savedEntries = Array.isArray(savedDivision2?.qualification_snapshot) ? savedDivision2.qualification_snapshot as SourceRow[] : [];
  const rawSnapshot = Array.isArray(data.config.qualification_snapshot) ? data.config.qualification_snapshot as unknown[] : [];
  const baseIds = rawSnapshot.map((entry: unknown) => entry as SourceRow).filter((entry) => entry.type === "group_rank" && entry.rank === 2).map((entry) => asText(entry.teamId));
  const extraIds = savedEntries.map((entry) => asText(entry.teamId)).filter((teamId) => teamId && !baseIds.includes(teamId));
  const state = buildState(data, extraIds.length ? extraIds : undefined);
  return { ok: true, state: { ...state, approvalStatus: "draft" as const, approvedAt: null, approvedByLabel: null } };
}

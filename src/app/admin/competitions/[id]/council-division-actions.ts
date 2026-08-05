"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin-server-auth";
import { isCupCompetition, normalizeCompetitionType } from "@/lib/competition-format";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { calculateCupGroupStandings } from "@/lib/cup-group-standings";
import { resetCouncilKnockoutRuntimeV2 } from "@/app/admin/competitions/[id]/council-bracket-actions";

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
  division1: { bracketCapacity: number | null; entries: CouncilDivisionEntry[]; extraCount: number; extraNeeded: number; error: string | null };
  division2: { bracketCapacity: number | null; entries: CouncilDivisionEntry[]; extraCount: number; extraNeeded: number; error: string | null };
  recommendedDivision1ExtraTeamIds: string[];
  recommendedDivision2ExtraTeamIds: string[];
  thirdPlaceTieRequiresConfirmation: boolean;
};

export type CouncilDivisionExtraSelections = {
  division1: string[];
  division2: string[];
};

export type CouncilTemplatePreflightResult = {
  code: "council_data_unavailable" | "division_1_not_ready" | "division_2_not_ready" | "qualification_not_approved" | "ready";
  message: string;
  missingRequirements: string[];
  ok: boolean;
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

function buildState(data: Exclude<Awaited<ReturnType<typeof loadCouncilData>>, { error: string; supabase: null }>, requestedExtras?: CouncilDivisionExtraSelections): CouncilDivisionState {
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
  const thirdPlaceCandidates = calculateCupGroupStandings({ groups: data.groups as SourceRow[], matches: data.matches as SourceRow[], teams: standingTeams })
    .flatMap((standing) => standing.rows.filter((row) => row.position === 3).map((row) => ({
      goalDifference: row.goal_difference,
      goalsFor: row.goals_for,
      groupId: standing.group_id,
      points: row.points,
      teamId: row.team_id,
      teamName: row.team_name,
      tieUnresolved: row.tie_unresolved,
      won: row.won,
    })))
    .sort((left, right) => right.points - left.points || right.goalDifference - left.goalDifference || right.goalsFor - left.goalsFor || right.won - left.won || left.teamName.localeCompare(right.teamName));
  const unresolvedThirdPlaceIds = new Set(thirdPlaceCandidates.filter((candidate, index, entries) => candidate.tieUnresolved || (index > 0 && candidate.points === entries[index - 1].points && candidate.goalDifference === entries[index - 1].goalDifference && candidate.goalsFor === entries[index - 1].goalsFor && candidate.won === entries[index - 1].won)).map((candidate) => candidate.teamId));
  const rankedCandidates = thirdPlaceCandidates.map((candidate, index) => ({ bestOrder: index + 1, groupId: candidate.groupId, label: `อันดับ 3 ที่ดีที่สุด #${index + 1}`, rank: 3, reason: unresolvedThirdPlaceIds.has(candidate.teamId) ? "ต้องยืนยันอันดับ 3 ที่ดีที่สุด" : "อันดับ 3 ที่ดีที่สุด", sourceType: "best_ranked" as const, teamId: candidate.teamId, teamName: candidate.teamName }));
  const division1Capacity = nextCapacity(division1Base.length);
  const division2Capacity = nextCapacity(division2Base.length);
  const division1ExtraNeeded = division1Capacity ? division1Capacity - division1Base.length : 0;
  const division2ExtraNeeded = division2Capacity ? division2Capacity - division2Base.length : 0;
  const reserved = new Set([...division1Base, ...division2Base].map((entry) => entry.teamId));
  const automaticCandidates = rankedCandidates.filter((candidate) => !unresolvedThirdPlaceIds.has(candidate.teamId));
  const recommendedDivision1ExtraTeamIds = automaticCandidates.slice(0, division1ExtraNeeded).map((candidate) => candidate.teamId);
  const recommendedDivision2ExtraTeamIds = automaticCandidates.filter((candidate) => !recommendedDivision1ExtraTeamIds.includes(candidate.teamId)).slice(0, division2ExtraNeeded).map((candidate) => candidate.teamId);
  const selectedDivision1Ids = requestedExtras?.division1 ?? recommendedDivision1ExtraTeamIds;
  const selectedDivision2Ids = requestedExtras?.division2 ?? recommendedDivision2ExtraTeamIds;
  const selectedIds = [...selectedDivision1Ids, ...selectedDivision2Ids];
  const selectedUnique = new Set(selectedIds);
  const extraEntries = (teamIds: string[]): CouncilDivisionEntry[] => teamIds.flatMap((teamId) => {
    const entry = rankedCandidates.find((candidate) => candidate.teamId === teamId);
    return entry && !reserved.has(entry.teamId) ? [entry] : [];
  });
  const division1Extras = extraEntries(selectedDivision1Ids);
  const division2Extras = extraEntries(selectedDivision2Ids);
  const invalidSelections = selectedUnique.size !== selectedIds.length || division1Extras.length !== division1ExtraNeeded || division2Extras.length !== division2ExtraNeeded;
  const division1Error = division1Capacity === null ? "Division 1 ต้องมีทีมไม่เกิน 32 ทีม" : invalidSelections || division1Extras.length !== division1ExtraNeeded ? `Division 1 ต้องเลือกทีมอันดับ 3 ที่ดีที่สุดเพิ่มอีก ${division1ExtraNeeded} ทีม` : null;
  const division2Error = division2Capacity === null ? "Division 2 ต้องมีทีมไม่เกิน 32 ทีม" : invalidSelections || division2Extras.length !== division2ExtraNeeded ? `Division 2 ต้องเลือกทีมอันดับ 3 ที่ดีที่สุดเพิ่มอีก ${division2ExtraNeeded} ทีม` : null;
  const candidatePool = Array.from(participantNames.entries())
    .filter(([teamId]) => !reserved.has(teamId) && !selectedUnique.has(teamId))
    .map(([teamId, teamName]) => {
      const ranked = rankedCandidates.find((candidate) => candidate.teamId === teamId);
      return ranked ?? { bestOrder: null, groupId: null, label: "Admin selected", rank: null, reason: "ผู้ดูแลเลือกเพิ่ม", sourceType: "admin_selected" as const, teamId, teamName };
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
    division1: { bracketCapacity: division1Capacity, entries: [...division1Base, ...division1Extras], extraCount: division1Extras.length, extraNeeded: division1ExtraNeeded, error: division1Error },
    division2: { bracketCapacity: division2Capacity, entries: [...division2Base, ...division2Extras], extraCount: division2Extras.length, extraNeeded: division2ExtraNeeded, error: division2Error },
    recommendedDivision1ExtraTeamIds,
    recommendedDivision2ExtraTeamIds,
    thirdPlaceTieRequiresConfirmation: unresolvedThirdPlaceIds.size > 0,
  };
}

export async function getCouncilTemplatePreflightV2(competitionId: string): Promise<CouncilTemplatePreflightResult> {
  const data = await loadCouncilData(competitionId);
  if (!data.supabase) {
    const qualificationPending = data.error === "ยืนยันทีมผ่านเข้ารอบก่อนเลือกคัพสภา";
    return {
      code: qualificationPending ? "qualification_not_approved" : "council_data_unavailable",
      message: qualificationPending ? "เลือกคัพสภา – สองดิวิชั่นแล้ว แต่ยังยืนยันทีมผ่านเข้ารอบไม่ครบ" : data.error ?? "ไม่สามารถตรวจสอบความพร้อมของคัพสภา – สองดิวิชั่นได้",
      missingRequirements: qualificationPending ? ["ยืนยันทีมผ่านเข้ารอบ"] : [],
      ok: false,
    };
  }

  const state = buildState(data);
  const missingRequirements = [state.division1.error, state.division2.error].filter((error): error is string => Boolean(error));
  if (missingRequirements.length) {
    return {
      code: state.division1.error ? "division_1_not_ready" : "division_2_not_ready",
      message: "เลือกคัพสภา – สองดิวิชั่นแล้ว แต่ยังสร้างโครงสร้างไม่ได้",
      missingRequirements,
      ok: false,
    };
  }

  return { code: "ready", message: "ข้อมูลพร้อมสำหรับจัดสาย Division 1 และ Division 2", missingRequirements: [], ok: true };
}

export async function getCouncilDivisionStateV2(competitionId: string) {
  const data = await loadCouncilData(competitionId);
  if (!data.supabase) return { error: data.error, ok: false };
  if (data.config.template_key !== councilTemplateKey) return { error: "ยังไม่ได้เลือกคัพสภา – สองดิวิชั่น", ok: false };
  const savedDivision1 = data.partitions.find((partition) => asText(partition.partition_key) === "division_1");
  const savedDivision2 = data.partitions.find((partition) => asText(partition.partition_key) === "division_2");
  const savedDivision1Entries = Array.isArray(savedDivision1?.qualification_snapshot) ? savedDivision1.qualification_snapshot as SourceRow[] : [];
  const savedDivision2Entries = Array.isArray(savedDivision2?.qualification_snapshot) ? savedDivision2.qualification_snapshot as SourceRow[] : [];
  const rawSnapshot = Array.isArray(data.config.qualification_snapshot) ? data.config.qualification_snapshot as unknown[] : [];
  const winnerIds = rawSnapshot.map((entry: unknown) => entry as SourceRow).filter((entry) => entry.type === "group_rank" && entry.rank === 1).map((entry) => asText(entry.teamId));
  const baseIds = rawSnapshot.map((entry: unknown) => entry as SourceRow).filter((entry) => entry.type === "group_rank" && entry.rank === 2).map((entry) => asText(entry.teamId));
  const extras = {
    division1: savedDivision1Entries.map((entry) => asText(entry.teamId)).filter((teamId) => teamId && !winnerIds.includes(teamId)),
    division2: savedDivision2Entries.map((entry) => asText(entry.teamId)).filter((teamId) => teamId && !baseIds.includes(teamId)),
  };
  return { ok: true, state: buildState(data, extras.division1.length || extras.division2.length ? extras : undefined) };
}

async function persistCouncilDivisions(competitionId: string, extras: CouncilDivisionExtraSelections, approvalStatus: "approved" | "draft") {
  const data = await loadCouncilData(competitionId);
  if (!data.supabase) return { error: data.error, ok: false };
  if (data.competition.season_status === "completed") return { error: "การแข่งขันปิดแล้ว ต้องเปิดการแข่งขันเพื่อแก้ไขก่อน", ok: false };
  if (data.config.template_key !== councilTemplateKey) return { error: "กรุณาเลือกคัพสภา – สองดิวิชั่นก่อน", ok: false };
  if (data.partitions.some((partition) => partition.approval_status === "approved")) return { error: "เปิดการแบ่งดิวิชั่นเพื่อแก้ไขก่อนเปลี่ยนข้อมูลที่อนุมัติแล้ว", ok: false };
  const state = buildState(data, extras);
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

export async function saveCouncilDivisionDraftV2(competitionId: string, extras: CouncilDivisionExtraSelections) {
  return persistCouncilDivisions(competitionId, extras, "draft");
}

export async function approveCouncilDivisionsV2(competitionId: string, extras: CouncilDivisionExtraSelections) {
  return persistCouncilDivisions(competitionId, extras, "approved");
}

export async function reopenCouncilDivisionsV2(competitionId: string) {
  const data = await loadCouncilData(competitionId);
  if (!data.supabase) return { error: data.error, ok: false };
  if (data.competition.season_status === "completed") return { error: "การแข่งขันปิดแล้ว ต้องเปิดการแข่งขันเพื่อแก้ไขก่อน", ok: false };
  if (data.config.template_key !== councilTemplateKey) return { error: "ยังไม่ได้เลือกคัพสภา – สองดิวิชั่น", ok: false };
  const reset = await resetCouncilKnockoutRuntimeV2(competitionId);
  if (!reset.ok) return { error: reset.error ?? "ไม่สามารถล้างข้อมูลน็อกเอาต์เพื่อเปิดการแบ่งดิวิชั่น", ok: false };
  const result = await data.supabase.rpc("reopen_council_division_partitions_v1", { p_competition_id: competitionId });
  if (result.error) return { error: "เปิดการแบ่งดิวิชั่นเพื่อแก้ไขไม่ได้ เพราะมีสายหรือแมตช์เริ่มแล้ว", ok: false };
  revalidatePath(`/admin/competitions/${competitionId}`);
  const savedDivision1 = data.partitions.find((partition) => asText(partition.partition_key) === "division_1");
  const savedDivision2 = data.partitions.find((partition) => asText(partition.partition_key) === "division_2");
  const savedDivision1Entries = Array.isArray(savedDivision1?.qualification_snapshot) ? savedDivision1.qualification_snapshot as SourceRow[] : [];
  const savedDivision2Entries = Array.isArray(savedDivision2?.qualification_snapshot) ? savedDivision2.qualification_snapshot as SourceRow[] : [];
  const rawSnapshot = Array.isArray(data.config.qualification_snapshot) ? data.config.qualification_snapshot as unknown[] : [];
  const winnerIds = rawSnapshot.map((entry: unknown) => entry as SourceRow).filter((entry) => entry.type === "group_rank" && entry.rank === 1).map((entry) => asText(entry.teamId));
  const baseIds = rawSnapshot.map((entry: unknown) => entry as SourceRow).filter((entry) => entry.type === "group_rank" && entry.rank === 2).map((entry) => asText(entry.teamId));
  const extras = {
    division1: savedDivision1Entries.map((entry) => asText(entry.teamId)).filter((teamId) => teamId && !winnerIds.includes(teamId)),
    division2: savedDivision2Entries.map((entry) => asText(entry.teamId)).filter((teamId) => teamId && !baseIds.includes(teamId)),
  };
  const state = buildState(data, extras.division1.length || extras.division2.length ? extras : undefined);
  return { ok: true, state: { ...state, approvalStatus: "draft" as const, approvedAt: null, approvedByLabel: null } };
}

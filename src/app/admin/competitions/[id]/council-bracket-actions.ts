"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminSession } from "@/lib/admin-server-auth";
import { isCupCompetition, normalizeCompetitionType } from "@/lib/competition-format";
import { buildCompetitionTree, type CompetitionTreeNode, type CompetitionTreeSource, validateCompetitionTree } from "@/lib/competition-tree";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const partitionKeys = ["division_1", "division_2"] as const;
type CouncilPartitionKey = (typeof partitionKeys)[number];
type Row = Record<string, unknown>;

export type CouncilBracketMatch = {
  away_score: number | null;
  away_team_id: string;
  home_score: number | null;
  home_team_id: string;
  id: string;
  manual_winner_team_id: string | null;
  match_date: string | null;
  penalty_away_score: number | null;
  penalty_home_score: number | null;
  status: string;
  venue: string | null;
  winner_team_id: string | null;
};

export type CouncilBracketState = {
  championAt: string | null;
  championTeamId: string | null;
  entrantCount: number;
  error?: string;
  matches: CouncilBracketMatch[];
  nodes: CompetitionTreeNode[];
  ok: boolean;
  pairingSources: CompetitionTreeSource[];
  partitionKey: CouncilPartitionKey;
  partitionLabel: string;
  status: "active" | "completed" | "draft" | "fixtures_created" | "reviewed";
};

function isPartitionKey(value: string): value is CouncilPartitionKey {
  return (partitionKeys as readonly string[]).includes(value);
}

function text(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value : "";
}

function numeric(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "number" ? value : null;
}

function sourceFromSnapshot(entry: Row): CompetitionTreeSource | null {
  const teamId = text(entry, "teamId");
  const sourceType = text(entry, "sourceType") || text(entry, "type");
  if (!teamId) return null;
  if (sourceType === "best_ranked") {
    return { bestOrder: numeric(entry, "bestOrder") ?? undefined, rank: numeric(entry, "rank") ?? undefined, teamId, type: "best_ranked" };
  }
  if (sourceType === "admin_selected") return { teamId, type: "manual_team" };
  return { groupId: text(entry, "groupId") || undefined, rank: numeric(entry, "rank") ?? undefined, teamId, type: "group_rank" };
}

function sourceFromRow(row: Row, side: "away" | "home"): CompetitionTreeSource {
  const type = text(row, `${side}_source_type`);
  const allowed = type === "best_ranked" || type === "bye" || type === "group_rank" || type === "manual_team" || type === "node_winner" || type === "unassigned" ? type : "unassigned";
  return {
    bestOrder: numeric(row, `${side}_source_best_order`) ?? undefined,
    groupId: text(row, `${side}_source_group_id`) || undefined,
    nodeId: text(row, `${side}_source_node_id`) || undefined,
    rank: numeric(row, `${side}_source_rank`) ?? undefined,
    teamId: text(row, `${side}_source_team_id`) || undefined,
    type: allowed,
  };
}

function nodeFromRow(row: Row): CompetitionTreeNode {
  return {
    awaySource: sourceFromRow(row, "away"),
    bracketPosition: numeric(row, "bracket_position") ?? 0,
    competitionId: text(row, "competition_id"),
    homeSource: sourceFromRow(row, "home"),
    id: text(row, "id"),
    linkedMatchId: text(row, "linked_match_id") || undefined,
    matchOrder: numeric(row, "match_order") ?? 0,
    partitionKey: text(row, "partition_key") || "main",
    roundIndex: numeric(row, "round_index") ?? 0,
    roundLabel: text(row, "round_label"),
  };
}

async function persistPartitionChampion(
  supabase: SupabaseClient,
  competitionId: string,
  partitionKey: CouncilPartitionKey,
  winnerTeamId: string,
  source: "completion" | "final_save" | "load_backfill",
) {
  const championAt = new Date().toISOString();
  const result = await supabase
    .from("competition_knockout_partitions")
    .update({ champion_at: championAt, champion_team_id: winnerTeamId, status: "completed", updated_at: championAt })
    .eq("competition_id", competitionId)
    .eq("partition_key", partitionKey)
    .select("competition_id, partition_key, champion_team_id, champion_at, status");
  if (result.error) {
    console.error("council partition champion update failed", { code: result.error.code, competitionId, message: result.error.message, partitionKey, source, winnerTeamId });
    return { error: "ไม่สามารถบันทึกแชมป์ดิวิชั่นได้", row: null as Row | null };
  }
  if (result.data?.length !== 1) {
    console.error("council partition champion update affected unexpected rows", { affectedRows: result.data?.length ?? 0, competitionId, partitionKey, source, winnerTeamId });
    return { error: "ไม่พบข้อมูลดิวิชั่นที่ต้องบันทึกแชมป์", row: null as Row | null };
  }
  const row = result.data[0] as Row;
  console.info("council partition champion persisted", { championAt: text(row, "champion_at"), championTeamId: text(row, "champion_team_id"), competitionId, partitionKey, source });
  return { error: "", row };
}

function sourceForInsert(source: CompetitionTreeSource) {
  return {
    bestOrder: source.type === "best_ranked" ? source.bestOrder ?? null : null,
    groupId: source.type === "group_rank" ? source.groupId ?? null : null,
    nodeId: source.type === "node_winner" ? source.nodeId ?? null : null,
    rank: source.type === "group_rank" || source.type === "best_ranked" ? source.rank ?? null : null,
    teamId: source.type === "manual_team" || source.type === "best_ranked" ? source.teamId ?? null : null,
  };
}

function nodeForInsert(node: CompetitionTreeNode) {
  const home = sourceForInsert(node.homeSource);
  const away = sourceForInsert(node.awaySource);
  return {
    away_source_best_order: away.bestOrder,
    away_source_group_id: away.groupId,
    away_source_node_id: away.nodeId,
    away_source_rank: away.rank,
    away_source_team_id: away.teamId,
    away_source_type: node.awaySource.type,
    bracket_position: node.bracketPosition,
    competition_id: node.competitionId,
    home_source_best_order: home.bestOrder,
    home_source_group_id: home.groupId,
    home_source_node_id: home.nodeId,
    home_source_rank: home.rank,
    home_source_team_id: home.teamId,
    home_source_type: node.homeSource.type,
    id: node.id,
    match_order: node.matchOrder,
    partition_key: node.partitionKey ?? "main",
    round_index: node.roundIndex,
    round_label: node.roundLabel,
  };
}

function sameSource(left: CompetitionTreeSource, right: CompetitionTreeSource) {
  return left.type === right.type && left.teamId === right.teamId && left.groupId === right.groupId && left.rank === right.rank && left.bestOrder === right.bestOrder;
}

function sameSourceSet(left: CompetitionTreeSource[], right: CompetitionTreeSource[]) {
  return left.length === right.length && left.every((source) => right.some((candidate) => sameSource(source, candidate)));
}

function naturalPairing(sources: CompetitionTreeSource[]) {
  const remaining = [...sources];
  const paired: CompetitionTreeSource[] = [];
  while (remaining.length) {
    const home = remaining.shift();
    if (!home) break;
    const awayIndex = remaining.findIndex((candidate) => !home.groupId || !candidate.groupId || candidate.groupId !== home.groupId);
    const away = remaining.splice(awayIndex >= 0 ? awayIndex : 0, 1)[0];
    if (!away || (home.groupId && home.groupId === away.groupId)) throw new Error("ไม่สามารถจัดคู่รอบแรกโดยหลีกเลี่ยงทีมจากกลุ่มเดียวกันได้");
    paired.push(home, away);
  }
  return paired;
}

async function verifyCouncilPartition(competitionId: string, partitionKey: string) {
  await requireAdminSession();
  if (!isPartitionKey(partitionKey)) return { error: "ดิวิชั่นไม่ถูกต้อง", supabase: null as SupabaseClient | null };
  const supabase = getSupabaseAdmin();
  if (!supabase) return { error: "ไม่สามารถเชื่อมต่อข้อมูลผู้ดูแล", supabase: null as SupabaseClient | null };
  const [competitionResult, configResult, partitionResult] = await Promise.all([
    supabase.from("leagues").select("competition_type, season_status").eq("id", competitionId).maybeSingle(),
    supabase.from("competition_knockout_configs").select("template_key").eq("competition_id", competitionId).maybeSingle(),
    supabase.from("competition_knockout_partitions").select("partition_key, partition_label, entrant_count, bracket_capacity, qualification_snapshot, pairing_snapshot, champion_team_id, champion_at, approval_status, status, updated_at").eq("competition_id", competitionId).eq("partition_key", partitionKey).maybeSingle(),
  ]);
  if (competitionResult.error || configResult.error || partitionResult.error) {
    console.error("council bracket verification failed", { competition: competitionResult.error, config: configResult.error, partition: partitionResult.error });
    return { error: "ไม่สามารถตรวจสอบสถานะสายแข่งขันได้", supabase: null as SupabaseClient | null };
  }
  if (!competitionResult.data || !isCupCompetition(normalizeCompetitionType(competitionResult.data.competition_type))) return { error: "ไม่พบการแข่งขันแบบ Cup", supabase: null as SupabaseClient | null };
  if (configResult.data?.template_key !== "council_two_division") return { error: "รายการนี้ไม่ได้ใช้รูปแบบคัพสภา – สองดิวิชั่น", supabase: null as SupabaseClient | null };
  if (!partitionResult.data || partitionResult.data.approval_status !== "approved") return { error: "ยืนยันการแบ่งดิวิชั่นก่อนจัดสายแข่งขัน", supabase: null as SupabaseClient | null };
  return { competition: competitionResult.data, partition: partitionResult.data as Row, partitionKey, supabase };
}

async function loadState(supabase: SupabaseClient, competitionId: string, partitionKey: CouncilPartitionKey, partition: Row): Promise<CouncilBracketState> {
  const [nodesResult, matchesResult] = await Promise.all([
    supabase.from("competition_bracket_nodes").select("id, competition_id, partition_key, round_index, round_label, match_order, bracket_position, linked_match_id, home_source_type, home_source_group_id, home_source_rank, home_source_team_id, home_source_node_id, home_source_best_order, away_source_type, away_source_group_id, away_source_rank, away_source_team_id, away_source_node_id, away_source_best_order").eq("competition_id", competitionId).eq("partition_key", partitionKey).order("round_index").order("match_order"),
    supabase.from("matches").select("id, home_team_id, away_team_id, home_score, away_score, penalty_home_score, penalty_away_score, manual_winner_team_id, winner_team_id, match_date, venue, status").eq("league_id", competitionId).eq("competition_stage", "knockout").eq("knockout_partition_key", partitionKey),
  ]);
  if (nodesResult.error || matchesResult.error) {
    console.error("council bracket state load failed", { nodes: nodesResult.error, matches: matchesResult.error });
    return { championAt: null, championTeamId: null, entrantCount: numeric(partition, "entrant_count") ?? 0, error: "ไม่สามารถโหลดข้อมูลสายแข่งขันได้", matches: [], nodes: [], ok: false, pairingSources: [], partitionKey, partitionLabel: text(partition, "partition_label") || partitionKey, status: "draft" };
  }
  let persistedPartition = partition;
  const finalNode = (nodesResult.data ?? []).map((row) => nodeFromRow(row as Row)).sort((left, right) => right.roundIndex - left.roundIndex || right.matchOrder - left.matchOrder)[0];
  const finalMatch = finalNode?.linkedMatchId
    ? (matchesResult.data ?? []).find((match) => text(match as Row, "id") === finalNode.linkedMatchId) as Row | undefined
    : undefined;
  if (!text(persistedPartition, "champion_team_id") && finalMatch && text(finalMatch, "status") === "finished" && text(finalMatch, "winner_team_id")) {
    const backfill = await persistPartitionChampion(supabase, competitionId, partitionKey, text(finalMatch, "winner_team_id"), "load_backfill");
    if (backfill.error || !backfill.row) {
      return { championAt: null, championTeamId: null, entrantCount: numeric(partition, "entrant_count") ?? 0, error: backfill.error || "ไม่สามารถเติมข้อมูลแชมป์เดิมได้", matches: [], nodes: [], ok: false, pairingSources: [], partitionKey, partitionLabel: text(partition, "partition_label") || partitionKey, status: "draft" };
    }
    persistedPartition = { ...partition, ...backfill.row };
  }
  const snapshot = Array.isArray(persistedPartition.qualification_snapshot) ? persistedPartition.qualification_snapshot : [];
  const pairingSnapshot = Array.isArray(persistedPartition.pairing_snapshot) && persistedPartition.pairing_snapshot.length ? persistedPartition.pairing_snapshot : snapshot;
  const rawPairingSources = pairingSnapshot.map((entry) => sourceFromSnapshot(entry as Row)).filter((source): source is CompetitionTreeSource => Boolean(source));
  let pairingSources = rawPairingSources;
  if (!Array.isArray(persistedPartition.pairing_snapshot) || !persistedPartition.pairing_snapshot.length) {
    try {
      pairingSources = naturalPairing(rawPairingSources);
    } catch {
      pairingSources = rawPairingSources;
    }
  }
  return {
    championAt: text(persistedPartition, "champion_at") || null,
    championTeamId: text(persistedPartition, "champion_team_id") || null,
    entrantCount: numeric(persistedPartition, "entrant_count") ?? 0,
    matches: (matchesResult.data ?? []) as CouncilBracketMatch[],
    nodes: (nodesResult.data ?? []).map((row) => nodeFromRow(row as Row)),
    ok: true,
    pairingSources,
    partitionKey,
    partitionLabel: text(persistedPartition, "partition_label") || partitionKey,
    status: text(persistedPartition, "status") === "completed" ? "completed" : text(persistedPartition, "status") === "active" ? "active" : text(persistedPartition, "status") === "fixtures_created" ? "fixtures_created" : text(persistedPartition, "status") === "reviewed" ? "reviewed" : "draft",
  };
}

export async function getCouncilBracketStateV2(competitionId: string, partitionKey: string) {
  const verified = await verifyCouncilPartition(competitionId, partitionKey);
  if (!verified.supabase || !verified.partition || !verified.partitionKey) return { error: verified.error, ok: false };
  return loadState(verified.supabase, competitionId, verified.partitionKey, verified.partition);
}

export async function confirmCouncilBracketV2(competitionId: string, partitionKey: string, requestedSources: CompetitionTreeSource[]) {
  const verified = await verifyCouncilPartition(competitionId, partitionKey);
  if (!verified.supabase || !verified.partition || !verified.partitionKey) return { error: verified.error, ok: false };
  if (verified.competition?.season_status === "completed") return { error: "การแข่งขันปิดแล้ว ไม่สามารถแก้ไขสายแข่งขันได้", ok: false };
  const state = await loadState(verified.supabase, competitionId, verified.partitionKey, verified.partition);
  if (!state.ok) return state;
  if (state.nodes.length) return { ...state, error: "สายแข่งขันของดิวิชั่นนี้ถูกยืนยันแล้ว", ok: false };
  const approvedSources = (Array.isArray(verified.partition.qualification_snapshot) ? verified.partition.qualification_snapshot : []).map((entry) => sourceFromSnapshot(entry as Row)).filter((source): source is CompetitionTreeSource => Boolean(source));
  const capacity = numeric(verified.partition, "bracket_capacity");
  if (!capacity || ![4, 8, 16, 32].includes(capacity) || approvedSources.length !== capacity || requestedSources.length !== capacity || !sameSourceSet(approvedSources, requestedSources)) {
    return { ...state, error: "รายชื่อหรือขนาดทีมไม่ตรงกับ Division Snapshot ที่อนุมัติแล้ว", ok: false };
  }
  if (requestedSources.some((source) => source.type === "bye" || source.type === "unassigned" || source.type === "node_winner")) return { ...state, error: "คัพสภาไม่รองรับ Bye หรือแหล่งทีมที่ยังไม่กำหนด", ok: false };
  for (let index = 0; index < requestedSources.length; index += 2) {
    if (requestedSources[index].groupId && requestedSources[index].groupId === requestedSources[index + 1]?.groupId) return { ...state, error: "รอบแรกห้ามให้ทีมจากกลุ่มเดียวกันพบกัน", ok: false };
  }
  try {
    // Nodes keep the approved team id as the executable source; the approved pairing snapshot keeps its group/rank label.
    const treeSources = requestedSources.map((source) => ({ teamId: source.teamId, type: "manual_team" as const }));
    const tree = buildCompetitionTree({ bracketCapacity: capacity, competitionId, entrantCount: capacity, entryMode: "custom", entrants: treeSources, idFactory: () => crypto.randomUUID(), partitionKey: verified.partitionKey });
    const insert = await verified.supabase.from("competition_bracket_nodes").insert(tree.nodes.map(nodeForInsert));
    if (insert.error) {
      console.error("council bracket insert failed", insert.error);
      return { ...state, error: "ไม่สามารถบันทึกสายแข่งขันของดิวิชั่นนี้ได้", ok: false };
    }
    const update = await verified.supabase.from("competition_knockout_partitions").update({ pairing_snapshot: requestedSources, status: "reviewed", updated_at: new Date().toISOString() }).eq("competition_id", competitionId).eq("partition_key", verified.partitionKey);
    if (update.error) {
      console.error("council bracket pairing snapshot update failed", update.error);
      return { ...state, error: "บันทึกสายแล้ว แต่ไม่สามารถยืนยันตัวอย่างการแข่งขันได้", ok: false };
    }
  } catch (error) {
    return { ...state, error: error instanceof Error ? error.message : "ไม่สามารถสร้างสายแข่งขันได้", ok: false };
  }
  revalidatePath(`/admin/competitions/${competitionId}`);
  return loadState(verified.supabase, competitionId, verified.partitionKey, verified.partition);
}

function resolveSource(source: CompetitionTreeSource, nodesById: Map<string, CompetitionTreeNode>, matchesById: Map<string, Row>) {
  if (source.type === "group_rank" || source.type === "best_ranked" || source.type === "manual_team") return source.teamId ? { teamId: source.teamId } : null;
  if (source.type !== "node_winner" || !source.nodeId) return null;
  const sourceNode = nodesById.get(source.nodeId);
  const sourceMatch = sourceNode?.linkedMatchId ? matchesById.get(sourceNode.linkedMatchId) : undefined;
  return sourceMatch && text(sourceMatch, "status") === "finished" && text(sourceMatch, "winner_team_id") ? { teamId: text(sourceMatch, "winner_team_id") } : null;
}

export async function createCouncilPartitionFixturesV2(competitionId: string, partitionKey: string, roundIndex: number) {
  const verified = await verifyCouncilPartition(competitionId, partitionKey);
  if (!verified.supabase || !verified.partition || !verified.partitionKey) return { error: verified.error, ok: false };
  if (verified.competition?.season_status === "completed") return { error: "การแข่งขันปิดแล้ว ไม่สามารถสร้างโปรแกรมได้", ok: false };
  const state = await loadState(verified.supabase, competitionId, verified.partitionKey, verified.partition);
  if (!state.ok) return state;
  const validation = validateCompetitionTree(state.nodes, state.entrantCount);
  if (!validation.valid) return { ...state, error: `โครงสร้างการแข่งขันไม่สมบูรณ์: ${validation.errors[0]}`, ok: false };
  const rounds = Array.from(new Set(state.nodes.map((node) => node.roundIndex))).sort((a, b) => a - b);
  const currentRound = rounds.find((index) => state.nodes.filter((node) => node.roundIndex === index).some((node) => !node.linkedMatchId || state.matches.find((match) => match.id === node.linkedMatchId)?.status !== "finished"));
  if (currentRound === undefined || currentRound !== roundIndex) return { ...state, error: "รอบนี้ยังไม่พร้อมสร้างโปรแกรมแข่งขัน", ok: false };
  const targetNodes = state.nodes.filter((node) => node.roundIndex === roundIndex);
  const matchesById = new Map(state.matches.map((match) => [match.id, match as unknown as Row]));
  const nodesById = new Map(state.nodes.map((node) => [node.id, node]));
  for (const node of targetNodes.filter((node) => !node.linkedMatchId)) {
    const home = resolveSource(node.homeSource, nodesById, matchesById);
    const away = resolveSource(node.awaySource, nodesById, matchesById);
    if (!home || !away || home.teamId === away.teamId) return { ...state, error: "รอผู้ชนะจากรอบก่อนก่อนสร้างโปรแกรม", ok: false };
    const created = await verified.supabase.from("matches").insert({ away_score: null, away_team_id: away.teamId, competition_stage: "knockout", fixture_source: "generated", group_id: null, home_score: null, home_team_id: home.teamId, knockout_partition_key: verified.partitionKey, league_id: competitionId, match_date: null, match_type: "cup", status: "scheduled", venue: null, winner_team_id: null }).select("id").maybeSingle();
    if (created.error || !created.data?.id) {
      console.error("council fixture insert failed", created.error);
      return { ...state, error: "ไม่สามารถสร้างโปรแกรมการแข่งขันได้", ok: false };
    }
    const link = await verified.supabase.from("competition_bracket_nodes").update({ linked_match_id: created.data.id }).eq("id", node.id).eq("competition_id", competitionId).eq("partition_key", verified.partitionKey).is("linked_match_id", null).select("id");
    if (link.error || !link.data?.length) {
      await verified.supabase.from("matches").delete().eq("id", created.data.id);
      return { ...state, error: "ไม่สามารถเชื่อมโปรแกรมกับสายแข่งขันได้", ok: false };
    }
  }
  const update = await verified.supabase.from("competition_knockout_partitions").update({ status: "fixtures_created", updated_at: new Date().toISOString() }).eq("competition_id", competitionId).eq("partition_key", verified.partitionKey);
  if (update.error) return { ...state, error: "สร้างโปรแกรมแล้ว แต่ไม่สามารถอัปเดตสถานะดิวิชั่นได้", ok: false };
  revalidatePath(`/admin/competitions/${competitionId}`);
  return loadState(verified.supabase, competitionId, verified.partitionKey, verified.partition);
}

function validScore(value: number | null) {
  return value === null || (Number.isInteger(value) && value >= 0 && value <= 999);
}

export async function saveCouncilPartitionMatchV2(payload: { awayScore: number | null; competitionId: string; homeScore: number | null; matchDate: string | null; matchId: string; partitionKey: string; penaltyAwayScore: number | null; penaltyHomeScore: number | null; status: "finished" | "scheduled"; venue: string | null }) {
  const verified = await verifyCouncilPartition(payload.competitionId, payload.partitionKey);
  if (!verified.supabase || !verified.partition || !verified.partitionKey) return { error: verified.error, ok: false };
  let partitionForState = verified.partition;
  if (verified.competition?.season_status === "completed") return { error: "การแข่งขันปิดแล้ว ไม่สามารถแก้ไขผลได้", ok: false };
  if (![payload.homeScore, payload.awayScore, payload.penaltyHomeScore, payload.penaltyAwayScore].every(validScore)) return { error: "คะแนนต้องเป็นจำนวนเต็มตั้งแต่ 0 ถึง 999", ok: false };
  const ownership = await verified.supabase.from("competition_bracket_nodes").select("id").eq("competition_id", payload.competitionId).eq("partition_key", verified.partitionKey).eq("linked_match_id", payload.matchId).maybeSingle();
  if (ownership.error || !ownership.data) return { error: "ไม่พบแมตช์ของดิวิชั่นนี้", ok: false };
  const matchResult = await verified.supabase.from("matches").select("id, home_team_id, away_team_id").eq("id", payload.matchId).eq("league_id", payload.competitionId).eq("competition_stage", "knockout").eq("knockout_partition_key", verified.partitionKey).maybeSingle();
  if (matchResult.error || !matchResult.data) return { error: "ไม่พบแมตช์รอบน็อกเอาต์", ok: false };
  let winnerTeamId: string | null = null;
  if (payload.status === "finished") {
    if (payload.homeScore === null || payload.awayScore === null) return { error: "กรุณากรอกคะแนนทั้งสองทีมก่อนบันทึกผล", ok: false };
    if (payload.homeScore !== payload.awayScore) winnerTeamId = payload.homeScore > payload.awayScore ? matchResult.data.home_team_id : matchResult.data.away_team_id;
    else if (payload.penaltyHomeScore === null || payload.penaltyAwayScore === null) return { error: "เสมอในเวลาปกติ กรุณากรอกผลการดวลจุดโทษ", ok: false };
    else if (payload.penaltyHomeScore === payload.penaltyAwayScore) return { error: "ผลการดวลจุดโทษต้องไม่เสมอกัน", ok: false };
    else winnerTeamId = payload.penaltyHomeScore > payload.penaltyAwayScore ? matchResult.data.home_team_id : matchResult.data.away_team_id;
  }
  const update = await verified.supabase.from("matches").update({ away_score: payload.awayScore, home_score: payload.homeScore, match_date: payload.matchDate, penalty_away_score: payload.status === "finished" && payload.homeScore === payload.awayScore ? payload.penaltyAwayScore : null, penalty_home_score: payload.status === "finished" && payload.homeScore === payload.awayScore ? payload.penaltyHomeScore : null, status: payload.status, venue: payload.venue, winner_team_id: winnerTeamId }).eq("id", payload.matchId).eq("league_id", payload.competitionId);
  if (update.error) return { error: "ไม่สามารถบันทึกผลการแข่งขันได้", ok: false };
  const finalNodeResult = await verified.supabase
    .from("competition_bracket_nodes")
    .select("id, linked_match_id")
    .eq("competition_id", payload.competitionId)
    .eq("partition_key", verified.partitionKey)
    .order("round_index", { ascending: false })
    .order("match_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (finalNodeResult.error || !finalNodeResult.data) return { error: "บันทึกผลแล้ว แต่ไม่สามารถตรวจสอบรอบชิงชนะเลิศได้", ok: false };
  const isFinalMatch = finalNodeResult.data.id === ownership.data.id && finalNodeResult.data.linked_match_id === payload.matchId;
  if (isFinalMatch && winnerTeamId) {
    console.info("council final detected", { competitionId: payload.competitionId, matchId: payload.matchId, nodeId: finalNodeResult.data.id, partitionKey: verified.partitionKey, winnerTeamId });
    const championUpdate = await persistPartitionChampion(verified.supabase, payload.competitionId, verified.partitionKey, winnerTeamId, "final_save");
    if (championUpdate.error || !championUpdate.row) return { error: championUpdate.error || "ไม่สามารถบันทึกแชมป์ดิวิชั่นได้", ok: false };
    partitionForState = { ...verified.partition, ...championUpdate.row };
  } else if (isFinalMatch) {
    const clearedAt = new Date().toISOString();
    const championClear = await verified.supabase
      .from("competition_knockout_partitions")
      .update({ champion_at: null, champion_team_id: null, status: "fixtures_created", updated_at: clearedAt })
      .eq("competition_id", payload.competitionId)
      .eq("partition_key", verified.partitionKey)
      .select("competition_id, partition_key, champion_team_id, champion_at, status");
    if (championClear.error || championClear.data?.length !== 1) {
      console.error("council final champion clear failed", { affectedRows: championClear.data?.length ?? 0, competitionId: payload.competitionId, error: championClear.error?.message, partitionKey: verified.partitionKey });
      return { error: "บันทึกผลแล้ว แต่ไม่สามารถอัปเดตสถานะแชมป์ดิวิชั่นได้", ok: false };
    }
    partitionForState = { ...verified.partition, ...(championClear.data[0] as Row) };
  }
  revalidatePath(`/admin/competitions/${payload.competitionId}`);
  const state = await loadState(verified.supabase, payload.competitionId, verified.partitionKey, partitionForState);
  console.info("council bracket state returned after match save", { championAt: state.championAt, championTeamId: state.championTeamId, competitionId: payload.competitionId, partitionKey: verified.partitionKey });
  return state;
}

export async function completeCouncilCupCompetitionV2(competitionId: string) {
  await requireAdminSession();
  const supabase = getSupabaseAdmin();
  if (!supabase) return { error: "ไม่สามารถเชื่อมต่อข้อมูลผู้ดูแล", ok: false };
  const [competitionResult, configResult, partitionsResult] = await Promise.all([
    supabase.from("leagues").select("competition_type, season_status").eq("id", competitionId).maybeSingle(),
    supabase.from("competition_knockout_configs").select("template_key").eq("competition_id", competitionId).maybeSingle(),
    supabase.from("competition_knockout_partitions").select("partition_key").eq("competition_id", competitionId).in("partition_key", partitionKeys),
  ]);
  if (competitionResult.error || configResult.error || partitionsResult.error || !competitionResult.data) return { error: "ไม่สามารถตรวจสอบสถานะการแข่งขันได้", ok: false };
  if (!isCupCompetition(normalizeCompetitionType(competitionResult.data.competition_type)) || configResult.data?.template_key !== "council_two_division") return { error: "รายการนี้ไม่ได้ใช้คัพสภา – สองดิวิชั่น", ok: false };
  if (competitionResult.data.season_status === "completed") return { ok: true };
  if ((partitionsResult.data ?? []).length !== 2) return { error: "ยังตั้งค่าดิวิชั่นไม่ครบ", ok: false };
  for (const key of partitionKeys) {
    const nodesResult = await supabase.from("competition_bracket_nodes").select("linked_match_id").eq("competition_id", competitionId).eq("partition_key", key).order("round_index", { ascending: false }).order("match_order", { ascending: false }).limit(1).maybeSingle();
    if (nodesResult.error || !nodesResult.data?.linked_match_id) return { error: `รอผลรอบชิงชนะเลิศ ${key === "division_1" ? "Division 1" : "Division 2"}`, ok: false };
    const finalResult = await supabase.from("matches").select("status, winner_team_id").eq("id", nodesResult.data.linked_match_id).eq("league_id", competitionId).eq("knockout_partition_key", key).maybeSingle();
    if (finalResult.error || finalResult.data?.status !== "finished" || !finalResult.data.winner_team_id) return { error: `รอผลรอบชิงชนะเลิศ ${key === "division_1" ? "Division 1" : "Division 2"}`, ok: false };
    const partitionUpdate = await persistPartitionChampion(supabase, competitionId, key, finalResult.data.winner_team_id, "completion");
    if (partitionUpdate.error || !partitionUpdate.row) return { error: partitionUpdate.error || "ไม่สามารถบันทึกแชมป์ดิวิชั่นได้", ok: false };
  }
  const close = await supabase.from("leagues").update({ season_status: "completed" }).eq("id", competitionId);
  if (close.error) return { error: "ไม่สามารถปิดการแข่งขันได้", ok: false };
  revalidatePath(`/admin/competitions/${competitionId}`);
  revalidatePath("/competitions");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateCupGroupStandings, type CupGroupRow } from "@/lib/cup-group-standings";
import {
  calculateCompetitionStructure,
  type CompetitionStructureEntryMode,
  type CompetitionStructurePreview,
} from "@/lib/competition-structure";
import {
  buildCompetitionTree,
  validateCompetitionTree,
  type CompetitionTreeEntryMode,
  type CompetitionTreeNode,
  type CompetitionTreeSource,
  type CompetitionTreeSummary,
} from "@/lib/competition-tree";
import {
  assertAllowedTransition,
  canEditQualification,
  canGenerateTree,
  deriveCompetitionEngineV2Integrity,
  isCompetitionEngineV2Status,
  type CompetitionEngineV2Integrity,
  type CompetitionEngineV2Status,
} from "@/lib/competition-engine-v2-state";
import { requireAdminSession } from "@/lib/admin-server-auth";
import { isCupCompetition, normalizeCompetitionType } from "@/lib/competition-format";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { buildKswStandardPairing } from "@/lib/ksw-knockout-template";
import type { ApprovedQualificationSummary } from "@/app/admin/competitions/[id]/qualification-actions";

export type CompetitionEngineV2Config = {
  bracketCapacity: number | null;
  competitionId: string;
  entrantCount: number | null;
  entryMode: "bye" | "custom" | "preliminary";
  groupStageEnabled: boolean;
  extraRankEnabled: boolean;
  extraRank: number | null;
  extraQualifierCount: number;
  qualificationStatus: "pending" | "approved";
  qualificationApprovedAt: string | null;
  qualificationApprovedByLabel: string | null;
  qualificationSnapshot: CompetitionTreeSource[];
  qualificationSnapshotSummary: ApprovedQualificationSummary | null;
  status: CompetitionEngineV2Status;
};

export type CompetitionEngineV2WizardPayload = {
  competitionId: string;
  entrantCount: number;
  entryMode?: CompetitionStructureEntryMode;
  groupCount?: number | null;
  groupStageEnabled: boolean;
  qualifiersPerGroup?: number | null;
  totalParticipantCount?: number | null;
};

export type CompetitionEngineV2WizardResult = {
  config?: CompetitionEngineV2Config;
  error?: string;
  ok: boolean;
  preview?: CompetitionStructurePreview;
};

export type CompetitionTreeV2Result = {
  error?: string;
  ok: boolean;
  summary?: CompetitionTreeSummary;
};

export type CompetitionEngineV2WorkflowResult = {
  error?: string;
  ok: boolean;
  workflow?: CompetitionEngineV2Integrity;
};

export type CompetitionFixtureNodeV2 = {
  awayTeamId?: string;
  awayTeamName?: string;
  homeTeamId?: string;
  homeTeamName?: string;
  matchId?: string;
  nodeId: string;
  reason?: string;
  roundLabel: string;
  state: "bye" | "eligible" | "incomplete" | "linked" | "waiting_winner";
};

export type CompetitionFixturesV2Result = {
  createdCount: number;
  error?: string;
  errors: string[];
  linkedCount: number;
  nodes: CompetitionFixtureNodeV2[];
  ok: boolean;
  pendingCount: number;
  skippedCount: number;
  status?: CompetitionEngineV2Status;
};

export type CompetitionKnockoutMatchV2 = {
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

export type SaveCompetitionKnockoutMatchV2Result = {
  error?: string;
  matches?: CompetitionKnockoutMatchV2[];
  ok: boolean;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function verifyCupCompetition(competitionId: string) {
  await requireAdminSession();
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return {
      error: "SUPABASE_SERVICE_ROLE_KEY is missing or Supabase URL is not configured.",
      supabase: null,
    };
  }

  if (!uuidPattern.test(competitionId)) {
    return { error: "Competition id is invalid.", supabase };
  }

  const result = await supabase
    .from("leagues")
    .select("id, competition_type")
    .eq("id", competitionId)
    .limit(1)
    .maybeSingle();

  if (result.error) {
    console.error("competition engine v2 competition lookup failed", result.error);
    return { error: "Could not verify competition.", supabase };
  }

  if (!result.data) {
    return { error: "Competition was not found.", supabase };
  }

  if (!isCupCompetition(normalizeCompetitionType(result.data.competition_type))) {
    return { error: "Knockout competition management is available for cup competitions only.", supabase };
  }

  return { error: "", supabase };
}

function sourceFromDatabase(row: Record<string, unknown>, side: "away" | "home"): CompetitionTreeSource {
  const type = row[`${side}_source_type`];
  const sourceType = type === "best_ranked" || type === "bye" || type === "group_rank" || type === "manual_team" || type === "node_winner" || type === "unassigned"
    ? type
    : "unassigned";
  const rank = row[`${side}_source_rank`];
  const groupId = row[`${side}_source_group_id`];
  const nodeId = row[`${side}_source_node_id`];
  const teamId = row[`${side}_source_team_id`];
  const bestOrder = row[`${side}_source_best_order`];

  return {
    groupId: typeof groupId === "string" ? groupId : undefined,
    bestOrder: typeof bestOrder === "number" ? bestOrder : undefined,
    nodeId: typeof nodeId === "string" ? nodeId : undefined,
    rank: typeof rank === "number" ? rank : undefined,
    teamId: typeof teamId === "string" ? teamId : undefined,
    type: sourceType,
  };
}

function nodeFromDatabase(row: Record<string, unknown>): CompetitionTreeNode {
  return {
    awaySource: sourceFromDatabase(row, "away"),
    bracketPosition: typeof row.bracket_position === "number" ? row.bracket_position : 0,
    competitionId: typeof row.competition_id === "string" ? row.competition_id : "",
    homeSource: sourceFromDatabase(row, "home"),
    id: typeof row.id === "string" ? row.id : "",
    linkedMatchId: typeof row.linked_match_id === "string" ? row.linked_match_id : undefined,
    matchOrder: typeof row.match_order === "number" ? row.match_order : 0,
    roundIndex: typeof row.round_index === "number" ? row.round_index : 0,
    roundLabel: typeof row.round_label === "string" ? row.round_label : "",
  };
}

function nodeForInsert(node: CompetitionTreeNode) {
  const awayGroupId = node.awaySource.type === "best_ranked" ? null : node.awaySource.groupId ?? null;
  const homeGroupId = node.homeSource.type === "best_ranked" ? null : node.homeSource.groupId ?? null;

  return {
    away_source_best_order: node.awaySource.bestOrder ?? null,
    away_source_group_id: awayGroupId,
    away_source_node_id: node.awaySource.nodeId ?? null,
    away_source_rank: node.awaySource.rank ?? null,
    away_source_team_id: node.awaySource.teamId ?? null,
    away_source_type: node.awaySource.type,
    bracket_position: node.bracketPosition,
    competition_id: node.competitionId,
    home_source_best_order: node.homeSource.bestOrder ?? null,
    home_source_group_id: homeGroupId,
    home_source_node_id: node.homeSource.nodeId ?? null,
    home_source_rank: node.homeSource.rank ?? null,
    home_source_team_id: node.homeSource.teamId ?? null,
    home_source_type: node.homeSource.type,
    id: node.id,
    match_order: node.matchOrder,
    round_index: node.roundIndex,
    round_label: node.roundLabel,
  };
}

function treePersistenceError(error: { code?: string | null; details?: string | null; hint?: string | null; message?: string | null }) {
  if (error.code === "23514") return "โครงสร้างคู่แข่งขันมีแหล่งทีมที่ไม่ตรงตามกติกาฐานข้อมูล กรุณาลองยืนยันการจัดสายอีกครั้ง";
  if (error.code === "23503") return "ไม่พบข้อมูลกลุ่ม ทีม หรือคู่ต้นทางที่ใช้สร้างสายแข่งขัน";
  if (error.code === "23505") return "มีโครงสร้างการแข่งขันนี้อยู่แล้ว ระบบจะใช้โครงสร้างเดิมแทน";
  return `ไม่สามารถบันทึกโครงสร้างการแข่งขันได้${error.code ? ` (รหัส ${error.code})` : ""}`;
}

async function loadCompetitionEngineV2Workflow(
  supabase: SupabaseClient,
  competitionId: string,
  engineVersion = 2,
) {
  const [configResult, nodesResult] = await Promise.all([
    supabase
      .from("competition_knockout_configs")
      .select("entrant_count, bracket_capacity, entry_mode, group_stage_enabled, status, qualification_status, qualification_snapshot")
      .eq("competition_id", competitionId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("competition_bracket_nodes")
      .select("id, competition_id, round_index, round_label, match_order, bracket_position, home_source_type, away_source_type, home_source_group_id, home_source_rank, home_source_team_id, home_source_node_id, away_source_group_id, away_source_rank, away_source_team_id, away_source_node_id, linked_match_id")
      .eq("competition_id", competitionId),
  ]);

  if (configResult.error || nodesResult.error) {
    console.error("competition engine v2 workflow lookup failed", {
      config: configResult.error,
      nodes: nodesResult.error,
    });
    return { error: "Could not load knockout competition workflow state.", workflow: null };
  }

  const config = configResult.data;
  const nodes = (nodesResult.data ?? []).map((row) => nodeFromDatabase(row as Record<string, unknown>));
  const status = isCompetitionEngineV2Status(config?.status) ? config.status : null;
  const hasValidTree = config && typeof config.entrant_count === "number" && nodes.length > 0
    ? validateCompetitionTree(nodes, config.entrant_count).valid
    : false;
  const hasLinkedMatches = (nodesResult.data ?? []).some((node) => typeof node.linked_match_id === "string" && node.linked_match_id.length > 0);

  return {
    config,
    error: "",
    nodes,
    workflow: deriveCompetitionEngineV2Integrity({
      engineVersion,
      hasConfig: Boolean(config),
      hasLinkedMatches,
      hasValidTree,
      status,
    }),
  };
}

export async function getCompetitionEngineV2WorkflowState(competitionId: string): Promise<CompetitionEngineV2WorkflowResult> {
  const verified = await verifyCupCompetition(competitionId);
  if (verified.error || !verified.supabase) return { error: verified.error, ok: false };

  const result = await loadCompetitionEngineV2Workflow(verified.supabase, competitionId);
  if (result.error || !result.workflow) return { error: result.error, ok: false };
  return { ok: true, workflow: result.workflow };
}

function sourceIdentity(source: CompetitionTreeSource) {
  return [source.type, source.teamId ?? "", source.groupId ?? "", source.rank ?? "", source.bestOrder ?? ""].join(":");
}

function hasSameSources(left: CompetitionTreeSource[], right: CompetitionTreeSource[]) {
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  left.forEach((source) => counts.set(sourceIdentity(source), (counts.get(sourceIdentity(source)) ?? 0) + 1));
  right.forEach((source) => counts.set(sourceIdentity(source), (counts.get(sourceIdentity(source)) ?? 0) - 1));
  return Array.from(counts.values()).every((count) => count === 0);
}

export async function generateCompetitionTreeV2(
  competitionId: string,
  previewSources?: CompetitionTreeSource[],
): Promise<CompetitionTreeV2Result> {
  const verified = await verifyCupCompetition(competitionId);
  if (verified.error || !verified.supabase) return { error: verified.error, ok: false };

  const [configResult, groupsResult, participantsResult, existingNodesResult] = await Promise.all([
    verified.supabase
      .from("competition_knockout_configs")
      .select("entrant_count, bracket_capacity, entry_mode, group_stage_enabled, status, qualification_status, qualification_snapshot")
      .eq("competition_id", competitionId)
      .limit(1)
      .maybeSingle(),
    verified.supabase
      .from("competition_groups")
      .select("id, name, sort_order, qualifiers_count")
      .eq("competition_id", competitionId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    verified.supabase
      .from("competition_teams")
      .select("team_id, group_id, display_order")
      .eq("competition_id", competitionId)
      .eq("is_active", true)
      .order("display_order", { ascending: true }),
    verified.supabase
      .from("competition_bracket_nodes")
      .select("id, competition_id, round_index, round_label, match_order, bracket_position, linked_match_id, home_source_type, away_source_type, home_source_group_id, home_source_rank, home_source_team_id, home_source_node_id, home_source_best_order, away_source_group_id, away_source_rank, away_source_team_id, away_source_node_id, away_source_best_order")
      .eq("competition_id", competitionId),
  ]);

  if (configResult.error) {
    console.error("competition tree v2 config lookup failed", configResult.error);
    return { error: "Could not load knockout competition configuration.", ok: false };
  }
  if (groupsResult.error || participantsResult.error || existingNodesResult.error) {
    console.error("competition tree v2 input lookup failed", {
      existingNodes: existingNodesResult.error,
      groups: groupsResult.error,
      participants: participantsResult.error,
    });
    return { error: "Could not load the inputs for this competition tree.", ok: false };
  }

  const config = configResult.data;
  if (!config || typeof config.entrant_count !== "number" || typeof config.bracket_capacity !== "number") {
    return { error: "Confirm qualification settings before creating the competition structure.", ok: false };
  }
  if (!isCompetitionEngineV2Status(config.status) || !canGenerateTree(config.status)) {
    return { error: "Reopen the competition structure for editing before creating it again.", ok: false };
  }
  const entryMode = config.entry_mode as CompetitionTreeEntryMode;
  if (entryMode !== "bye" && entryMode !== "preliminary" && entryMode !== "custom") {
    return { error: "The knockout entry mode is invalid.", ok: false };
  }

  const existingNodes = (existingNodesResult.data ?? []).map((row) => nodeFromDatabase(row as Record<string, unknown>));
  if (existingNodes.length) {
    const existingValidation = validateCompetitionTree(existingNodes, config.entrant_count);
    if (!existingValidation.valid) {
      if (existingNodes.some((node) => node.linkedMatchId)) {
        return { error: "โครงสร้างเดิมไม่สมบูรณ์และมีแมตช์ที่เชื่อมอยู่ จึงไม่สามารถซ่อมอัตโนมัติได้", ok: false };
      }
      const removeStaleResult = await verified.supabase
        .from("competition_bracket_nodes")
        .delete()
        .eq("competition_id", competitionId);
      if (removeStaleResult.error) {
        console.error("competition tree v2 stale draft removal failed", {
          code: removeStaleResult.error.code,
          constraint: removeStaleResult.error.details,
          message: removeStaleResult.error.message,
          table: "public.competition_bracket_nodes",
        });
        return { error: "ไม่สามารถซ่อมโครงสร้างฉบับร่างเดิมได้", ok: false };
      }
      console.info("competition tree v2 stale draft removed", { competitionId, reason: existingValidation.errors[0] });
    }
    if (existingValidation.valid) {
      const expectedNodeCount = entryMode === "preliminary" && ![2, 4, 8, 16, 32, 64].includes(config.entrant_count)
        ? config.entrant_count - 1
        : config.bracket_capacity - 1;
      if (existingValidation.summary.nodeCount !== expectedNodeCount) {
        return { error: "โครงสร้างเดิมไม่ตรงกับจำนวนทีมที่อนุมัติแล้ว", ok: false };
      }
      return { ok: true, summary: existingValidation.summary };
    }
  }

  const participants = participantsResult.data ?? [];
  let entrants: CompetitionTreeSource[];

  if (config.group_stage_enabled) {
    if (config.qualification_status !== "approved" || !Array.isArray(config.qualification_snapshot)) return { error: "ยืนยันทีมผ่านเข้ารอบก่อนสร้างรอบน็อกเอาต์", ok: false };
    entrants = config.qualification_snapshot.map((entry: Record<string, unknown>) => ({
      bestOrder: typeof entry.bestOrder === "number" ? entry.bestOrder : undefined,
      groupId: typeof entry.groupId === "string" ? entry.groupId : undefined,
      rank: typeof entry.rank === "number" ? entry.rank : undefined,
      teamId: typeof entry.teamId === "string" ? entry.teamId : undefined,
      type: entry.type === "best_ranked" ? "best_ranked" as const : "group_rank" as const,
    }));
  } else if (entryMode === "custom") {
    entrants = Array.from({ length: config.entrant_count }, () => ({ type: "unassigned" as const }));
  } else {
    if (participants.length < config.entrant_count) {
      return { error: "There are not enough active competition teams for the configured knockout entrants.", ok: false };
    }
    entrants = participants.slice(0, config.entrant_count).map((participant) => ({
      teamId: participant.team_id,
      type: "manual_team" as const,
    }));
  }

  if (entrants.length !== config.entrant_count) {
    return { error: "Configured knockout entrants do not match the available qualification sources.", ok: false };
  }

  if (config.group_stage_enabled) {
    const defaultSources = buildKswStandardPairing(entrants).sources;
    if (previewSources && !hasSameSources(entrants, previewSources)) {
      return { error: "คู่แข่งขันที่เลือกไม่ตรงกับทีมผ่านเข้ารอบที่อนุมัติแล้ว", ok: false };
    }
    entrants = previewSources ?? defaultSources;
  }

  try {
    const tree = buildCompetitionTree({
      bracketCapacity: config.bracket_capacity,
      competitionId,
      entrantCount: config.entrant_count,
      entryMode,
      entrants,
      idFactory: () => crypto.randomUUID(),
    });
    const firstRoundIndex = Math.min(...tree.nodes.map((node) => node.roundIndex));
    const sameGroupPair = tree.nodes.find((node) =>
      node.roundIndex === firstRoundIndex
      && node.homeSource.groupId
      && node.homeSource.groupId === node.awaySource.groupId,
    );
    if (sameGroupPair) {
      return { error: "ไม่สามารถให้ทีมจากกลุ่มเดียวกันพบกันในรอบแรกได้", ok: false };
    }
    const insertResult = await verified.supabase.from("competition_bracket_nodes").insert(tree.nodes.map(nodeForInsert));
    if (insertResult.error) {
      console.error("competition tree v2 insert failed", {
        code: insertResult.error.code,
        constraint: insertResult.error.details,
        hint: insertResult.error.hint,
        message: insertResult.error.message,
        nodeCount: tree.nodes.length,
        table: "public.competition_bracket_nodes",
      });
      return { error: treePersistenceError(insertResult.error), ok: false };
    }
    revalidatePath(`/admin/competitions/${competitionId}`);
    return { ok: true, summary: tree.summary };
  } catch (error) {
    console.error("competition tree v2 generation failed", error);
    return { error: error instanceof Error ? error.message : "Could not create the competition structure.", ok: false };
  }
}

export async function reviewCompetitionTreeV2(competitionId: string): Promise<CompetitionEngineV2WorkflowResult> {
  const verified = await verifyCupCompetition(competitionId);
  if (verified.error || !verified.supabase) return { error: verified.error, ok: false };

  const workflowResult = await loadCompetitionEngineV2Workflow(verified.supabase, competitionId);
  if (workflowResult.error || !workflowResult.workflow || !workflowResult.config) {
    return { error: workflowResult.error || "Knockout competition configuration is missing.", ok: false };
  }
  const status = workflowResult.workflow.status;
  if (status !== "draft") return { error: "Only a draft competition structure can be reviewed.", ok: false };
  if (typeof workflowResult.config.entrant_count !== "number" || typeof workflowResult.config.bracket_capacity !== "number") {
    return { error: "Knockout competition configuration is incomplete.", ok: false };
  }
  if (!workflowResult.workflow.hasValidTree) {
    return { error: "Create a valid competition structure before reviewing it.", ok: false };
  }

  try {
    assertAllowedTransition(status, "reviewed");
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Competition workflow transition is invalid.", ok: false };
  }

  const updateResult = await verified.supabase
    .from("competition_knockout_configs")
    .update({ status: "reviewed", updated_at: new Date().toISOString() })
    .eq("competition_id", competitionId)
    .eq("status", "draft");
  if (updateResult.error) {
    console.error("competition tree v2 review failed", updateResult.error);
    return { error: "Could not review the competition structure.", ok: false };
  }

  revalidatePath(`/admin/competitions/${competitionId}`);
  return {
    ok: true,
    workflow: { ...workflowResult.workflow, status: "reviewed", warning: null },
  };
}

export async function reopenCompetitionTreeV2(
  competitionId: string,
  confirmation: string,
): Promise<CompetitionEngineV2WorkflowResult> {
  const verified = await verifyCupCompetition(competitionId);
  if (verified.error || !verified.supabase) return { error: verified.error, ok: false };
  if (confirmation !== "REOPEN") return { error: "Reopen confirmation was not accepted.", ok: false };

  const workflowResult = await loadCompetitionEngineV2Workflow(verified.supabase, competitionId);
  if (workflowResult.error || !workflowResult.workflow) {
    return { error: workflowResult.error || "Could not load the knockout competition workflow.", ok: false };
  }
  if (workflowResult.workflow.status !== "reviewed") {
    return { error: "Only a reviewed competition structure can be reopened for editing.", ok: false };
  }

  try {
    assertAllowedTransition("reviewed", "draft");
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Competition workflow transition is invalid.", ok: false };
  }

  const updateResult = await verified.supabase
    .from("competition_knockout_configs")
    .update({ status: "draft", updated_at: new Date().toISOString() })
    .eq("competition_id", competitionId)
    .eq("status", "reviewed");
  if (updateResult.error) {
    console.error("competition tree v2 reopen failed", updateResult.error);
    return { error: "Could not reopen the competition structure for editing.", ok: false };
  }

  revalidatePath(`/admin/competitions/${competitionId}`);
  return {
    ok: true,
    workflow: { ...workflowResult.workflow, status: "draft", warning: null },
  };
}

type ResolvedTreeSource =
  | { state: "bye" }
  | { reason: string; state: "pending" }
  | { state: "team"; teamId: string };

function fixtureResultBase(status?: CompetitionEngineV2Status): CompetitionFixturesV2Result {
  return {
    createdCount: 0,
    errors: [],
    linkedCount: 0,
    nodes: [],
    ok: true,
    pendingCount: 0,
    skippedCount: 0,
    status,
  };
}

async function loadCompetitionFixturesV2Context(
  supabase: SupabaseClient,
  competitionId: string,
) {
  const [workflowResult, groupsResult, participantsResult, groupMatchesResult] = await Promise.all([
    loadCompetitionEngineV2Workflow(supabase, competitionId),
    supabase
      .from("competition_groups")
      .select("id, name, label, sort_order, qualifiers_count")
      .eq("competition_id", competitionId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("competition_teams")
      .select("team_id, group_id, is_active, display_order")
      .eq("competition_id", competitionId)
      .eq("is_active", true)
      .order("display_order", { ascending: true }),
    supabase
      .from("matches")
      .select("id, league_id, group_id, competition_stage, fixture_source, home_team_id, away_team_id, home_score, away_score, status, winner_team_id")
      .eq("league_id", competitionId)
      .eq("competition_stage", "group"),
  ]);

  if (workflowResult.error || !workflowResult.config || !workflowResult.workflow) {
    return { error: workflowResult.error || "Knockout competition configuration is missing." };
  }
  if (groupsResult.error || participantsResult.error || groupMatchesResult.error) {
    console.error("competition fixture v2 context lookup failed", {
      groupMatches: groupMatchesResult.error,
      groups: groupsResult.error,
      participants: participantsResult.error,
    });
    return { error: "Could not load competition structure fixture inputs." };
  }

  const participants = participantsResult.data ?? [];
  const participantIds = Array.from(new Set(participants.map((participant) => participant.team_id).filter(Boolean)));
  const teamsResult = participantIds.length
    ? await supabase.from("teams").select("id, name, short_name, logo_url, is_ksw").in("id", participantIds)
    : { data: [], error: null };
  if (teamsResult.error) {
    console.error("competition fixture v2 team lookup failed", teamsResult.error);
    return { error: "Could not load competition teams." };
  }

  const linkedMatchIds = (workflowResult.nodes ?? [])
    .map((node) => {
      const raw = (node as CompetitionTreeNode & { linkedMatchId?: string }).linkedMatchId;
      return raw;
    })
    .filter((matchId): matchId is string => Boolean(matchId));
  const linkedMatchesResult = linkedMatchIds.length
    ? await supabase
        .from("matches")
        .select("id, league_id, competition_stage, fixture_source, home_team_id, away_team_id, winner_team_id")
        .in("id", linkedMatchIds)
    : { data: [], error: null };
  if (linkedMatchesResult.error) {
    console.error("competition fixture v2 linked match lookup failed", linkedMatchesResult.error);
    return { error: "Could not verify linked knockout matches." };
  }

  const teamsById = new Map((teamsResult.data ?? []).map((team) => [team.id, team]));
  const standingTeams = participants.map((participant) => ({
    ...teamsById.get(participant.team_id),
    display_order: participant.display_order,
    group_id: participant.group_id,
    is_active: participant.is_active,
    team_id: participant.team_id,
  }));
  const standings = calculateCupGroupStandings({
    groups: (groupsResult.data ?? []) as CupGroupRow[],
    matches: (groupMatchesResult.data ?? []) as CupGroupRow[],
    teams: standingTeams as CupGroupRow[],
  });

  return {
    activeParticipantIds: new Set(participantIds),
    config: workflowResult.config,
    groups: groupsResult.data ?? [],
    linkedMatchesById: new Map((linkedMatchesResult.data ?? []).map((match) => [match.id, match])),
    nodes: workflowResult.nodes,
    rawNodes: workflowResult.nodes,
    standingsByGroupId: new Map(standings.map((standing) => [standing.group_id, standing])),
    teamNamesById: new Map((teamsResult.data ?? []).map((team) => [team.id, team.name || team.short_name || team.id])),
    workflow: workflowResult.workflow,
  };
}

function linkedMatchIdForNode(node: CompetitionTreeNode & { linkedMatchId?: string }) {
  return typeof node.linkedMatchId === "string" && node.linkedMatchId ? node.linkedMatchId : null;
}

function resolveCompetitionTreeSource(
  source: CompetitionTreeSource,
  context: {
    activeParticipantIds: Set<string>;
    linkedMatchesById: Map<string, Record<string, unknown>>;
    nodesById: Map<string, CompetitionTreeNode & { linkedMatchId?: string }>;
    standingsByGroupId: Map<string, ReturnType<typeof calculateCupGroupStandings>[number]>;
    teamNamesById: Map<string, string>;
  },
): ResolvedTreeSource {
  if (source.type === "bye") return { state: "bye" };
  if (source.type === "unassigned") return { reason: "Waiting for an assigned entrant.", state: "pending" };
  if (source.type === "manual_team") {
    if (!source.teamId || !context.activeParticipantIds.has(source.teamId)) {
      return { reason: "Manual team is not an active competition participant.", state: "pending" };
    }
    return { state: "team", teamId: source.teamId };
  }
  if (source.type === "best_ranked") {
    if (!source.teamId || !context.activeParticipantIds.has(source.teamId)) return { reason: "Waiting for an approved best-ranked team.", state: "pending" };
    return { state: "team", teamId: source.teamId };
  }
  if (source.type === "group_rank") {
    const standing = source.groupId ? context.standingsByGroupId.get(source.groupId) : undefined;
    const row = standing && source.rank ? standing.rows[source.rank - 1] : undefined;
    if (!row || !context.activeParticipantIds.has(row.team_id)) {
      return { reason: "Waiting for the requested group standing.", state: "pending" };
    }
    return { state: "team", teamId: row.team_id };
  }
  if (source.type === "node_winner") {
    const sourceNode = source.nodeId ? context.nodesById.get(source.nodeId) : undefined;
    const matchId = sourceNode ? linkedMatchIdForNode(sourceNode) : null;
    const match = matchId ? context.linkedMatchesById.get(matchId) : undefined;
    const winnerTeamId = match && typeof match.winner_team_id === "string" ? match.winner_team_id : "";
    if (!winnerTeamId || !context.activeParticipantIds.has(winnerTeamId)) {
      return { reason: "Waiting for the winner of the previous tree node.", state: "pending" };
    }
    return { state: "team", teamId: winnerTeamId };
  }
  return { reason: "Tree source is invalid.", state: "pending" };
}

async function inspectCompetitionFixturesV2(
  supabase: SupabaseClient,
  competitionId: string,
): Promise<CompetitionFixturesV2Result> {
  const context = await loadCompetitionFixturesV2Context(supabase, competitionId);
  if ("error" in context) return { ...fixtureResultBase(), error: context.error, ok: false };
  const result = fixtureResultBase(context.workflow.status ?? undefined);
  const config = context.config;
  const treeValidation = validateCompetitionTree(context.nodes, config.entrant_count ?? 0);
  if (!treeValidation.valid) {
    return { ...result, error: `Competition structure is invalid: ${treeValidation.errors[0]}`, ok: false };
  }

  const nodesById = new Map(context.nodes.map((node) => [node.id, node as CompetitionTreeNode & { linkedMatchId?: string }]));
  const resolverContext = {
    activeParticipantIds: context.activeParticipantIds,
    linkedMatchesById: context.linkedMatchesById as Map<string, Record<string, unknown>>,
    nodesById,
    standingsByGroupId: context.standingsByGroupId,
    teamNamesById: context.teamNamesById,
  };

  for (const node of context.nodes as Array<CompetitionTreeNode & { linkedMatchId?: string }>) {
    const matchId = linkedMatchIdForNode(node);
    if (matchId) {
      const linkedMatch = context.linkedMatchesById.get(matchId);
      if (!linkedMatch || linkedMatch.league_id !== competitionId || linkedMatch.competition_stage !== "knockout") {
        result.errors.push(`Node ${node.id} has an invalid linked match.`);
      } else {
        result.linkedCount += 1;
        result.skippedCount += 1;
        result.nodes.push({
          awayTeamId: typeof linkedMatch.away_team_id === "string" ? linkedMatch.away_team_id : undefined,
          awayTeamName: typeof linkedMatch.away_team_id === "string" ? resolverContext.teamNamesById.get(linkedMatch.away_team_id) : undefined,
          homeTeamId: typeof linkedMatch.home_team_id === "string" ? linkedMatch.home_team_id : undefined,
          homeTeamName: typeof linkedMatch.home_team_id === "string" ? resolverContext.teamNamesById.get(linkedMatch.home_team_id) : undefined,
          matchId,
          nodeId: node.id,
          roundLabel: node.roundLabel,
          state: "linked",
        });
      }
      continue;
    }

    const home = resolveCompetitionTreeSource(node.homeSource, resolverContext);
    const away = resolveCompetitionTreeSource(node.awaySource, resolverContext);
    if (home.state === "bye" || away.state === "bye") {
      result.pendingCount += 1;
      result.nodes.push({ nodeId: node.id, reason: "Bye advancement is pending a later phase.", roundLabel: node.roundLabel, state: "bye" });
      continue;
    }
    if (home.state !== "team" || away.state !== "team") {
      result.pendingCount += 1;
      const pendingReason = home.state === "pending"
        ? home.reason
        : away.state === "pending"
          ? away.reason
          : "Waiting for a resolved tree source.";
      const waitingWinner = pendingReason.includes("winner");
      result.nodes.push({
        nodeId: node.id,
        reason: pendingReason,
        roundLabel: node.roundLabel,
        state: waitingWinner ? "waiting_winner" : "incomplete",
      });
      continue;
    }
    if (home.teamId === away.teamId) {
      result.errors.push(`Node ${node.id} resolves the same team on both sides.`);
      continue;
    }
    result.nodes.push({
      awayTeamId: away.teamId,
      awayTeamName: resolverContext.teamNamesById.get(away.teamId),
      homeTeamId: home.teamId,
      homeTeamName: resolverContext.teamNamesById.get(home.teamId),
      nodeId: node.id,
      roundLabel: node.roundLabel,
      state: "eligible",
    });
  }

  if (result.errors.length) result.ok = false;
  return result;
}

export async function previewCompetitionFixturesV2(competitionId: string): Promise<CompetitionFixturesV2Result> {
  const verified = await verifyCupCompetition(competitionId);
  if (verified.error || !verified.supabase) return { ...fixtureResultBase(), error: verified.error, ok: false };
  return inspectCompetitionFixturesV2(verified.supabase, competitionId);
}

export async function createCompetitionFixturesV2(competitionId: string): Promise<CompetitionFixturesV2Result> {
  const verified = await verifyCupCompetition(competitionId);
  if (verified.error || !verified.supabase) return { ...fixtureResultBase(), error: verified.error, ok: false };

  const inspected = await inspectCompetitionFixturesV2(verified.supabase, competitionId);
  if (!inspected.ok) return inspected;
  if (inspected.status !== "reviewed" && inspected.status !== "fixtures_created") {
    return { ...inspected, error: "Competition fixtures can only be created after the tree is reviewed.", ok: false };
  }

  for (const node of inspected.nodes.filter((item) => item.state === "eligible")) {
    if (!node.homeTeamId || !node.awayTeamId) continue;
    const insertResult = await verified.supabase
      .from("matches")
      .insert({
        away_score: null,
        away_team_id: node.awayTeamId,
        competition_stage: "knockout",
        fixture_source: "generated",
        group_id: null,
        home_score: null,
        home_team_id: node.homeTeamId,
        league_id: competitionId,
        match_date: null,
        match_type: "cup",
        status: "scheduled",
        venue: null,
        winner_team_id: null,
      })
      .select("id")
      .maybeSingle();
    if (insertResult.error || !insertResult.data?.id) {
      inspected.errors.push(`Node ${node.nodeId}: could not create its match.`);
      continue;
    }

    const linkResult = await verified.supabase
      .from("competition_bracket_nodes")
      .update({ linked_match_id: insertResult.data.id })
      .eq("competition_id", competitionId)
      .eq("id", node.nodeId)
      .is("linked_match_id", null)
      .select("id");
    if (linkResult.error || !linkResult.data?.length) {
      const compensation = await verified.supabase.from("matches").delete().eq("id", insertResult.data.id);
      if (compensation.error) {
        console.error("competition fixture v2 compensation failed", compensation.error);
        inspected.errors.push(`Node ${node.nodeId}: match link failed and compensation also failed.`);
      } else {
        inspected.errors.push(`Node ${node.nodeId}: match link failed; the new match was removed.`);
      }
      continue;
    }
    inspected.createdCount += 1;
    inspected.linkedCount += 1;
  }

  if (inspected.errors.length) {
    inspected.ok = false;
    if (inspected.createdCount > 0) revalidatePath(`/admin/competitions/${competitionId}`);
    return inspected;
  }

  if (inspected.status === "reviewed" && (inspected.createdCount > 0 || inspected.linkedCount > 0)) {
    try {
      assertAllowedTransition("reviewed", "fixtures_created");
    } catch (error) {
      return { ...inspected, error: error instanceof Error ? error.message : "Competition workflow transition is invalid.", ok: false };
    }
    const statusResult = await verified.supabase
      .from("competition_knockout_configs")
      .update({ status: "fixtures_created", updated_at: new Date().toISOString() })
      .eq("competition_id", competitionId)
      .eq("status", "reviewed");
    if (statusResult.error) {
      console.error("competition fixture v2 status update failed", statusResult.error);
      revalidatePath(`/admin/competitions/${competitionId}`);
      return { ...inspected, error: "Fixtures were linked, but workflow status could not be updated.", ok: false };
    }
    inspected.status = "fixtures_created";
  }

  revalidatePath(`/admin/competitions/${competitionId}`);
  return inspected;
}

function validScore(value: number | null) {
  return value === null || (Number.isInteger(value) && value >= 0 && value <= 999);
}

async function loadKnockoutMatchesForClient(supabase: SupabaseClient, competitionId: string) {
  const nodesResult = await supabase
    .from("competition_bracket_nodes")
    .select("linked_match_id")
    .eq("competition_id", competitionId)
    .not("linked_match_id", "is", null);
  if (nodesResult.error) {
    console.error("competition knockout v2 node lookup failed", nodesResult.error);
    return { error: "Could not load knockout matches.", matches: [] as CompetitionKnockoutMatchV2[] };
  }
  const matchIds = (nodesResult.data ?? [])
    .map((node) => node.linked_match_id)
    .filter((matchId): matchId is string => typeof matchId === "string");
  if (!matchIds.length) return { error: "", matches: [] as CompetitionKnockoutMatchV2[] };
  const matchesResult = await supabase
    .from("matches")
    .select("id, match_date, home_team_id, away_team_id, home_score, away_score, penalty_home_score, penalty_away_score, manual_winner_team_id, winner_team_id, venue, status")
    .in("id", matchIds);
  if (matchesResult.error) {
    console.error("competition knockout v2 match lookup failed", matchesResult.error);
    return { error: "Could not load knockout matches.", matches: [] as CompetitionKnockoutMatchV2[] };
  }
  return { error: "", matches: (matchesResult.data ?? []) as CompetitionKnockoutMatchV2[] };
}

export async function saveCompetitionKnockoutMatchV2(payload: {
  awayScore: number | null;
  competitionId: string;
  homeScore: number | null;
  manualWinnerTeamId: string | null;
  matchDate: string | null;
  matchId: string;
  penaltyAwayScore: number | null;
  penaltyHomeScore: number | null;
  status: "finished" | "scheduled";
  venue: string | null;
}): Promise<SaveCompetitionKnockoutMatchV2Result> {
  const verified = await verifyCupCompetition(payload.competitionId);
  if (verified.error || !verified.supabase) return { error: verified.error, ok: false };
  if (!uuidPattern.test(payload.matchId)) return { error: "Match id is invalid.", ok: false };
  if (![payload.homeScore, payload.awayScore, payload.penaltyHomeScore, payload.penaltyAwayScore].every(validScore)) {
    return { error: "คะแนนต้องเป็นจำนวนเต็มตั้งแต่ 0 ถึง 999", ok: false };
  }

  const nodeResult = await verified.supabase
    .from("competition_bracket_nodes")
    .select("id")
    .eq("competition_id", payload.competitionId)
    .eq("linked_match_id", payload.matchId)
    .maybeSingle();
  if (nodeResult.error || !nodeResult.data) {
    if (nodeResult.error) console.error("competition knockout v2 match ownership lookup failed", nodeResult.error);
    return { error: "ไม่พบแมตช์รอบน็อกเอาต์ของรายการนี้", ok: false };
  }

  const matchResult = await verified.supabase
    .from("matches")
    .select("id, league_id, home_team_id, away_team_id")
    .eq("id", payload.matchId)
    .eq("league_id", payload.competitionId)
    .eq("competition_stage", "knockout")
    .maybeSingle();
  if (matchResult.error || !matchResult.data) {
    if (matchResult.error) console.error("competition knockout v2 match verification failed", matchResult.error);
    return { error: "ไม่พบแมตช์รอบน็อกเอาต์", ok: false };
  }

  let winnerTeamId: string | null = null;
  if (payload.status === "finished") {
    if (payload.homeScore === null || payload.awayScore === null) {
      return { error: "กรุณากรอกคะแนนทั้งสองทีมก่อนบันทึกผล", ok: false };
    }
    if (payload.homeScore !== payload.awayScore) {
      winnerTeamId = payload.homeScore > payload.awayScore ? matchResult.data.home_team_id : matchResult.data.away_team_id;
    } else if (payload.penaltyHomeScore !== null && payload.penaltyAwayScore !== null && payload.penaltyHomeScore !== payload.penaltyAwayScore) {
      winnerTeamId = payload.penaltyHomeScore > payload.penaltyAwayScore ? matchResult.data.home_team_id : matchResult.data.away_team_id;
    } else if (payload.manualWinnerTeamId === matchResult.data.home_team_id || payload.manualWinnerTeamId === matchResult.data.away_team_id) {
      winnerTeamId = payload.manualWinnerTeamId;
    } else {
      return { error: "ผลเสมอต้องระบุผลจุดโทษหรือคำตัดสินพิเศษ", ok: false };
    }
  }

  const updateResult = await verified.supabase
    .from("matches")
    .update({
      away_score: payload.awayScore,
      home_score: payload.homeScore,
      manual_winner_team_id: payload.status === "finished" && payload.homeScore === payload.awayScore ? payload.manualWinnerTeamId : null,
      match_date: payload.matchDate,
      penalty_away_score: payload.status === "finished" && payload.homeScore === payload.awayScore ? payload.penaltyAwayScore : null,
      penalty_home_score: payload.status === "finished" && payload.homeScore === payload.awayScore ? payload.penaltyHomeScore : null,
      status: payload.status,
      venue: payload.venue,
      winner_team_id: winnerTeamId,
    })
    .eq("id", payload.matchId)
    .eq("league_id", payload.competitionId);
  if (updateResult.error) {
    console.error("competition knockout v2 match save failed", updateResult.error);
    return { error: "ไม่สามารถบันทึกแมตช์รอบน็อกเอาต์ได้", ok: false };
  }

  // Re-running only fills newly resolvable downstream nodes; linked fixtures are skipped.
  const fixturesResult = await createCompetitionFixturesV2(payload.competitionId);
  if (!fixturesResult.ok) return { error: fixturesResult.error ?? fixturesResult.errors[0], ok: false };
  const matches = await loadKnockoutMatchesForClient(verified.supabase, payload.competitionId);
  if (matches.error) return { error: matches.error, ok: false };
  revalidatePath(`/admin/competitions/${payload.competitionId}`);
  return { matches: matches.matches, ok: true };
}

export async function saveCompetitionEngineV2Config(
  payload: CompetitionEngineV2WizardPayload,
): Promise<CompetitionEngineV2WizardResult> {
  const verified = await verifyCupCompetition(payload.competitionId);
  if (verified.error || !verified.supabase) return { error: verified.error, ok: false };

  const [groupsResult, participantsResult, existingConfigResult, existingNodesResult] = await Promise.all([
    verified.supabase
      .from("competition_groups")
      .select("id, qualifiers_count")
      .eq("competition_id", payload.competitionId),
    verified.supabase
      .from("competition_teams")
      .select("team_id")
      .eq("competition_id", payload.competitionId)
      .eq("is_active", true),
    verified.supabase
      .from("competition_knockout_configs")
      .select("entrant_count, bracket_capacity, entry_mode, group_stage_enabled, status")
      .eq("competition_id", payload.competitionId)
      .limit(1)
      .maybeSingle(),
    verified.supabase
      .from("competition_bracket_nodes")
      .select("id, linked_match_id")
      .eq("competition_id", payload.competitionId),
  ]);

  if (groupsResult.error) {
    console.error("competition engine v2 groups lookup failed", groupsResult.error);
    return { error: "Could not verify competition groups.", ok: false };
  }

  if (participantsResult.error) {
    console.error("competition engine v2 participants lookup failed", participantsResult.error);
    return { error: "Could not verify competition participants.", ok: false };
  }

  if (existingConfigResult.error || existingNodesResult.error) {
    console.error("competition engine v2 edit guard lookup failed", {
      config: existingConfigResult.error,
      nodes: existingNodesResult.error,
    });
    return { error: "Could not verify the competition editing state.", ok: false };
  }

  const existingConfig = existingConfigResult.data;
  if (existingConfig && (!isCompetitionEngineV2Status(existingConfig.status) || !canEditQualification(existingConfig.status))) {
    return { error: "Reopen the competition structure for editing before changing qualification settings.", ok: false };
  }

  const groups = groupsResult.data ?? [];
  const totalParticipantCount = participantsResult.data?.length ?? 0;
  const knockoutEntrantCount = payload.groupStageEnabled && groups.length
    ? groups.reduce((sum, group) => sum + (typeof group.qualifiers_count === "number" ? group.qualifiers_count : 0), 0)
    : payload.entrantCount;

  if (!payload.groupStageEnabled && totalParticipantCount > 0 && knockoutEntrantCount > totalParticipantCount) {
    return { error: "Knockout entrants cannot exceed active competition teams.", ok: false };
  }

  let preview: CompetitionStructurePreview;
  try {
    preview = calculateCompetitionStructure({
      entrantCount: knockoutEntrantCount,
      entryMode: payload.entryMode ?? "bye",
      groupCount: payload.groupStageEnabled ? (groups.length || payload.groupCount) : null,
      groupStageEnabled: payload.groupStageEnabled,
      qualifiersPerGroup: payload.groupStageEnabled ? payload.qualifiersPerGroup : null,
      totalParticipantCount: totalParticipantCount || payload.totalParticipantCount || knockoutEntrantCount,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Competition structure is invalid.", ok: false };
  }

  const treeNeedsReset = Boolean(existingNodesResult.data?.length) && (
    existingConfig?.entrant_count !== knockoutEntrantCount
    || existingConfig?.bracket_capacity !== preview.bracketCapacity
    || existingConfig?.entry_mode !== preview.entryMode
    || existingConfig?.group_stage_enabled !== payload.groupStageEnabled
  );
  if (treeNeedsReset) {
    if (existingNodesResult.data?.some((node) => typeof node.linked_match_id === "string" && node.linked_match_id.length > 0)) {
      return { error: "The competition structure has linked matches and cannot be reset in this workflow.", ok: false };
    }
    const deleteResult = await verified.supabase
      .from("competition_bracket_nodes")
      .delete()
      .eq("competition_id", payload.competitionId);
    if (deleteResult.error) {
      console.error("competition engine v2 stale tree reset failed", deleteResult.error);
      return { error: "Could not reset the stale competition structure.", ok: false };
    }
  }

  const result = await verified.supabase
    .from("competition_knockout_configs")
    .upsert(
      {
        bracket_capacity: preview.bracketCapacity,
        competition_id: payload.competitionId,
        entrant_count: knockoutEntrantCount,
        entry_mode: preview.entryMode,
        group_stage_enabled: payload.groupStageEnabled,
        status: "draft",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "competition_id" },
    )
    .select("competition_id, entrant_count, bracket_capacity, entry_mode, group_stage_enabled, status")
    .maybeSingle();

  if (result.error) {
    console.error("competition engine v2 config save failed", result.error);
    return { error: "Could not save knockout qualification settings.", ok: false };
  }

  revalidatePath(`/admin/competitions/${payload.competitionId}`);

  return {
    config: result.data
      ? {
          bracketCapacity: typeof result.data.bracket_capacity === "number" ? result.data.bracket_capacity : null,
          competitionId: result.data.competition_id,
          entrantCount: typeof result.data.entrant_count === "number" ? result.data.entrant_count : null,
          entryMode: result.data.entry_mode,
          groupStageEnabled: result.data.group_stage_enabled === true,
          extraRankEnabled: false,
          extraRank: null,
          extraQualifierCount: 0,
          qualificationStatus: "pending",
          qualificationApprovedAt: null,
          qualificationApprovedByLabel: null,
          qualificationSnapshot: [],
          qualificationSnapshotSummary: null,
          status: result.data.status,
        }
      : undefined,
    ok: true,
    preview,
  };
}

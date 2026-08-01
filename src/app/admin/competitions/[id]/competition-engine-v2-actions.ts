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

export type CompetitionEngineV2Config = {
  bracketCapacity: number | null;
  competitionId: string;
  entrantCount: number | null;
  entryMode: "bye" | "custom" | "preliminary";
  groupStageEnabled: boolean;
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
    .select("id, competition_type, competition_engine_version")
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
    return { error: "Competition Wizard V2 is available for cup competitions only.", supabase };
  }

  if (result.data.competition_engine_version !== 2) {
    return { error: "Competition Engine V2 is not enabled for this competition.", supabase };
  }

  return { error: "", supabase };
}

function sourceFromDatabase(row: Record<string, unknown>, side: "away" | "home"): CompetitionTreeSource {
  const type = row[`${side}_source_type`];
  const sourceType = type === "bye" || type === "group_rank" || type === "manual_team" || type === "node_winner" || type === "unassigned"
    ? type
    : "unassigned";
  const rank = row[`${side}_source_rank`];
  const groupId = row[`${side}_source_group_id`];
  const nodeId = row[`${side}_source_node_id`];
  const teamId = row[`${side}_source_team_id`];

  return {
    groupId: typeof groupId === "string" ? groupId : undefined,
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
  return {
    away_source_group_id: node.awaySource.groupId ?? null,
    away_source_node_id: node.awaySource.nodeId ?? null,
    away_source_rank: node.awaySource.rank ?? null,
    away_source_team_id: node.awaySource.teamId ?? null,
    away_source_type: node.awaySource.type,
    bracket_position: node.bracketPosition,
    competition_id: node.competitionId,
    home_source_group_id: node.homeSource.groupId ?? null,
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

async function loadCompetitionEngineV2Workflow(
  supabase: SupabaseClient,
  competitionId: string,
  engineVersion = 2,
) {
  const [configResult, nodesResult] = await Promise.all([
    supabase
      .from("competition_knockout_configs")
      .select("entrant_count, bracket_capacity, entry_mode, group_stage_enabled, status")
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
    return { error: "Could not load Competition Engine V2 workflow state.", workflow: null };
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

export async function generateCompetitionTreeV2(competitionId: string): Promise<CompetitionTreeV2Result> {
  const verified = await verifyCupCompetition(competitionId);
  if (verified.error || !verified.supabase) return { error: verified.error, ok: false };

  const [configResult, groupsResult, participantsResult, existingNodesResult] = await Promise.all([
    verified.supabase
      .from("competition_knockout_configs")
      .select("entrant_count, bracket_capacity, entry_mode, group_stage_enabled, status")
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
      .select("id, competition_id, round_index, round_label, match_order, bracket_position, home_source_type, away_source_type, home_source_group_id, home_source_rank, home_source_team_id, home_source_node_id, away_source_group_id, away_source_rank, away_source_team_id, away_source_node_id")
      .eq("competition_id", competitionId),
  ]);

  if (configResult.error) {
    console.error("competition tree v2 config lookup failed", configResult.error);
    return { error: "Could not load Competition Engine V2 configuration.", ok: false };
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
    return { error: "Confirm Competition Wizard V2 before generating the tree.", ok: false };
  }
  if (!isCompetitionEngineV2Status(config.status) || !canGenerateTree(config.status)) {
    return { error: "Reopen Competition Tree V2 for editing before generating it again.", ok: false };
  }
  const entryMode = config.entry_mode as CompetitionTreeEntryMode;
  if (entryMode !== "bye" && entryMode !== "preliminary" && entryMode !== "custom") {
    return { error: "Competition Engine V2 entry mode is invalid.", ok: false };
  }

  const existingNodes = (existingNodesResult.data ?? []).map((row) => nodeFromDatabase(row as Record<string, unknown>));
  if (existingNodes.length) {
    const existingValidation = validateCompetitionTree(existingNodes, config.entrant_count);
    if (!existingValidation.valid) {
      return { error: `Existing Competition Tree V2 is invalid: ${existingValidation.errors[0]}`, ok: false };
    }
    const expectedNodeCount = entryMode === "preliminary" && ![2, 4, 8, 16, 32, 64].includes(config.entrant_count)
      ? config.entrant_count - 1
      : config.bracket_capacity - 1;
    if (existingValidation.summary.nodeCount !== expectedNodeCount) {
      return { error: "Existing Competition Tree V2 does not match the current configuration.", ok: false };
    }
    return { ok: true, summary: existingValidation.summary };
  }

  const participants = participantsResult.data ?? [];
  const groups = groupsResult.data ?? [];
  let entrants: CompetitionTreeSource[];

  if (config.group_stage_enabled) {
    if (!groups.length) return { error: "Group Stage is enabled, but no competition groups exist.", ok: false };
    const activeByGroup = new Map<string, number>();
    participants.forEach((participant) => {
      if (typeof participant.group_id === "string") {
        activeByGroup.set(participant.group_id, (activeByGroup.get(participant.group_id) ?? 0) + 1);
      }
    });
    entrants = groups.flatMap((group) => {
      const qualifiers = typeof group.qualifiers_count === "number" ? group.qualifiers_count : 0;
      return Array.from({ length: qualifiers }, (_, index) => ({
        groupId: group.id,
        rank: index + 1,
        type: "group_rank" as const,
      }));
    });
    const insufficientGroup = groups.find((group) => {
      const qualifiers = typeof group.qualifiers_count === "number" ? group.qualifiers_count : 0;
      return qualifiers > (activeByGroup.get(group.id) ?? 0);
    });
    if (insufficientGroup) {
      return {
        error: `Group ${insufficientGroup.name || insufficientGroup.id} has fewer active teams than its qualifier count.`,
        ok: false,
      };
    }
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

  try {
    const tree = buildCompetitionTree({
      bracketCapacity: config.bracket_capacity,
      competitionId,
      entrantCount: config.entrant_count,
      entryMode,
      entrants,
      idFactory: () => crypto.randomUUID(),
    });
    const insertResult = await verified.supabase.from("competition_bracket_nodes").insert(tree.nodes.map(nodeForInsert));
    if (insertResult.error) {
      console.error("competition tree v2 insert failed", insertResult.error);
      return { error: "Could not save Competition Tree V2.", ok: false };
    }
    revalidatePath(`/admin/competitions/${competitionId}`);
    return { ok: true, summary: tree.summary };
  } catch (error) {
    console.error("competition tree v2 generation failed", error);
    return { error: error instanceof Error ? error.message : "Could not generate Competition Tree V2.", ok: false };
  }
}

export async function reviewCompetitionTreeV2(competitionId: string): Promise<CompetitionEngineV2WorkflowResult> {
  const verified = await verifyCupCompetition(competitionId);
  if (verified.error || !verified.supabase) return { error: verified.error, ok: false };

  const workflowResult = await loadCompetitionEngineV2Workflow(verified.supabase, competitionId);
  if (workflowResult.error || !workflowResult.workflow || !workflowResult.config) {
    return { error: workflowResult.error || "Competition Engine V2 configuration is missing.", ok: false };
  }
  const status = workflowResult.workflow.status;
  if (status !== "draft") return { error: "Only a draft Competition Tree V2 can be reviewed.", ok: false };
  if (typeof workflowResult.config.entrant_count !== "number" || typeof workflowResult.config.bracket_capacity !== "number") {
    return { error: "Competition Engine V2 configuration is incomplete.", ok: false };
  }
  if (!workflowResult.workflow.hasValidTree) {
    return { error: "Generate a valid Competition Tree V2 before reviewing it.", ok: false };
  }

  try {
    assertAllowedTransition(status, "reviewed");
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Competition Engine V2 transition is invalid.", ok: false };
  }

  const updateResult = await verified.supabase
    .from("competition_knockout_configs")
    .update({ status: "reviewed", updated_at: new Date().toISOString() })
    .eq("competition_id", competitionId)
    .eq("status", "draft");
  if (updateResult.error) {
    console.error("competition tree v2 review failed", updateResult.error);
    return { error: "Could not review Competition Tree V2.", ok: false };
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
    return { error: workflowResult.error || "Could not load Competition Engine V2 workflow.", ok: false };
  }
  if (workflowResult.workflow.status !== "reviewed") {
    return { error: "Only a reviewed Competition Tree V2 can be reopened for editing.", ok: false };
  }

  try {
    assertAllowedTransition("reviewed", "draft");
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Competition Engine V2 transition is invalid.", ok: false };
  }

  const updateResult = await verified.supabase
    .from("competition_knockout_configs")
    .update({ status: "draft", updated_at: new Date().toISOString() })
    .eq("competition_id", competitionId)
    .eq("status", "reviewed");
  if (updateResult.error) {
    console.error("competition tree v2 reopen failed", updateResult.error);
    return { error: "Could not reopen Competition Tree V2 for editing.", ok: false };
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
    return { error: workflowResult.error || "Competition Engine V2 configuration is missing." };
  }
  if (groupsResult.error || participantsResult.error || groupMatchesResult.error) {
    console.error("competition fixture v2 context lookup failed", {
      groupMatches: groupMatchesResult.error,
      groups: groupsResult.error,
      participants: participantsResult.error,
    });
    return { error: "Could not load Competition Tree V2 fixture inputs." };
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
    return { ...result, error: `Competition Tree V2 is invalid: ${treeValidation.errors[0]}`, ok: false };
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
  if (inspected.status === "fixtures_created") return inspected;

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

  if (inspected.createdCount > 0 || inspected.linkedCount > 0) {
    try {
      assertAllowedTransition("reviewed", "fixtures_created");
    } catch (error) {
      return { ...inspected, error: error instanceof Error ? error.message : "Competition Engine V2 transition is invalid.", ok: false };
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
    return { error: "Could not verify Competition Engine V2 editing state.", ok: false };
  }

  const existingConfig = existingConfigResult.data;
  if (existingConfig && (!isCompetitionEngineV2Status(existingConfig.status) || !canEditQualification(existingConfig.status))) {
    return { error: "Reopen Competition Tree V2 for editing before changing qualification settings.", ok: false };
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
      return { error: "Competition Tree V2 has linked matches and cannot be reset in this workflow.", ok: false };
    }
    const deleteResult = await verified.supabase
      .from("competition_bracket_nodes")
      .delete()
      .eq("competition_id", payload.competitionId);
    if (deleteResult.error) {
      console.error("competition engine v2 stale tree reset failed", deleteResult.error);
      return { error: "Could not reset the stale Competition Tree V2.", ok: false };
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
    return { error: "Could not save Competition Wizard V2 config.", ok: false };
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
          status: result.data.status,
        }
      : undefined,
    ok: true,
    preview,
  };
}

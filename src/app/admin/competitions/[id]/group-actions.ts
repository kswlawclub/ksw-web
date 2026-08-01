"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin-server-auth";
import { isCupCompetition, normalizeCompetitionType } from "@/lib/competition-format";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type ActionResult = {
  ok: boolean;
  error?: string;
};

export type CupGroupFixturePreviewPair = {
  awayTeamId: string;
  awayTeamName: string;
  exists: boolean;
  homeTeamId: string;
  homeTeamName: string;
};

export type CupGroupFixtureResult = ActionResult & {
  createdCount?: number;
  pairs?: CupGroupFixturePreviewPair[];
  skippedCount?: number;
  totalPairs?: number;
};

type GroupPayload = {
  competitionId: string;
  label?: string | null;
  name: string;
  sortOrder?: number | string | null;
};

type AssignPayload = {
  competitionId: string;
  competitionTeamId: string;
  groupId: string | null;
};

type QualifiersPayload = {
  competitionId: string;
  groupId: string;
  qualifiersCount: number | string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeLabel(value: string | null | undefined, name: string) {
  const label = value?.trim().replace(/\s+/g, " ");
  return label || `Group ${name}`;
}

function normalizeSortOrder(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const numberValue = Number(value);
  return Number.isInteger(numberValue) ? numberValue : Number.NaN;
}

function friendlyGroupError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("duplicate") || normalized.includes("competition_groups_competition_name_unique_idx")) {
    return "A group with this name already exists in this competition.";
  }
  if (normalized.includes("matches_group_id_fkey") || normalized.includes("violates foreign key constraint")) {
    return "Cannot delete this group because it already has matches. Keep the group or move/delete its matches first.";
  }
  if (normalized.includes("foreign key")) {
    return "The selected group or competition could not be verified.";
  }
  return message || "Could not save group changes.";
}

async function getCupCompetition(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>, competitionId: string) {
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
    console.error("competition group competition lookup failed", result.error);
    return { error: "Could not verify competition." };
  }

  if (!result.data) {
    return { error: "Competition was not found." };
  }

  if (!isCupCompetition(normalizeCompetitionType(result.data.competition_type))) {
    return { error: "Groups are available for cup competitions only." };
  }

  return { competition: result.data };
}

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

function pairKey(homeTeamId: string, awayTeamId: string) {
  return [homeTeamId, awayTeamId].sort().join(":");
}

async function getCupGroup(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  competitionId: string,
  groupId: string,
) {
  if (!uuidPattern.test(competitionId) || !uuidPattern.test(groupId)) {
    return { error: "Competition or group id is invalid." };
  }

  const competitionCheck = await getCupCompetition(supabase, competitionId);
  if (competitionCheck.error) return { error: competitionCheck.error };

  const group = await supabase
    .from("competition_groups")
    .select("id, competition_id, name, label")
    .eq("id", groupId)
    .eq("competition_id", competitionId)
    .limit(1)
    .maybeSingle();

  if (group.error) {
    console.error("cup group fixture group lookup failed", group.error);
    return { error: "Could not verify selected group." };
  }

  if (!group.data) {
    return { error: "Selected group does not belong to this competition." };
  }

  return { group: group.data };
}

async function buildCupGroupFixturePlan(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  competitionId: string,
  groupId: string,
) {
  const groupCheck = await getCupGroup(supabase, competitionId, groupId);
  if (groupCheck.error) return { error: groupCheck.error };

  const participants = await supabase
    .from("competition_teams")
    .select("team_id, display_order")
    .eq("competition_id", competitionId)
    .eq("group_id", groupId)
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (participants.error) {
    console.error("cup group fixture participant lookup failed", participants.error);
    return { error: "Could not load active teams in this group." };
  }

  const participantRows = participants.data ?? [];
  const teamIds = Array.from(new Set(participantRows.map((row) => row.team_id as string).filter(Boolean)));

  if (teamIds.length < 2) {
    return { error: "ต้องมีอย่างน้อย 2 ทีมในกลุ่มก่อนสร้างคู่แข่งขัน" };
  }

  const teams = await supabase
    .from("teams")
    .select("id, name, short_name, is_active")
    .in("id", teamIds);

  if (teams.error) {
    console.error("cup group fixture team lookup failed", teams.error);
    return { error: "Could not verify teams in this group." };
  }

  const orderByTeamId = new Map(participantRows.map((row) => [row.team_id as string, Number(row.display_order ?? 0)]));
  const sortedTeams = (teams.data ?? [])
    .filter((team) => team.is_active !== false)
    .sort((a, b) => {
      const orderDiff = (orderByTeamId.get(a.id) ?? 0) - (orderByTeamId.get(b.id) ?? 0);
      if (orderDiff) return orderDiff;
      return String(a.name ?? "").localeCompare(String(b.name ?? ""));
    });

  if (sortedTeams.length < 2) {
    return { error: "ต้องมีอย่างน้อย 2 ทีมที่ active ในกลุ่มก่อนสร้างคู่แข่งขัน" };
  }

  const existingMatches = await supabase
    .from("matches")
    .select("home_team_id, away_team_id")
    .eq("league_id", competitionId)
    .eq("group_id", groupId)
    .eq("competition_stage", "group");

  if (existingMatches.error) {
    console.error("cup group fixture existing match lookup failed", existingMatches.error);
    return { error: "Could not verify existing group fixtures." };
  }

  const existingPairKeys = new Set(
    (existingMatches.data ?? []).map((match) =>
      pairKey(match.home_team_id as string, match.away_team_id as string),
    ),
  );
  const pairs: CupGroupFixturePreviewPair[] = [];

  for (let homeIndex = 0; homeIndex < sortedTeams.length; homeIndex += 1) {
    for (let awayIndex = homeIndex + 1; awayIndex < sortedTeams.length; awayIndex += 1) {
      const homeTeam = sortedTeams[homeIndex];
      const awayTeam = sortedTeams[awayIndex];
      const key = pairKey(homeTeam.id, awayTeam.id);
      pairs.push({
        awayTeamId: awayTeam.id,
        awayTeamName: String(awayTeam.name ?? awayTeam.short_name ?? "Away team"),
        exists: existingPairKeys.has(key),
        homeTeamId: homeTeam.id,
        homeTeamName: String(homeTeam.name ?? homeTeam.short_name ?? "Home team"),
      });
    }
  }

  return { pairs };
}

async function groupNameExists(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  competitionId: string,
  name: string,
  excludedGroupId?: string,
) {
  let query = supabase
    .from("competition_groups")
    .select("id")
    .eq("competition_id", competitionId)
    .ilike("name", name)
    .limit(1);

  if (excludedGroupId) {
    query = query.neq("id", excludedGroupId);
  }

  const result = await query;

  if (result.error) {
    console.error("competition group duplicate lookup failed", result.error);
    return { error: "Could not verify duplicate group names." };
  }

  return { exists: (result.data ?? []).length > 0 };
}

export async function createCompetitionGroup(payload: GroupPayload): Promise<ActionResult> {
  const { supabase, error } = await getAdminClient();
  if (!supabase) return { ok: false, error };

  const competitionId = payload.competitionId;
  const name = normalizeName(payload.name);
  const sortOrder = normalizeSortOrder(payload.sortOrder);

  if (!name) {
    return { ok: false, error: "Group name is required." };
  }

  if (!Number.isInteger(sortOrder)) {
    return { ok: false, error: "Sort order must be a whole number." };
  }

  const competitionCheck = await getCupCompetition(supabase, competitionId);
  if (competitionCheck.error) return { ok: false, error: competitionCheck.error };

  const duplicate = await groupNameExists(supabase, competitionId, name);
  if (duplicate.error) return { ok: false, error: duplicate.error };
  if (duplicate.exists) return { ok: false, error: "A group with this name already exists in this competition." };

  const result = await supabase.from("competition_groups").insert({
    competition_id: competitionId,
    label: normalizeLabel(payload.label, name),
    name,
    sort_order: sortOrder,
  });

  if (result.error) {
    console.error("competition group create failed", result.error);
    return { ok: false, error: friendlyGroupError(result.error.message) };
  }

  revalidatePath(`/admin/competitions/${competitionId}`);
  return { ok: true };
}

export async function updateCompetitionGroup(
  competitionId: string,
  groupId: string,
  payload: Omit<GroupPayload, "competitionId">,
): Promise<ActionResult> {
  const { supabase, error } = await getAdminClient();
  if (!supabase) return { ok: false, error };

  if (!uuidPattern.test(competitionId) || !uuidPattern.test(groupId)) {
    return { ok: false, error: "Competition or group id is invalid." };
  }

  const name = normalizeName(payload.name);
  const sortOrder = normalizeSortOrder(payload.sortOrder);

  if (!name) {
    return { ok: false, error: "Group name is required." };
  }

  if (!Number.isInteger(sortOrder)) {
    return { ok: false, error: "Sort order must be a whole number." };
  }

  const competitionCheck = await getCupCompetition(supabase, competitionId);
  if (competitionCheck.error) return { ok: false, error: competitionCheck.error };

  const group = await supabase
    .from("competition_groups")
    .select("id")
    .eq("id", groupId)
    .eq("competition_id", competitionId)
    .limit(1)
    .maybeSingle();

  if (group.error) {
    console.error("competition group update lookup failed", group.error);
    return { ok: false, error: "Could not verify group." };
  }

  if (!group.data) {
    return { ok: false, error: "Group was not found in this competition." };
  }

  const duplicate = await groupNameExists(supabase, competitionId, name, groupId);
  if (duplicate.error) return { ok: false, error: duplicate.error };
  if (duplicate.exists) return { ok: false, error: "A group with this name already exists in this competition." };

  const result = await supabase
    .from("competition_groups")
    .update({
      label: normalizeLabel(payload.label, name),
      name,
      sort_order: sortOrder,
      updated_at: new Date().toISOString(),
    })
    .eq("id", groupId)
    .eq("competition_id", competitionId);

  if (result.error) {
    console.error("competition group update failed", result.error);
    return { ok: false, error: friendlyGroupError(result.error.message) };
  }

  revalidatePath(`/admin/competitions/${competitionId}`);
  return { ok: true };
}

export async function updateCompetitionGroupQualifiers(payload: QualifiersPayload): Promise<ActionResult> {
  const { supabase, error } = await getAdminClient();
  if (!supabase) return { ok: false, error };

  const { competitionId, groupId } = payload;
  const qualifiersCount = Number(payload.qualifiersCount);

  if (!uuidPattern.test(competitionId) || !uuidPattern.test(groupId)) {
    return { ok: false, error: "Competition or group id is invalid." };
  }

  if (!Number.isInteger(qualifiersCount) || qualifiersCount < 0) {
    return { ok: false, error: "Teams qualifying must be zero or a whole number." };
  }

  const groupCheck = await getCupGroup(supabase, competitionId, groupId);
  if (groupCheck.error) return { ok: false, error: groupCheck.error };

  const participants = await supabase
    .from("competition_teams")
    .select("id", { count: "exact", head: true })
    .eq("competition_id", competitionId)
    .eq("group_id", groupId)
    .eq("is_active", true);

  if (participants.error) {
    console.error("competition group qualifiers participant count failed", participants.error);
    return { ok: false, error: "Could not verify teams in this group." };
  }

  const teamCount = participants.count ?? 0;
  if (qualifiersCount > teamCount) {
    return { ok: false, error: "Teams qualifying cannot exceed the teams currently in this group." };
  }

  const result = await supabase
    .from("competition_groups")
    .update({ qualifiers_count: qualifiersCount, updated_at: new Date().toISOString() })
    .eq("id", groupId)
    .eq("competition_id", competitionId);

  if (result.error) {
    console.error("competition group qualifiers update failed", result.error);
    return { ok: false, error: friendlyGroupError(result.error.message) };
  }

  revalidatePath(`/admin/competitions/${competitionId}`);
  return { ok: true };
}

export async function deleteCompetitionGroup(competitionId: string, groupId: string): Promise<ActionResult> {
  const { supabase, error } = await getAdminClient();
  if (!supabase) return { ok: false, error };

  if (!uuidPattern.test(competitionId) || !uuidPattern.test(groupId)) {
    return { ok: false, error: "Competition or group id is invalid." };
  }

  const competitionCheck = await getCupCompetition(supabase, competitionId);
  if (competitionCheck.error) return { ok: false, error: competitionCheck.error };

  const group = await supabase
    .from("competition_groups")
    .select("id")
    .eq("id", groupId)
    .eq("competition_id", competitionId)
    .limit(1)
    .maybeSingle();

  if (group.error) {
    console.error("competition group delete lookup failed", group.error);
    return { ok: false, error: "Could not verify group." };
  }

  if (!group.data) {
    return { ok: false, error: "Group was not found in this competition." };
  }

  // Future group-match phases can add blocking checks here before deletion.
  const result = await supabase
    .from("competition_groups")
    .delete()
    .eq("id", groupId)
    .eq("competition_id", competitionId);

  if (result.error) {
    console.error("competition group delete failed", result.error);
    return { ok: false, error: friendlyGroupError(result.error.message) };
  }

  revalidatePath(`/admin/competitions/${competitionId}`);
  return { ok: true };
}

export async function assignCompetitionTeamToGroup(payload: AssignPayload): Promise<ActionResult> {
  const { supabase, error } = await getAdminClient();
  if (!supabase) return { ok: false, error };

  const { competitionId, competitionTeamId, groupId } = payload;

  if (!uuidPattern.test(competitionId) || !uuidPattern.test(competitionTeamId)) {
    return { ok: false, error: "Competition or team assignment id is invalid." };
  }

  if (groupId !== null && !uuidPattern.test(groupId)) {
    return { ok: false, error: "Group id is invalid." };
  }

  const competitionCheck = await getCupCompetition(supabase, competitionId);
  if (competitionCheck.error) return { ok: false, error: competitionCheck.error };

  const participant = await supabase
    .from("competition_teams")
    .select("id")
    .eq("id", competitionTeamId)
    .eq("competition_id", competitionId)
    .limit(1)
    .maybeSingle();

  if (participant.error) {
    console.error("competition group participant lookup failed", participant.error);
    return { ok: false, error: "Could not verify competition participant." };
  }

  if (!participant.data) {
    return { ok: false, error: "Selected team is not assigned to this competition." };
  }

  if (groupId !== null) {
    const group = await supabase
      .from("competition_groups")
      .select("id")
      .eq("id", groupId)
      .eq("competition_id", competitionId)
      .limit(1)
      .maybeSingle();

    if (group.error) {
      console.error("competition group assignment lookup failed", group.error);
      return { ok: false, error: "Could not verify selected group." };
    }

    if (!group.data) {
      return { ok: false, error: "Selected group does not belong to this competition." };
    }
  }

  const result = await supabase
    .from("competition_teams")
    .update({ group_id: groupId })
    .eq("id", competitionTeamId)
    .eq("competition_id", competitionId)
    .select("id, group_id")
    .maybeSingle();

  if (result.error || !result.data || result.data.group_id !== groupId) {
    console.error("competition team group assignment failed", result.error);
    return { ok: false, error: friendlyGroupError(result.error?.message ?? "The team group could not be updated.") };
  }

  revalidatePath(`/admin/competitions/${competitionId}`);
  return { ok: true };
}

export async function previewCupGroupFixtures(
  competitionId: string,
  groupId: string,
): Promise<CupGroupFixtureResult> {
  const { supabase, error } = await getAdminClient();
  if (!supabase) return { ok: false, error };

  const plan = await buildCupGroupFixturePlan(supabase, competitionId, groupId);
  if (plan.error) return { ok: false, error: plan.error };

  const pairs = plan.pairs ?? [];
  return {
    createdCount: 0,
    ok: true,
    pairs,
    skippedCount: pairs.filter((pair) => pair.exists).length,
    totalPairs: pairs.length,
  };
}

export async function generateCupGroupFixtures(
  competitionId: string,
  groupId: string,
): Promise<CupGroupFixtureResult> {
  const { supabase, error } = await getAdminClient();
  if (!supabase) return { ok: false, error };

  const plan = await buildCupGroupFixturePlan(supabase, competitionId, groupId);
  if (plan.error) return { ok: false, error: plan.error };

  const pairs = plan.pairs ?? [];
  const missingPairs = pairs.filter((pair) => !pair.exists);

  if (missingPairs.length === 0) {
    revalidatePath(`/admin/competitions/${competitionId}`);
    return {
      createdCount: 0,
      ok: true,
      pairs,
      skippedCount: pairs.length,
      totalPairs: pairs.length,
    };
  }

  const result = await supabase.from("matches").insert(
    missingPairs.map((pair) => ({
      away_score: null,
      away_team_id: pair.awayTeamId,
      competition_stage: "group",
      fixture_source: "generated",
      group_id: groupId,
      home_score: null,
      home_team_id: pair.homeTeamId,
      league_id: competitionId,
      match_date: null,
      match_type: "cup",
      status: "scheduled",
      venue: null,
    })),
  );

  if (result.error) {
    if (result.error.code === "23505") {
      revalidatePath(`/admin/competitions/${competitionId}`);
      return {
        createdCount: 0,
        ok: true,
        pairs,
        skippedCount: pairs.length,
        totalPairs: pairs.length,
      };
    }

    console.error("cup group fixture insert failed", result.error);
    return { ok: false, error: "Could not generate group fixtures." };
  }

  revalidatePath(`/admin/competitions/${competitionId}`);
  return {
    createdCount: missingPairs.length,
    ok: true,
    pairs: pairs.map((pair) => ({ ...pair, exists: true })),
    skippedCount: pairs.length - missingPairs.length,
    totalPairs: pairs.length,
  };
}

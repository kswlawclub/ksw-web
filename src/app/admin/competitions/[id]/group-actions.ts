"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin-server-auth";
import { isCupCompetition, normalizeCompetitionType } from "@/lib/competition-format";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type ActionResult = {
  ok: boolean;
  error?: string;
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
    .eq("competition_id", competitionId);

  if (result.error) {
    console.error("competition team group assignment failed", result.error);
    return { ok: false, error: friendlyGroupError(result.error.message) };
  }

  revalidatePath(`/admin/competitions/${competitionId}`);
  return { ok: true };
}

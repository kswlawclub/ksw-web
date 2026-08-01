"use server";

import { revalidatePath } from "next/cache";
import {
  calculateCompetitionStructure,
  type CompetitionStructureEntryMode,
  type CompetitionStructurePreview,
} from "@/lib/competition-structure";
import { requireAdminSession } from "@/lib/admin-server-auth";
import { isCupCompetition, normalizeCompetitionType } from "@/lib/competition-format";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export type CompetitionEngineV2Config = {
  bracketCapacity: number | null;
  competitionId: string;
  entrantCount: number | null;
  entryMode: "bye" | "custom" | "preliminary";
  groupStageEnabled: boolean;
  status: "active" | "completed" | "draft" | "fixtures_created" | "reviewed";
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
    return { error: "Competition Wizard V2 is available for cup competitions only.", supabase };
  }

  return { error: "", supabase };
}

export async function saveCompetitionEngineV2Config(
  payload: CompetitionEngineV2WizardPayload,
): Promise<CompetitionEngineV2WizardResult> {
  const verified = await verifyCupCompetition(payload.competitionId);
  if (verified.error || !verified.supabase) return { error: verified.error, ok: false };

  const [groupsResult, participantsResult] = await Promise.all([
    verified.supabase
      .from("competition_groups")
      .select("id, qualifiers_count")
      .eq("competition_id", payload.competitionId),
    verified.supabase
      .from("competition_teams")
      .select("team_id")
      .eq("competition_id", payload.competitionId)
      .eq("is_active", true),
  ]);

  if (groupsResult.error) {
    console.error("competition engine v2 groups lookup failed", groupsResult.error);
    return { error: "Could not verify competition groups.", ok: false };
  }

  if (participantsResult.error) {
    console.error("competition engine v2 participants lookup failed", participantsResult.error);
    return { error: "Could not verify competition participants.", ok: false };
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

  const result = await verified.supabase
    .from("competition_knockout_configs")
    .upsert(
      {
        bracket_capacity: preview.bracketCapacity,
        competition_id: payload.competitionId,
        entrant_count: knockoutEntrantCount,
        entry_mode: preview.entryMode,
        group_stage_enabled: payload.groupStageEnabled,
        status: "reviewed",
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

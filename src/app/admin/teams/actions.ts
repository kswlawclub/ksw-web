"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { loadCompetitionParticipants } from "@/lib/competition-participants";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSession } from "@/lib/admin-server-auth";

type TeamPayload = {
  name: string;
  short_name: string;
  logo_url: string | null;
  is_ksw: boolean;
  is_active: boolean;
};

type ActionResult = {
  ok: boolean;
  error?: string;
};

type AssignTeamsResult = ActionResult & {
  assignedCount?: number;
  alreadyAssignedCount?: number;
  count?: number;
  reactivatedCount?: number;
};

type UploadResult = ActionResult & {
  publicUrl?: string;
  path?: string;
};

type CompetitionRow = {
  id: string;
  name: string;
  season: string | null;
  competition_type: string | null;
  season_status: string | null;
  slug: string | null;
  is_published: boolean | null;
};

type TeamRow = {
  id: string;
  league_id: string | null;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  is_ksw: boolean;
  is_active: boolean;
  created_at: string | null;
  display_order?: number;
  participant_is_active?: boolean;
  participant_source?: string;
};

type AdminTeamsDataResult = ActionResult & {
  competitions?: CompetitionRow[];
  teams?: TeamRow[];
  availableTeams?: TeamRow[];
};

type SupabaseActionError = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

const maxLogoSize = 2 * 1024 * 1024;
const bucketName = "team-logos";
const rasterLogoTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const allowedLogoTypes = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/webp", "webp"],
  ["image/svg+xml", "svg"],
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const competitionColumns = "id, name, season, competition_type, season_status, slug, is_published";
const teamColumns = "id, league_id, name, short_name, logo_url, is_ksw, is_active, created_at";

function getAdminClient() {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return {
      supabase: null,
      error: "SUPABASE_SERVICE_ROLE_KEY is missing or Supabase URL is not configured.",
    };
  }

  return { supabase, error: "" };
}

function validatePayload(payload: TeamPayload) {
  if (!payload.name.trim()) {
    return "Team name is required.";
  }

  if (!payload.short_name.trim()) {
    return "Short name is required.";
  }

  return "";
}

function logSupabaseActionError(source: string, error: unknown, context?: Record<string, unknown>) {
  const supabaseError = error as SupabaseActionError | null;

  console.error(source, {
    code: supabaseError?.code,
    details: supabaseError?.details,
    hint: supabaseError?.hint,
    message: supabaseError?.message,
    ...context,
  });
}

async function validateCompetitionExists(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  competitionId: string | null | undefined,
) {
  if (!competitionId) {
    return "";
  }

  const competition = await supabase
    .from("leagues")
    .select("id", { count: "exact", head: true })
    .eq("id", competitionId);

  if (competition.error) {
    console.error("admin team competition validation failed", competition.error);
    return "Could not verify the selected competition.";
  }

  if ((competition.count ?? 0) < 1) {
    return "Selected competition does not exist.";
  }

  return "";
}

export async function loadAdminTeamsData(competitionId = ""): Promise<AdminTeamsDataResult> {
  await requireAdminSession();

  const normalizedCompetitionId = competitionId.trim();

  if (normalizedCompetitionId && !uuidPattern.test(normalizedCompetitionId)) {
    return { ok: false, error: "Competition id is invalid." };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const teamsQuery = normalizedCompetitionId
    ? loadCompetitionParticipants(supabase, normalizedCompetitionId, {
        includeInactiveParticipants: false,
        includeLegacyFallback: false,
      })
    : supabase.from("teams").select(teamColumns).order("name");
  const competitionsQuery = normalizedCompetitionId
    ? supabase
        .from("leagues")
        .select(competitionColumns)
        .eq("id", normalizedCompetitionId)
        .order("created_at", { ascending: false })
        .limit(1)
    : supabase
        .from("leagues")
        .select(competitionColumns)
        .eq("is_active", true)
        .order("created_at", { ascending: false });
  const availableTeamsQuery = normalizedCompetitionId
    ? supabase
        .from("teams")
        .select(teamColumns)
        .eq("is_active", true)
        .order("name")
    : null;

  const [teamsResult, competitionsResult, availableTeamsResult] = await Promise.all([
    teamsQuery,
    competitionsQuery,
    availableTeamsQuery,
  ]);

  const teams = Array.isArray(teamsResult)
    ? (teamsResult as TeamRow[])
    : ((teamsResult.data ?? []) as TeamRow[]);

  if (!Array.isArray(teamsResult) && teamsResult.error) {
    logSupabaseActionError("admin teams load teams query failed", teamsResult.error, {
      competitionId: normalizedCompetitionId || null,
    });
    return { ok: false, error: "Could not load teams." };
  }

  if (competitionsResult.error) {
    logSupabaseActionError("admin teams load competitions query failed", competitionsResult.error, {
      competitionId: normalizedCompetitionId || null,
    });
    return { ok: false, error: "Could not load competitions for the team form." };
  }

  if (availableTeamsResult?.error) {
    logSupabaseActionError("admin teams load available teams query failed", availableTeamsResult.error, {
      competitionId: normalizedCompetitionId,
    });
    return { ok: false, error: "Could not load available teams." };
  }

  const assignedTeamIds = new Set(teams.map((team) => team.id));
  const availableTeams = ((availableTeamsResult?.data ?? []) as TeamRow[]).filter(
    (team) => !assignedTeamIds.has(team.id),
  );

  return {
    ok: true,
    availableTeams,
    competitions: (competitionsResult.data ?? []) as CompetitionRow[],
    teams,
  };
}

async function getExistingTeam(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  id: string,
) {
  const team = await supabase
    .from("teams")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (team.error) {
    console.error("admin team lookup failed", team.error);
    return {
      leagueId: null,
      error: "Could not verify the selected team.",
    };
  }

  if (!team.data) {
    return {
      leagueId: null,
      error: "Team was not found.",
    };
  }

  return {
    id: team.data.id as string,
    error: "",
  };
}

async function getCompetitionParticipant(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  teamId: string,
  competitionId: string,
) {
  const participant = await supabase
    .from("competition_teams")
    .select("id, is_active")
    .eq("competition_id", competitionId)
    .eq("team_id", teamId)
    .maybeSingle();

  if (participant.error) {
    console.error("admin competition participant lookup failed", participant.error);
    return {
      data: null as { id: string; is_active: boolean } | null,
      error: "Could not verify the team participant relationship.",
    };
  }

  return {
    data: participant.data as { id: string; is_active: boolean } | null,
    error: "",
  };
}

async function countTeamMatchReferences(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  teamId: string,
  competitionId?: string,
) {
  const homeQuery = supabase
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("home_team_id", teamId);
  const awayQuery = supabase
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("away_team_id", teamId);

  if (competitionId) {
    homeQuery.eq("league_id", competitionId);
    awayQuery.eq("league_id", competitionId);
  }

  const [homeMatches, awayMatches] = await Promise.all([homeQuery, awayQuery]);

  if (homeMatches.error || awayMatches.error) {
    console.error("admin team match usage check failed", homeMatches.error ?? awayMatches.error);
    return {
      count: 0,
      error: "Could not verify whether this team is used in matches.",
    };
  }

  return {
    count: (homeMatches.count ?? 0) + (awayMatches.count ?? 0),
    error: "",
  };
}

export async function createTeam(payload: TeamPayload): Promise<ActionResult> {
  await requireAdminSession();

  const validationError = validatePayload(payload);

  if (validationError) {
    return { ok: false, error: validationError };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const result = await supabase.from("teams").insert({
    name: payload.name,
    short_name: payload.short_name,
    logo_url: payload.logo_url,
    is_ksw: payload.is_ksw,
    is_active: payload.is_active,
    league_id: null,
  });

  if (result.error) {
    console.error("admin team insert failed", result.error);
    return { ok: false, error: result.error.message };
  }

  revalidatePath("/admin/teams");

  return { ok: true };
}

export async function updateTeam(
  id: string,
  payload: TeamPayload,
  expectedCompetitionId?: string,
): Promise<ActionResult> {
  await requireAdminSession();

  if (!id) {
    return { ok: false, error: "Team id is required." };
  }

  const validationError = validatePayload(payload);

  if (validationError) {
    return { ok: false, error: validationError };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const existingTeam = await getExistingTeam(supabase, id);

  if (existingTeam.error) {
    return { ok: false, error: existingTeam.error };
  }

  if (expectedCompetitionId) {
    const participant = await getCompetitionParticipant(supabase, id, expectedCompetitionId);

    if (participant.error) {
      return { ok: false, error: participant.error };
    }

    if (!participant.data?.is_active) {
      return { ok: false, error: "This team is not an active participant in the selected competition." };
    }
  }

  const result = await supabase
    .from("teams")
    .update({
      name: payload.name,
      short_name: payload.short_name,
      logo_url: payload.logo_url,
      is_ksw: payload.is_ksw,
      is_active: payload.is_active,
    })
    .eq("id", id);

  if (result.error) {
    console.error("admin team update failed", result.error);
    return { ok: false, error: result.error.message };
  }

  revalidatePath("/admin/teams");

  return { ok: true };
}

export async function assignTeamsToCompetition(
  teamIds: string[],
  competitionId: string,
): Promise<AssignTeamsResult> {
  await requireAdminSession();

  const uniqueTeamIds = Array.from(new Set(teamIds.map((id) => id.trim()).filter(Boolean)));

  if (!competitionId) {
    return { ok: false, error: "Competition is required." };
  }

  if (uniqueTeamIds.length === 0) {
    return { ok: false, error: "Select at least one team to assign." };
  }

  if (!uuidPattern.test(competitionId) || uniqueTeamIds.some((teamId) => !uuidPattern.test(teamId))) {
    return { ok: false, error: "Competition or team id is invalid." };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const competitionError = await validateCompetitionExists(supabase, competitionId);

  if (competitionError) {
    return { ok: false, error: competitionError };
  }

  const teams = await supabase
    .from("teams")
    .select("id")
    .in("id", uniqueTeamIds);

  if (teams.error) {
    logSupabaseActionError("admin team assign lookup failed", teams.error, {
      selectedTeamCount: uniqueTeamIds.length,
    });
    return { ok: false, error: "Could not verify selected teams." };
  }

  const teamRows = teams.data ?? [];

  if (teamRows.length !== uniqueTeamIds.length) {
    return { ok: false, error: "One or more selected teams could not be found." };
  }

  const existingParticipants = await supabase
    .from("competition_teams")
    .select("team_id, is_active")
    .eq("competition_id", competitionId)
    .in("team_id", uniqueTeamIds);

  if (existingParticipants.error) {
    logSupabaseActionError("assignTeamsToCompetition existing participant query failed", existingParticipants.error, {
      competitionId,
      selectedTeamCount: uniqueTeamIds.length,
    });
    return { ok: false, error: "Could not verify existing competition participants." };
  }

  const existingRows = (existingParticipants.data ?? []) as Array<{ team_id: string; is_active: boolean }>;
  const activeTeamIds = new Set(existingRows.filter((row) => row.is_active).map((row) => row.team_id));
  const inactiveTeamIds = existingRows.filter((row) => !row.is_active).map((row) => row.team_id);
  const existingTeamIds = new Set(existingRows.map((row) => row.team_id));
  const missingTeamIds = uniqueTeamIds.filter((teamId) => !existingTeamIds.has(teamId));

  let assignedCount = 0;
  let reactivatedCount = 0;

  if (missingTeamIds.length > 0) {
    const insertResult = await supabase
      .from("competition_teams")
      .insert(
        missingTeamIds.map((teamId) => ({
          competition_id: competitionId,
          team_id: teamId,
          is_active: true,
          display_order: 0,
        })),
      )
      .select("team_id");

    if (insertResult.error) {
      logSupabaseActionError("assignTeamsToCompetition participant insert failed", insertResult.error, {
        competitionId,
        insertCount: missingTeamIds.length,
      });

      if ((insertResult.error as SupabaseActionError).code === "23505") {
        return {
          ok: false,
          error: "One or more selected teams were assigned by another session. Please reload and try again.",
        };
      }

      return { ok: false, error: "Could not assign selected teams." };
    }

    assignedCount = (insertResult.data ?? []).length;
  }

  if (inactiveTeamIds.length > 0) {
    const reactivateResult = await supabase
      .from("competition_teams")
      .update({ is_active: true })
      .eq("competition_id", competitionId)
      .in("team_id", inactiveTeamIds)
      .eq("is_active", false)
      .select("team_id");

    if (reactivateResult.error) {
      logSupabaseActionError("assignTeamsToCompetition participant reactivate failed", reactivateResult.error, {
        competitionId,
        reactivateCount: inactiveTeamIds.length,
      });
      return { ok: false, error: "Could not reactivate selected teams." };
    }

    reactivatedCount = (reactivateResult.data ?? []).length;
  }

  revalidatePath("/admin/teams");

  return {
    ok: true,
    assignedCount,
    alreadyAssignedCount: activeTeamIds.size,
    count: assignedCount + reactivatedCount,
    reactivatedCount,
  };
}

export async function removeTeamFromCompetition(
  id: string,
  expectedCompetitionId: string,
): Promise<ActionResult> {
  await requireAdminSession();

  if (!id) {
    return { ok: false, error: "Team id is required." };
  }

  if (!expectedCompetitionId) {
    return { ok: false, error: "Competition is required." };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const existingTeam = await getExistingTeam(supabase, id);

  if (existingTeam.error) {
    return { ok: false, error: existingTeam.error };
  }

  const participant = await getCompetitionParticipant(supabase, id, expectedCompetitionId);

  if (participant.error) {
    return { ok: false, error: participant.error };
  }

  if (!participant.data) {
    return { ok: false, error: "This team does not belong to the selected competition." };
  }

  const usage = await countTeamMatchReferences(supabase, id, expectedCompetitionId);

  if (usage.error) {
    return { ok: false, error: usage.error };
  }

  if (usage.count > 0) {
    return {
      ok: false,
      error: "This team is used by one or more matches and cannot be removed from the competition.",
    };
  }

  const result = await supabase
    .from("competition_teams")
    .update({ is_active: false })
    .eq("competition_id", expectedCompetitionId)
    .eq("team_id", id)
    .eq("is_active", true);

  if (result.error) {
    console.error("admin team remove from competition failed", result.error);
    return { ok: false, error: result.error.message };
  }

  revalidatePath("/admin/teams");

  return { ok: true };
}

export async function deleteTeamById(id: string, expectedCompetitionId?: string): Promise<ActionResult> {
  await requireAdminSession();

  if (!id) {
    return { ok: false, error: "Team id is required." };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const existingTeam = await getExistingTeam(supabase, id);

  if (existingTeam.error) {
    return { ok: false, error: existingTeam.error };
  }

  if (expectedCompetitionId) {
    const participant = await getCompetitionParticipant(supabase, id, expectedCompetitionId);

    if (participant.error) {
      return { ok: false, error: participant.error };
    }

    if (!participant.data) {
      return { ok: false, error: "This team does not belong to the selected competition." };
    }
  }

  const usage = await countTeamMatchReferences(supabase, id);

  if (usage.error) {
    return { ok: false, error: usage.error };
  }

  if (usage.count > 0) {
    return {
      ok: false,
      error: `This team is used in ${usage.count} match${usage.count === 1 ? "" : "es"} and cannot be deleted.`,
    };
  }

  const participantUsage = await supabase
    .from("competition_teams")
    .select("id", { count: "exact", head: true })
    .eq("team_id", id);

  if (participantUsage.error) {
    console.error("admin team competition usage check failed", participantUsage.error);
    return { ok: false, error: "Could not verify whether this team is linked to competitions." };
  }

  if ((participantUsage.count ?? 0) > 0) {
    return {
      ok: false,
      error: "This team is linked to one or more competitions and cannot be deleted.",
    };
  }

  const result = await supabase.from("teams").delete().eq("id", id);

  if (result.error) {
    console.error("admin team delete failed", result.error);
    return { ok: false, error: result.error.message };
  }

  revalidatePath("/admin/teams");

  return { ok: true };
}

export async function uploadTeamLogo(formData: FormData): Promise<UploadResult> {
  await requireAdminSession();

  const file = formData.get("file");
  const shortName = String(formData.get("shortName") ?? "team");
  const teamId = String(formData.get("teamId") ?? "");

  if (!(file instanceof File)) {
    return { ok: false, error: "Please choose an image file." };
  }

  if (!allowedLogoTypes.has(file.type)) {
    return { ok: false, error: "Logo must be a png, jpg, jpeg, webp, or svg image." };
  }

  if (file.type === "image/svg+xml" && file.size > maxLogoSize) {
    return { ok: false, error: "Logo file must be 2MB or smaller." };
  }

  const { supabase, error } = getAdminClient();

  if (!supabase) {
    return { ok: false, error };
  }

  const isRasterLogo = rasterLogoTypes.has(file.type);
  const extension = isRasterLogo ? "webp" : allowedLogoTypes.get(file.type) ?? "png";
  const baseName =
    (shortName || teamId || "team")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "team";
  const objectPath = `${baseName}-${Date.now()}.${extension}`;
  let inputBytes: Buffer<ArrayBufferLike>;

  try {
    inputBytes = Buffer.from(await file.arrayBuffer());
  } catch (readError) {
    console.error("admin team logo file read failed", readError);
    return { ok: false, error: "Logo file could not be read." };
  }

  let bytes: Buffer<ArrayBufferLike> = inputBytes;
  let contentType = file.type;

  if (isRasterLogo) {
    try {
      bytes = await sharp(inputBytes)
        .rotate()
        .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
      contentType = "image/webp";
    } catch (processingError) {
      console.error("admin team logo processing failed", processingError);
      return { ok: false, error: "Logo could not be processed." };
    }

    if (bytes.length > maxLogoSize) {
      return {
        ok: false,
        error: "Logo could not be compressed below 2MB. Please choose a smaller image.",
      };
    }
  }

  const upload = await supabase.storage.from(bucketName).upload(objectPath, bytes, {
    contentType,
    upsert: false,
  });

  if (upload.error) {
    console.error("admin team logo upload failed", {
      bucketName,
      objectPath,
      contentType,
      fileSize: bytes.length,
      error: upload.error,
    });
    return {
      ok: false,
      error: `Logo upload failed for bucket "${bucketName}": ${upload.error.message}`,
    };
  }

  const { data } = supabase.storage.from(bucketName).getPublicUrl(objectPath);

  if (!data.publicUrl) {
    console.error("admin team logo public URL missing", {
      bucketName,
      objectPath,
    });
    return { ok: false, error: "Logo uploaded, but no public URL was returned." };
  }

  return {
    ok: true,
    path: objectPath,
    publicUrl: data.publicUrl,
  };
}

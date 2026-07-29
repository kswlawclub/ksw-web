"use server";

import sharp from "sharp";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSession } from "@/lib/admin-server-auth";

type TeamPayload = {
  league_id: string | null;
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

type UploadResult = ActionResult & {
  publicUrl?: string;
  path?: string;
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

async function getExistingTeamLeague(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  id: string,
) {
  const team = await supabase
    .from("teams")
    .select("id, league_id")
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
    leagueId: team.data.league_id as string | null,
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

  const competitionError = await validateCompetitionExists(supabase, payload.league_id);

  if (competitionError) {
    return { ok: false, error: competitionError };
  }

  const result = await supabase.from("teams").insert(payload);

  if (result.error) {
    console.error("admin team insert failed", result.error);
    return { ok: false, error: result.error.message };
  }

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

  const existingTeam = await getExistingTeamLeague(supabase, id);

  if (existingTeam.error) {
    return { ok: false, error: existingTeam.error };
  }

  if (
    expectedCompetitionId &&
    (existingTeam.leagueId !== expectedCompetitionId || payload.league_id !== expectedCompetitionId)
  ) {
    return { ok: false, error: "This team does not belong to the selected competition." };
  }

  if (existingTeam.leagueId !== payload.league_id) {
    return { ok: false, error: "Team competition cannot be changed from the team editor." };
  }

  const competitionError = await validateCompetitionExists(supabase, payload.league_id);

  if (competitionError) {
    return { ok: false, error: competitionError };
  }

  const result = await supabase.from("teams").update(payload).eq("id", id);

  if (result.error) {
    console.error("admin team update failed", result.error);
    return { ok: false, error: result.error.message };
  }

  return { ok: true };
}

export async function assignTeamsToCompetition(
  teamIds: string[],
  competitionId: string,
): Promise<ActionResult & { count?: number }> {
  await requireAdminSession();

  const uniqueTeamIds = Array.from(new Set(teamIds.map((id) => id.trim()).filter(Boolean)));

  if (!competitionId) {
    return { ok: false, error: "Competition is required." };
  }

  if (uniqueTeamIds.length === 0) {
    return { ok: false, error: "Select at least one team to assign." };
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
    .select("id, league_id")
    .in("id", uniqueTeamIds);

  if (teams.error) {
    console.error("admin team assign lookup failed", teams.error);
    return { ok: false, error: "Could not verify selected teams." };
  }

  const teamRows = teams.data ?? [];

  if (teamRows.length !== uniqueTeamIds.length) {
    return { ok: false, error: "One or more selected teams could not be found." };
  }

  if (teamRows.some((team) => team.league_id !== null)) {
    return { ok: false, error: "One or more selected teams already belong to another competition." };
  }

  const result = await supabase
    .from("teams")
    .update({ league_id: competitionId })
    .in("id", uniqueTeamIds)
    .is("league_id", null)
    .select("id");

  if (result.error) {
    console.error("admin team assign failed", result.error);
    return { ok: false, error: result.error.message };
  }

  if ((result.data ?? []).length !== uniqueTeamIds.length) {
    return { ok: false, error: "One or more selected teams were already assigned. Please reload and try again." };
  }

  return { ok: true, count: uniqueTeamIds.length };
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

  const existingTeam = await getExistingTeamLeague(supabase, id);

  if (existingTeam.error) {
    return { ok: false, error: existingTeam.error };
  }

  if (existingTeam.leagueId !== expectedCompetitionId) {
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
    .from("teams")
    .update({ league_id: null })
    .eq("id", id)
    .eq("league_id", expectedCompetitionId);

  if (result.error) {
    console.error("admin team remove from competition failed", result.error);
    return { ok: false, error: result.error.message };
  }

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

  const existingTeam = await getExistingTeamLeague(supabase, id);

  if (existingTeam.error) {
    return { ok: false, error: existingTeam.error };
  }

  if (expectedCompetitionId && existingTeam.leagueId !== expectedCompetitionId) {
    return { ok: false, error: "This team does not belong to the selected competition." };
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

  const result = await supabase.from("teams").delete().eq("id", id);

  if (result.error) {
    console.error("admin team delete failed", result.error);
    return { ok: false, error: result.error.message };
  }

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

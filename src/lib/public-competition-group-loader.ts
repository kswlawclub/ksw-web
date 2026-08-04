import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

type Row = Record<string, unknown>;

export type PublicCompetitionGroupData = {
  error: string | null;
  groups: Row[];
  matches: Row[];
  participants: Row[];
  status: "error" | "ready" | "skipped";
};

export function isEligiblePublicCupGroupLoad(competition: Row) {
  return Boolean(text(competition, "id") && competition.is_published === true && text(competition, "competition_type") === "cup");
}

function text(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" && value.trim() ? value : "";
}

function publicTeam(row: Row | null) {
  return Array.isArray(row?.teams) ? row?.teams[0] as Row | undefined : row?.teams as Row | undefined;
}

export async function loadPublicCompetitionGroupData(competition: Row): Promise<PublicCompetitionGroupData> {
  const competitionId = text(competition, "id");
  if (!isEligiblePublicCupGroupLoad(competition)) {
    return { error: null, groups: [], matches: [], participants: [], status: "skipped" };
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.error("public competition group loader unavailable", { competitionId });
    return { error: "ไม่สามารถโหลดข้อมูลรอบแบ่งกลุ่มได้ในขณะนี้", groups: [], matches: [], participants: [], status: "error" };
  }

  const [groupsResult, participantsResult, matchesResult] = await Promise.all([
    supabase.from("competition_groups").select("id, name, label, sort_order, qualifiers_count").eq("competition_id", competitionId).order("sort_order"),
    supabase.from("competition_teams").select("team_id, group_id, display_order, is_active, teams(id, name, short_name, logo_url, is_ksw)").eq("competition_id", competitionId).eq("is_active", true).order("display_order"),
    supabase.from("matches").select("id, group_id, competition_stage, match_date, home_team_id, away_team_id, home_score, away_score, penalty_home_score, penalty_away_score, venue, status, teams!matches_home_team_id_fkey(id, name, short_name, logo_url, is_ksw), away_teams:teams!matches_away_team_id_fkey(id, name, short_name, logo_url, is_ksw)").eq("league_id", competitionId).eq("competition_stage", "group").order("match_date"),
  ]);
  const failure = groupsResult.error ?? participantsResult.error ?? matchesResult.error;
  if (failure) {
    console.error("public competition group loader failed", { code: failure.code, competitionId, message: failure.message });
    return { error: "ไม่สามารถโหลดข้อมูลรอบแบ่งกลุ่มได้ในขณะนี้", groups: [], matches: [], participants: [], status: "error" };
  }

  const participants = ((participantsResult.data ?? []) as Row[]).map((participant) => {
    const team = publicTeam(participant) ?? {};
    return { ...participant, ...team };
  });
  const matches = ((matchesResult.data ?? []) as Row[]).map((match) => {
    const home = publicTeam({ teams: match.teams }) ?? {};
    const away = publicTeam({ teams: match.away_teams }) ?? {};
    return {
      ...match,
      away_team_is_ksw: away.is_ksw === true,
      away_team_logo_url: text(away, "logo_url"),
      away_team_name: text(away, "name") || "ทีมเยือน",
      away_team_short_name: text(away, "short_name"),
      home_team_is_ksw: home.is_ksw === true,
      home_team_logo_url: text(home, "logo_url"),
      home_team_name: text(home, "name") || "ทีมเหย้า",
      home_team_short_name: text(home, "short_name"),
    };
  });
  return { error: null, groups: (groupsResult.data ?? []) as Row[], matches, participants, status: "ready" };
}

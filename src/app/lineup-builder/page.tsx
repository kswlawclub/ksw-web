import { getSupabase } from "@/lib/supabase";
import { LineupBuilderClient, type LineupMember, type OpponentTeam } from "./lineup-builder-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getLineupData() {
  const supabase = getSupabase();

  if (!supabase) {
    return { members: [], opponents: [] };
  }

  const [membersResult, teamsResult] = await Promise.all([
    supabase
      .from("club_members")
      .select("id, nickname, photo_url, shirt_number, birth_year_be, is_active, lineup_enabled")
      .eq("is_active", true)
      .eq("lineup_enabled", true)
      .order("nickname", { ascending: true }),
    supabase
      .from("teams")
      .select("id, name, short_name, logo_url, is_ksw")
      .order("name", { ascending: true }),
  ]);

  if (membersResult.error) {
    console.error("lineup builder members query failed", membersResult.error.message);
  }

  if (teamsResult.error) {
    console.error("lineup builder teams query failed", teamsResult.error.message);
  }

  const members = ((membersResult.data ?? []) as LineupMember[]).filter(
    (member) => member.is_active && member.lineup_enabled,
  );
  const opponents = ((teamsResult.data ?? []) as (OpponentTeam & { is_ksw?: boolean | null })[])
    .filter((team) => {
      const name = `${team.name ?? ""} ${team.short_name ?? ""}`.toLowerCase();

      return !team.is_ksw && team.short_name !== "KSW" && !name.includes("คลองสามวา");
    })
    .map(({ id, name, short_name, logo_url }) => ({ id, name, short_name, logo_url }));

  return { members, opponents };
}

export default async function LineupBuilderPage() {
  const { members, opponents } = await getLineupData();

  return <LineupBuilderClient members={members} opponents={opponents} />;
}

"use server";

import { requireAdminSession } from "@/lib/admin-server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export type AcceptanceStatus = "PASS" | "FAIL" | "WARNING";
export type CompetitionAcceptanceResult = { detail: string; status: AcceptanceStatus; testedAt: string };

export type CompetitionAcceptanceCheckId =
  | "league-create" | "league-publish" | "league-fixture" | "league-matchweek" | "league-reschedule" | "league-champion" | "league-complete" | "league-archive"
  | "ksw-qualification" | "ksw-group" | "ksw-knockout" | "ksw-champion" | "ksw-complete"
  | "council-division" | "council-champion-d1" | "council-champion-d2" | "council-complete"
  | "public-home" | "public-detail" | "public-archive" | "public-hidden"
  | "analytics-page-view" | "analytics-competition-view" | "analytics-sponsor-click";

const checkIds = new Set<CompetitionAcceptanceCheckId>([
  "league-create", "league-publish", "league-fixture", "league-matchweek", "league-reschedule", "league-champion", "league-complete", "league-archive",
  "ksw-qualification", "ksw-group", "ksw-knockout", "ksw-champion", "ksw-complete",
  "council-division", "council-champion-d1", "council-champion-d2", "council-complete",
  "public-home", "public-detail", "public-archive", "public-hidden",
  "analytics-page-view", "analytics-competition-view", "analytics-sponsor-click",
]);

function result(status: AcceptanceStatus, detail: string): CompetitionAcceptanceResult {
  return { detail, status, testedAt: new Date().toISOString() };
}

async function countRows(query: PromiseLike<{ count: number | null; error: { code?: string; message: string } | null }>) {
  const response = await query;
  if (response.error) return { count: 0, error: response.error };
  return { count: response.count ?? 0, error: null };
}

function countResult(count: number, existsDetail: string, missingDetail: string, warn = false) {
  return count > 0 ? result("PASS", `${existsDetail} (${count} รายการ)`) : result(warn ? "WARNING" : "FAIL", missingDetail);
}

export async function runCompetitionAcceptanceCheck(checkId: CompetitionAcceptanceCheckId): Promise<CompetitionAcceptanceResult> {
  await requireAdminSession();
  if (!checkIds.has(checkId)) return result("FAIL", "ไม่พบรายการทดสอบที่ร้องขอ");
  const supabase = getSupabaseAdmin();
  if (!supabase) return result("FAIL", "ไม่พบการตั้งค่า Supabase admin สำหรับการตรวจสอบ");

  const leagueBase = () => supabase.from("competition_league_configs").select("competition_id", { count: "exact", head: true }).eq("template_key", "standard_league");
  const cupBase = (templateKey: string) => supabase.from("competition_knockout_configs").select("competition_id", { count: "exact", head: true }).eq("template_key", templateKey);
  const completedCupByTemplate = async (templateKey: string) => {
    const configs = await supabase.from("competition_knockout_configs").select("competition_id").eq("template_key", templateKey);
    if (configs.error) return { count: 0, error: configs.error };
    const ids = (configs.data ?? []).map((config) => config.competition_id).filter(Boolean);
    return ids.length ? countRows(supabase.from("leagues").select("id", { count: "exact", head: true }).in("id", ids).eq("season_status", "completed")) : { count: 0, error: null };
  };
  let checked;
  switch (checkId) {
    case "league-create": checked = await countRows(leagueBase()); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบ Standard League ที่สร้างแล้ว", "ยังไม่พบ Standard League", true);
    case "league-publish": checked = await countRows(supabase.from("leagues").select("id", { count: "exact", head: true }).eq("competition_type", "league").eq("is_published", true)); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบ League ที่เผยแพร่แล้ว", "ยังไม่พบ League ที่เผยแพร่", true);
    case "league-fixture": checked = await countRows(supabase.from("matches").select("id", { count: "exact", head: true }).not("league_fixture_version", "is", null)); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบ Standard League fixtures", "ยังไม่พบ Standard League fixtures", true);
    case "league-matchweek": checked = await countRows(supabase.from("competition_league_matchweeks").select("competition_id", { count: "exact", head: true }).in("status", ["confirmed", "completed"])); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบ Matchweek ที่ยืนยันแล้ว", "ยังไม่พบ Matchweek ที่ยืนยันแล้ว", true);
    case "league-reschedule": checked = await countRows(supabase.from("competition_league_match_reschedules").select("id", { count: "exact", head: true })); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบประวัติการเลื่อนนัด", "ยังไม่มีข้อมูลเลื่อนนัดสำหรับตรวจสอบ", true);
    case "league-champion": checked = await countRows(supabase.from("competition_league_configs").select("competition_id", { count: "exact", head: true }).eq("template_key", "standard_league").not("champion_team_id", "is", null)); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบ Champion League ที่ persist แล้ว", "ยังไม่มี Champion League ที่ persist", true);
    case "league-complete": checked = await countRows(supabase.from("leagues").select("id", { count: "exact", head: true }).eq("competition_type", "league").eq("season_status", "completed")); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบ League ที่ปิดฤดูกาลแล้ว", "ยังไม่มี League ที่ปิดฤดูกาล", true);
    case "league-archive": checked = await countRows(supabase.from("leagues").select("id", { count: "exact", head: true }).eq("competition_type", "league").eq("season_status", "completed").eq("is_published", true)); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบ League Archive ที่เผยแพร่แล้ว", "ยังไม่มี League Archive ที่เผยแพร่", true);
    case "ksw-qualification": checked = await countRows(cupBase("ksw_standard").eq("qualification_status", "approved")); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบ KSW qualification ที่อนุมัติแล้ว", "ยังไม่มี KSW qualification ที่อนุมัติ", true);
    case "ksw-group": checked = await countRows(supabase.from("competition_groups").select("id", { count: "exact", head: true })); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบ Cup groups", "ยังไม่มี Cup groups", true);
    case "ksw-knockout": checked = await countRows(supabase.from("competition_bracket_nodes").select("id", { count: "exact", head: true }).eq("partition_key", "main")); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบ KSW knockout nodes", "ยังไม่มี KSW knockout nodes", true);
    case "ksw-champion": checked = await countRows(supabase.from("competition_knockout_partitions").select("competition_id", { count: "exact", head: true }).eq("partition_key", "main").not("champion_team_id", "is", null)); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบ KSW Champion ที่ persist แล้ว", "ยังไม่มี KSW Champion ที่ persist", true);
    case "ksw-complete": checked = await completedCupByTemplate("ksw_standard"); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบ KSW Cup ที่ปิดการแข่งขันแล้ว", "ยังไม่มี KSW Cup ที่ปิดการแข่งขัน", true);
    case "council-division": checked = await countRows(cupBase("council_two_division")); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบ Council Cup สองดิวิชั่น", "ยังไม่มี Council Cup สำหรับตรวจสอบ", true);
    case "council-champion-d1": checked = await countRows(supabase.from("competition_knockout_partitions").select("competition_id", { count: "exact", head: true }).eq("partition_key", "division_1").not("champion_team_id", "is", null)); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบ Champion Division 1", "ยังไม่มี Champion Division 1", true);
    case "council-champion-d2": checked = await countRows(supabase.from("competition_knockout_partitions").select("competition_id", { count: "exact", head: true }).eq("partition_key", "division_2").not("champion_team_id", "is", null)); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบ Champion Division 2", "ยังไม่มี Champion Division 2", true);
    case "council-complete": checked = await completedCupByTemplate("council_two_division"); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบ Council Cup ที่ปิดการแข่งขันแล้ว", "ยังไม่มี Council Cup ที่ปิดการแข่งขัน", true);
    case "public-home": checked = await countRows(supabase.from("leagues").select("id", { count: "exact", head: true }).eq("is_published", true)); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "Home มีรายการ published ให้แสดง", "ไม่มีรายการ published สำหรับ Home", true);
    case "public-detail": checked = await countRows(supabase.from("leagues").select("id", { count: "exact", head: true }).eq("is_published", true).not("slug", "is", null)); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบ Public detail URLs", "ไม่มี published competition ที่มี slug", true);
    case "public-archive": checked = await countRows(supabase.from("leagues").select("id", { count: "exact", head: true }).eq("is_published", true).eq("season_status", "completed")); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบ Published archive", "ยังไม่มี published completed competition", true);
    case "public-hidden": checked = await countRows(supabase.from("leagues").select("id", { count: "exact", head: true }).eq("is_published", false)); return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, "พบ Hidden competition สำหรับตรวจ guard", "ยังไม่มี Hidden competition สำหรับตรวจ guard", true);
    case "analytics-page-view": case "analytics-competition-view": case "analytics-sponsor-click": {
      const eventType = checkId.replace("analytics-", "").replace(/-/g, "_");
      checked = await countRows(supabase.from("analytics_events").select("id", { count: "exact", head: true }).eq("event_type", eventType));
      if (checked.error?.code === "42P01") return result("WARNING", "ยังไม่ได้ apply migration Analytics");
      return checked.error ? result("FAIL", checked.error.message) : countResult(checked.count, `พบ Analytics event ${eventType}`, `ยังไม่มี Analytics event ${eventType}`, true);
    }
  }
}

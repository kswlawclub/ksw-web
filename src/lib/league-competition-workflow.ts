import { resolveStandardLeagueChampion } from "@/lib/league-template/champion-resolver";
import type { LeagueFixturePlan, StandardLeagueConfig, StandardLeagueMatchweek } from "@/lib/league-template/types";
import type { StandardLeagueMatch, StandardLeagueStanding } from "@/lib/league-template/standings";

export type LeagueCompetitionWorkflowStep = {
  description: string;
  id: "teams" | "settings" | "preview" | "confirm" | "matchweeks" | "matches" | "standings" | "champion" | "completed";
  label: string;
  state: "complete" | "current" | "locked" | "upcoming";
};

export type LeagueMatchweekSummary = Record<StandardLeagueMatchweek["status"], number> & {
  total: number;
};

export type LeagueCompetitionWorkflowInput = {
  competitionStatus: string | null;
  config: StandardLeagueConfig | null;
  matches: StandardLeagueMatch[];
  matchweeks: StandardLeagueMatchweek[];
  plan: LeagueFixturePlan | null;
  standings: StandardLeagueStanding[];
  teamCount: number;
};

export function calculateLeagueMatchweekSummary(matchweeks: StandardLeagueMatchweek[]): LeagueMatchweekSummary {
  const summary: LeagueMatchweekSummary = { completed: 0, confirmed: 0, draft: 0, total: matchweeks.length, unconfigured: 0 };
  matchweeks.forEach((matchweek) => { summary[matchweek.status] += 1; });
  return summary;
}

export function calculateLeagueCompetitionWorkflow(input: LeagueCompetitionWorkflowInput) {
  const fixturesConfirmed = input.config?.fixtureStatus === "confirmed";
  const expectedFixtureCount = input.plan?.summary.fixtureCount ?? input.matches.length;
  const champion = input.config
    ? resolveStandardLeagueChampion({ config: input.config, expectedFixtureCount, matches: input.matches, standings: input.standings })
    : { status: "pending" as const, reason: "ยังไม่ได้ตั้งค่าลีก" };
  const matchesComplete = champion.status === "champion" || champion.status === "needs_admin_resolution";
  const matchweekSummary = calculateLeagueMatchweekSummary(input.matchweeks);
  const matchweeksComplete = fixturesConfirmed && matchweekSummary.total > 0 && matchweekSummary.unconfigured === 0 && matchweekSummary.draft === 0;
  const completed = input.competitionStatus === "completed";
  const definitions = [
    { complete: input.teamCount >= 2, description: "เพิ่มทีมที่จะเข้าร่วมการแข่งขัน", id: "teams" as const, label: "ทีมที่เข้าแข่งขัน" },
    { complete: Boolean(input.config), description: "กำหนดจำนวนเลกและกติกาคะแนน", id: "settings" as const, label: "ตั้งค่าลีก" },
    { complete: fixturesConfirmed, description: "ตรวจสอบคู่แข่งขันที่ระบบคำนวณ", id: "preview" as const, label: "ตรวจสอบโปรแกรม" },
    { complete: fixturesConfirmed, description: "ยืนยันคู่แข่งขันและ Matchweek ทั้งฤดูกาล", id: "confirm" as const, label: "ยืนยันโครงสร้าง" },
    { complete: Boolean(matchweeksComplete), description: "กำหนดและยืนยันวัน เวลา สนามราย Matchweek", id: "matchweeks" as const, label: "จัดการโปรแกรมราย Matchweek" },
    { complete: matchesComplete, description: "บันทึกผลการแข่งขันให้ครบทุกคู่", id: "matches" as const, label: "แข่งขันและบันทึกผล" },
    { complete: matchesComplete, description: "คำนวณตารางคะแนนจากผลที่ยืนยันแล้ว", id: "standings" as const, label: "ตารางคะแนน" },
    { complete: input.config?.championTeamId !== null && input.config?.championTeamId !== undefined, description: "ประกาศแชมป์จากตารางคะแนน", id: "champion" as const, label: "Champion" },
    { complete: completed, description: "ตรวจสอบผลและปิดฤดูกาล", id: "completed" as const, label: "Completed" },
  ];
  const currentIndex = definitions.findIndex((step) => !step.complete);
  return definitions.map((step, index): LeagueCompetitionWorkflowStep => ({
    ...step,
    state: completed || step.complete ? "complete" : index === currentIndex ? "current" : index === currentIndex + 1 ? "upcoming" : "locked",
  }));
}

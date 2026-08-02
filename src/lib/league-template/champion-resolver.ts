import type { LeagueChampionResolution, LeagueStandingCandidate, StandardLeagueConfig } from "./types";

type ConfirmedLeagueMatch = {
  awayScore: number | null;
  fixtureKey: string | null;
  homeScore: number | null;
  status: string;
};

function compareSportingRules(left: LeagueStandingCandidate, right: LeagueStandingCandidate) {
  return right.points - left.points
    || right.goalDifference - left.goalDifference
    || right.goalsFor - left.goalsFor
    || right.wins - left.wins;
}

export function resolveStandardLeagueChampion(input: {
  config: Pick<StandardLeagueConfig, "fixtureStatus" | "fixtureVersion">;
  expectedFixtureCount: number;
  matches: ConfirmedLeagueMatch[];
  standings: LeagueStandingCandidate[];
}): LeagueChampionResolution {
  if (input.config.fixtureStatus !== "confirmed" || input.config.fixtureVersion < 1 || input.expectedFixtureCount < 1) {
    return { reason: "ยังไม่ได้ยืนยันโปรแกรมการแข่งขัน", status: "invalid_fixture_set" };
  }
  if (input.matches.length !== input.expectedFixtureCount || new Set(input.matches.map((match) => match.fixtureKey).filter(Boolean)).size !== input.expectedFixtureCount) {
    return { reason: "จำนวนหรือรหัสโปรแกรมการแข่งขันไม่ตรงกับชุดที่ยืนยัน", status: "invalid_fixture_set" };
  }
  if (input.matches.some((match) => !["finished", "completed"].includes(match.status) || match.homeScore === null || match.awayScore === null)) {
    return { reason: "รอผลการแข่งขันให้ครบทุกคู่", status: "pending" };
  }
  if (!input.standings.length) return { reason: "ยังไม่มีตารางคะแนน", status: "pending" };

  const ranked = [...input.standings].sort(compareSportingRules);
  const leader = ranked[0];
  const runnerUp = ranked[1];
  if (!leader) return { reason: "ยังไม่มีอันดับหนึ่ง", status: "pending" };
  if (runnerUp && compareSportingRules(leader, runnerUp) === 0) {
    return { candidateTeamIds: ranked.filter((team) => compareSportingRules(leader, team) === 0).map((team) => team.teamId), reason: "อันดับหนึ่งยังเสมอในเกณฑ์ที่ระบบรองรับ ต้องให้ผู้จัดตัดสิน", status: "needs_admin_resolution" };
  }
  return { championTeamId: leader.teamId, status: "champion" };
}

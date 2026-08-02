import type { LeagueStandingsPolicy, LeagueStandingsPolicyKey } from "./types";

export const leagueStandingsPolicies: Record<LeagueStandingsPolicyKey, LeagueStandingsPolicy> = {
  legacy_season6: {
    key: "legacy_season6",
    label: "Thai Lawyers League Season 6 (Legacy)",
    rules: [
      { key: "points", label: "คะแนน", support: "supported" },
      { key: "goal_difference", label: "ผลต่างประตู", support: "supported" },
      { key: "goals_for", label: "ประตูได้", support: "supported" },
      { key: "team_name", label: "ชื่อทีม (ลำดับเทคนิค)", support: "technical_fallback" },
    ],
    version: 1,
  },
  standard_league_v1: {
    key: "standard_league_v1",
    label: "ลีกมาตรฐาน v1",
    rules: [
      { key: "points", label: "คะแนน", support: "supported" },
      { key: "goal_difference", label: "ผลต่างประตู", support: "supported" },
      { key: "goals_for", label: "ประตูได้", support: "supported" },
      { key: "wins", label: "จำนวนชนะ", support: "supported" },
      { key: "head_to_head", label: "ผลการพบกัน", support: "deferred" },
      { key: "fair_play", label: "แฟร์เพลย์", support: "deferred" },
      { key: "admin_decision", label: "คำตัดสินผู้จัด / จับสลาก", support: "deferred" },
    ],
    version: 1,
  },
};

export function getLeagueStandingsPolicy(key: string | null | undefined) {
  return key === "legacy_season6" || key === "standard_league_v1"
    ? leagueStandingsPolicies[key]
    : null;
}

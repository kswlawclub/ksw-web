import type { Row } from "@/lib/competition-data";
import type { CupGroupStanding } from "@/lib/cup-group-standings";

export type PublicGroupStageStatus = "complete" | "in_progress" | "not_started";

export type PublicGroupStageGroup = {
  id: string;
  leaderName: string | null;
  matches: Row[];
  playedMatches: number;
  qualifiedTeams: number;
  standing: CupGroupStanding;
  status: PublicGroupStageStatus;
  totalMatches: number;
};

function value(row: Row, keys: string[]) {
  for (const key of keys) {
    const candidate = row[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (typeof candidate === "number") return String(candidate);
  }
  return "";
}

function sortMatches(left: Row, right: Row) {
  const leftDate = value(left, ["match_date", "date", "kickoff_at"]);
  const rightDate = value(right, ["match_date", "date", "kickoff_at"]);
  const leftTime = leftDate ? new Date(leftDate).getTime() : Number.NaN;
  const rightTime = rightDate ? new Date(rightDate).getTime() : Number.NaN;
  const leftValid = Number.isFinite(leftTime);
  const rightValid = Number.isFinite(rightTime);
  if (leftValid && rightValid && leftTime !== rightTime) return leftTime - rightTime;
  if (leftValid !== rightValid) return leftValid ? -1 : 1;
  return value(left, ["id"]).localeCompare(value(right, ["id"]));
}

function groupStatus(standing: CupGroupStanding): PublicGroupStageStatus {
  if (standing.is_complete || (standing.total_required_matches > 0 && standing.finished_matches >= standing.total_required_matches)) return "complete";
  if (standing.finished_matches > 0) return "in_progress";
  return "not_started";
}

export function derivePublicGroupStagePresentation({ matches, standings }: { matches: Row[]; standings: CupGroupStanding[] }) {
  const matchesByGroup = new Map<string, Row[]>();
  matches.forEach((match) => {
    const groupId = value(match, ["group_id"]);
    if (!groupId) return;
    matchesByGroup.set(groupId, [...(matchesByGroup.get(groupId) ?? []), match]);
  });

  const groups: PublicGroupStageGroup[] = standings
    .filter((standing) => standing.team_count > 0)
    .sort((left, right) => left.sort_order - right.sort_order || left.group_label.localeCompare(right.group_label))
    .map((standing) => ({
      id: standing.group_id,
      leaderName: standing.finished_matches > 0 ? standing.rows[0]?.team_name ?? null : null,
      matches: [...(matchesByGroup.get(standing.group_id) ?? [])].sort(sortMatches),
      playedMatches: standing.finished_matches,
      qualifiedTeams: standing.rows.filter((row) => row.qualifies).length,
      standing,
      status: groupStatus(standing),
      totalMatches: standing.total_required_matches,
    }));

  return {
    groups,
    qualifiedTeams: groups.reduce((total, group) => total + group.qualifiedTeams, 0),
    totalMatches: groups.reduce((total, group) => total + group.totalMatches, 0),
    totalPlayedMatches: groups.reduce((total, group) => total + group.playedMatches, 0),
  };
}

export function togglePublicGroupStageGroup(openGroupIds: string[], groupId: string) {
  return openGroupIds.includes(groupId)
    ? openGroupIds.filter((id) => id !== groupId)
    : [...openGroupIds, groupId];
}

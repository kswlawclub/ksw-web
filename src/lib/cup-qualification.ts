import { calculateCupGroupStandings, type CupGroupRow, type CupGroupStandingRow } from "@/lib/cup-group-standings";

export type CupQualificationSettings = {
  extraQualifierCount: number;
  extraRank: number | null;
  extraRankEnabled: boolean;
};

export type CupQualificationEntry = {
  bestOrder: number | null;
  groupId: string;
  label: string;
  rank: number;
  teamId: string;
  teamName: string;
  temporary: boolean;
  type: "best_ranked" | "group_rank";
};

function text(row: CupGroupRow, key: string) {
  return typeof row[key] === "string" ? row[key] as string : "";
}

function compareCrossGroup(a: CupGroupStandingRow, b: CupGroupStandingRow, uneven: boolean) {
  const aPlayed = Math.max(a.played, 1);
  const bPlayed = Math.max(b.played, 1);
  const values = uneven
    ? [b.points / bPlayed - a.points / aPlayed, b.goal_difference / bPlayed - a.goal_difference / aPlayed, b.goals_for / bPlayed - a.goals_for / aPlayed, b.won / bPlayed - a.won / aPlayed]
    : [b.points - a.points, b.goal_difference - a.goal_difference, b.goals_for - a.goals_for, b.won - a.won];
  const difference = values.find((value) => value !== 0);
  if (difference !== undefined) return difference;
  return a.team_name.localeCompare(b.team_name) || a.team_id.localeCompare(b.team_id);
}

export function calculateCupQualification({
  groups,
  matches,
  settings,
  teams,
}: {
  groups: CupGroupRow[];
  matches: CupGroupRow[];
  settings: CupQualificationSettings;
  teams: CupGroupRow[];
}) {
  const standings = calculateCupGroupStandings({ groups, matches, teams });
  const completion = new Map(standings.map((standing) => {
    const fixtures = matches.filter((match) => text(match, "competition_stage") === "group" && text(match, "group_id") === standing.group_id);
    const complete = fixtures.length === standing.total_required_matches && fixtures.every((match) => text(match, "status") === "finished" && typeof match.home_score === "number" && typeof match.away_score === "number");
    return [standing.group_id, complete];
  }));
  const confirmed = standings.flatMap((standing) => completion.get(standing.group_id) ? standing.rows.slice(0, standing.qualifiers_count).map((row) => ({ bestOrder: null, groupId: standing.group_id, label: `${standing.group_name}${row.position}`, rank: row.position, teamId: row.team_id, teamName: row.team_name, temporary: false, type: "group_rank" as const })) : []);
  const extraCandidates = settings.extraRankEnabled && settings.extraRank
    ? standings.flatMap((standing) => standing.rows.filter((row) => row.position === settings.extraRank).map((row) => ({ groupId: standing.group_id, row })))
    : [];
  const allExtraGroupsComplete = extraCandidates.length > 0 && extraCandidates.every((candidate) => completion.get(candidate.groupId));
  const uneven = new Set(standings.map((standing) => standing.team_count)).size > 1;
  const bestRanked = extraCandidates.sort((a, b) => compareCrossGroup(a.row, b.row, uneven)).slice(0, settings.extraQualifierCount).map((candidate, index) => ({ bestOrder: index + 1, groupId: candidate.groupId, label: `อันดับ ${settings.extraRank} ดีที่สุด #${index + 1}`, rank: settings.extraRank!, teamId: candidate.row.team_id, teamName: candidate.row.team_name, temporary: !allExtraGroupsComplete, type: "best_ranked" as const }));
  return {
    confirmed: [...confirmed, ...(allExtraGroupsComplete ? bestRanked : [])],
    groupComplete: completion,
    preview: [...confirmed, ...bestRanked],
    standings,
    unevenGroups: uneven,
  };
}

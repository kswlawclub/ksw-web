export type CupGroupRow = Record<string, unknown>;

export type CupGroupStandingRow = {
  drawn: number;
  goal_difference: number;
  goals_against: number;
  goals_for: number;
  is_ksw: boolean;
  lost: number;
  played: number;
  points: number;
  position: number;
  qualifies: boolean;
  short_name: string | null;
  team_id: string;
  team_name: string;
  tie_unresolved: boolean;
  won: number;
};

export type CupGroupStanding = {
  finished_matches: number;
  group_id: string;
  group_label: string;
  group_name: string;
  is_complete: boolean;
  qualifiers_count: number;
  rows: CupGroupStandingRow[];
  sort_order: number;
  team_count: number;
  total_required_matches: number;
};

type HeadToHeadStats = {
  goals_against: number;
  goals_for: number;
  points: number;
};

type RankedRows = {
  rows: CupGroupStandingRow[];
  unresolvedTeamIds: Set<string>;
};

function text(row: CupGroupRow | undefined, key: string, fallback = "") {
  const value = row?.[key];
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function number(row: CupGroupRow | undefined, key: string, fallback = 0) {
  const value = row?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  return fallback;
}

function groupDisplayName(group: CupGroupRow) {
  return text(group, "label") || `Group ${text(group, "name", "Group")}`;
}

function sortGroupRows(groups: CupGroupRow[]) {
  return [...groups].sort((a, b) => {
    const orderDiff = number(a, "sort_order") - number(b, "sort_order");
    if (orderDiff) return orderDiff;
    return text(a, "name").localeCompare(text(b, "name"));
  });
}

function sortByOverallWithoutPoints(rows: CupGroupStandingRow[]) {
  return [...rows].sort((a, b) => {
    const goalDiff = b.goal_difference - a.goal_difference;
    if (goalDiff) return goalDiff;

    const goalsForDiff = b.goals_for - a.goals_for;
    if (goalsForDiff) return goalsForDiff;

    const winsDiff = b.won - a.won;
    if (winsDiff) return winsDiff;

    return a.team_name.localeCompare(b.team_name);
  });
}

function overallTieKey(row: CupGroupStandingRow) {
  return [row.goal_difference, row.goals_for, row.won].join(":");
}

function headToHeadTieKey(stats: HeadToHeadStats) {
  return [stats.points, stats.goals_for - stats.goals_against, stats.goals_for].join(":");
}

function groupByKey<T>(items: T[], keyForItem: (item: T) => string) {
  const groups: T[][] = [];
  const groupByKeyValue = new Map<string, T[]>();

  items.forEach((item) => {
    const key = keyForItem(item);
    const group = groupByKeyValue.get(key) ?? [];
    group.push(item);
    groupByKeyValue.set(key, group);
  });

  groupByKeyValue.forEach((group) => groups.push(group));
  return groups;
}

function isFinishedGroupMatch(match: CupGroupRow, groupId: string) {
  return (
    text(match, "competition_stage") === "group" &&
    text(match, "group_id") === groupId &&
    text(match, "status") === "finished" &&
    typeof match.home_score === "number" &&
    typeof match.away_score === "number"
  );
}

function buildHeadToHeadStats(rows: CupGroupStandingRow[], matches: CupGroupRow[]) {
  const teamIds = new Set(rows.map((row) => row.team_id));
  const stats = new Map<string, HeadToHeadStats>();

  rows.forEach((row) => {
    stats.set(row.team_id, {
      goals_against: 0,
      goals_for: 0,
      points: 0,
    });
  });

  matches.forEach((match) => {
    const homeTeamId = text(match, "home_team_id");
    const awayTeamId = text(match, "away_team_id");
    const homeScore = match.home_score as number;
    const awayScore = match.away_score as number;

    if (!teamIds.has(homeTeamId) || !teamIds.has(awayTeamId)) return;

    const home = stats.get(homeTeamId);
    const away = stats.get(awayTeamId);
    if (!home || !away) return;

    home.goals_for += homeScore;
    home.goals_against += awayScore;
    away.goals_for += awayScore;
    away.goals_against += homeScore;

    if (homeScore > awayScore) {
      home.points += 3;
    } else if (homeScore < awayScore) {
      away.points += 3;
    } else {
      home.points += 1;
      away.points += 1;
    }
  });

  return stats;
}

function resolveTiedRows(rows: CupGroupStandingRow[], matches: CupGroupRow[]): RankedRows {
  if (rows.length <= 1) {
    return { rows, unresolvedTeamIds: new Set<string>() };
  }

  const headToHeadStats = buildHeadToHeadStats(rows, matches);
  const sortedByHeadToHead = [...rows].sort((a, b) => {
    const aStats = headToHeadStats.get(a.team_id) ?? { goals_against: 0, goals_for: 0, points: 0 };
    const bStats = headToHeadStats.get(b.team_id) ?? { goals_against: 0, goals_for: 0, points: 0 };
    const pointsDiff = bStats.points - aStats.points;
    if (pointsDiff) return pointsDiff;

    const goalDiff = (bStats.goals_for - bStats.goals_against) - (aStats.goals_for - aStats.goals_against);
    if (goalDiff) return goalDiff;

    const goalsForDiff = bStats.goals_for - aStats.goals_for;
    if (goalsForDiff) return goalsForDiff;

    return a.team_name.localeCompare(b.team_name);
  });
  const headToHeadGroups = groupByKey(sortedByHeadToHead, (row) =>
    headToHeadTieKey(headToHeadStats.get(row.team_id) ?? { goals_against: 0, goals_for: 0, points: 0 }),
  );

  if (headToHeadGroups.length > 1) {
    const rankedRows: CupGroupStandingRow[] = [];
    const unresolvedTeamIds = new Set<string>();

    headToHeadGroups.forEach((group) => {
      const result = resolveTiedRows(group, matches);
      rankedRows.push(...result.rows);
      result.unresolvedTeamIds.forEach((teamId) => unresolvedTeamIds.add(teamId));
    });

    return { rows: rankedRows, unresolvedTeamIds };
  }

  const sortedByOverall = sortByOverallWithoutPoints(rows);
  const unresolvedTeamIds = new Set<string>();

  groupByKey(sortedByOverall, overallTieKey).forEach((group) => {
    if (group.length > 1) {
      group.forEach((row) => unresolvedTeamIds.add(row.team_id));
    }
  });

  return { rows: sortedByOverall, unresolvedTeamIds };
}

function rankStandingRows(rows: CupGroupStandingRow[], matches: CupGroupRow[]) {
  const sortedByPoints = [...rows].sort((a, b) => {
    const pointsDiff = b.points - a.points;
    if (pointsDiff) return pointsDiff;
    return a.team_name.localeCompare(b.team_name);
  });
  const rankedRows: CupGroupStandingRow[] = [];
  const unresolvedTeamIds = new Set<string>();

  groupByKey(sortedByPoints, (row) => String(row.points)).forEach((group) => {
    if (group.length === 1) {
      rankedRows.push(group[0]);
      return;
    }

    const result = resolveTiedRows(group, matches);
    rankedRows.push(...result.rows);
    result.unresolvedTeamIds.forEach((teamId) => unresolvedTeamIds.add(teamId));
  });

  return { rankedRows, unresolvedTeamIds };
}

export function calculateCupGroupStandings({
  groups,
  matches,
  teams,
}: {
  groups: CupGroupRow[];
  matches: CupGroupRow[];
  teams: CupGroupRow[];
}): CupGroupStanding[] {
  const teamsByGroup = new Map<string, CupGroupRow[]>();

  teams.forEach((team) => {
    const groupId = text(team, "group_id");
    if (!groupId || team.is_active === false) return;
    teamsByGroup.set(groupId, [...(teamsByGroup.get(groupId) ?? []), team]);
  });

  return sortGroupRows(groups).map((group) => {
    const groupId = text(group, "id");
    const groupTeams = [...(teamsByGroup.get(groupId) ?? [])].sort((a, b) => {
      const orderDiff = number(a, "display_order") - number(b, "display_order");
      if (orderDiff) return orderDiff;
      return text(a, "name", text(a, "team_name")).localeCompare(text(b, "name", text(b, "team_name")));
    });
    const groupTeamIds = new Set(groupTeams.map((team) => text(team, "team_id", text(team, "id"))).filter(Boolean));
    const rowsByTeamId = new Map<string, CupGroupStandingRow>();

    groupTeams.forEach((team) => {
      const teamId = text(team, "team_id", text(team, "id"));
      if (!teamId) return;
      rowsByTeamId.set(teamId, {
        drawn: 0,
        goal_difference: 0,
        goals_against: 0,
        goals_for: 0,
        is_ksw: team.is_ksw === true,
        lost: 0,
        played: 0,
        points: 0,
        position: 0,
        qualifies: false,
        short_name: text(team, "short_name") || null,
        team_id: teamId,
        team_name: text(team, "name", text(team, "team_name", "Team unavailable")),
        tie_unresolved: false,
        won: 0,
      });
    });

    const finishedMatches = matches.filter((match) => {
      const homeTeamId = text(match, "home_team_id");
      const awayTeamId = text(match, "away_team_id");
      return isFinishedGroupMatch(match, groupId) && groupTeamIds.has(homeTeamId) && groupTeamIds.has(awayTeamId);
    });

    finishedMatches.forEach((match) => {
      const homeTeamId = text(match, "home_team_id");
      const awayTeamId = text(match, "away_team_id");
      const home = rowsByTeamId.get(homeTeamId);
      const away = rowsByTeamId.get(awayTeamId);
      const homeScore = match.home_score as number;
      const awayScore = match.away_score as number;

      if (!home || !away) return;

      home.played += 1;
      away.played += 1;
      home.goals_for += homeScore;
      home.goals_against += awayScore;
      away.goals_for += awayScore;
      away.goals_against += homeScore;

      if (homeScore > awayScore) {
        home.won += 1;
        home.points += 3;
        away.lost += 1;
      } else if (homeScore < awayScore) {
        away.won += 1;
        away.points += 3;
        home.lost += 1;
      } else {
        home.drawn += 1;
        away.drawn += 1;
        home.points += 1;
        away.points += 1;
      }

      home.goal_difference = home.goals_for - home.goals_against;
      away.goal_difference = away.goals_for - away.goals_against;
    });

    const ranking = rankStandingRows(Array.from(rowsByTeamId.values()), finishedMatches);
    const sortedRows = ranking.rankedRows.map((row, index) => ({
      ...row,
      position: index + 1,
      qualifies: index < number(group, "qualifiers_count", 2),
    }));

    return {
      finished_matches: finishedMatches.length,
      group_id: groupId,
      group_label: groupDisplayName(group),
      group_name: text(group, "name"),
      is_complete: finishedMatches.length >= (groupTeams.length * (groupTeams.length - 1)) / 2,
      qualifiers_count: number(group, "qualifiers_count", 2),
      rows: sortedRows.map((row) => ({
        ...row,
        tie_unresolved: ranking.unresolvedTeamIds.has(row.team_id),
      })),
      sort_order: number(group, "sort_order"),
      team_count: groupTeams.length,
      total_required_matches: (groupTeams.length * (groupTeams.length - 1)) / 2,
    };
  });
}

import { compareTeamsByName, type NamedTeam } from "@/lib/team-sort";
import type { LeagueStandingCandidate, StandardLeagueConfig } from "./types";

export type StandardLeagueMatch = {
  awayScore: number | null;
  awayTeamId: string;
  fixtureKey: string | null;
  homeScore: number | null;
  homeTeamId: string;
  status: string;
};

export type StandardLeagueStanding = LeagueStandingCandidate & {
  draws: number;
  goalsAgainst: number;
  played: number;
  teamName: string;
  losses: number;
};

function compareSporting(left: StandardLeagueStanding, right: StandardLeagueStanding) {
  return right.points - left.points
    || right.goalDifference - left.goalDifference
    || right.goalsFor - left.goalsFor
    || right.wins - left.wins;
}

export function calculateStandardLeagueStandings(input: {
  config: Pick<StandardLeagueConfig, "drawPoints" | "lossPoints" | "winPoints">;
  matches: StandardLeagueMatch[];
  teams: NamedTeam[];
}) {
  const standings = new Map(input.teams.map((team) => [team.id, {
    draws: 0,
    goalDifference: 0,
    goalsAgainst: 0,
    goalsFor: 0,
    losses: 0,
    played: 0,
    points: 0,
    teamId: team.id,
    teamName: team.name,
    wins: 0,
  }]));

  input.matches.forEach((match) => {
    if (!["finished", "completed"].includes(match.status) || match.homeScore === null || match.awayScore === null) return;
    const home = standings.get(match.homeTeamId);
    const away = standings.get(match.awayTeamId);
    if (!home || !away) return;
    home.played += 1;
    away.played += 1;
    home.goalsFor += match.homeScore;
    home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore;
    away.goalsAgainst += match.homeScore;
    if (match.homeScore > match.awayScore) {
      home.wins += 1;
      home.points += input.config.winPoints;
      away.losses += 1;
      away.points += input.config.lossPoints;
    } else if (match.homeScore < match.awayScore) {
      away.wins += 1;
      away.points += input.config.winPoints;
      home.losses += 1;
      home.points += input.config.lossPoints;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += input.config.drawPoints;
      away.points += input.config.drawPoints;
    }
  });

  const rows = Array.from(standings.values()).map((row) => ({ ...row, goalDifference: row.goalsFor - row.goalsAgainst }));
  const sorted = rows.sort((left, right) => compareSporting(left, right) || compareTeamsByName({ id: left.teamId, name: left.teamName }, { id: right.teamId, name: right.teamName }));
  const requiresAdminResolution = sorted.length > 1 && compareSporting(sorted[0], sorted[1]) === 0;
  return { requiresAdminResolution, rows: sorted };
}

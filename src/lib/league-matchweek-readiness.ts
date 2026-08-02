export type LeagueScheduleMatch = { matchDate: string | null; venue: string | null };

export type LeagueMatchweekReadiness = {
  incompleteMatches: number;
  matchesWithDateTime: number;
  matchesWithVenue: number;
  readyMatches: number;
  totalMatches: number;
};

export function calculateLeagueMatchweekReadiness(matches: LeagueScheduleMatch[]): LeagueMatchweekReadiness {
  const matchesWithDateTime = matches.filter((match) => Boolean(match.matchDate)).length;
  const matchesWithVenue = matches.filter((match) => Boolean(match.venue?.trim())).length;
  const readyMatches = matches.filter((match) => Boolean(match.matchDate) && Boolean(match.venue?.trim())).length;
  return { incompleteMatches: matches.length - readyMatches, matchesWithDateTime, matchesWithVenue, readyMatches, totalMatches: matches.length };
}

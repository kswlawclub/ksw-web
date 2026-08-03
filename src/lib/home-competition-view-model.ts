export type HomeFeatureMatch = { competitionId: string; matchDate: string | null; status: string };

function isFinished(status: string) {
  return ["finished", "completed"].includes(status.toLowerCase());
}

export function featuredCompetitionMatches(matches: HomeFeatureMatch[], competitionId: string, now = Date.now()) {
  const featured = matches.filter((match) => match.competitionId === competitionId);
  return {
    fixtures: featured
      .filter((match) => !isFinished(match.status) && Boolean(match.matchDate) && new Date(match.matchDate as string).getTime() >= now)
      .sort((a, b) => new Date(a.matchDate as string).getTime() - new Date(b.matchDate as string).getTime())
      .slice(0, 4),
    results: featured
      .filter((match) => isFinished(match.status))
      .sort((a, b) => new Date(b.matchDate ?? 0).getTime() - new Date(a.matchDate ?? 0).getTime())
      .slice(0, 4),
  };
}

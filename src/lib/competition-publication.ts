export type CompetitionPublicationRow = { competition_type?: unknown; is_published?: unknown; season_status?: unknown };

export function isPublicCompetition(row: CompetitionPublicationRow) {
  return row.is_published === true;
}

export function publicCompetitionBucket(row: CompetitionPublicationRow) {
  if (!isPublicCompetition(row)) return "hidden" as const;
  if (row.season_status === "completed" && row.competition_type === "cup") return "cup_archive" as const;
  if (row.competition_type === "league") return "league" as const;
  return row.season_status === "completed" ? "archive" as const : "current" as const;
}

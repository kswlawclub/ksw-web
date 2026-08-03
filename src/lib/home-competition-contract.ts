export type HomeCompetitionFixture = {
  id: string;
  linkedNodeId: string | null;
  penaltyAwayScore: number | null;
  penaltyHomeScore: number | null;
  partitionLabel: string | null;
  scheduledMatchweek: number | null;
  status: string;
};

export function effectiveHomeMatchweek(fixture: HomeCompetitionFixture & { originalMatchweek: number | null }) {
  return fixture.scheduledMatchweek ?? fixture.originalMatchweek;
}

export function isPublishedHomeCompetition(row: { isPublished: boolean }) {
  return row.isPublished;
}

export function isHomeFinishedFixture(status: string) {
  return ["finished", "completed"].includes(status.toLowerCase());
}

export function homeFixturePartitionLabel(partitionKey: string | null) {
  if (partitionKey === "division_1") return "Division 1";
  if (partitionKey === "division_2") return "Division 2";
  return null;
}

export function dedupeHomeFixtures<T extends { id: string }>(fixtures: T[]) {
  return Array.from(new Map(fixtures.map((fixture) => [fixture.id, fixture])).values());
}

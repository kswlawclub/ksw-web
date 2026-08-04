import assert from "node:assert/strict";
import test from "node:test";
import { groupChronicleEntries, isChronicleCompetition, mapChronicleViewModel } from "./chronicle-view-model.ts";

function source(overrides: Partial<Parameters<typeof mapChronicleViewModel>[0]> = {}) {
  return {
    competitionId: "competition-1",
    completedMatchCount: 6,
    matchCount: 6,
    name: "KSW Competition",
    slug: "ksw-competition",
    teamCount: 4,
    templateKey: "generic" as const,
    type: "tournament",
    ...overrides,
  };
}

test("Chronicle only maps the completed, published loader input and uses end date before start and created dates", () => {
  assert.equal(isChronicleCompetition({ isPublished: true, seasonStatus: "completed" }), true);
  assert.equal(isChronicleCompetition({ isPublished: false, seasonStatus: "completed" }), false);
  assert.equal(isChronicleCompetition({ isPublished: true, seasonStatus: "active" }), false);
  const viewModel = mapChronicleViewModel(source({ createdAt: "2025-01-01T00:00:00Z", endDate: "2026-02-02T00:00:00Z", startDate: "2026-01-01T00:00:00Z" }));
  assert.equal(viewModel.sortDate, "2026-02-02T00:00:00Z");
  assert.equal(viewModel.yearLabel, "พ.ศ. 2569");
});

test("Chronicle groups newest first with unknown seasons last and preserves display order", () => {
  const groups = groupChronicleEntries([
    mapChronicleViewModel(source({ competitionId: "old", endDate: "2025-12-30T00:00:00Z", name: "Old" })),
    mapChronicleViewModel(source({ competitionId: "unknown", name: "Unknown" })),
    mapChronicleViewModel(source({ competitionId: "first", displayOrder: 1, endDate: "2026-12-30T00:00:00Z", name: "Later" })),
    mapChronicleViewModel(source({ competitionId: "second", displayOrder: 2, endDate: "2026-12-31T00:00:00Z", name: "Earlier order" })),
  ]);
  assert.deepEqual(groups.map((group) => group.yearLabel), ["พ.ศ. 2569", "พ.ศ. 2568", "ไม่ระบุฤดูกาล"]);
  assert.deepEqual(groups[0]?.entries.map((entry) => entry.competitionId), ["first", "second"]);
});

test("Chronicle keeps persisted Standard League, KSW, and Council champions explicit", () => {
  const league = mapChronicleViewModel(source({ champion: "League Champion", templateKey: "standard_league", type: "league" }));
  const ksw = mapChronicleViewModel(source({ champion: "Cup Champion", templateKey: "ksw_standard", type: "cup" }));
  const council = mapChronicleViewModel(source({ councilChampions: { division1: "D1 Champion", division2: "D2 Champion" }, templateKey: "council_two_division", type: "cup" }));
  assert.equal(league.champion, "League Champion");
  assert.equal(ksw.champion, "Cup Champion");
  assert.deepEqual(council.councilChampions, { division1: "D1 Champion", division2: "D2 Champion" });
});

test("Chronicle warns about missing persisted champions without inventing a winner and keeps generic fallbacks usable", () => {
  assert.equal(mapChronicleViewModel(source({ templateKey: "standard_league", type: "league" })).warning, "ผลสรุปกำลังจัดเตรียม");
  assert.equal(mapChronicleViewModel(source({ councilChampions: { division1: "D1", division2: null }, templateKey: "council_two_division", type: "cup" })).warning, "ผลสรุปกำลังจัดเตรียม");
  assert.equal(mapChronicleViewModel(source()).warning, null);
});

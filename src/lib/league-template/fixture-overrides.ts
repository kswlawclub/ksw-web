import type { LeagueFixtureDraft, LeagueFixturePlan } from "./types";

export type LeagueFixtureOverride = {
  awayTeamId: string;
  fixtureKey: string;
  homeTeamId: string;
  matchDate: string | null;
  venue: string | null;
};

function cleanText(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

export function validateLeagueFixtureOverrides(plan: LeagueFixturePlan, overrides: LeagueFixtureOverride[]) {
  const byKey = new Map(plan.fixtures.map((fixture) => [fixture.fixtureKey, fixture]));
  const seen = new Set<string>();
  const normalized: LeagueFixtureOverride[] = [];
  for (const override of overrides) {
    const fixture = byKey.get(override.fixtureKey);
    if (!fixture) return { error: "พบรายการแก้ไขที่ไม่อยู่ในโปรแกรมที่ระบบสร้าง", overrides: [] as LeagueFixtureOverride[] };
    if (seen.has(override.fixtureKey)) return { error: "พบรายการแก้ไขซ้ำสำหรับคู่แข่งขันเดียวกัน", overrides: [] as LeagueFixtureOverride[] };
    seen.add(override.fixtureKey);
    const sameOrder = fixture.homeTeamId === override.homeTeamId && fixture.awayTeamId === override.awayTeamId;
    const swappedOrder = fixture.homeTeamId === override.awayTeamId && fixture.awayTeamId === override.homeTeamId;
    if (!sameOrder && !swappedOrder) return { error: "การแก้ไขเปลี่ยนคู่แข่งขัน ซึ่งระบบไม่อนุญาต", overrides: [] as LeagueFixtureOverride[] };
    const matchDate = cleanText(override.matchDate);
    if (matchDate && Number.isNaN(new Date(matchDate).getTime())) return { error: "วันและเวลาแข่งขันไม่ถูกต้อง", overrides: [] as LeagueFixtureOverride[] };
    normalized.push({ ...override, matchDate, venue: cleanText(override.venue) });
  }
  return { error: "", overrides: normalized };
}

export function applyLeagueFixtureOverrides(plan: LeagueFixturePlan, overrides: LeagueFixtureOverride[]) {
  const validated = validateLeagueFixtureOverrides(plan, overrides);
  if (validated.error) return { error: validated.error, fixtures: [] as LeagueFixtureDraft[], overrides: [] as LeagueFixtureOverride[] };
  const byKey = new Map(validated.overrides.map((override) => [override.fixtureKey, override]));
  return {
    error: "",
    fixtures: plan.fixtures.map((fixture) => {
      const override = byKey.get(fixture.fixtureKey);
      return override ? { ...fixture, awayTeamId: override.awayTeamId, homeTeamId: override.homeTeamId } : fixture;
    }),
    overrides: validated.overrides,
  };
}

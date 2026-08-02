import assert from "node:assert/strict";
import test from "node:test";
import { generateRoundRobinFixtures } from "./round-robin.ts";

function teams(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `team-${index + 1}`, name: `ทีม ${index + 1}` }));
}

function pairKeys(fixtures: ReturnType<typeof generateRoundRobinFixtures>["fixtures"], leg: 1 | 2) {
  return fixtures.filter((fixture) => fixture.leg === leg).map((fixture) => [fixture.homeTeamId, fixture.awayTeamId].sort().join(":"));
}

function assertPlan(teamCount: number, legs: 1 | 2) {
  const plan = generateRoundRobinFixtures(teams(teamCount), legs);
  assert.equal(plan.fixtures.length, teamCount * (teamCount - 1) / 2 * legs);
  assert.equal(new Set(pairKeys(plan.fixtures, 1)).size, teamCount * (teamCount - 1) / 2);
  plan.rounds.forEach((round) => {
    const active = round.fixtures.flatMap((fixture) => [fixture.homeTeamId, fixture.awayTeamId]);
    assert.equal(new Set(active).size, active.length);
  });
  const homeCounts = new Map(teams(teamCount).map((team) => [team.id, 0]));
  const awayCounts = new Map(teams(teamCount).map((team) => [team.id, 0]));
  plan.fixtures.filter((fixture) => fixture.leg === 1).forEach((fixture) => {
    homeCounts.set(fixture.homeTeamId, (homeCounts.get(fixture.homeTeamId) ?? 0) + 1);
    awayCounts.set(fixture.awayTeamId, (awayCounts.get(fixture.awayTeamId) ?? 0) + 1);
  });
  homeCounts.forEach((homeCount, teamId) => {
    assert.ok(Math.abs(homeCount - (awayCounts.get(teamId) ?? 0)) <= 1);
  });
  if (teamCount % 2 === 1) assert.equal(plan.summary.idleRoundCount, plan.summary.roundCount);
}

test("generates complete one- and two-leg schedules for 2, 3, and 4 teams", () => {
  ([2, 3, 4] as const).forEach((count) => {
    assertPlan(count, 1);
    assertPlan(count, 2);
  });
});

test("generates complete schedules for 5 and 8 teams", () => {
  assertPlan(5, 1);
  assertPlan(8, 1);
});

test("reverses every home and away pairing in the second leg", () => {
  const plan = generateRoundRobinFixtures(teams(4), 2);
  const firstLeg = new Map(plan.fixtures.filter((fixture) => fixture.leg === 1).map((fixture) => [[fixture.homeTeamId, fixture.awayTeamId].sort().join(":"), fixture]));
  plan.fixtures.filter((fixture) => fixture.leg === 2).forEach((fixture) => {
    const first = firstLeg.get([fixture.homeTeamId, fixture.awayTeamId].sort().join(":"));
    assert.ok(first);
    assert.equal(fixture.homeTeamId, first.awayTeamId);
    assert.equal(fixture.awayTeamId, first.homeTeamId);
  });
});

test("is deterministic and rejects duplicate team ids", () => {
  const input = teams(5);
  assert.deepEqual(generateRoundRobinFixtures(input, 2), generateRoundRobinFixtures(input, 2));
  assert.throws(() => generateRoundRobinFixtures([{ id: "same", name: "A" }, { id: "same", name: "B" }], 1));
});

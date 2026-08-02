import assert from "node:assert/strict";
import test from "node:test";
import { applyLeagueFixtureOverrides, validateLeagueFixtureOverrides } from "./fixture-overrides.ts";
import { generateRoundRobinFixtures } from "./round-robin.ts";

const teams = ["a", "b", "c", "d"].map((id) => ({ id, name: id.toUpperCase() }));

test("accepts a same-pair home-away swap without changing matchweek", () => {
  const plan = generateRoundRobinFixtures(teams, 1);
  const fixture = plan.fixtures[0];
  const result = applyLeagueFixtureOverrides(plan, [{ awayTeamId: fixture.homeTeamId, fixtureKey: fixture.fixtureKey, homeTeamId: fixture.awayTeamId, matchDate: "2026-08-03T10:00:00.000Z", venue: "V1" }]);
  assert.equal(result.error, "");
  assert.equal(result.fixtures[0].homeTeamId, fixture.awayTeamId);
  assert.equal(result.fixtures[0].matchweek, fixture.matchweek);
  assert.equal(plan.summary.fixtureCount, 6);
});

test("keeps an empty override set valid and retains schedule metadata for the RPC payload", () => {
  const plan = generateRoundRobinFixtures(teams, 1);
  const fixture = plan.fixtures[0];
  const result = validateLeagueFixtureOverrides(plan, [{ awayTeamId: fixture.awayTeamId, fixtureKey: fixture.fixtureKey, homeTeamId: fixture.homeTeamId, matchDate: "2026-08-03T10:00:00.000Z", venue: "สนามกลาง 1" }]);
  assert.equal(validateLeagueFixtureOverrides(plan, []).error, "");
  assert.equal(result.error, "");
  assert.equal(result.overrides[0].venue, "สนามกลาง 1");
  assert.equal(result.overrides[0].matchDate, "2026-08-03T10:00:00.000Z");
});

test("rejects unknown fixture keys and changed participants", () => {
  const plan = generateRoundRobinFixtures(teams, 1);
  const fixture = plan.fixtures[0];
  const outsider = teams.find((team) => team.id !== fixture.homeTeamId && team.id !== fixture.awayTeamId)?.id ?? "";
  assert.notEqual(validateLeagueFixtureOverrides(plan, [{ awayTeamId: fixture.awayTeamId, fixtureKey: "unknown", homeTeamId: fixture.homeTeamId, matchDate: null, venue: null }]).error, "");
  assert.notEqual(validateLeagueFixtureOverrides(plan, [{ awayTeamId: outsider, fixtureKey: fixture.fixtureKey, homeTeamId: fixture.homeTeamId, matchDate: null, venue: null }]).error, "");
});

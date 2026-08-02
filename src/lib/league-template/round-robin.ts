import type { LeagueEntrant, LeagueFixtureDraft, LeagueFixturePlan, LeagueFixtureRound } from "./types";

type RotationSlot = LeagueEntrant | null;

function fixtureKey(leg: 1 | 2, homeTeamId: string, awayTeamId: string) {
  return `leg-${leg}:${[homeTeamId, awayTeamId].sort().join(":")}`;
}

function assertEntrants(teams: LeagueEntrant[]) {
  if (teams.length < 2) throw new Error("A league needs at least two teams.");
  const ids = new Set(teams.map((team) => team.id));
  if (ids.size !== teams.length || teams.some((team) => !team.id)) throw new Error("League teams must have unique ids.");
}

function firstLegRounds(teams: LeagueEntrant[]) {
  const rotation: RotationSlot[] = teams.length % 2 === 0 ? [...teams] : [...teams, null];
  const teamIndex = new Map(teams.map((team, index) => [team.id, index]));
  const rounds: Array<{ fixtures: Array<{ awayTeamId: string; homeTeamId: string }>; idleTeamId: string | null }> = [];
  const roundCount = rotation.length - 1;
  const pairCount = rotation.length / 2;

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const fixtures: Array<{ awayTeamId: string; homeTeamId: string }> = [];
    let idleTeamId: string | null = null;

    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      const left = rotation[pairIndex];
      const right = rotation[rotation.length - 1 - pairIndex];
      if (!left || !right) {
        idleTeamId = (left ?? right)?.id ?? null;
        continue;
      }
      const leftIndex = teamIndex.get(left.id) ?? 0;
      const rightIndex = teamIndex.get(right.id) ?? 0;
      const distance = (rightIndex - leftIndex + teams.length) % teams.length;
      const half = Math.floor(teams.length / 2);
      const leftIsHome = teams.length % 2 === 1
        ? distance <= half
        : distance < half || (distance === half && leftIndex < rightIndex);
      fixtures.push(leftIsHome
        ? { awayTeamId: right.id, homeTeamId: left.id }
        : { awayTeamId: left.id, homeTeamId: right.id });
    }

    rounds.push({ fixtures, idleTeamId });
    rotation.splice(1, 0, rotation.pop() ?? null);
  }

  return rounds;
}

export function generateRoundRobinFixtures(teams: LeagueEntrant[], legs: 1 | 2): LeagueFixturePlan {
  assertEntrants(teams);
  const baseRounds = firstLegRounds(teams);
  const rounds: LeagueFixtureRound[] = [];
  let order = 0;

  for (const leg of legs === 2 ? [1, 2] as const : [1] as const) {
    baseRounds.forEach((baseRound, index) => {
      const roundNumber = index + 1 + (leg - 1) * baseRounds.length;
      const fixtures: LeagueFixtureDraft[] = baseRound.fixtures.map((fixture) => {
        const homeTeamId = leg === 1 ? fixture.homeTeamId : fixture.awayTeamId;
        const awayTeamId = leg === 1 ? fixture.awayTeamId : fixture.homeTeamId;
        order += 1;
        return {
          awayTeamId,
          fixtureKey: fixtureKey(leg, homeTeamId, awayTeamId),
          homeTeamId,
          leg,
          matchweek: roundNumber,
          order,
          roundNumber,
        };
      });
      rounds.push({ fixtures, idleTeamId: baseRound.idleTeamId, leg, matchweek: roundNumber, roundNumber });
    });
  }

  const fixtures = rounds.flatMap((round) => round.fixtures);
  return {
    fixtures,
    rounds,
    summary: {
      fixtureCount: fixtures.length,
      idleRoundCount: rounds.filter((round) => round.idleTeamId).length,
      roundCount: rounds.length,
      roundsPerLeg: baseRounds.length,
      teamCount: teams.length,
    },
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import { sortCompletedParticipantTeams } from "./completed-participating-team-order.ts";
import type { PublicCupV2Data, PublicCupV2Node, PublicCupV2Team } from "./public-cup-v2-types.ts";

function team(id: string, name = id): PublicCupV2Team {
  return { id, logoUrl: null, name, shortName: null };
}

function node(input: Partial<PublicCupV2Node>): PublicCupV2Node {
  return {
    awaySource: { bestOrder: null, groupId: null, groupLabel: null, rank: null, team: null, type: "node_winner", winnerNodeId: null },
    bracketPosition: 1,
    homeSource: { bestOrder: null, groupId: null, groupLabel: null, rank: null, team: null, type: "node_winner", winnerNodeId: null },
    id: "node",
    linkedMatch: null,
    linkedMatchId: null,
    matchOrder: 1,
    partitionKey: "division_1",
    roundIndex: 0,
    roundLabel: "Quarterfinal",
    ...input,
  };
}

function finishedMatch(home: PublicCupV2Team, away: PublicCupV2Team, winner: PublicCupV2Team) {
  return { awayPenaltyScore: null, awayScore: 0, awayTeam: away, homePenaltyScore: null, homeScore: 1, homeTeam: home, id: `${home.id}-${away.id}`, matchDate: null, status: "finished", venue: null, winner };
}

test("keeps KSW first, ranks both Council champions together, and does not duplicate teams", () => {
  const ksw = team("ksw", "KSW L.C.");
  const championD1 = team("champion-d1", "Champion D1");
  const runnerD1 = team("runner-d1", "Runner D1");
  const semi = team("semi", "Semifinalist");
  const quarter = team("quarter", "Quarterfinalist");
  const championD2 = team("champion-d2", "Champion D2");
  const runnerD2 = team("runner-d2", "Runner D2");
  const bracket: PublicCupV2Data = {
    champions: { division1: championD1, division2: championD2, main: null },
    config: null,
    groups: [],
    linkedMatches: [],
    nodes: [
      node({ id: "d1-quarter", linkedMatch: finishedMatch(ksw, quarter, ksw), roundIndex: 0 }),
      node({ id: "d1-semi", linkedMatch: finishedMatch(ksw, semi, ksw), roundIndex: 1, roundLabel: "Semifinal" }),
      node({ id: "d1-final", linkedMatch: finishedMatch(championD1, runnerD1, championD1), roundIndex: 2, roundLabel: "Final" }),
      node({ id: "d2-final", linkedMatch: finishedMatch(championD2, runnerD2, championD2), partitionKey: "division_2", roundIndex: 0, roundLabel: "Final" }),
    ],
    partitions: [
      { bracketCapacity: 8, championAt: null, champion: championD1, entrantCount: 8, key: "division_1", label: "Division 1", status: "completed" },
      { bracketCapacity: 2, championAt: null, champion: championD2, entrantCount: 2, key: "division_2", label: "Division 2", status: "completed" },
    ],
    templateKey: "council_two_division",
    teams: [ksw, championD1, runnerD1, semi, quarter, championD2, runnerD2],
  };
  const ordered = sortCompletedParticipantTeams({
    bracket,
    teams: [
      { displayOrder: null, id: "group-only", isKsw: false, name: "ทีมทดสอบ 10", seed: null },
      { displayOrder: null, id: ksw.id, isKsw: true, name: ksw.name, seed: null },
      { displayOrder: null, id: championD1.id, isKsw: false, name: championD1.name, seed: null },
      { displayOrder: null, id: runnerD1.id, isKsw: false, name: runnerD1.name, seed: null },
      { displayOrder: null, id: semi.id, isKsw: false, name: semi.name, seed: null },
      { displayOrder: null, id: quarter.id, isKsw: false, name: quarter.name, seed: null },
      { displayOrder: null, id: championD2.id, isKsw: false, name: championD2.name, seed: null },
      { displayOrder: null, id: championD2.id, isKsw: false, name: championD2.name, seed: null },
      { displayOrder: null, id: runnerD2.id, isKsw: false, name: runnerD2.name, seed: null },
    ],
  });

  assert.deepEqual(ordered.map((entry) => entry.id), ["ksw", "champion-d1", "champion-d2", "runner-d1", "runner-d2", "semi", "quarter", "group-only"]);
  assert.equal(ordered.find((entry) => entry.id === "champion-d1")?.performance, "champion");
  assert.equal(ordered.find((entry) => entry.id === "runner-d1")?.performance, "runner_up");
});

test("falls back to display order, seed, then natural Thai name ordering without a bracket", () => {
  const ordered = sortCompletedParticipantTeams({
    bracket: null,
    teams: [
      { displayOrder: null, id: "ten", isKsw: false, name: "ทีมทดสอบ 10", seed: null },
      { displayOrder: null, id: "two", isKsw: false, name: "ทีมทดสอบ 2", seed: null },
      { displayOrder: 2, id: "display-two", isKsw: false, name: "ทีมทดสอบ 99", seed: null },
      { displayOrder: 1, id: "display-one", isKsw: false, name: "ทีมทดสอบ 100", seed: null },
      { displayOrder: null, id: "seed-one", isKsw: false, name: "ทีมทดสอบ 11", seed: 1 },
    ],
  });

  assert.deepEqual(ordered.map((entry) => entry.id), ["display-one", "display-two", "seed-one", "two", "ten"]);
});

test("uses the persisted league champion before the standings fallback", () => {
  const ordered = sortCompletedParticipantTeams({
    bracket: null,
    championTeamIds: new Set(["persisted-champion"]),
    leaguePlacements: new Map([["standings-leader", 1], ["persisted-champion", 2]]),
    teams: [
      { displayOrder: 1, id: "standings-leader", isKsw: false, name: "ทีมตารางคะแนน", seed: null },
      { displayOrder: 2, id: "persisted-champion", isKsw: false, name: "ทีมแชมป์", seed: null },
    ],
  });

  assert.deepEqual(ordered.map((entry) => entry.id), ["persisted-champion", "standings-leader"]);
});

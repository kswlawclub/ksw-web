import assert from "node:assert/strict";
import test from "node:test";
import { buildCompetitionTree, type CompetitionTreeNode } from "./competition-tree.ts";
import { calculateCupCompetitionWorkflow } from "./cup-competition-workflow.ts";

function treeFor(capacity: 4 | 8 | 16 | 32, partitionKey: "division_1" | "division_2" | "main") {
  let index = 0;
  return buildCompetitionTree({
    bracketCapacity: capacity,
    competitionId: "competition",
    entrantCount: capacity,
    entryMode: "custom",
    entrants: Array.from({ length: capacity }, (_, entryIndex) => ({ teamId: `${partitionKey}-team-${entryIndex + 1}`, type: "manual_team" as const })),
    idFactory: () => `${partitionKey}-node-${++index}`,
    partitionKey: partitionKey === "main" ? undefined : partitionKey,
  }).nodes;
}

function withFinalMatch(nodes: CompetitionTreeNode[], matchId: string) {
  const finalRoundIndex = Math.max(...nodes.map((node) => node.roundIndex));
  return nodes.map((node) => node.roundIndex === finalRoundIndex ? { ...node, linkedMatchId: matchId } : node);
}

function step(workflow: ReturnType<typeof calculateCupCompetitionWorkflow>, id: "knockout_setup" | "knockout_matches" | "champion") {
  const result = workflow.find((entry) => entry.id === id);
  assert.ok(result);
  return result;
}

function councilWorkflow(nodes: CompetitionTreeNode[], matches: Record<string, unknown>[] = []) {
  return calculateCupCompetitionWorkflow({
    competitionStatus: "active",
    councilPartitions: [
      { approvalStatus: "approved", bracketConfirmed: true, championTeamId: null, partitionKey: "division_1", status: "reviewed" },
      { approvalStatus: "approved", bracketConfirmed: true, championTeamId: null, partitionKey: "division_2", status: "reviewed" },
    ],
    groups: [{ id: "group-1" }],
    matches,
    nodes,
    knockoutStatus: "reviewed",
    qualificationStatus: "approved",
    teams: [{ group_id: "group-1", id: "team-1", is_active: true }],
    templateKey: "council_two_division",
  });
}

for (const capacity of [4, 8, 16, 32] as const) {
  test(`${capacity}-team Council topology is configured without fixtures`, () => {
    const workflow = councilWorkflow([...treeFor(capacity, "division_1"), ...treeFor(capacity, "division_2")]);

    assert.equal(step(workflow, "knockout_setup").state, "complete");
    assert.equal(step(workflow, "knockout_matches").state, "current");
    assert.equal(step(workflow, "champion").state, "upcoming");
  });
}

test("Council keeps Division 1 completion independent from Division 2", () => {
  const division1 = withFinalMatch(treeFor(4, "division_1"), "division-1-final");
  const division2 = treeFor(4, "division_2");
  const workflow = councilWorkflow([...division1, ...division2], [{ id: "division-1-final", status: "finished", winner_team_id: "division-1-champion" }]);

  assert.equal(step(workflow, "knockout_matches").state, "current");
  assert.match(step(workflow, "knockout_matches").subStatus ?? "", /D1 ✓.*D2 พร้อมสร้างโปรแกรม/);
  assert.equal(step(workflow, "champion").state, "upcoming");
});

test("Council fixture activity without a final keeps the workflow in knockout progress", () => {
  const division1 = treeFor(4, "division_1");
  const firstRound = division1.find((node) => node.roundIndex === 0);
  assert.ok(firstRound);
  const nodes = [
    ...division1.map((node) => node.id === firstRound.id ? { ...node, linkedMatchId: "division-1-first" } : node),
    ...treeFor(4, "division_2"),
  ];
  const workflow = councilWorkflow(nodes, [{ id: "division-1-first", status: "scheduled", winner_team_id: null }]);

  assert.equal(step(workflow, "knockout_matches").state, "current");
  assert.match(step(workflow, "knockout_matches").subStatus ?? "", /D1 กำลังแข่งขัน/);
  assert.equal(step(workflow, "champion").state, "upcoming");
});

test("Council final winners make both champion candidates ready through the engine", () => {
  const division1 = withFinalMatch(treeFor(4, "division_1"), "division-1-final");
  const division2 = withFinalMatch(treeFor(4, "division_2"), "division-2-final");
  const workflow = councilWorkflow([...division1, ...division2], [
    { id: "division-1-final", status: "finished", winner_team_id: "division-1-champion" },
    { id: "division-2-final", status: "completed", winner_team_id: "division-2-champion" },
  ]);

  assert.equal(step(workflow, "knockout_matches").state, "complete");
  assert.equal(step(workflow, "champion").state, "complete");
  assert.match(step(workflow, "champion").subStatus ?? "", /D1 ✓.*D2 ✓/);
});

test("Standard workflow keeps its existing final-match behavior", () => {
  const nodes = withFinalMatch(treeFor(4, "main"), "standard-final");
  const workflow = calculateCupCompetitionWorkflow({
    competitionStatus: "active",
    councilPartitions: [],
    groups: [{ id: "group-1" }],
    matches: [{ id: "standard-final", status: "finished", winner_team_id: "standard-champion" }],
    nodes,
    knockoutStatus: "reviewed",
    qualificationStatus: "approved",
    teams: [{ group_id: "group-1", id: "team-1", is_active: true }],
    templateKey: "ksw_standard",
  });

  assert.equal(step(workflow, "knockout_matches").state, "complete");
  assert.equal(step(workflow, "champion").state, "complete");
});

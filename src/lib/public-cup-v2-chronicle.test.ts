import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicCupArchive, chronicleGroupLabel, derivePublicCupChampionPath, hasUnpartitionedPublicCupTeams, publicCupArchiveMetadata, publicCupPartitionTeams } from "./public-cup-v2-chronicle.ts";
import { mapPublicCupV2Data } from "./public-cup-v2-types.ts";
import { calculateCupGroupStandings } from "./cup-group-standings.ts";

const data = mapPublicCupV2Data({
  config: { status: "completed" },
  groups: [],
  linkedMatches: [
    { away_team_id: "b", home_team_id: "a", id: "d1-quarter", status: "finished", winner_team_id: "a" },
    { away_team_id: "c", home_team_id: "a", id: "d1-final", status: "finished", winner_team_id: "a" },
    { away_team_id: "e", home_team_id: "d", id: "d2-final", status: "finished", winner_team_id: "d" },
  ],
  nodes: [
    { id: "n1", linked_match_id: "d1-quarter", match_order: 1, partition_key: "division_1", round_index: 1, round_label: "Quarterfinal" },
    { id: "n2", linked_match_id: "d1-final", match_order: 1, partition_key: "division_1", round_index: 3, round_label: "Final" },
    { id: "n3", linked_match_id: "d2-final", match_order: 1, partition_key: "division_2", round_index: 3, round_label: "Final" },
  ],
  partitions: [
    { champion_team_id: "a", partition_key: "division_1" },
    { champion_team_id: "d", partition_key: "division_2" },
  ],
  teams: [
    { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }, { id: "e", name: "E" },
  ],
  templateKey: "council_two_division",
});

test("Road to Champion only contains the persisted champion's matches in final-to-earlier order", () => {
  assert.deepEqual(derivePublicCupChampionPath({ championId: "a", data, partitionKey: "division_1" }).map((node) => node.linkedMatchId), ["d1-final", "d1-quarter"]);
});

test("Council champion paths and participants stay separated by partition", () => {
  assert.deepEqual(derivePublicCupChampionPath({ championId: "d", data, partitionKey: "division_2" }).map((node) => node.linkedMatchId), ["d2-final"]);
  assert.deepEqual(publicCupPartitionTeams(data, "division_1").map((team) => team.id).sort(), ["a", "b", "c"]);
  assert.deepEqual(publicCupPartitionTeams(data, "division_2").map((team) => team.id).sort(), ["d", "e"]);
  assert.equal(hasUnpartitionedPublicCupTeams(data, [publicCupPartitionTeams(data, "division_1"), publicCupPartitionTeams(data, "division_2")]), false);
});

test("Chronicle archive preserves division and group labels with an explicit unknown-group fallback", () => {
  const node = {
    ...data.nodes[0],
    homeSource: { ...data.nodes[0]!.homeSource, groupLabel: "Group A" },
  };
  assert.deepEqual(publicCupArchiveMetadata(data, node), { divisionLabel: "division_1", groupLabel: "Group A" });
  assert.equal(chronicleGroupLabel("group-a", new Map([["group-a", "Group A"]])), "Group A");
  assert.equal(chronicleGroupLabel("missing", new Map()), "ไม่ระบุกลุ่ม");
});

test("completed Council archive assigns one topology-defined final per division and keeps groups out of divisions", () => {
  const archive = buildPublicCupArchive({
    matches: [
      { competition_stage: "knockout", id: "d1-quarter" },
      { competition_stage: "knockout", id: "d1-final" },
      { competition_stage: "knockout", id: "d2-final" },
      { competition_stage: "group", group_id: "group-a", id: "group-a-1" },
      { competition_stage: "group", group_id: "group-b", id: "group-b-1" },
      { competition_stage: "group", id: "unknown-group" },
      { competition_stage: "knockout", id: "d1-final" },
    ],
    nodes: data.nodes,
  });
  assert.deepEqual(archive.filter((entry) => entry.section === "knockout" && entry.isFinal).map((entry) => entry.matchId).sort(), ["d1-final", "d2-final"]);
  assert.equal(archive.filter((entry) => entry.section === "knockout" && entry.partitionKey === "division_1" && entry.isFinal).length, 1);
  assert.deepEqual(archive.filter((entry) => entry.section === "group").map((entry) => entry.groupId), ["group-a", "group-b", null]);
  assert.equal(new Set(archive.map((entry) => entry.matchId)).size, archive.length);
});

test("archive round identity is partition plus round index, and completed group results feed the shared standings helper", () => {
  const archive = buildPublicCupArchive({
    matches: [{ id: "d1-quarter" }, { id: "d1-final" }, { id: "d2-final" }],
    nodes: data.nodes,
  });
  assert.equal(new Set(archive.filter((entry) => entry.section === "knockout").map((entry) => `${entry.partitionKey}:${entry.roundIndex}`)).size, 3);
  const standings = calculateCupGroupStandings({
    groups: [{ id: "group-a", label: "Group A", qualifiers_count: 2, sort_order: 1 }],
    matches: [{ away_score: 0, away_team_id: "b", competition_stage: "group", group_id: "group-a", home_score: 1, home_team_id: "a", status: "completed" }],
    teams: [{ group_id: "group-a", name: "A", team_id: "a" }, { group_id: "group-a", name: "B", team_id: "b" }],
  });
  assert.equal(standings[0]?.finished_matches, 1);
  assert.equal(standings[0]?.rows[0]?.team_id, "a");
});

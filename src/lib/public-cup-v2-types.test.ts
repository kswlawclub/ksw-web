import assert from "node:assert/strict";
import test from "node:test";
import { detectPublicCupV2Template, mapPublicCupV2Data } from "./public-cup-v2-types.ts";

test("maps KSW Standard public nodes and only uses the persisted main champion", () => {
  const result = mapPublicCupV2Data({
    config: { bracket_capacity: 16, entrant_count: 16, qualification_status: "approved", status: "active" },
    groups: [{ id: "group-a", label: "Group A", name: "A" }],
    linkedMatches: [{ away_score: 1, away_team_id: "team-b", home_score: 2, home_team_id: "team-a", id: "match-1", status: "finished", winner_team_id: "team-a" }],
    nodes: [{ away_source_group_id: "group-a", away_source_rank: 2, away_source_type: "group_rank", bracket_position: 1, home_source_group_id: "group-a", home_source_rank: 1, home_source_type: "group_rank", id: "node-1", linked_match_id: "match-1", match_order: 1, partition_key: "main", round_index: 0, round_label: "Round of 16" }],
    partitions: [{ champion_team_id: "team-a", partition_key: "main", status: "completed" }],
    teams: [{ id: "team-a", name: "Team A" }, { id: "team-b", name: "Team B" }],
    templateKey: "ksw_standard",
  });

  assert.equal(result.templateKey, "ksw_standard");
  assert.equal(result.nodes[0]?.linkedMatch?.winner?.name, "Team A");
  assert.equal(result.champions.main?.name, "Team A");
});

test("maps Council champions from their separate persisted partitions", () => {
  const result = mapPublicCupV2Data({
    config: { status: "completed" },
    groups: [],
    linkedMatches: [],
    nodes: [],
    partitions: [
      { champion_team_id: "team-a", partition_key: "division_1", partition_label: "Division 1", status: "completed" },
      { champion_team_id: "team-b", partition_key: "division_2", partition_label: "Division 2", status: "completed" },
    ],
    teams: [{ id: "team-a", name: "Team A" }, { id: "team-b", name: "Team B" }],
    templateKey: "council_two_division",
  });

  assert.equal(result.champions.division1?.name, "Team A");
  assert.equal(result.champions.division2?.name, "Team B");
  assert.equal(result.champions.main, null);
});

test("keeps an incomplete Council champion state explicit without inventing another champion", () => {
  const result = mapPublicCupV2Data({
    config: { status: "active" },
    groups: [],
    linkedMatches: [],
    nodes: [],
    partitions: [{ champion_team_id: "team-a", partition_key: "division_1", status: "completed" }, { partition_key: "division_2", status: "active" }],
    teams: [{ id: "team-a", name: "Team A" }],
    templateKey: "council_two_division",
  });

  assert.equal(result.champions.division1?.name, "Team A");
  assert.equal(result.champions.division2, null);
  assert.equal(result.champions.main, null);
});

test("keeps legacy, unpublished, and missing-template Cups outside the V2 contract", () => {
  assert.equal(detectPublicCupV2Template({ competitionType: "cup", isPublished: false, templateKey: "ksw_standard" }), "legacy_cup");
  assert.equal(detectPublicCupV2Template({ competitionType: "cup", isPublished: true, templateKey: null }), "legacy_cup");
  assert.equal(detectPublicCupV2Template({ competitionType: "cup", isPublished: true, templateKey: "legacy" }), "legacy_cup");
});

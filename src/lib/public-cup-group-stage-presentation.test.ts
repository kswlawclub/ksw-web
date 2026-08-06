import assert from "node:assert/strict";
import test from "node:test";
import { derivePublicGroupStagePresentation, togglePublicGroupStageGroup } from "@/lib/public-cup-group-stage-presentation";
import type { CupGroupStanding } from "@/lib/cup-group-standings";

function standing(input: Partial<CupGroupStanding>): CupGroupStanding {
  return {
    finished_matches: 0,
    group_id: "group-a",
    group_label: "Group A",
    group_name: "A",
    is_complete: false,
    qualifiers_count: 2,
    rows: [{ drawn: 0, goal_difference: 2, goals_against: 0, goals_for: 2, is_ksw: false, lost: 0, played: 1, points: 3, position: 1, qualifies: true, short_name: null, team_id: "team-a", team_name: "ทีมทดสอบ 59", tie_unresolved: false, won: 1 }],
    sort_order: 1,
    team_count: 3,
    total_required_matches: 3,
    ...input,
  };
}

test("builds group header summaries without changing standing rows", () => {
  const source = [standing({ finished_matches: 3, is_complete: true }), standing({ finished_matches: 1, group_id: "group-b", group_label: "Group B", group_name: "B", sort_order: 2 }), standing({ group_id: "group-c", group_label: "Group C", group_name: "C", sort_order: 3 })];
  const presentation = derivePublicGroupStagePresentation({ matches: [], standings: source });

  assert.deepEqual(presentation.groups.map((group) => group.standing.rows), source.map((group) => group.rows));
  assert.deepEqual(presentation.groups.map((group) => group.status), ["complete", "in_progress", "not_started"]);
  assert.equal(presentation.groups[0]?.leaderName, "ทีมทดสอบ 59");
  assert.equal(presentation.groups[2]?.leaderName, null);
  assert.deepEqual([presentation.totalPlayedMatches, presentation.totalMatches, presentation.qualifiedTeams], [4, 9, 3]);
});

test("keeps group accordions independently open and lets the first group close", () => {
  const opened = togglePublicGroupStageGroup(["group-a"], "group-b");
  assert.deepEqual(opened, ["group-a", "group-b"]);
  assert.deepEqual(togglePublicGroupStageGroup(opened, "group-a"), ["group-b"]);
});

test("keeps group matches inside their matching group and ordered by date", () => {
  const presentation = derivePublicGroupStagePresentation({
    matches: [
      { group_id: "group-a", id: "later", match_date: "2026-02-02" },
      { group_id: "group-b", id: "other", match_date: "2026-02-01" },
      { group_id: "group-a", id: "earlier", match_date: "2026-02-01" },
    ],
    standings: [standing({ group_id: "group-a" }), standing({ group_id: "group-b", group_label: "Group B", group_name: "B", sort_order: 2 })],
  });

  assert.deepEqual(presentation.groups[0]?.matches.map((match) => match.id), ["earlier", "later"]);
  assert.deepEqual(presentation.groups[1]?.matches.map((match) => match.id), ["other"]);
});

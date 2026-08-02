import assert from "node:assert/strict";
import test from "node:test";
import { isPublicCompetition, publicCompetitionBucket } from "./competition-publication.ts";

test("keeps unpublished competitions out of every public bucket", () => {
  assert.equal(isPublicCompetition({ is_published: false }), false);
  assert.equal(publicCompetitionBucket({ competition_type: "cup", is_published: false, season_status: "completed" }), "hidden");
});

test("separates published current competitions from completed archives", () => {
  assert.equal(publicCompetitionBucket({ competition_type: "cup", is_published: true, season_status: "active" }), "current");
  assert.equal(publicCompetitionBucket({ competition_type: "cup", is_published: true, season_status: "completed" }), "cup_archive");
  assert.equal(publicCompetitionBucket({ competition_type: "league", is_published: true, season_status: "completed" }), "league");
});

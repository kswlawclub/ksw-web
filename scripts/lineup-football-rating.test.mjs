import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as jsx from "react/jsx-runtime";
import { loadRatingModule, ratingContract, fixtureId, ratingRow } from "./lib/football-rating-test-support.mjs";

const loader = loadRatingModule("src/lib/public-member-football-ratings.ts", { "./member-football-rating": ratingContract });
const presentation = loadRatingModule("src/lib/lineup-rating-presentation.ts");
const member = (index, overrides = {}) => ({ id: fixtureId(index), nickname: `Member ${index}`, photo_url: null, shirt_number: index, birth_year_be: 2540,
  membership_type: "ordinary", is_active: true, lineup_enabled: true, ...overrides });

function harness({ members = [], ratings = [], failure = false, unavailable = false } = {}) {
  const calls = [];
  const client = { from(table) {
    calls.push(["from", table]);
    if (table === "club_member_football_ratings") return { select(columns) {
      assert.equal(columns, ratingContract.footballRatingColumns);
      return { in(column, ids) {
        assert.equal(column, "member_id");
        calls.push(["ratings", ids]);
        if (failure === "throw") throw new Error("fixture only");
        return Promise.resolve({ data: ratings, error: failure ? {} : null });
      } };
    } };
    assert.ok(["club_members", "teams"].includes(table));
    const query = {
      select(columns) { calls.push([table, "select", columns]); return query; },
      eq(column, value) { calls.push([table, "eq", column, value]); return query; },
      order(column, options) { calls.push([table, "order", column, options]); return Promise.resolve({ data: table === "club_members" ? members : [], error: null }); },
    };
    return query;
  } };
  const page = loadRatingModule("src/app/lineup-builder/page.tsx", {
    "react/jsx-runtime": jsx,
    "@/lib/supabase": { getSupabase: () => unavailable ? null : client },
    "@/lib/public-member-football-ratings": loader,
    "./lineup-builder-client": { LineupBuilderClient: () => null },
  });
  return { client, calls, load: async () => (await page.default()).props };
}

test("real Lineup loader retains public-safe membership SELECT, active + lineup eligibility, and original ordering", async () => {
  const rows = [member(1), member(2, { membership_type: "extraordinary" }), member(3, { is_active: false }), member(4, { lineup_enabled: false })];
  const snapshot = structuredClone(rows);
  const h = harness({ members: rows, ratings: [ratingRow("player", fixtureId(1)), ratingRow("goalkeeper", fixtureId(2)), ratingRow("player", fixtureId(3))] });
  const props = await h.load();
  assert.deepEqual(props.members, rows.slice(0, 2));
  assert.deepEqual(Object.keys(props.ratings), [fixtureId(1), fixtureId(2)]);
  assert.deepEqual(h.calls.filter(([table]) => table === "club_members"), [
    ["club_members", "select", "id, nickname, photo_url, shirt_number, birth_year_be, is_active, lineup_enabled, membership_type"],
    ["club_members", "eq", "is_active", true], ["club_members", "eq", "lineup_enabled", true],
    ["club_members", "order", "nickname", { ascending: true }],
  ]);
  assert.deepEqual(h.calls.filter(([operation]) => operation === "ratings"), [["ratings", [fixtureId(1), fixtureId(2)]]]);
  assert.deepEqual(rows, snapshot);
});

test("Rating reads are bounded batches, map by member ID, exclude outsiders and retain DB overall", async () => {
  const ids = Array.from({ length: 405 }, (_, index) => fixtureId(index + 1));
  const h = harness({ ratings: [...ids.map((id) => ratingRow("player", id)), ratingRow("player", fixtureId(999))] });
  const result = await loader.getPublicMemberFootballRatings(h.client, [...ids, ids[0]]);
  assert.equal(Object.keys(result).length, 405);
  assert.deepEqual(h.calls.filter(([operation]) => operation === "ratings").map(([, ids]) => ids.length), [200, 200, 5]);
  const stored = { ...ratingRow(), overall: 81 };
  assert.equal((await harness({ members: [member(1)], ratings: [stored] }).load()).ratings[fixtureId(1)].overall, 81);
});

test("missing/broken Rating never removes selectable members; empty eligibility does not query ratings", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const failure of [false, true, "throw"]) {
    const h = harness({ members: [member(1), member(2)], failure });
    const props = await h.load();
    assert.equal(props.members.length, 2);
    assert.deepEqual(props.ratings, {});
  }
  const empty = harness();
  assert.deepEqual((await empty.load()).ratings, {});
  assert.equal(empty.calls.filter(([operation]) => operation === "ratings").length, 0);
  assert.deepEqual((await harness({ unavailable: true }).load()).members, []);
});

test("actual pointer wins over screen size/capability; keyboard keeps the selection workflow", () => {
  for (const canHover of [true, false]) {
    assert.equal(presentation.isTouchLineupActivation("touch", 1, canHover), true);
    assert.equal(presentation.isTouchLineupActivation("pen", 1, canHover), true);
    assert.equal(presentation.isTouchLineupActivation("mouse", 1, canHover), false);
    assert.equal(presentation.isTouchLineupActivation("", 0, canHover), false);
  }
  assert.equal(presentation.isTouchLineupActivation("", 1, false), true);
  assert.equal(presentation.isTouchLineupActivation("", 1, true), false);
});

test("preview positioning never covers its row and stays within mobile/tablet/desktop viewport", () => {
  for (const width of [375, 768, 1440]) for (const height of [600, 900]) {
    for (const top of [24, height / 2, height - 68]) {
      const anchor = { left: width / 4, right: width * 3 / 4, top, bottom: top + 44 };
      const result = presentation.positionLineupRatingPreview(anchor, { width, height }, 540);
      const bottom = result.top + Math.min(540, result.maxHeight);
      assert.ok(result.left >= 12 && result.left + result.width <= width - 12);
      assert.ok(result.top >= 12 && bottom <= height - 12);
      assert.ok(result.left >= anchor.right || result.left + result.width <= anchor.left || result.top >= anchor.bottom || bottom <= anchor.top);
    }
  }
});

test("Lineup reuses Rating rendering, existing change/clear handlers and never adds resting OVR or a write path", () => {
  const component = readFileSync(new URL("../src/components/lineup-member-rating.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("../src/app/lineup-builder/lineup-builder-client.tsx", import.meta.url), "utf8");
  const query = readFileSync(new URL("../src/lib/public-member-football-ratings.ts", import.meta.url), "utf8");
  assert.match(component, /<MemberFootballCard /);
  assert.doesNotMatch(component, /<svg|<polygon|footballRadarPoint|\.overall/);
  assert.doesNotMatch(client, /OVR|footballRadarPoint|\.overall/);
  assert.match(client, /change: \(\) => openPositionPicker\(index\), clear: \(\) => clearPosition\(index\)/);
  assert.match(client, /ratingUI\.dismiss\(\); selectPlayer\(positionIndex, member\.id\)/);
  assert.match(component, /ยังไม่มี Football Rating/);
  assert.doesNotMatch(query, /getSupabaseAdmin|\.insert\(|\.upsert\(|\.update\(|\.delete\(|phone|lawyer_license_no/);
});

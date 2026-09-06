// All actions use an in-memory adapter. Unknown imports/tables fail before any network access.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as members from "../src/lib/club-members.ts";
import { loadRatingModule, ratingContract as rating, ratingDiagnostics, card, publicRating, fixtureId, ratingInput, ratingRow } from "./lib/football-rating-test-support.mjs";

test("Player and GK definitions are exact six distinct fields/labels", () => {
  assert.deepEqual(rating.footballStats.player.map(({ label }) => label), ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"]);
  assert.deepEqual(rating.footballStats.goalkeeper.map(({ label }) => label), ["DIV", "HAN", "KIC", "REF", "SPD", "POS"]);
  assert.deepEqual(rating.footballStats.player.map(({ field }) => field), ["pace", "shooting", "passing", "dribbling", "defending", "physical"]);
  assert.deepEqual(rating.footballStats.goalkeeper.map(({ field }) => field), ["gk_diving", "gk_handling", "gk_kicking", "gk_reflexes", "gk_speed", "gk_positioning"]);
});

test("strict server validation rejects incomplete, mixed, unexpected and manually provided overall", () => {
  for (const type of ["player", "goalkeeper"]) {
    const input = ratingInput(type);
    for (const { field } of rating.footballStats[type]) {
      for (const invalid of [null, undefined, "50", 0, 100, 2.5, NaN, Infinity, true, ""]) {
        assert.equal(rating.parseFootballRatingInput({ ...input, [field]: invalid }).ok, false);
      }
      for (const value of [1, 99]) assert.equal(rating.parseFootballRatingInput({ ...input, [field]: value }).ok, true);
    }
    for (const extra of [{ overall: 99 }, { phone: "private" }, { is_active: true }, { member_id: "bad-id" }, { rating_type: "Player" }, { rating_type: "coach" }]) {
      assert.equal(rating.parseFootballRatingInput({ ...input, ...extra }).ok, false);
    }
    const otherType = type === "player" ? "goalkeeper" : "player";
    for (const { field } of rating.footballStats[otherType]) {
      for (const value of [null, 50]) assert.equal(rating.parseFootballRatingInput({ ...input, [field]: value }).ok, false);
      assert.equal(rating.parseFootballRatingInput(input).payload[field], null);
    }
  }
  for (const input of [null, [], "rating", {}, 1]) assert.equal(rating.parseFootballRatingInput(input).ok, false);
});

test("overall matches DB numeric round(sum/6) for every valid sum and both types", () => {
  for (const type of ["player", "goalkeeper"]) {
    assert.equal(rating.footballOverallPreview(type, {}), null);
    for (let sum = 6; sum <= 594; sum++) {
      let remaining = sum - 6;
      const values = {};
      for (const { field } of rating.footballStats[type]) { const delta = Math.min(remaining, 98); values[field] = 1 + delta; remaining -= delta; }
      assert.equal(rating.footballOverallPreview(type, values), Math.floor((sum + 3) / 6));
    }
  }
});

test("empty and switched forms never reuse the other type; all six values are required again", () => {
  const empty = rating.createFootballRatingForm();
  assert.equal(empty.rating_type, "player");
  assert.deepEqual(Object.values(empty.values), ["", "", "", "", "", ""]);
  const existing = ratingRow();
  const loaded = rating.createFootballRatingForm(existing);
  assert.equal(rating.parseFootballRatingInput(rating.footballRatingFormInput(existing.member_id, loaded)).ok, true);
  const switched = rating.createFootballRatingForm(existing, "goalkeeper");
  assert.deepEqual(Object.values(switched.values), ["", "", "", "", "", ""]);
  assert.equal(rating.parseFootballRatingInput(rating.footballRatingFormInput(existing.member_id, switched)).ok, false);
});

test("DB projection maps by member ID, rejects corrupt data, retains stored overall and excludes outsiders", () => {
  const row = { ...ratingRow(), overall: 61 };
  assert.equal(rating.mapFootballRatings([row, ratingRow("goalkeeper", fixtureId(2))], [row.member_id])[row.member_id].overall, 61);
  assert.deepEqual(Object.keys(rating.mapFootballRatings([row, row], [row.member_id])), [row.member_id]);
  for (const corrupt of [{ ...row, gk_diving: 12 }, { ...row, pace: null }, { ...row, overall: null }]) assert.equal(rating.readFootballRating(corrupt), null);
});

test("valid uppercase UUIDs use canonical DB IDs for save/read/clear", async () => {
  const h = actionHarness();
  const upper = fixtureId().toUpperCase();
  assert.equal((await h.actions.saveMemberFootballRating(ratingInput("player", upper))).rating.member_id, fixtureId());
  assert.deepEqual(Object.keys((await h.actions.listMemberFootballRatings([upper])).ratings), [fixtureId()]);
  assert.equal((await h.actions.clearMemberFootballRating(upper)).ok, true);
  assert.equal(h.rows.size, 0);
});

test("radar six points are stable, finite and bounded including bad presentation inputs", () => {
  assert.deepEqual(rating.footballRadarPoint(0, 99), { x: 120, y: 34 });
  for (let axis = 0; axis < 6; axis++) for (const value of [NaN, Infinity, -1, 0, 1, 50, 99, 1000]) {
    const { x, y } = rating.footballRadarPoint(axis, value);
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
    assert.ok(Math.hypot(x - 120, y - 110) <= 76.001);
  }
});

function actionHarness({ authorized = true, error = false, missing = false } = {}) {
  const rows = new Map();
  const calls = [];
  const refreshed = [];
  let checked = false;
  const client = { from(table) {
    assert.equal(checked, true);
    assert.equal(table, "club_member_football_ratings");
    calls.push(["from", table]);
    let payload, id, operation;
    const query = {
      select(columns) { calls.push(["select", columns]); return query; },
      in(column, ids) { assert.equal(column, "member_id"); calls.push(["batch", ids]); return Promise.resolve({ data: [...rows.values()].filter((row) => ids.includes(row.member_id)), error: error ? {} : null }); },
      upsert(value, options) { assert.deepEqual(options, { onConflict: "member_id" }); payload = value; operation = "save"; calls.push(["upsert", value]); return query; },
      delete() { operation = "clear"; return query; },
      eq(column, value) { assert.equal(column, "member_id"); id = value; return query; },
      single() {
        if (error || missing) return Promise.resolve({ data: null, error: {} });
        assert.equal(operation, "save");
        assert.ok(!Object.hasOwn(payload, "overall"));
        const row = { ...payload, overall: rating.footballOverallPreview(payload.rating_type, payload) };
        rows.set(payload.member_id, row);
        return Promise.resolve({ data: row, error: null });
      },
      then(resolve) {
        assert.equal(operation, "clear");
        const existed = rows.has(id);
        if (!error) rows.delete(id);
        resolve({ data: existed ? [{ member_id: id }] : [], error: error ? {} : null });
      },
    };
    return query;
  } };
  const actions = loadRatingModule("src/app/admin/members/rating-actions.ts", {
    "next/cache": { revalidatePath: (path) => refreshed.push(path) },
    "@/lib/admin-server-auth": { requireAdminSession: async () => { if (!authorized) throw new Error("Unauthorized"); checked = true; } },
    "@/lib/supabase-admin": { getSupabaseAdmin: () => { assert.ok(checked); return client; } },
    "@/lib/club-members": members, "@/lib/member-football-rating": rating,
    "@/lib/member-football-rating-diagnostics": ratingDiagnostics,
  });
  return { actions, rows, calls, refreshed };
}

test("real actions save Player/GK with DB overall and clear only one rating, never member state", async () => {
  const h = actionHarness();
  for (const type of ["player", "goalkeeper"]) {
    const result = await h.actions.saveMemberFootballRating(ratingInput(type));
    assert.equal(result.ok, true);
    assert.equal(result.rating.overall, 60);
    assert.equal(result.rating.rating_type, type);
    assert.equal(h.rows.size, 1);
  }
  await h.actions.saveMemberFootballRating(ratingInput("player", fixtureId(2)));
  assert.equal((await h.actions.clearMemberFootballRating(fixtureId())).ok, true);
  assert.deepEqual([...h.rows.keys()], [fixtureId(2)]);
  assert.equal((await h.actions.clearMemberFootballRating(fixtureId())).ok, true);
  assert.deepEqual([...new Set(h.refreshed)], ["/admin/members", "/team"]);
});

test("every action requires Admin; invalid payload is rejected before DB; write errors do not report success", async () => {
  for (const [name, input] of [["saveMemberFootballRating", ratingInput()], ["clearMemberFootballRating", fixtureId()], ["listMemberFootballRatings", [fixtureId()]]]) {
    const h = actionHarness({ authorized: false });
    if (name === "saveMemberFootballRating") assert.equal((await h.actions[name](input)).code, "RATING_AUTH");
    else await assert.rejects(h.actions[name](input), /Unauthorized/);
    assert.equal(h.calls.length, 0);
  }
  const invalid = actionHarness();
  assert.equal((await invalid.actions.saveMemberFootballRating({ ...ratingInput(), overall: 100 })).ok, false);
  assert.equal((await invalid.actions.clearMemberFootballRating("bad")).ok, false);
  assert.equal((await invalid.actions.listMemberFootballRatings(["bad"])).ok, false);
  assert.equal(invalid.calls.length, 0);
  const h = actionHarness({ error: true });
  assert.equal((await h.actions.saveMemberFootballRating(ratingInput())).ok, false);
  assert.equal((await h.actions.clearMemberFootballRating(fixtureId())).ok, false);
  assert.deepEqual(h.refreshed, []);
});

test("Admin batch read avoids N+1 and preserves all profiles across batch boundaries", async () => {
  const h = actionHarness();
  const ids = Array.from({ length: 405 }, (_, index) => fixtureId(index + 1));
  for (const id of ids) h.rows.set(id, ratingRow("player", id));
  const result = await h.actions.listMemberFootballRatings([...ids, ids[0]]);
  assert.equal(Object.keys(result.ratings).length, 405);
  assert.equal(h.calls.filter(([name]) => name === "from").length, 3);
});

test("Player/GK cards expose all six numbers without depending on SVG; popover uses accessible native interaction", () => {
  for (const type of ["player", "goalkeeper"]) {
    const data = ratingRow(type);
    const html = renderToStaticMarkup(createElement(card.MemberFootballCard, { name: "Test member", photoUrl: null, rating: data }));
    assert.match(html, /60<\/p><p[^>]*>OVR/);
    assert.equal((html.match(/<dd/g) ?? []).length, 6);
    for (const { label } of rating.footballStats[type]) assert.ok(html.includes(`>${label}</dt>`));
    assert.match(html, /aria-hidden="true" viewBox="0 0 240 220"/);
    const interactive = renderToStaticMarkup(createElement(publicRating.PublicMemberRating, { name: "Test member", photoUrl: null, rating: data }, createElement("div", null, "portrait")));
    assert.match(interactive, /aria-expanded="false"/);
    assert.match(interactive, /popover="auto" role="dialog"/);
    assert.match(interactive, /max-h-\[calc\(100dvh-24px\)\]/);
  }
  const source = readFileSync(new URL("../src/components/public-member-rating.tsx", import.meta.url), "utf8");
  for (const marker of ["onPointerEnter", "onFocus", "onClick", "hidePopover", "showPopover", "onToggle", "focus-visible"]) assert.ok(source.includes(marker));
  assert.doesNotMatch(source, /Math.random|animate-|fetch\(/);
});

test("resting public rating trigger contains only the original portrait, without an OVR badge or replacement indicator", () => {
  const portrait = createElement("div", { className: "original-portrait" }, "portrait");
  for (const type of ["player", "goalkeeper"]) {
    const html = renderToStaticMarkup(createElement(publicRating.PublicMemberRating, {
      name: "Test member", photoUrl: null, rating: ratingRow(type),
    }, portrait));
    const trigger = html.match(/<button\b([^>]*)>([\s\S]*?)<\/button>/);
    assert.ok(trigger);
    assert.equal(trigger[2], renderToStaticMarkup(portrait));
    assert.doesNotMatch(trigger[2], /OVR|<svg|<span/);
    assert.match(trigger[1], /type="button"/);
    assert.match(trigger[1], /aria-label="ดู Football Rating Test member"/);
    assert.match(trigger[1], /aria-expanded="false"/);
    assert.match(trigger[1], /aria-controls="[^"]+"/);
    assert.match(trigger[1], /aria-haspopup="dialog"/);
    assert.match(trigger[1], /focus-visible/);
    assert.match(html, /popover="auto" role="dialog"/);
    assert.match(html, /60<\/p><p[^>]*>OVR/);
  }
});

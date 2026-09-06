// Render the real server page with an in-memory read-only public client. No network/credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as grouping from "../src/lib/public-team-members.ts";
import * as memberPresentation from "../src/lib/club-members.ts";

const source = readFileSync(new URL("../src/app/team/page.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} });
const row = (id, values = {}) => ({ id, nickname: id, photo_url: null, membership_type: "ordinary", club_role: "member", is_active: true, ...values });
const migration = readFileSync(new URL("../supabase/migrations/202609060002_stage_static_team_staff.sql", import.meta.url), "utf8");
const staffManifest = JSON.parse(migration.match(/staff_manifest CONSTANT jsonb := \$staff\$([\s\S]*?)\$staff\$::jsonb;/)[1]);
const staffRows = staffManifest.map((staff) => row(staff.id, { ...staff, membership_type: "extraordinary", club_role: "staff" }));

async function renderPage(rows, { available = true, queryError = false, random = Math.random } = {}) {
  const calls = [];
  const shuffledGroups = [];
  const snapshot = structuredClone(rows);
  const client = { from(table) {
    assert.equal(table, "club_members");
    calls.push(["from", table]);
    const query = {
      select(columns) { calls.push(["select", columns]); return query; },
      eq(column, value) { calls.push(["eq", column, value]); return query; },
      order(column, options) {
        calls.push(["order", column, options]);
        return Promise.resolve(queryError ? { data: null, error: { message: "Simulated read failure" } } : { data: rows.filter((member) => member.is_active), error: null });
      },
    };
    return query;
  } };
  const imports = {
    "react/jsx-runtime": jsxRuntime,
    "next/link": ({ children, ...props }) => createElement("a", props, children),
    "@/components/facebook-icon": { FacebookIcon: () => null },
    "@/lib/club-members": memberPresentation,
    "@/lib/public-team-members": { ...grouping, shuffleTeamMembers: (members) => {
      shuffledGroups.push(members.map((member) => member.id));
      return grouping.shuffleTeamMembers(members, random);
    } },
    "@/lib/supabase": { getSupabase: () => available ? client : null },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => {
    assert.ok(Object.hasOwn(imports, name), `Unmocked import blocked: ${name}`);
    return imports[name];
  }, loaded, loaded.exports);
  const html = renderToStaticMarkup(await loaded.exports.default());
  assert.deepEqual(rows, snapshot);
  const sections = [...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)].map((match) => match[1]);
  assert.equal(sections.length, 4);
  return { html, calls, shuffledGroups, ordinary: sections[1], extraordinary: sections[2], coaching: sections[3] };
}
const names = (section) => [...section.matchAll(/<h3\b[^>]*>([^<]*)<\/h3>/g)].map((match) => match[1]);

test("real Team page uses the public-safe SELECT and unchanged active filter/created_at ordering", async () => {
  const rendered = await renderPage([]);
  assert.deepEqual(rendered.calls, [
    ["from", "club_members"],
    ["select", "id, nickname, photo_url, membership_type, club_role, is_active"],
    ["eq", "is_active", true],
    ["order", "created_at", { ascending: false }],
  ]);
  assert.doesNotMatch(source, /getSupabaseAdmin|\.insert\(|\.update\(|\.delete\(|\.rpc\(|phone|lawyer_license_no/);
  assert.match(source, /dynamic = "force-dynamic"/);
  assert.match(source, /revalidate = 0/);
});

test("all six inactive staged Staff are absent, with no static-name/photo fallback", async () => {
  const result = await renderPage(staffRows.map((member) => ({ ...member, is_active: false })));
  assert.deepEqual(names(result.extraordinary), []);
  for (const staff of staffRows) {
    assert.ok(!result.html.includes(staff.nickname));
    assert.ok(!result.html.includes(staff.photo_url));
  }
  assert.match(result.extraordinary, /ข้อมูลสมาชิกวิสามัญจะอัปเดตเร็ว ๆ นี้/);
  assert.match(result.coaching, /Coming Soon/);
});

test("partial activation displays only active DB Staff and other extraordinary members", async () => {
  const result = await renderPage([
    ...staffRows.map((member, index) => ({ ...member, is_active: index < 3, nickname: `DB-${index}` })),
    row("other-extraordinary", { nickname: "ผู้สนับสนุน", membership_type: "extraordinary" }),
    row("ordinary-go", { nickname: "โก้" }),
  ]);
  assert.deepEqual(names(result.extraordinary).sort(), ["DB-0", "DB-1", "DB-2", "ผู้สนับสนุน"].sort());
  assert.deepEqual(names(result.ordinary), ["ทนายโก้"]);
  assert.doesNotMatch(result.html, /DB-[345]/);
});

test("active Staff use DB names/photos and never render a second list", async () => {
  const result = await renderPage(staffRows.map((member, index) => ({ ...member, nickname: `DB-${index}`, photo_url: `/updated-${index}.webp` })));
  assert.deepEqual(names(result.extraordinary).sort(), staffRows.map((_, index) => `DB-${index}`));
  assert.doesNotMatch(result.html, /\/images\/staff\/|scale\(1\.9\)/);
  for (let index = 0; index < 6; index++) assert.match(result.extraordinary, new RegExp(`src="/updated-${index}\\.webp"`));
});

test("coaches appear only in the final section, using membership-aware names and real roles", async () => {
  const result = await renderPage([
    row("lawyer-coach", { nickname: "ทนายเอ", club_role: "coach" }),
    row("supporter-coach", { nickname: "บี", membership_type: "extraordinary", club_role: "assistant_coach" }),
    row("inactive-coach", { nickname: "INACTIVE", club_role: "coach", is_active: false }),
  ]);
  assert.deepEqual(names(result.coaching), ["ทนายเอ", "บี"]);
  assert.match(result.coaching, /โค้ช/);
  assert.match(result.coaching, /ผู้ช่วยโค้ช/);
  assert.doesNotMatch(result.coaching, /Coming Soon|INACTIVE/);
  assert.doesNotMatch(result.ordinary + result.extraordinary, /ทนายเอ|>บี</);
  assert.match(result.ordinary, />สมาชิกสามัญ<\/h2>/);
  assert.match(result.extraordinary, />สมาชิกวิสามัญ<\/h2>/);
  assert.match(result.coaching, />Coaching Staff<\/h2>/);
});

test("unavailable public client shows empty states without inventing any people", async () => {
  const result = await renderPage([], { available: false });
  assert.deepEqual(result.calls, []);
  assert.match(result.ordinary, /Team member profiles will be updated soon/);
  assert.equal(names(result.extraordinary).length, 0);
  assert.match(result.coaching, /Coming Soon/);
});

test("existing responsive grid/photo crops and links are preserved without a runtime Staff array", async () => {
  const result = await renderPage([row("member", { nickname: "ชื่อยาวสำหรับทดสอบการตัดบรรทัด" }), ...staffRows]);
  assert.match(result.ordinary, /grid-cols-2.*md:grid-cols-3 lg:grid-cols-4/);
  assert.match(result.extraordinary, /grid-cols-2.*sm:grid-cols-3 lg:grid-cols-6/);
  assert.match(result.ordinary, /size-\[130px\]/);
  assert.match(result.ordinary, /max-w-full break-words/);
  for (const href of ["/", "/gallery", "/partners", "https://web.facebook.com/KlongSamWaLawyers"]) assert.ok(result.html.includes(`href="${href}"`));
  assert.match(result.extraordinary, /scale\(1\.9\)/);
  assert.match(source, /shuffleTeamMembers\(groups\.ordinary\)/);
  assert.match(source, /shuffleTeamMembers\(groups\.extraordinary\)/);
  const helperSource = readFileSync(new URL("../src/lib/public-team-members.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source + helperSource, /staticTeamStaff|usingStaticStaffFallback|static_staff/);
  for (const staff of staffRows) assert.ok(!helperSource.includes(staff.id));
});

test("inactive ordinary/extraordinary/coaches never render, independent of membership and role", async () => {
  const rows = [];
  for (const membership_type of ["ordinary", "extraordinary"]) {
    for (const club_role of ["member", "staff", "coach", "assistant_coach"]) {
      rows.push(row(`${membership_type}-${club_role}`, { membership_type, club_role, is_active: false }));
    }
  }
  const result = await renderPage(rows);
  assert.deepEqual(names(result.ordinary), []);
  assert.deepEqual(names(result.extraordinary), []);
  assert.deepEqual(names(result.coaching), ["Coming Soon"]);
  for (const member of rows) assert.ok(!result.html.includes(member.nickname));
});

test("each server render shuffles extraordinary independently after grouping, never coaching", async () => {
  const rows = [
    row("o1"), row("e1", { membership_type: "extraordinary" }), row("c2", { club_role: "coach" }),
    row("o2"), row("e2", { membership_type: "extraordinary" }), row("c1", { club_role: "assistant_coach" }),
    row("e3", { membership_type: "extraordinary" }),
  ];
  const first = await renderPage(rows, { random: () => 0 });
  const second = await renderPage(rows, { random: () => 0.999 });
  for (const result of [first, second]) {
    assert.deepEqual(result.shuffledGroups, [["o1", "o2"], ["e1", "e2", "e3"]]);
    assert.deepEqual(names(result.ordinary).sort(), ["ทนายo1", "ทนายo2"]);
    assert.deepEqual(names(result.extraordinary).sort(), ["e1", "e2", "e3"]);
    assert.deepEqual(names(result.coaching), ["ทนายc2", "ทนายc1"]);
  }
  assert.notDeepEqual(names(first.extraordinary), names(second.extraordinary));
  assert.doesNotMatch(source, /["']use client["']|useEffect|useState|shuffleTeamMembers\(groups\.coaching\)/);
});

test("deactivation is reflected on the next request without resurrecting a static profile", async () => {
  const before = await renderPage(staffRows);
  const after = await renderPage(staffRows.map((member, index) => ({ ...member, is_active: index !== 0 })));
  assert.equal(names(before.extraordinary).length, 6);
  assert.equal(names(after.extraordinary).length, 5);
  assert.ok(!after.html.includes(staffRows[0].nickname));
  assert.ok(!after.html.includes(staffRows[0].photo_url));
});

test("query failure keeps people hidden instead of replacing them with static records", async (context) => {
  context.mock.method(console, "error", () => {});
  const result = await renderPage(staffRows, { queryError: true });
  assert.equal(names(result.ordinary).length, 0);
  assert.equal(names(result.extraordinary).length, 0);
  assert.deepEqual(names(result.coaching), ["Coming Soon"]);
});

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
const staffRows = grouping.staticTeamStaff.map((staff) => row(staff.id, { ...staff, membership_type: "extraordinary", club_role: "staff" }));

async function renderPage(rows, available = true) {
  const calls = [];
  const snapshot = structuredClone(rows);
  const client = { from(table) {
    assert.equal(table, "club_members");
    calls.push(["from", table]);
    const query = {
      select(columns) { calls.push(["select", columns]); return query; },
      eq(column, value) { calls.push(["eq", column, value]); return query; },
      order(column, options) {
        calls.push(["order", column, options]);
        return Promise.resolve({ data: rows.filter((member) => member.is_active), error: null });
      },
    };
    return query;
  } };
  const imports = {
    "react/jsx-runtime": jsxRuntime,
    "next/link": ({ children, ...props }) => createElement("a", props, children),
    "@/components/facebook-icon": { FacebookIcon: () => null },
    "@/lib/club-members": memberPresentation,
    "@/lib/public-team-members": grouping,
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
  return { html, calls, ordinary: sections[1], extraordinary: sections[2], coaching: sections[3] };
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

test("staged inactive Staff retain the original six profiles without rendering inactive DB records", async () => {
  const result = await renderPage(staffRows.map((member) => ({ ...member, is_active: false, nickname: "INACTIVE DB NAME" })));
  assert.deepEqual(names(result.extraordinary), grouping.staticTeamStaff.map((staff) => staff.nickname));
  assert.doesNotMatch(result.html, /INACTIVE DB NAME/);
  assert.match(result.extraordinary, /scale\(1\.9\)/);
  assert.match(result.coaching, /Coming Soon/);
});

test("partial activation does not duplicate Staff or hide other active extraordinary people", async () => {
  const result = await renderPage([
    ...staffRows.slice(0, 3).map((member) => ({ ...member, nickname: "PARTIAL DB NAME" })),
    row("other-extraordinary", { nickname: "ผู้สนับสนุน", membership_type: "extraordinary" }),
    row("ordinary-go", { nickname: "โก้" }),
  ]);
  assert.deepEqual(names(result.extraordinary), [...grouping.staticTeamStaff.map((staff) => staff.nickname), "ผู้สนับสนุน"]);
  assert.deepEqual(names(result.ordinary), ["ทนายโก้"]);
  assert.doesNotMatch(result.html, /PARTIAL DB NAME/);
});

test("all six active IDs switch the actual page to DB names/photos and never render a second Staff list", async () => {
  const result = await renderPage(staffRows.map((member, index) => ({ ...member, nickname: `DB-${index}`, photo_url: `/updated-${index}.webp` })));
  assert.deepEqual(names(result.extraordinary), staffRows.map((_, index) => `DB-${index}`));
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

test("unavailable public client retains safe empty member/coaching states and the static fallback", async () => {
  const result = await renderPage([], false);
  assert.deepEqual(result.calls, []);
  assert.match(result.ordinary, /Team member profiles will be updated soon/);
  assert.equal(names(result.extraordinary).length, 6);
  assert.match(result.coaching, /Coming Soon/);
});

test("existing responsive grid/photo sizes, links and ordinary-only shuffle are preserved", async () => {
  const result = await renderPage([row("member", { nickname: "ชื่อยาวสำหรับทดสอบการตัดบรรทัด" })]);
  assert.match(result.ordinary, /grid-cols-2.*md:grid-cols-3 lg:grid-cols-4/);
  assert.match(result.extraordinary, /grid-cols-2.*sm:grid-cols-3 lg:grid-cols-6/);
  assert.match(result.ordinary, /size-\[130px\]/);
  assert.match(result.ordinary, /max-w-full break-words/);
  for (const href of ["/", "/gallery", "/partners", "https://web.facebook.com/KlongSamWaLawyers"]) assert.ok(result.html.includes(`href="${href}"`));
  assert.match(source, /shuffle\(groups\.ordinary\)/);
  assert.equal((source.match(/Math\.random\(/g) ?? []).length, 1);
});

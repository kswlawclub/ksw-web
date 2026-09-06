// Executes the real actions against a strictly in-memory adapter. No credentials/network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "lucide-react";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const members = await import(new URL("../src/lib/club-members.ts", import.meta.url).href);
const actionsPath = "src/app/admin/members/actions.ts";
const adminPath = "src/app/admin/members/page.tsx";
const registrationPath = "src/app/admin/members/registration/page.tsx";
const lineupClientPath = "src/app/lineup-builder/lineup-builder-client.tsx";
const id = "c522634a-8515-4bfe-a45d-bf37a7416a99";
const staged = { ...members.parseMemberPayload({ nickname: "โก้", membership_type: "extraordinary", club_role: "staff", is_active: false, lineup_enabled: false, photo_url: "/images/staff/staff-04.png" }).payload, id, created_at: "2026-09-06", updated_at: null };

function loadModule(path, imports) {
  const { outputText } = ts.transpileModule(read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  const loaded = { exports: {} };
  const requireMock = (name) => {
    assert.ok(Object.hasOwn(imports, name), `Unmocked import blocked: ${name}`);
    return imports[name];
  };
  new Function("require", "module", "exports", outputText)(requireMock, loaded, loaded.exports);
  return loaded.exports;
}

// Exercise the actual local event/cleanup functions without mounting UI or calling actions.
function localCallback(path, predicate, bindings) {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (!found && predicate(node, source)) found = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `Callback not found in ${path}`);
  const expression = ts.isCallExpression(found) ? found.arguments[0] : found;
  const { outputText } = ts.transpileModule(`const callback = ${expression.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  return new Function(...Object.keys(bindings), `${outputText}\nreturn callback;`)(...Object.values(bindings));
}

const namedFunction = (name) => (node) => ts.isFunctionDeclaration(node) && node.name?.text === name;

function photoHarness() {
  const liveUrls = new Set();
  const revoked = [];
  let sequence = 0;
  let selection = null;
  const bindings = {
    URL: {
      createObjectURL() { const url = `blob:test-${++sequence}`; liveUrls.add(url); return url; },
      revokeObjectURL(url) { assert.ok(liveUrls.delete(url), "URL must be released once"); revoked.push(url); },
    },
    photoPreviewUrlRef: { current: null },
    setPhotoSelection: (next) => { selection = next; },
  };
  const select = localCallback(adminPath, namedFunction("selectPhotoFile"), bindings);
  const setupCleanup = localCallback(adminPath, (node, source) => ts.isCallExpression(node)
    && node.expression.getText(source) === "useEffect"
    && node.arguments[0].getText(source).includes("photoPreviewUrlRef"), bindings);
  return { select, cleanup: setupCleanup(), liveUrls, revoked, current: () => selection };
}

test("photo selection keeps file/URL atomic and releases replacements even before another render", () => {
  const harness = photoHarness();
  const first = { name: "first.png" };
  const second = { name: "second.png" };
  harness.select(first);
  assert.deepEqual(harness.current(), { file: first, previewUrl: "blob:test-1" });
  harness.select(second);
  assert.deepEqual(harness.current(), { file: second, previewUrl: "blob:test-2" });
  assert.deepEqual([...harness.liveUrls], ["blob:test-2"]);
  assert.deepEqual(harness.revoked, ["blob:test-1"]);
  harness.select(null);
  assert.equal(harness.current(), null);
  assert.equal(harness.liveUrls.size, 0);
  harness.select(null);
  harness.cleanup();
  assert.deepEqual(harness.revoked, ["blob:test-1", "blob:test-2"]);
});

test("photo unmount cleanup releases the current URL and is safe to repeat", () => {
  const harness = photoHarness();
  // Initial Strict Mode effect cleanup has no resource and does not change state.
  harness.cleanup();
  harness.select({ name: "new.png" });
  harness.cleanup();
  harness.cleanup();
  assert.equal(harness.liveUrls.size, 0);
  assert.deepEqual(harness.revoked, ["blob:test-1"]);
});

test("cancel/edit/save/remove/invalid photo paths all clear selection through the event handler", () => {
  const source = read(adminPath);
  assert.doesNotMatch(source, /setPhotoFile|setPhotoPreview/);
  assert.match(source, /photoFile = photoSelection\?\.file \?\? null/);
  assert.match(source, /photoPreview = photoSelection\?\.previewUrl \?\? ""/);
  assert.equal((source.match(/selectPhotoFile\(null\)/g) ?? []).length, 7);
  assert.match(source, /selectPhotoFile\(file\)/);
});

test("role guide resets on opening/switching positions, not on same-position click or drag mode", () => {
  for (const [active, next, moving, expectedExpanded, expectedPosition] of [
    [null, 0, false, false, 0], [0, 1, false, false, 1],
    [1, 1, false, true, 1], [null, 1, false, false, 1], [0, 1, true, true, 0],
  ]) {
    let expanded = true;
    let position = active;
    const open = localCallback(lineupClientPath, namedFunction("openPositionPicker"), {
      activePickerPosition: active, movePositionsMode: moving,
      setMobileRoleGuideExpanded: (value) => { expanded = value; },
      setActivePickerPosition: (value) => { position = value; },
    });
    open(next);
    assert.equal(expanded, expectedExpanded);
    assert.equal(position, expectedPosition);
  }
  const source = read(lineupClientPath);
  assert.equal((source.match(/setMobileRoleGuideExpanded\(false\)/g) ?? []).length, 1);
  assert.match(source, /document\.addEventListener\("keydown", closeOnEscape\)/);
  assert.match(source, /document\.addEventListener\("mousedown", closeOnOutsideClick\)/);
  assert.doesNotMatch(source, /eslint-disable/);
});

function actionHarness(seed = [staged], options = {}) {
  const rows = structuredClone(seed);
  const calls = [];
  const refreshed = [];
  let authorized = false;
  const client = {
    from(table) {
      assert.equal(authorized, true);
      assert.equal(table, "club_members");
      let patch;
      let target;
      const query = {
        select(columns) { calls.push(["select", columns]); return query; },
        order(column, order) { calls.push(["order", column, order]); return Promise.resolve({ data: structuredClone(rows), error: null }); },
        insert(payload) { calls.push(["insert", payload]); rows.push({ ...payload, id: "test-created-id" }); return Promise.resolve({ error: null }); },
        update(payload) { patch = payload; calls.push(["update", payload]); return query; },
        eq(column, value) { assert.equal(column, "id"); target = value; return query; },
        maybeSingle() {
          if (options.writeError) return Promise.resolve({ error: { message: "Write rejected" }, data: null });
          const row = rows.find((member) => member.id === target);
          if (row && patch) Object.assign(row, patch);
          return Promise.resolve({ data: row ? { id: row.id } : null, error: null });
        },
      };
      return query;
    },
  };
  const actions = loadModule(actionsPath, {
    sharp: () => { throw new Error("Lifecycle must not process photos"); },
    "next/cache": { revalidatePath: (path) => refreshed.push(path) },
    "@/lib/club-members": members,
    "@/lib/admin-server-auth": { requireAdminSession: async () => { if (options.deny) throw new Error("Unauthorized"); authorized = true; } },
    "@/lib/supabase-admin": { getSupabaseAdmin: () => { assert.equal(authorized, true); return client; } },
  });
  return { actions, rows, calls, refreshed };
}

// Render the real page and dispatch its callbacks with local state and in-memory actions only.
function adminPresentationHarness(seed) {
  const backend = actionHarness(seed);
  const states = [];
  let cursor = 0;
  const page = loadModule(adminPath, {
    "react/jsx-runtime": jsxRuntime,
    react: { ...React,
      useState(initial) {
        const index = cursor++;
        if (!Object.hasOwn(states, index)) states[index] = index === 0 ? false : Array.isArray(initial) ? structuredClone(seed) : initial;
        return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
      },
      useEffect() {}, useMemo: (derive) => derive(), useRef: (current) => ({ current }),
    },
    "next/link": ({ children, ...props }) => React.createElement("a", props, children),
    "lucide-react": icons,
    "@/lib/club-members": members,
    "./actions": backend.actions,
  });
  function render() {
    cursor = 0;
    const tree = page.default();
    const nodes = [];
    function visit(node) {
      if (Array.isArray(node)) node.forEach(visit);
      else if (React.isValidElement(node)) { nodes.push(node); visit(node.props.children); }
    }
    visit(tree);
    return { html: renderToStaticMarkup(tree), nodes };
  }
  return { ...backend, render };
}

test("Admin defaults to current members; tabs separate rows/counts and filters keep base totals", () => {
  const current = { ...staged, id: "current", nickname: "current-only", is_active: true, membership_type: "ordinary", club_role: "coach" };
  const harness = adminPresentationHarness([staged, current]);
  let rendered = harness.render();
  assert.match(rendered.html, /สมาชิกปัจจุบัน 1 คน/);
  assert.match(rendered.html, /aria-selected="true"[^>]*id="member-tab-active"/);
  assert.equal(rendered.nodes.filter((node) => node.type === "tr").length, 2);
  assert.ok(rendered.nodes.some((node) => node.key === current.id));
  assert.ok(!rendered.nodes.some((node) => node.key === staged.id));
  rendered.nodes.find((node) => node.props.role === "tab" && node.props.id === "member-tab-inactive").props.onClick();
  rendered = harness.render();
  assert.match(rendered.html, /รายชื่อที่ไม่ใช้งาน 1 รายการ/);
  assert.ok(rendered.nodes.some((node) => node.key === staged.id));
  assert.ok(!rendered.nodes.some((node) => node.key === current.id));
  const typeSelect = rendered.nodes.find((node) => node.type === "select" && node.props.children?.[0]?.props?.children === "ทุกประเภท");
  typeSelect.props.onChange({ target: { value: "ordinary" } });
  rendered = harness.render();
  assert.match(rendered.html, /แสดง 0 จาก 1 รายการ/);
  assert.match(rendered.html, /ไม่พบรายชื่อที่ไม่ใช้งาน/);
  assert.equal(rendered.nodes.filter((node) => node.props.role === "tab").length, 2);
  assert.equal(harness.calls.length, 0);
});

test("Admin lifecycle callback reloads rows, moves records between tabs and updates public counts", async () => {
  const original = { ...staged, is_active: true, lineup_enabled: true };
  const harness = adminPresentationHarness([original]);
  const previousWindow = globalThis.window;
  let confirmations = 0;
  globalThis.window = { confirm: () => { confirmations++; return true; } };
  try {
    let rendered = harness.render();
    rendered.nodes.find((node) => node.type === "button" && String(node.props.onClick).includes("changeMemberStatus")).props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    rendered = harness.render();
    assert.equal(confirmations, 1);
    assert.match(rendered.html, /สมาชิกปัจจุบัน 0 คน/);
    assert.equal(rendered.nodes.some((node) => node.key === staged.id), false);
    assert.deepEqual(harness.rows, [{ ...original, is_active: false }]);
    assert.equal(members.getCurrentMemberCounts(harness.rows).total, 0);
    rendered.nodes.find((node) => node.props.id === "member-tab-inactive").props.onClick();
    rendered = harness.render();
    assert.match(rendered.html, /รายชื่อที่ไม่ใช้งาน 1 รายการ/);
    rendered.nodes.find((node) => node.type === "button" && String(node.props.onClick).includes("changeMemberStatus")).props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    rendered = harness.render();
    assert.match(rendered.html, /รายชื่อที่ไม่ใช้งาน 0 รายการ/);
    assert.deepEqual(harness.rows, [original]);
    assert.equal(members.getCurrentMemberCounts(harness.rows).total, 1);
    assert.equal(confirmations, 1);
    assert.ok(harness.refreshed.includes("/team"));
    assert.equal(harness.calls.filter(([name]) => name === "order").length, 2);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("Admin status tabs support arrow/Home/End navigation with connected panel and focus", () => {
  const harness = adminPresentationHarness([staged]);
  const previousDocument = globalThis.document;
  let focused;
  globalThis.document = { getElementById: (id) => ({ focus: () => { focused = id; } }) };
  try {
    for (const [key, expected] of [["ArrowRight", "inactive"], ["ArrowRight", "active"], ["ArrowLeft", "inactive"], ["Home", "active"], ["End", "inactive"]]) {
      let prevented = false;
      const before = harness.render();
      const selected = before.nodes.find((node) => node.props.role === "tab" && node.props["aria-selected"]);
      selected.props.onKeyDown({ key, preventDefault: () => { prevented = true; } });
      assert.equal(prevented, true);
      assert.equal(focused, `member-tab-${expected}`);
      const after = harness.render();
      const tab = after.nodes.find((node) => node.props.role === "tab" && node.props["aria-selected"]);
      const panel = after.nodes.find((node) => node.props.role === "tabpanel");
      assert.equal(tab.props.id, focused);
      assert.equal(tab.props.tabIndex, 0);
      assert.equal(tab.props["aria-controls"], panel.props.id);
      assert.equal(panel.props["aria-labelledby"], focused);
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("real list action selects classification, includes inactive Staff and keeps original order contract", async () => {
  const { actions, rows, calls } = actionHarness();
  const result = await actions.listMembers();
  assert.deepEqual(result.members, rows);
  assert.equal(result.members[0].is_active, false);
  assert.match(calls[0][1], /membership_type, club_role/);
  assert.deepEqual(calls[1], ["order", "created_at", { ascending: false }]);
  assert.equal(calls.some(([name]) => name === "update" || name === "insert"), false);
});

test("real create/update actions reject invalid classification and flags before database access", async () => {
  for (const change of [{ membership_type: "ORDINARY" }, { membership_type: null }, { club_role: "admin" }, { club_role: ["coach"] }, { is_active: "false" }, { lineup_enabled: 1 }]) {
    const harness = actionHarness();
    for (const operation of [() => harness.actions.createMember({ ...staged, ...change }), () => harness.actions.updateMember(id, { ...staged, ...change })]) {
      assert.equal((await operation()).ok, false);
    }
    assert.deepEqual(harness.calls, []);
  }
});

test("real create supports ordinary/extraordinary coach without mandatory personal information", async () => {
  for (const membership_type of ["ordinary", "extraordinary"]) {
    const harness = actionHarness([]);
    const result = await harness.actions.createMember({ ...staged, membership_type, club_role: "coach", id: "ignored-client-id" });
    assert.equal(result.ok, true);
    assert.equal(harness.rows[0].club_role, "coach");
    assert.equal(harness.rows[0].membership_type, membership_type);
    assert.equal(harness.rows[0].lawyer_license_no, null);
    assert.equal(harness.calls[0][1].id, undefined);
  }
});

test("editing staged Staff preserves inactive/lineup flags, ID and membership type", async () => {
  const harness = actionHarness();
  assert.equal((await harness.actions.updateMember(id, { ...staged, nickname: "edited nickname" })).ok, true);
  assert.deepEqual(harness.rows[0], { ...staged, nickname: "edited nickname" });
});

test("real deactivate/reactivate actions preserve record, photo and independent lineup setting", async () => {
  for (const lineup_enabled of [true, false]) {
    const original = { ...staged, is_active: true, lineup_enabled };
    const harness = actionHarness([original]);
    assert.equal((await harness.actions.setMemberActive(id, false)).ok, true);
    assert.deepEqual(harness.rows, [{ ...original, is_active: false }]);
    assert.equal((await harness.actions.setMemberActive(id, true)).ok, true);
    assert.deepEqual(harness.rows, [original]);
    assert.deepEqual(harness.calls.filter(([name]) => name === "update").map(([, patch]) => patch), [{ is_active: false }, { is_active: true }]);
    assert.deepEqual(new Set(harness.refreshed), new Set(["/admin/members", "/admin/members/registration", "/team", "/lineup-builder"]));
  }
});

test("every member mutation/list requires Admin; hard-delete action is absent", async () => {
  const { actions, calls } = actionHarness([], { deny: true });
  for (const operation of [() => actions.listMembers(), () => actions.createMember(staged), () => actions.updateMember(id, staged), () => actions.setMemberActive(id, false)]) await assert.rejects(operation, /Unauthorized/);
  assert.deepEqual(calls, []);
  assert.equal(actions.deleteMemberById, undefined);
  assert.doesNotMatch(read(actionsPath), /\.delete\(/);
  assert.doesNotMatch(read(adminPath), /deleteMemberById|deleteMember\(/);
});

test("status action rejects invalid input and reports missing rows without false success", async () => {
  const harness = actionHarness([]);
  for (const [memberId, active] of [["", false], [id, "false"], [id, null], [id, 1]]) assert.equal((await harness.actions.setMemberActive(memberId, active)).ok, false);
  assert.deepEqual(harness.calls, []);
  assert.match((await harness.actions.setMemberActive(id, false)).error, /Member not found/);
  assert.deepEqual(harness.refreshed, []);
});

test("write errors do not refresh or report success", async () => {
  const harness = actionHarness([staged], { writeError: true });
  const result = await harness.actions.setMemberActive(id, true);
  assert.equal(result.ok, false);
  assert.deepEqual(harness.rows, [staged]);
  assert.deepEqual(harness.refreshed, []);
});

test("UI defaults and edit mappings preserve separate type/role/active/lineup values", () => {
  const source = read(adminPath);
  for (const entry of ["membershipType: defaultMemberClassification.membership_type", "clubRole: defaultMemberClassification.club_role", "membershipType: member.membership_type", "clubRole: member.club_role", "isActive: member.is_active", "lineupEnabled: member.lineup_enabled", "membership_type: form.membershipType", "club_role: form.clubRole"]) assert.ok(source.includes(entry));
  assert.match(source, /useState<MemberStatusTab>\("active"\)/);
  assert.doesNotMatch(source, /activeStatus|สถานะสมาชิก|members\.length\} members/);
  assert.match(source, /getMemberListView\(members, statusTab, filters\)/);
  assert.match(source, /\[\.\.\.listView\.rows\]\.sort\(\(a, b\) => compareMembers\(a, b, sortBy\)\)/);
  assert.match(source, /member\.is_active \? "Active" : "Inactive"/);
  assert.match(source, /member\.is_active \? "Deactivate" : "Reactivate"/);
  assert.match(source, /existing\?\.is_active && !form\.isActive && !window\.confirm\(memberDeactivationMessage\(existing\)\)/);
  assert.match(source, /member\.is_active && !window\.confirm\(memberDeactivationMessage\(member\)\)/);
  assert.match(source, /if \(mutationInFlight\.current\) return/);
});

test("Admin, Registration/CSV and Lineup use shared names; CSV keeps original default fields", () => {
  for (const path of [adminPath, registrationPath, "src/app/lineup-builder/lineup-builder-client.tsx"]) {
    const source = read(path);
    assert.match(source, /getMemberDisplayName/);
    assert.doesNotMatch(source, /function (?:publicMemberName|formatPublicLawyerName)/);
  }
  const registration = read(registrationPath);
  assert.match(registration, /activeOnly \? member\.is_active : true/);
  assert.match(registration, /value: \(member\) => member\.membership_type/);
  assert.match(registration, /value: \(member\) => member\.club_role/);
  assert.match(registration, /key: "publicDisplay".*getMemberDisplayName\(member\)/);
  const defaults = registration.match(/const defaultExportColumns: ExportColumnKey\[\] = \[([\s\S]*?)\];/)[1];
  assert.deepEqual([...defaults.matchAll(/"(\w+)"/g)].map((match) => match[1]), ["number", "fullName", "lawyerLicenseNo", "birthDate", "displayAge", "shirtNo", "nickname", "phone"]);
});

test("Lineup only adds the already-public membership_type column; eligibility stays active && lineup", () => {
  const query = read("src/app/lineup-builder/page.tsx");
  assert.match(query, /\.select\("id, nickname, photo_url, shirt_number, birth_year_be, is_active, lineup_enabled, membership_type"\)/);
  assert.match(query, /\.eq\("is_active", true\)\s*\.eq\("lineup_enabled", true\)/);
  assert.match(query, /\(member\) => member\.is_active && member\.lineup_enabled/);
  assert.doesNotMatch(query, /\.eq\("(?:membership_type|club_role)"/);
});

// Real modal handlers, action and installed Supabase SDK; all HTTP is a fixture.
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as icons from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import * as members from "../src/lib/club-members.ts";
import { fixtureId, loadRatingModule, ratingContract as rating, ratingDiagnostics, ratingRow, ratingSaveState } from "./lib/football-rating-test-support.mjs";

const uatValues = { pace: "84", shooting: "78", passing: "82", dribbling: "80", defending: "72", physical: "84" };
const uatInput = () => rating.footballRatingFormInput(fixtureId(), { rating_type: "player", values: uatValues });

function actionHarness({ failure, overall = 80 } = {}) {
  const requests = [];
  const refreshed = [];
  let authenticated = false;
  const client = createClient("https://rating-fixture.invalid", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, options) => {
      assert.equal(authenticated, true);
      const parsedUrl = new URL(url);
      assert.equal(parsedUrl.origin, "https://rating-fixture.invalid");
      assert.equal(parsedUrl.pathname, "/rest/v1/club_member_football_ratings");
      assert.equal(parsedUrl.searchParams.get("on_conflict"), "member_id");
      assert.deepEqual(parsedUrl.searchParams.get("select").split(","), rating.footballRatingColumns.split(",").map((column) => column.trim()));
      assert.equal(options.method, "POST");
      assert.equal(new Headers(options.headers).get("Accept"), "application/vnd.pgrst.object+json");
      const payload = JSON.parse(options.body);
      requests.push(payload);
      if (failure === "transport") throw new TypeError("PRIVATE fixture transport details");
      if (failure === "database") return Response.json({ code: "23503", message: "PRIVATE fixture error", details: "PRIVATE details", hint: null }, { status: 409 });
      if (failure === "return-shape") return Response.json({ ...payload, overall: null }, { status: 201 });
      if (failure === "return-id") return Response.json({ ...payload, member_id: fixtureId(2), overall }, { status: 201 });
      return Response.json({ ...payload, overall }, { status: 201 });
    } },
  });
  const actions = loadRatingModule("src/app/admin/members/rating-actions.ts", {
    "next/cache": { revalidatePath(path) {
      if (failure === "revalidate") throw new Error("PRIVATE fixture revalidation error");
      if (failure === "revalidate-team" && path === "/team") throw new Error("PRIVATE fixture team revalidation error");
      refreshed.push(path);
    } },
    "@/lib/admin-server-auth": { requireAdminSession: async () => {
      if (failure === "auth") throw new Error("PRIVATE fixture auth error");
      authenticated = true;
    } },
    "@/lib/supabase-admin": { getSupabaseAdmin: () => {
      assert.equal(authenticated, true);
      if (failure === "client-init") throw new Error("PRIVATE fixture client initialization error");
      if (failure === "client-missing") return null;
      if (failure === "query-throw") return { from() { throw new Error("PRIVATE fixture SDK error"); } };
      return client;
    } },
    "@/lib/club-members": members,
    "@/lib/member-football-rating": {
      ...rating,
      ...(failure === "prepare" ? { parseFootballRatingInput() { throw new Error("PRIVATE fixture preparation error"); } } : {}),
      ...(failure === "readback-throw" ? { readFootballRating() { throw new Error("PRIVATE fixture readback error"); } } : {}),
    },
    "@/lib/member-football-rating-diagnostics": ratingDiagnostics,
  });
  return { actions, requests, refreshed };
}

// A hook adapter exercises the existing JSX's onChange/onSubmit closures without
// a browser, action transport or copies of the production event-handler logic.
function modalHarness(actions, { callbackFailure = false, initialRating = null } = {}) {
  const states = [];
  const refs = [];
  const saved = [];
  const closed = [];
  let stateCursor = 0;
  let refCursor = 0;
  const modal = loadRatingModule("src/components/admin-member-rating-modal.tsx", {
    react: {
      ...React,
      useId: () => "fixture-dialog",
      useEffect: () => {},
      useRef(value) {
        const index = refCursor++;
        if (!Object.hasOwn(refs, index)) refs[index] = { current: value };
        return refs[index];
      },
      useState(value) {
        const index = stateCursor++;
        if (!Object.hasOwn(states, index)) states[index] = typeof value === "function" ? value() : value;
        return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
      },
    },
    "react/jsx-runtime": jsx,
    "next/image": () => null,
    "lucide-react": icons,
    "@/app/admin/members/rating-actions": actions,
    "@/lib/club-members": members,
    "@/lib/member-football-rating": rating,
    "@/lib/member-football-rating-diagnostics": ratingDiagnostics,
    "@/lib/member-football-rating-save-state": ratingSaveState,
    "@/components/admin-football-rating-guide": { AdminFootballRatingGuide: () => null },
  });
  function render() {
    stateCursor = 0;
    refCursor = 0;
    return modal.AdminMemberRatingModal({
      member: { id: fixtureId(), nickname: "Fixture", membership_type: "ordinary", club_role: "member", photo_url: null },
      initialRating,
      onClose() { closed.push(true); },
      onSaved(value) {
        if (callbackFailure) throw new Error("PRIVATE fixture callback error");
        saved.push(value);
      },
    });
  }
  function elements(predicate) {
    function visit(node) {
      if (Array.isArray(node)) return node.flatMap(visit);
      if (!React.isValidElement(node)) return [];
      return [...(predicate(node) ? [node] : []), ...visit(node.props.children)];
    }
    return visit(render());
  }
  function fill(values = uatValues, type = "player") {
    for (const { field, label } of rating.footballStats[type]) {
      const [input] = elements((node) => node.type === "input" && node.props["aria-label"]?.startsWith(`${label} `));
      input.props.onChange({ target: { value: values[field] } });
    }
  }
  async function submit() {
    let prevented = false;
    const [form] = elements((node) => node.type === "form");
    await form.props.onSubmit({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  }
  const button = (label) => elements((node) => node.type === "button" && content(node) === label)[0];
  const status = () => content(elements((node) => node.props.role === "status")[0]);
  return { fill, submit, saved, closed, elements, button, status };
}

function content(node) {
  if (Array.isArray(node)) return node.map(content).join("");
  if (React.isValidElement(node)) return content(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}

test("UAT Player values pass real modal handlers, action, SDK JSON body and DB return contract", async () => {
  const h = actionHarness();
  const modal = modalHarness(h.actions);
  modal.fill();
  assert.equal(modal.elements((node) => node.type === "output")[0].props.children, 80);
  assert.equal(modal.elements((node) => node.props.type === "submit")[0].props.disabled, false);
  await modal.submit();
  assert.equal(h.requests.length, 1);
  const [payload] = h.requests;
  assert.equal(payload.member_id, fixtureId());
  assert.equal(payload.rating_type, "player");
  assert.equal(Object.hasOwn(payload, "overall"), false);
  for (const [field, value] of Object.entries(uatValues)) assert.equal(payload[field], Number(value));
  for (const { field } of rating.footballStats.goalkeeper) assert.equal(payload[field], null);
  assert.deepEqual(Object.keys(payload).sort(), ["member_id", "rating_type", ...Object.keys(uatValues), ...rating.footballStats.goalkeeper.map(({ field }) => field)].sort());
  assert.deepEqual(h.refreshed, ["/admin/members", "/team"]);
  assert.deepEqual(modal.saved, [{ ...payload, overall: 80 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(modal.saved[0])), modal.saved[0]);
  assert.equal(modal.elements((node) => node.props.role === "alert").length, 0);
  assert.match(modal.status(), /บันทึกเรียบร้อยแล้ว.*OVR 80/);
});

test("successful save accepts the returned DB overall rather than recomputing the preview", async () => {
  const h = actionHarness({ overall: 81 });
  const modal = modalHarness(h.actions);
  modal.fill();
  await modal.submit();
  assert.equal(modal.saved[0].overall, 81);
  assert.equal(modal.elements((node) => node.type === "output")[0].props.children, 81);
});

test("client and server validation prevent an invalid write before transport", async () => {
  const h = actionHarness();
  const modal = modalHarness(h.actions);
  modal.fill({ ...uatValues, pace: "" });
  await modal.submit();
  const result = await h.actions.saveMemberFootballRating({ ...uatInput(), overall: 80 });
  assert.deepEqual(result, ratingDiagnostics.footballRatingFailure("RATING_VALIDATION"));
  assert.equal(h.requests.length, 0);
});

for (const [failure, code] of [
  ["database", "RATING_DB_WRITE"], ["transport", "RATING_DB_WRITE"],
  ["return-shape", "RATING_READBACK"], ["return-id", "RATING_READBACK"],
]) {
  test(`${failure} returns ${code} with a visible safe code, not a raw DB/transport error`, async () => {
    const h = actionHarness({ failure });
    const modal = modalHarness(h.actions);
    modal.fill();
    await modal.submit();
    const [alert] = modal.elements((node) => node.props.role === "alert");
    assert.ok(alert);
    assert.equal(h.requests.length, 1);
    assert.match(alert.props.children, new RegExp(`^บันทึกไม่สำเร็จ \\[รหัส: ${code}\\]`));
    assert.doesNotMatch(alert.props.children, /PRIVATE/);
    assert.equal(modal.saved.length, 0);
    assert.deepEqual(h.refreshed, []);
  });
}

// These prove classification at each boundary, not the as-yet unknown UAT cause.
for (const [failure, code, writes] of [
  ["auth", "RATING_AUTH", 0], ["client-init", "RATING_CLIENT_INIT", 0],
  ["client-missing", "RATING_CLIENT_INIT", 0], ["prepare", "RATING_SERVER", 0],
  ["query-throw", "RATING_DB_WRITE", 0], ["readback-throw", "RATING_READBACK", 1],
  ["revalidate", "RATING_REVALIDATE", 1], ["revalidate-team", "RATING_REVALIDATE", 1],
  ["action-transport", "RATING_TRANSPORT", 0], ["success-callback", "RATING_CLIENT_STATE", 1],
]) {
  test(`${failure} is classified as ${code}, never retried and does not leak details`, async (t) => {
    const logs = [];
    t.mock.method(console, "error", (...args) => logs.push(args));
    const h = actionHarness({ failure });
    const actions = failure === "action-transport" ? { ...h.actions, saveMemberFootballRating: async () => { throw new Error("PRIVATE fixture action transport error"); } } : h.actions;
    const modal = modalHarness(actions, { callbackFailure: failure === "success-callback" });
    modal.fill();
    await modal.submit();
    const [alert] = modal.elements((node) => node.props.role === "alert");
    assert.match(alert.props.children, new RegExp(`^บันทึกไม่สำเร็จ \\[รหัส: ${code}\\]`));
    assert.doesNotMatch(alert.props.children, /PRIVATE/);
    assert.equal(h.requests.length, writes);
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|fixture-key|fixture-secret|member_id|stack/);
    for (const log of logs) assert.deepEqual(log, ["member football rating save failed", { code }]);
    assert.equal(modal.elements((node) => node.props.role === "status").length, 0);
    assert.equal(modal.elements((node) => node.props.type === "submit")[0].props.disabled, false);
    if (code === "RATING_REVALIDATE") assert.match(alert.props.children, /บันทึก Rating แล้ว.*ก่อนบันทึกซ้ำ/);
  });
}

test("every server boundary returns a serializable safe failure without raw errors or extra properties", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const [failure, code] of [
    ["auth", "RATING_AUTH"], ["client-init", "RATING_CLIENT_INIT"],
    ["database", "RATING_DB_WRITE"], ["return-shape", "RATING_READBACK"],
    ["revalidate", "RATING_REVALIDATE"], ["prepare", "RATING_SERVER"],
  ]) {
    const h = actionHarness({ failure });
    const result = await h.actions.saveMemberFootballRating(uatInput());
    assert.deepEqual(JSON.parse(JSON.stringify(result)), ratingDiagnostics.footballRatingFailure(code));
    assert.deepEqual(Object.keys(result).sort(), ["code", "error", "ok"]);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|23503|fixture-key|member_id|stack/);
  }
});

test("the modal ignores unexpected server messages/codes and handles missing responses safely", async () => {
  for (const response of [
    { ok: false, error: "PRIVATE legacy server error" },
    { ok: false, code: "PRIVATE exception", error: "PRIVATE database error" },
    { ok: false, code: "RATING_DB_WRITE", error: "PRIVATE database error" },
    undefined,
  ]) {
    const modal = modalHarness({ saveMemberFootballRating: async () => response });
    modal.fill();
    await modal.submit();
    const [alert] = modal.elements((node) => node.props.role === "alert");
    const expected = response === undefined ? "RATING_TRANSPORT" : response.code === "RATING_DB_WRITE" ? "RATING_DB_WRITE" : "RATING_SERVER";
    assert.match(alert.props.children, new RegExp(`\\[รหัส: ${expected}\\]`));
    assert.doesNotMatch(alert.props.children, /PRIVATE/);
  }
});

test("duplicate submissions still perform only one write and update the parent once", async () => {
  const h = actionHarness();
  const modal = modalHarness(h.actions);
  modal.fill();
  const first = modal.submit();
  const second = modal.submit();
  await first;
  await second;
  assert.equal(h.requests.length, 1);
  assert.equal(modal.saved.length, 1);
});

test("normalized saved snapshot derives clean/dirty, rejects partial values and uses DB overall for both types", () => {
  for (const type of ["player", "goalkeeper"]) {
    const saved = { ...ratingRow(type), overall: 61 };
    const form = rating.createFootballRatingForm(saved);
    const snapshot = structuredClone({ saved, form });
    const derive = (values) => ratingSaveState.deriveFootballRatingSaveState(saved.member_id, { ...form, values: { ...form.values, ...values } }, saved);
    assert.equal(derive({}).kind, "saved");
    assert.equal(derive({}).canSave, false);
    assert.equal(derive({}).overall, 61);
    for (const { field } of rating.footballStats[type]) {
      for (const normalized of ["60", "060", "60.0", " 60 ", "6e1"]) {
        assert.equal(derive({ [field]: normalized }).dirty, false);
      }
      assert.equal(derive({ [field]: "61" }).dirty, true);
      assert.equal(derive({ [field]: "61" }).canSave, true);
      for (const invalid of ["", "bad", "0", "100", "1.5"]) {
        assert.equal(derive({ [field]: invalid }).dirty, true);
        assert.equal(derive({ [field]: invalid }).canSave, false);
      }
    }
    const opposite = rating.createFootballRatingForm(null, type === "player" ? "goalkeeper" : "player");
    const changed = ratingSaveState.deriveFootballRatingSaveState(saved.member_id, opposite, saved);
    assert.equal(changed.dirty, true);
    assert.equal(changed.canSave, false);
    assert.deepEqual({ saved, form }, snapshot);
  }
});

test("existing Rating opens saved with disabled submit, editing then reverting restores clean without any write", async () => {
  const h = actionHarness();
  const initialRating = { ...rating.parseFootballRatingInput(uatInput()).payload, overall: 80 };
  const modal = modalHarness(h.actions, { initialRating });
  assert.equal(modal.status(), "บันทึกแล้วOVR 80");
  assert.ok(modal.button("บันทึกแล้ว").props.disabled);
  await modal.submit();
  assert.equal(h.requests.length, 0);
  modal.fill({ ...uatValues, pace: "85" });
  assert.equal(modal.status(), "มีการแก้ไขที่ยังไม่บันทึก");
  assert.equal(modal.button("บันทึกการเปลี่ยนแปลง").props.disabled, false);
  modal.fill();
  assert.ok(modal.button("บันทึกแล้ว").props.disabled);
  modal.elements((node) => node.type === "input" && node.props.value === "goalkeeper")[0].props.onChange();
  assert.equal(modal.status(), "มีการแก้ไขที่ยังไม่บันทึก");
  assert.ok(modal.button("บันทึกการเปลี่ยนแปลง").props.disabled);
});

test("new Rating validates before save, adopts returned snapshot/overall, stays open and becomes dirty again on edit", async () => {
  const h = actionHarness({ overall: 81 });
  const modal = modalHarness(h.actions);
  assert.equal(modal.status(), "ยังไม่ได้ตั้งค่าความสามารถ");
  assert.ok(modal.button("บันทึก Rating").props.disabled);
  modal.fill({ ...uatValues, pace: "" });
  assert.ok(modal.button("บันทึก Rating").props.disabled);
  modal.fill();
  assert.equal(modal.status(), "พร้อมบันทึก Rating");
  await modal.submit();
  assert.equal(modal.status(), "บันทึกเรียบร้อยแล้วOVR 81");
  assert.ok(modal.button("บันทึกแล้ว").props.disabled);
  assert.equal(modal.elements((node) => node.type === "output")[0].props.children, 81);
  assert.equal(modal.closed.length, 0);
  await modal.submit();
  assert.equal(h.requests.length, 1);
  modal.fill({ ...uatValues, pace: "85" });
  assert.equal(modal.status(), "มีการแก้ไขที่ยังไม่บันทึก");
  modal.fill();
  assert.equal(modal.status(), "บันทึกแล้วOVR 81");
});

test("clear keeps its existing confirmation, resets the snapshot and form, and leaves member lifecycle untouched", async () => {
  const calls = [];
  const modal = modalHarness({ clearMemberFootballRating: async (id) => { calls.push(id); return { ok: true, rating: null }; } }, { initialRating: ratingRow("goalkeeper") });
  modal.button("Clear Rating").props.onClick();
  assert.equal(calls.length, 0);
  modal.button("ยืนยันล้าง Rating").props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [fixtureId()]);
  assert.deepEqual(modal.saved, [null]);
  assert.equal(modal.status(), "ล้าง Rating เรียบร้อยแล้ว");
  assert.equal(modal.button("Clear Rating"), undefined);
  assert.ok(modal.button("บันทึก Rating").props.disabled);
  assert.equal(modal.elements((node) => node.type === "output")[0].props.children, "–");
  assert.deepEqual(modal.elements((node) => node.props.type === "number").map((node) => node.props.value), ["", "", "", "", "", ""]);
  modal.fill();
  assert.equal(modal.status(), "พร้อมบันทึก Rating");
});

test("every close path confirms normalized unsaved changes; cancel preserves input, clean and cleared close immediately", async (t) => {
  const previous = globalThis.window;
  const prompts = [];
  let accept = false;
  globalThis.window = { confirm: (message) => { prompts.push(message); return accept; } };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  const paths = [
    (modal) => modal.elements((node) => node.props["aria-label"] === "ปิด Football Rating")[0].props.onClick(),
    (modal) => modal.button("Cancel").props.onClick(),
    (modal) => modal.elements((node) => node.type === "dialog")[0].props.onCancel({ preventDefault() {} }),
    (modal) => { const target = { getBoundingClientRect: () => ({ left: 10, top: 10, right: 100, bottom: 100 }) }; modal.elements((node) => node.type === "dialog")[0].props.onClick({ target, currentTarget: target, clientX: 0, clientY: 0 }); },
  ];
  for (const close of paths) {
    const modal = modalHarness({}, { initialRating: ratingRow() });
    modal.fill();
    accept = false;
    close(modal);
    assert.equal(modal.closed.length, 0);
    assert.equal(modal.elements((node) => node.props.type === "number")[0].props.value, "84");
    accept = true;
    close(modal);
    assert.equal(modal.closed.length, 1);
    const count = prompts.length;
    for (const initialRating of [null, ratingRow()]) {
      const clean = modalHarness({}, { initialRating });
      close(clean);
      assert.equal(clean.closed.length, 1);
      assert.equal(prompts.length, count);
    }
  }
  assert.ok(prompts.every((message) => message === "มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการออกโดยไม่บันทึกหรือไม่?"));
});

test("error replaces prior success, retains edits and diagnostic code; new edit clears the old error", async () => {
  let fail = false;
  const modal = modalHarness({ saveMemberFootballRating: async (input) => fail ? ratingDiagnostics.footballRatingFailure("RATING_DB_WRITE") : { ok: true, rating: { ...rating.parseFootballRatingInput(input).payload, overall: 80 } } });
  modal.fill();
  await modal.submit();
  modal.fill({ ...uatValues, pace: "85" });
  fail = true;
  await modal.submit();
  assert.equal(modal.status(), "");
  assert.match(content(modal.elements((node) => node.props.role === "alert")[0]), /RATING_DB_WRITE/);
  assert.equal(modal.button("บันทึกการเปลี่ยนแปลง").props.disabled, false);
  modal.fill();
  assert.equal(modal.status(), "บันทึกแล้วOVR 80");
  assert.equal(modal.elements((node) => node.props.role === "alert").length, 0);
});

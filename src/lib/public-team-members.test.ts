import assert from "node:assert/strict";
import test from "node:test";
import type { PublicTeamMember } from "./public-team-members";

const { groupPublicTeamMembers, staticTeamStaff }: typeof import("./public-team-members") = await import(new URL("./public-team-members.ts", import.meta.url).href);
const { getMemberDisplayName }: typeof import("./club-members") = await import(new URL("./club-members.ts", import.meta.url).href);

const member = (id: string, fields: Partial<PublicTeamMember> = {}): PublicTeamMember => ({
  id, nickname: id, photo_url: null, membership_type: "ordinary", club_role: "member", is_active: true, ...fields,
});
const staff = staticTeamStaff.map((entry) => member(entry.id, { ...entry, membership_type: "extraordinary", club_role: "staff" }));
const ids = (profiles: { id: string }[]) => profiles.map((profile) => profile.id);
const allProfiles = (groups: ReturnType<typeof groupPublicTeamMembers>) => [...groups.ordinary, ...groups.extraordinary, ...groups.coaching];

test("ordinary and extraordinary grouping uses active membership, independently of non-coaching roles", () => {
  const result = groupPublicTeamMembers([
    member("lawyer"), member("ordinary-staff", { club_role: "staff" }),
    member("supporter", { membership_type: "extraordinary" }),
    member("inactive-lawyer", { is_active: false }),
    member("inactive-staff", { membership_type: "extraordinary", is_active: false }),
  ]);
  assert.deepEqual(ids(result.ordinary), ["lawyer", "ordinary-staff"]);
  assert.deepEqual(ids(result.extraordinary).slice(6), ["supporter"]);
  assert.equal(allProfiles(result).some((profile) => profile.id.startsWith("inactive")), false);
});

test("ordinary/extraordinary coaches and assistants belong only to Coaching", () => {
  for (const membership_type of ["ordinary", "extraordinary"] as const) {
    for (const club_role of ["coach", "assistant_coach"] as const) {
      const result = groupPublicTeamMembers([member("coach", { membership_type, club_role }), member("inactive-coach", { club_role, is_active: false })]);
      assert.deepEqual(ids(result.coaching), ["coach"]);
      assert.equal(result.ordinary.length, 0);
      assert.equal(result.extraordinary.length, 6);
    }
  }
});

test("all 64 partial activation combinations retain one fallback per staged ID until all six are active", () => {
  for (let mask = 0; mask < 64; mask++) {
    const rows = staff.map((entry, index) => ({ ...entry, is_active: Boolean(mask & (1 << index)) }));
    const snapshot = structuredClone(rows);
    for (const input of [rows, rows.filter((entry) => entry.is_active)]) {
      const result = groupPublicTeamMembers(input);
      assert.equal(result.usingStaticStaffFallback, mask !== 63);
      assert.deepEqual(ids(result.extraordinary), ids(staff));
      assert.ok(result.extraordinary.every((entry) => entry.source === (mask === 63 ? "database" : "static_staff")));
      assert.equal(new Set(ids(allProfiles(result))).size, 6);
    }
    assert.deepEqual(rows, snapshot);
  }
});

test("complete activation uses actual DB names/photos without stale static overrides", () => {
  const rows = staff.map((entry, index) => ({ ...entry, nickname: `updated-${index}`, photo_url: `/new-${index}.webp` })).reverse();
  const result = groupPublicTeamMembers(rows);
  assert.equal(result.usingStaticStaffFallback, false);
  assert.deepEqual(ids(result.extraordinary), ids(staff));
  for (const profile of result.extraordinary) {
    const actual = rows.find((entry) => entry.id === profile.id)!;
    assert.equal(profile.nickname, actual.nickname);
    assert.equal(profile.photo_url, actual.photo_url);
    assert.equal(profile.source, "database");
  }
});

test("other extraordinary people remain visible in query order during fallback and after cutover", () => {
  const other = [member("newer", { membership_type: "extraordinary" }), member("older", { membership_type: "extraordinary" })];
  for (const staged of [[], staff.slice(0, 3), staff]) {
    const result = groupPublicTeamMembers([...other, ...staged]);
    assert.deepEqual(ids(result.extraordinary).slice(6), ["newer", "older"]);
  }
});

test("identity uses IDs, not names; duplicate input IDs cannot render across sections", () => {
  const result = groupPublicTeamMembers([
    member("ordinary-go", { nickname: "โก้" }), ...staff,
    member("ordinary-go", { nickname: "โก้", club_role: "coach" }), ...staff,
  ]);
  assert.deepEqual(ids(result.ordinary), ["ordinary-go"]);
  assert.equal(result.extraordinary.length, 6);
  assert.equal(result.coaching.length, 0);
  assert.equal(new Set(ids(allProfiles(result))).size, 7);
});

test("matching six nicknames or repeated IDs cannot trigger the fixed-ID cutover", () => {
  assert.equal(groupPublicTeamMembers(staff.map((entry, index) => ({ ...entry, id: `other-${index}` }))).usingStaticStaffFallback, true);
  assert.equal(groupPublicTeamMembers(Array(6).fill(staff[0])).usingStaticStaffFallback, true);
});

test("active staged coach takes precedence over their static copy and is never duplicated", () => {
  const result = groupPublicTeamMembers([{ ...staff[0], club_role: "coach" }]);
  assert.equal(result.usingStaticStaffFallback, true);
  assert.deepEqual(ids(result.coaching), [staff[0].id]);
  assert.equal(result.coaching[0].source, "database");
  assert.equal(result.extraordinary.length, 5);
  assert.equal(new Set(ids(allProfiles(result))).size, 6);
});

test("after cutover, membership type and coaching roles come from actual DB rows", () => {
  const result = groupPublicTeamMembers(staff.map((entry, index) => index === 0
    ? { ...entry, membership_type: "ordinary", club_role: "assistant_coach" }
    : index === 1 ? { ...entry, membership_type: "ordinary" } : entry));
  assert.deepEqual(ids(result.coaching), [staff[0].id]);
  assert.deepEqual(ids(result.ordinary), [staff[1].id]);
  assert.equal(result.extraordinary.length, 4);
});

test("shared display-name rule applies to database and fallback profiles, without duplicate honorifics", () => {
  const result = groupPublicTeamMembers([
    member("ordinary", { nickname: "ทนายทนายเอ" }),
    member("extraordinary", { nickname: "ทนายบี", membership_type: "extraordinary" }),
    member("coach", { nickname: "ซี", club_role: "coach" }),
  ]);
  assert.equal(getMemberDisplayName(result.ordinary[0]), "ทนายเอ");
  assert.equal(getMemberDisplayName(result.extraordinary[6]), "บี");
  assert.equal(getMemberDisplayName(result.coaching[0]), "ทนายซี");
  assert.equal(getMemberDisplayName(result.extraordinary[3]), "โก้");
});

test("grouping is pure, does not introduce randomness, and projects only public profile fields", () => {
  const rows = [member("second"), member("first")];
  const snapshot = structuredClone(rows);
  const result = groupPublicTeamMembers(rows);
  assert.deepEqual(groupPublicTeamMembers(rows), result);
  assert.deepEqual(rows, snapshot);
  assert.deepEqual(ids(result.ordinary), ["second", "first"]);
  assert.deepEqual(Object.keys(result.ordinary[0]).sort(), ["id", "nickname", "photo_url", "membership_type", "club_role", "source"].sort());
});

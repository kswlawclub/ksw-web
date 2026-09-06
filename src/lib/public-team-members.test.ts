import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PublicTeamMember } from "./public-team-members";

const { groupPublicTeamMembers, shuffleTeamMembers }: typeof import("./public-team-members") = await import(new URL("./public-team-members.ts", import.meta.url).href);
const { getMemberDisplayName }: typeof import("./club-members") = await import(new URL("./club-members.ts", import.meta.url).href);

const member = (id: string, fields: Partial<PublicTeamMember> = {}): PublicTeamMember => ({
  id, nickname: id, photo_url: null, membership_type: "ordinary", club_role: "member", is_active: true, ...fields,
});
// Read the immutable staging manifest as test fixtures only, never as runtime fallback.
const migration = readFileSync(new URL("../../supabase/migrations/202609060002_stage_static_team_staff.sql", import.meta.url), "utf8");
const staffManifest: Pick<PublicTeamMember, "id" | "nickname" | "photo_url">[] = JSON.parse(migration.match(/staff_manifest CONSTANT jsonb := \$staff\$([\s\S]*?)\$staff\$::jsonb;/)![1]);
const staff = staffManifest.map((entry) => member(entry.id, { ...entry, membership_type: "extraordinary", club_role: "staff" }));
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
  assert.deepEqual(ids(result.extraordinary), ["supporter"]);
  assert.equal(allProfiles(result).some((profile) => profile.id.startsWith("inactive")), false);
});

test("ordinary/extraordinary coaches and assistants belong only to Coaching", () => {
  for (const membership_type of ["ordinary", "extraordinary"] as const) {
    for (const club_role of ["coach", "assistant_coach"] as const) {
      const result = groupPublicTeamMembers([member("coach", { membership_type, club_role }), member("inactive-coach", { club_role, is_active: false })]);
      assert.deepEqual(ids(result.coaching), ["coach"]);
      assert.equal(result.ordinary.length, 0);
      assert.equal(result.extraordinary.length, 0);
    }
  }
});

test("all 64 staged activation combinations display only active IDs, with no fallback or six-person threshold", () => {
  for (let mask = 0; mask < 64; mask++) {
    const rows = staff.map((entry, index) => ({ ...entry, is_active: Boolean(mask & (1 << index)) }));
    const snapshot = structuredClone(rows);
    for (const input of [rows, rows.filter((entry) => entry.is_active)]) {
      const result = groupPublicTeamMembers(input);
      const active = rows.filter((entry) => entry.is_active);
      assert.deepEqual(ids(result.extraordinary), ids(active));
      assert.equal(new Set(ids(allProfiles(result))).size, active.length);
    }
    assert.deepEqual(rows, snapshot);
  }
});

test("profiles always use actual DB names/photos and preserve query order before shuffle", () => {
  const rows = staff.map((entry, index) => ({ ...entry, nickname: `updated-${index}`, photo_url: `/new-${index}.webp` })).reverse();
  const result = groupPublicTeamMembers(rows);
  assert.deepEqual(ids(result.extraordinary), ids(rows));
  for (const profile of result.extraordinary) {
    const actual = rows.find((entry) => entry.id === profile.id)!;
    assert.equal(profile.nickname, actual.nickname);
    assert.equal(profile.photo_url, actual.photo_url);
  }
});

test("other extraordinary people remain visible regardless of staged Staff activation", () => {
  const other = [member("newer", { membership_type: "extraordinary" }), member("older", { membership_type: "extraordinary" })];
  for (const staged of [[], staff.slice(0, 3), staff]) {
    const result = groupPublicTeamMembers([...other, ...staged]);
    assert.deepEqual(ids(result.extraordinary), ["newer", "older", ...ids(staged)]);
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

test("inactive means hidden for every type/role, including missing/non-boolean active flags", () => {
  for (const membership_type of ["ordinary", "extraordinary"] as const) {
    for (const club_role of ["member", "staff", "coach", "assistant_coach"] as const) {
      for (const is_active of [false, null, undefined, 0, 1, "true", "false"]) {
        const result = groupPublicTeamMembers([{ ...member("hidden", { membership_type, club_role }), is_active } as PublicTeamMember]);
        assert.deepEqual(allProfiles(result), []);
      }
    }
  }
});

test("a single active staged coach appears only in Coaching; the other five are not fabricated", () => {
  const result = groupPublicTeamMembers([{ ...staff[0], club_role: "coach" }]);
  assert.deepEqual(ids(result.coaching), [staff[0].id]);
  assert.equal(result.extraordinary.length, 0);
  assert.equal(new Set(ids(allProfiles(result))).size, 1);
});

test("membership type and coaching roles come from actual DB rows without fixed-ID exceptions", () => {
  const result = groupPublicTeamMembers(staff.map((entry, index) => index === 0
    ? { ...entry, membership_type: "ordinary", club_role: "assistant_coach" }
    : index === 1 ? { ...entry, membership_type: "ordinary" } : entry));
  assert.deepEqual(ids(result.coaching), [staff[0].id]);
  assert.deepEqual(ids(result.ordinary), [staff[1].id]);
  assert.equal(result.extraordinary.length, 4);
});

test("shared display-name rule applies to each DB section without duplicate honorifics", () => {
  const result = groupPublicTeamMembers([
    member("ordinary", { nickname: "ทนายทนายเอ" }),
    member("extraordinary", { nickname: "ทนายบี", membership_type: "extraordinary" }),
    member("coach", { nickname: "ซี", club_role: "coach" }),
  ]);
  assert.equal(getMemberDisplayName(result.ordinary[0]), "ทนายเอ");
  assert.equal(getMemberDisplayName(result.extraordinary[0]), "บี");
  assert.equal(getMemberDisplayName(result.coaching[0]), "ทนายซี");
});

test("grouping is pure, does not introduce randomness, and projects only public profile fields", () => {
  const rows = [member("second"), member("first")];
  const snapshot = structuredClone(rows);
  const result = groupPublicTeamMembers(rows);
  assert.deepEqual(groupPublicTeamMembers(rows), result);
  assert.deepEqual(rows, snapshot);
  assert.deepEqual(ids(result.ordinary), ["second", "first"]);
  assert.deepEqual(Object.keys(result.ordinary[0]).sort(), ["id", "nickname", "photo_url", "membership_type", "club_role"].sort());
});

test("shuffle preserves every item exactly once and never mutates input, including empty/singleton lists", () => {
  for (const length of [0, 1, 2, 6, 32, 64]) {
    const input = Object.freeze(Array.from({ length }, (_, index) => Object.freeze(member(`extra-${index}`, { membership_type: "extraordinary" }))));
    for (let seed = 1; seed <= 30; seed++) {
      let state = seed;
      const shuffled = shuffleTeamMembers(input, () => (state = state * 16807 % 2147483647) / 2147483647);
      assert.notEqual(shuffled, input);
      assert.equal(shuffled.length, length);
      assert.equal(new Set(ids(shuffled)).size, length);
      assert.deepEqual(ids(shuffled).sort(), input.map((entry) => entry.id).sort());
      for (const item of shuffled) assert.ok(input.includes(item));
    }
  }
});

test("Fisher-Yates can produce all six permutations of three members", () => {
  const orders = new Set();
  for (let first = 0; first < 3; first++) {
    for (let second = 0; second < 2; second++) {
      const draws = [first / 3, second / 2];
      orders.add(shuffleTeamMembers(["a", "b", "c"], () => draws.shift()!).join(""));
    }
  }
  assert.equal(orders.size, 6);
});

test("shuffling extraordinary after grouping cannot mix ordinary/coaching or change their order", () => {
  const groups = groupPublicTeamMembers([
    member("ordinary-2"), member("extra-2", { membership_type: "extraordinary" }),
    member("coach-2", { club_role: "coach" }), member("ordinary-1"),
    member("extra-1", { membership_type: "extraordinary" }), member("coach-1", { club_role: "assistant_coach" }),
  ]);
  const before = structuredClone(groups);
  assert.deepEqual(ids(shuffleTeamMembers(groups.extraordinary, () => 0)), ["extra-1", "extra-2"]);
  assert.deepEqual(groups, before);
});

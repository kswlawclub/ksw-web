import assert from "node:assert/strict";
import test from "node:test";

const {
  clubRoles, membershipTypes, defaultMemberClassification, getMemberDisplayName,
  getMemberNickname, isClubRole, isMembershipType, parseMemberPayload,
  getMemberActivePatch, matchesMemberFilters, memberDeactivationMessage,
} = await import(new URL("./club-members.ts", import.meta.url).href);

const base = { nickname: "โก้", ...defaultMemberClassification, is_active: true, lineup_enabled: false };

test("new member defaults and exact classification allowlists match the schema", () => {
  assert.deepEqual(defaultMemberClassification, { membership_type: "ordinary", club_role: "member" });
  assert.deepEqual(membershipTypes.map((option: { value: string }) => option.value), ["ordinary", "extraordinary"]);
  assert.deepEqual(clubRoles.map((option: { value: string }) => option.value), ["member", "staff", "coach", "assistant_coach"]);
  for (const value of [null, undefined, "", "Ordinary", " ordinary", [], {}, "admin"]) assert.equal(isMembershipType(value), false);
  for (const value of [null, undefined, "", "Coach", "staff ", ["member", "coach"], "admin"]) assert.equal(isClubRole(value), false);
});

test("all eight type/role combinations remain independent and license stays optional", () => {
  for (const type of membershipTypes) for (const role of clubRoles) {
    const parsed = parseMemberPayload({ ...base, membership_type: type.value, club_role: role.value });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.payload.membership_type, type.value);
    assert.equal(parsed.payload.club_role, role.value);
    for (const field of ["first_name", "last_name", "lawyer_license_no", "phone", "photo_url", "birth_day", "birth_month", "birth_year_be", "shirt_number"]) assert.equal(parsed.payload[field], null);
  }
});

test("invalid server payloads are rejected instead of coercing classification or boolean flags", () => {
  for (const input of [null, [], {}, { ...base, nickname: " " }, { ...base, membership_type: "admin" }, { ...base, club_role: "Coach" }, { ...base, is_active: "false" }, { ...base, lineup_enabled: 1 }, { ...base, phone: {} }, { ...base, birth_day: NaN }]) {
    assert.equal(parseMemberPayload(input).ok, false);
  }
});

test("write payload strips untrusted fields and trims text without fabricating optional data", () => {
  const { payload } = parseMemberPayload({ ...base, nickname: " โก้ ", first_name: "", phone: "  ", id: "injected", created_at: "injected", public_visible: true });
  assert.equal(payload.nickname, "โก้");
  assert.equal(payload.first_name, null);
  assert.equal(payload.phone, null);
  for (const key of ["id", "created_at", "public_visible"]) assert.equal(key in payload, false);
});

test("display name separates membership type from role and handles legacy prefixes without writing", () => {
  for (const nickname of ["โก้", " โก้ ", "ทนายโก้", "ทนาย โก้", "ทนายทนายโก้"]) {
    const member = { nickname, membership_type: "ordinary", club_role: "coach" };
    assert.equal(getMemberDisplayName(member), "ทนายโก้");
    assert.equal(getMemberDisplayName({ ...member, membership_type: "extraordinary" }), "โก้");
    assert.equal(member.nickname, nickname);
    assert.equal(getMemberNickname(nickname), "โก้");
  }
  assert.equal(getMemberDisplayName({ nickname: "", membership_type: "ordinary" }), "ทนาย");
  assert.equal(getMemberDisplayName({ nickname: "", membership_type: "extraordinary" }), "-");
});

test("lifecycle patch changes only is_active, regardless of type, role or lineup state", () => {
  for (const value of [null, undefined, 0, 1, "false", {}]) assert.equal(getMemberActivePatch(value), null);
  for (const active of [false, true]) for (const lineup of [false, true]) {
    const member = { ...base, lineup_enabled: lineup, photo_url: "/images/staff/staff-04.png", id: "unchanged" };
    assert.deepEqual({ ...member, ...getMemberActivePatch(active) }, { ...member, is_active: active });
  }
  assert.match(memberDeactivationMessage({ ...base, membership_type: "extraordinary" }), /Deactivate โก้/);
  assert.match(memberDeactivationMessage(base), /ไม่ลบสมาชิก รูป/);
});

test("filters include inactive staged Staff by default and do not reorder members", () => {
  const rows = [base, { ...base, membership_type: "extraordinary", club_role: "staff", is_active: false }, { ...base, club_role: "coach" }];
  const all = { membershipType: "all", clubRole: "all", activeStatus: "all" };
  assert.deepEqual(rows.filter((member) => matchesMemberFilters(member, all)), rows);
  assert.deepEqual(rows.filter((member) => matchesMemberFilters(member, { membershipType: "extraordinary", clubRole: "staff", activeStatus: "inactive" })), [rows[1]]);
  assert.deepEqual(rows.filter((member) => matchesMemberFilters(member, { ...all, activeStatus: "active" })), [rows[0], rows[2]]);
});

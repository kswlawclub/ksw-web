import assert from "node:assert/strict";
import test from "node:test";

const {
  clubRoles, membershipTypes, defaultMemberClassification, getMemberDisplayName,
  getMemberNickname, isClubRole, isMembershipType, parseMemberPayload,
  getMemberActivePatch, matchesMemberFilters, memberDeactivationMessage,
  partitionMembersByStatus, getCurrentMemberCounts, getMemberListView,
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

test("classification filters are independent of status and do not reorder records", () => {
  const rows = [base, { ...base, membership_type: "extraordinary", club_role: "staff", is_active: false }, { ...base, club_role: "coach" }];
  const all = { membershipType: "all", clubRole: "all" };
  assert.deepEqual(rows.filter((member) => matchesMemberFilters(member, all)), rows);
  assert.deepEqual(rows.filter((member) => matchesMemberFilters(member, { membershipType: "extraordinary", clubRole: "staff" })), [rows[1]]);
});

const directory = [
  { ...base, id: "ordinary" },
  { ...base, id: "ordinary-coach", club_role: "coach" },
  { ...base, id: "extraordinary", membership_type: "extraordinary", club_role: "staff" },
  { ...base, id: "extraordinary-coach", membership_type: "extraordinary", club_role: "assistant_coach" },
  { ...base, id: "inactive", is_active: false },
  { ...base, id: "inactive-coach", is_active: false, club_role: "coach" },
  { ...base, id: "inactive-staff", is_active: false, membership_type: "extraordinary", club_role: "staff" },
];
const noFilters = { membershipType: "all", clubRole: "all" };

test("only unique active IDs count as members, including coaches once by membership type", () => {
  assert.deepEqual(getCurrentMemberCounts([...directory, ...directory]), { total: 4, ordinary: 2, extraordinary: 2 });
  assert.deepEqual(getCurrentMemberCounts([]), { total: 0, ordinary: 0, extraordinary: 0 });
  for (const is_active of [false, null, undefined, "true", 1]) {
    assert.equal(getCurrentMemberCounts([{ ...base, id: "invalid", is_active }]).total, 0);
  }
});

test("status partition preserves source order, has no duplicate IDs, and never mutates records", () => {
  const input = [...directory, ...directory, { ...directory[0], is_active: false }];
  const original = structuredClone(input);
  const partitions = partitionMembersByStatus(input);
  assert.deepEqual(partitions.active.map((row: { id: string }) => row.id), directory.slice(0, 4).map((row) => row.id));
  assert.deepEqual(partitions.inactive.map((row: { id: string }) => row.id), directory.slice(4).map((row) => row.id));
  assert.equal(new Set([...partitions.active, ...partitions.inactive].map((row) => row.id)).size, 7);
  assert.deepEqual(input, original);
});

test("active/inactive tabs have separate base totals and correct people/records wording", () => {
  const active = getMemberListView(directory, "active", noFilters);
  const inactive = getMemberListView(directory, "inactive", noFilters);
  assert.deepEqual(active.counts, { active: 4, inactive: 3 });
  assert.deepEqual(inactive.counts, active.counts);
  assert.equal(active.summary, "สมาชิกปัจจุบัน 4 คน");
  assert.equal(inactive.summary, "รายชื่อที่ไม่ใช้งาน 3 รายการ");
  assert.ok(active.rows.every((row: { is_active: boolean }) => row.is_active));
  assert.ok(inactive.rows.every((row: { is_active: boolean }) => !row.is_active));
});

test("classification filters affect visible counts, never base/tab counts", () => {
  const filters = { membershipType: "extraordinary", clubRole: "staff" };
  for (const tab of ["active", "inactive"]) {
    const view = getMemberListView(directory, tab, filters);
    assert.deepEqual(view.counts, { active: 4, inactive: 3 });
    assert.equal(view.summary, tab === "active" ? "แสดง 1 จาก 4 คน" : "แสดง 1 จาก 3 รายการ");
  }
  assert.equal(getMemberListView(directory, "inactive", { ...filters, clubRole: "assistant_coach" }).summary, "แสดง 0 จาก 3 รายการ");
});

test("deactivate/reactivate recomputes tab and public counts without changing independent state", () => {
  const original = structuredClone(directory);
  const deactivated = directory.map((row) => row.id === "ordinary-coach" ? { ...row, ...getMemberActivePatch(false) } : row);
  assert.deepEqual(getMemberListView(deactivated, "active", noFilters).counts, { active: 3, inactive: 4 });
  assert.deepEqual(getCurrentMemberCounts(deactivated), { total: 3, ordinary: 1, extraordinary: 2 });
  const restored = deactivated.map((row) => row.id === "ordinary-coach" ? { ...row, ...getMemberActivePatch(true) } : row);
  assert.deepEqual(restored, original);
  assert.deepEqual(getCurrentMemberCounts(restored), { total: 4, ordinary: 2, extraordinary: 2 });
});

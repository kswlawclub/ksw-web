export const membershipTypes = [
  { value: "ordinary", label: "สมาชิกสามัญ" },
  { value: "extraordinary", label: "สมาชิกวิสามัญ" },
] as const;

export const clubRoles = [
  { value: "member", label: "สมาชิก" },
  { value: "staff", label: "ทีมงาน" },
  { value: "coach", label: "โค้ช" },
  { value: "assistant_coach", label: "ผู้ช่วยโค้ช" },
] as const;

export type MembershipType = (typeof membershipTypes)[number]["value"];
export type ClubRole = (typeof clubRoles)[number]["value"];

export const defaultMemberClassification = {
  membership_type: "ordinary",
  club_role: "member",
} as const;

export type MemberPayload = {
  first_name: string | null;
  last_name: string | null;
  nickname: string;
  birth_day: number | null;
  birth_month: number | null;
  birth_year_be: number | null;
  shirt_number: number | null;
  lawyer_license_no: string | null;
  phone: string | null;
  photo_url: string | null;
  membership_type: MembershipType;
  club_role: ClubRole;
  is_active: boolean;
  lineup_enabled: boolean;
};

export type ClubMember = MemberPayload & {
  id: string;
  created_at: string;
  updated_at: string | null;
};

export function isMembershipType(value: unknown): value is MembershipType {
  return membershipTypes.some((option) => option.value === value);
}

export function isClubRole(value: unknown): value is ClubRole {
  return clubRoles.some((option) => option.value === value);
}

export function membershipTypeLabel(value: MembershipType) {
  return membershipTypes.find((option) => option.value === value)?.label ?? "-";
}

export function clubRoleLabel(value: ClubRole) {
  return clubRoles.find((option) => option.value === value)?.label ?? "-";
}

// Strip legacy honorifics for presentation only; stored nicknames are never rewritten.
export function getMemberNickname(nickname: string) {
  return nickname.trim().replace(/^(?:ทนาย\s*)+/, "").trim();
}

export function getMemberDisplayName(member: Pick<MemberPayload, "nickname" | "membership_type">) {
  const nickname = getMemberNickname(member.nickname);
  return member.membership_type === "ordinary" ? `ทนาย${nickname}` : nickname || "-";
}

export type MemberFilters = {
  membershipType: MembershipType | "all";
  clubRole: ClubRole | "all";
};

export function matchesMemberFilters(member: Pick<MemberPayload, "membership_type" | "club_role">, filters: MemberFilters) {
  return (filters.membershipType === "all" || member.membership_type === filters.membershipType)
    && (filters.clubRole === "all" || member.club_role === filters.clubRole);
}

export const memberStatusTabs = [
  { value: "active", label: "สมาชิกปัจจุบัน", unit: "คน" },
  { value: "inactive", label: "รายชื่อที่ไม่ใช้งาน", unit: "รายการ" },
] as const;
export type MemberStatusTab = (typeof memberStatusTabs)[number]["value"];

export function partitionMembersByStatus<T extends Pick<ClubMember, "id" | "is_active">>(members: readonly T[]) {
  const active = new Map<string, T>();
  const inactive = new Map<string, T>();
  for (const member of members) {
    if (member.is_active === true && !active.has(member.id)) active.set(member.id, member);
    if (member.is_active === false && !inactive.has(member.id)) inactive.set(member.id, member);
  }
  // Active query rows take precedence if a duplicate ID appears in a supplied snapshot.
  return { active: [...active.values()], inactive: [...inactive.values()].filter((member) => !active.has(member.id)) };
}

export function getCurrentMemberCounts(members: readonly Pick<ClubMember, "id" | "is_active" | "membership_type">[]) {
  const { active } = partitionMembersByStatus(members);
  return {
    total: active.length,
    ordinary: active.filter((member) => member.membership_type === "ordinary").length,
    extraordinary: active.filter((member) => member.membership_type === "extraordinary").length,
  };
}

export function getMemberListView<T extends Pick<ClubMember, "id" | "is_active" | "membership_type" | "club_role">>(
  members: readonly T[], tab: MemberStatusTab, filters: MemberFilters,
) {
  const partitions = partitionMembersByStatus(members);
  const baseCount = partitions[tab].length;
  const rows = partitions[tab].filter((member) => matchesMemberFilters(member, filters));
  const { label, unit } = memberStatusTabs.find((option) => option.value === tab)!;
  const isFiltered = filters.membershipType !== "all" || filters.clubRole !== "all";
  return {
    rows, baseCount,
    counts: { active: partitions.active.length, inactive: partitions.inactive.length },
    summary: isFiltered ? `แสดง ${rows.length} จาก ${baseCount} ${unit}` : `${label} ${baseCount} ${unit}`,
  };
}

export function memberDeactivationMessage(member: Pick<MemberPayload, "nickname" | "membership_type">) {
  return `Deactivate ${getMemberDisplayName(member)}?\nจะเปลี่ยนเป็น Inactive โดยไม่ลบสมาชิก รูป หรือเปลี่ยนการตั้งค่า Lineup Builder`;
}

export function isMemberId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function getMemberActivePatch(value: unknown): Pick<MemberPayload, "is_active"> | null {
  return typeof value === "boolean" ? { is_active: value } : null;
}

type PayloadResult = { ok: true; payload: MemberPayload } | { ok: false; error: string };

export function parseMemberPayload(input: unknown): PayloadResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid member data." };
  }
  const value = input as Record<string, unknown>;
  if (typeof value.nickname !== "string" || !value.nickname.trim()) {
    return { ok: false, error: "Nickname is required." };
  }
  if (!isMembershipType(value.membership_type)) {
    return { ok: false, error: "ประเภทสมาชิกต้องเป็น ordinary หรือ extraordinary เท่านั้น" };
  }
  if (!isClubRole(value.club_role)) {
    return { ok: false, error: "บทบาทต้องเป็น member, staff, coach หรือ assistant_coach เท่านั้น" };
  }
  if (typeof value.is_active !== "boolean" || typeof value.lineup_enabled !== "boolean") {
    return { ok: false, error: "Active และ Lineup Available ต้องเป็น true หรือ false" };
  }
  const textFields = ["first_name", "last_name", "lawyer_license_no", "phone", "photo_url"] as const;
  const numberFields = ["birth_day", "birth_month", "birth_year_be", "shirt_number"] as const;
  for (const field of textFields) {
    if (value[field] != null && typeof value[field] !== "string") {
      return { ok: false, error: `Invalid ${field}.` };
    }
  }
  for (const field of numberFields) {
    if (value[field] != null && (typeof value[field] !== "number" || !Number.isFinite(value[field]))) {
      return { ok: false, error: `Invalid ${field}.` };
    }
  }
  const text = (field: (typeof textFields)[number]) => (value[field] as string | null | undefined)?.trim() || null;
  const number = (field: (typeof numberFields)[number]) => (value[field] as number | null | undefined) ?? null;
  // Project only editable fields; never forward arbitrary action arguments to Supabase.
  return { ok: true, payload: {
    nickname: value.nickname.trim(),
    membership_type: value.membership_type,
    club_role: value.club_role,
    is_active: value.is_active,
    lineup_enabled: value.lineup_enabled,
    first_name: text("first_name"), last_name: text("last_name"),
    lawyer_license_no: text("lawyer_license_no"), phone: text("phone"), photo_url: text("photo_url"),
    birth_day: number("birth_day"), birth_month: number("birth_month"),
    birth_year_be: number("birth_year_be"), shirt_number: number("shirt_number"),
  } };
}

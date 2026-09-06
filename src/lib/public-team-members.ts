import type { ClubMember } from "./club-members";

export type PublicTeamMember = Pick<ClubMember,
  "id" | "nickname" | "photo_url" | "membership_type" | "club_role" | "is_active"
>;

export type PublicTeamProfile = Omit<PublicTeamMember, "is_active"> & {
  source: "database" | "static_staff";
};

// Temporary presentation fallback, mapped to the Phase 2B identities, never by nickname.
export const staticTeamStaff = [
  { id: "e950da1b-7788-4e80-bcec-9a8f6e5d1397", nickname: "เฟี๊ยต", photo_url: "/images/staff/staff-01.png" },
  { id: "84a1bd85-ba18-412f-b783-da4c01d9088d", nickname: "เหงี่ยม", photo_url: "/images/staff/staff-02.png" },
  { id: "f8fe38e1-201e-4327-a645-a17140079e93", nickname: "พาสต้า", photo_url: "/images/staff/staff-03.png" },
  { id: "77eb3cde-3815-4c4a-b33c-3dff615a4e70", nickname: "โก้", photo_url: "/images/staff/staff-04.png" },
  { id: "749c89b3-9953-433f-904a-50429442ec14", nickname: "หม่อมโจอี้", photo_url: "/images/staff/staff-05.png" },
  { id: "37f8ab40-e282-4619-a4e7-c7307f4665ea", nickname: "เด่น", photo_url: "/images/staff/staff-06.png" },
] as const;

const stagedStaffIds = new Set<string>(staticTeamStaff.map((staff) => staff.id));

function isCoach(member: Pick<PublicTeamMember, "club_role">) {
  return member.club_role === "coach" || member.club_role === "assistant_coach";
}

function databaseProfile(member: PublicTeamMember): PublicTeamProfile {
  const { id, nickname, photo_url, membership_type, club_role } = member;
  return { id, nickname, photo_url, membership_type, club_role, source: "database" };
}

export function groupPublicTeamMembers(members: readonly PublicTeamMember[]) {
  const activeById = new Map<string, PublicTeamMember>();
  for (const member of members) {
    if (member.is_active === true && !activeById.has(member.id)) activeById.set(member.id, member);
  }
  const usingStaticStaffFallback = !staticTeamStaff.every((staff) => activeById.has(staff.id));
  const ordinary: PublicTeamProfile[] = [];
  const extraordinary: PublicTeamProfile[] = [];
  const coaching: PublicTeamProfile[] = [];

  const staffProfiles = staticTeamStaff.map((staff): PublicTeamProfile => {
    const activeMember = activeById.get(staff.id);
    // An explicitly assigned active coach belongs only in Coaching, even during staging.
    if (activeMember && (!usingStaticStaffFallback || isCoach(activeMember))) return databaseProfile(activeMember);
    return { ...staff, membership_type: "extraordinary", club_role: "staff", source: "static_staff" };
  });
  const otherProfiles = [...activeById.values()]
    .filter((member) => !stagedStaffIds.has(member.id))
    .map(databaseProfile);

  // Preserve the existing Staff order; other DB profiles retain the query's order.
  for (const profile of [...staffProfiles, ...otherProfiles]) {
    if (isCoach(profile)) coaching.push(profile);
    else if (profile.membership_type === "ordinary") ordinary.push(profile);
    else if (profile.membership_type === "extraordinary") extraordinary.push(profile);
  }
  return { ordinary, extraordinary, coaching, usingStaticStaffFallback };
}

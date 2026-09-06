import type { ClubMember } from "./club-members";

export type PublicTeamMember = Pick<ClubMember,
  "id" | "nickname" | "photo_url" | "membership_type" | "club_role" | "is_active"
>;

export type PublicTeamProfile = Omit<PublicTeamMember, "is_active">;

function isCoach(member: Pick<PublicTeamMember, "club_role">) {
  return member.club_role === "coach" || member.club_role === "assistant_coach";
}

function databaseProfile(member: PublicTeamMember): PublicTeamProfile {
  const { id, nickname, photo_url, membership_type, club_role } = member;
  return { id, nickname, photo_url, membership_type, club_role };
}

export function groupPublicTeamMembers(members: readonly PublicTeamMember[]) {
  const activeById = new Map<string, PublicTeamMember>();
  for (const member of members) {
    if (member.is_active === true && !activeById.has(member.id)) activeById.set(member.id, member);
  }
  const ordinary: PublicTeamProfile[] = [];
  const extraordinary: PublicTeamProfile[] = [];
  const coaching: PublicTeamProfile[] = [];

  // Group only active DB rows, preserving query order until the page shuffles a section.
  for (const member of activeById.values()) {
    const profile = databaseProfile(member);
    if (isCoach(profile)) coaching.push(profile);
    else if (profile.membership_type === "ordinary") ordinary.push(profile);
    else if (profile.membership_type === "extraordinary") extraordinary.push(profile);
  }
  return { ordinary, extraordinary, coaching };
}

// Fisher-Yates on a copy; inject a [0, 1) random source for deterministic tests.
export function shuffleTeamMembers<T>(members: readonly T[], random: () => number = Math.random): T[] {
  const shuffled = [...members];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

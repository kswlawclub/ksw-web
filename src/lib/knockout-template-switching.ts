type KnockoutNodeForState = {
  linkedMatchId?: string | null;
  awaySource: { teamId?: string | null };
  homeSource: { teamId?: string | null };
};

type KnockoutMatchForState = {
  status: string | null | undefined;
  winnerTeamId: string | null | undefined;
};

export type KnockoutTemplateSwitchGuard = {
  allowed: boolean;
  reason?: string;
};

function nodeHasAssignedTeam(node: KnockoutNodeForState) {
  return Boolean(node.homeSource.teamId || node.awaySource.teamId);
}

export function isTopologyOnlyNode(node: KnockoutNodeForState) {
  return !node.linkedMatchId && !nodeHasAssignedTeam(node);
}

export function hasResolvedBracketPairing(node: KnockoutNodeForState) {
  return Boolean(node.linkedMatchId || (node.homeSource.teamId && node.awaySource.teamId));
}

export function hasMaterializedKnockoutFixtures(matches: KnockoutMatchForState[]) {
  return matches.length > 0;
}

export function getKnockoutTemplateSwitchGuard(input: {
  matches: KnockoutMatchForState[];
  nodes: KnockoutNodeForState[];
}): KnockoutTemplateSwitchGuard {
  const resultMatch = input.matches.find((match) => match.status === "finished" || Boolean(match.winnerTeamId));
  if (resultMatch) return { allowed: false, reason: "เปลี่ยนไม่ได้ เพราะมีผลการแข่งขันรอบน็อกเอาต์แล้ว" };

  if (hasMaterializedKnockoutFixtures(input.matches)) return { allowed: false, reason: "เปลี่ยนไม่ได้ เพราะสร้างโปรแกรมรอบน็อกเอาต์แล้ว" };

  if (input.nodes.some((node) => node.linkedMatchId)) {
    return { allowed: false, reason: "เปลี่ยนไม่ได้ เพราะมีคู่แข่งขันรอบน็อกเอาต์ที่เชื่อมอยู่แล้ว" };
  }

  if (input.nodes.some(nodeHasAssignedTeam)) {
    return { allowed: false, reason: "เปลี่ยนไม่ได้ เพราะมีทีมถูกจัดลงสายแล้ว" };
  }

  return { allowed: true };
}

import type { CompetitionTreeNode } from "@/lib/competition-tree";

type KnockoutMatchForTemplateSwitch = {
  status: string | null | undefined;
  winnerTeamId: string | null | undefined;
};

export type KnockoutTemplateSwitchGuard = {
  allowed: boolean;
  reason?: string;
};

function nodeHasAssignedTeam(node: CompetitionTreeNode) {
  return Boolean(node.homeSource.teamId || node.awaySource.teamId);
}

export function getKnockoutTemplateSwitchGuard(input: {
  matches: KnockoutMatchForTemplateSwitch[];
  nodes: CompetitionTreeNode[];
}): KnockoutTemplateSwitchGuard {
  const resultMatch = input.matches.find((match) => match.status === "finished" || Boolean(match.winnerTeamId));
  if (resultMatch) return { allowed: false, reason: "เปลี่ยนไม่ได้ เพราะมีผลการแข่งขันรอบน็อกเอาต์แล้ว" };

  if (input.matches.length) return { allowed: false, reason: "เปลี่ยนไม่ได้ เพราะสร้างโปรแกรมรอบน็อกเอาต์แล้ว" };

  if (input.nodes.some((node) => node.linkedMatchId)) {
    return { allowed: false, reason: "เปลี่ยนไม่ได้ เพราะมีคู่แข่งขันรอบน็อกเอาต์ที่เชื่อมอยู่แล้ว" };
  }

  if (input.nodes.some(nodeHasAssignedTeam)) {
    return { allowed: false, reason: "เปลี่ยนไม่ได้ เพราะมีทีมถูกจัดลงสายแล้ว" };
  }

  return { allowed: true };
}

type KnockoutNodeForState = {
  id?: string;
  linkedMatchId?: string | null;
  matchOrder?: number;
  bracketPosition?: number;
  roundIndex?: number;
  roundLabel?: string;
  awaySource: { groupId?: string | null; nodeId?: string | null; rank?: number | null; teamId?: string | null; type?: string | null };
  homeSource: { groupId?: string | null; nodeId?: string | null; rank?: number | null; teamId?: string | null; type?: string | null };
};

type KnockoutMatchForState = {
  id?: string;
  awayScore?: number | null;
  awayTeamId?: string | null;
  homeScore?: number | null;
  homeTeamId?: string | null;
  status: string | null | undefined;
  winnerTeamId: string | null | undefined;
};

export type KnockoutTemplateSwitchCode = "allowed" | "fixture_result" | "fixture_created" | "linked_match" | "team_assigned";

export type KnockoutTemplateSwitchGuard = {
  allowed: boolean;
  code: KnockoutTemplateSwitchCode;
  reason?: string;
};

export type KnockoutTemplateSwitchDiagnostic = KnockoutTemplateSwitchGuard & {
  blockingNodes: Array<{ code: "linked_match" | "team_assigned"; node: KnockoutNodeForState; reason: string }>;
  fixtures: Array<{ code: "fixture_created" | "fixture_result"; match: KnockoutMatchForState; reason: string }>;
  nodeDiagnostics: Array<{ blocking: boolean; code: "linked_match" | "team_assigned" | null; node: KnockoutNodeForState; reason: string | null; resettable: boolean; resolvedPairing: boolean; topologyOnly: boolean }>;
  resettableNodes: KnockoutNodeForState[];
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

export function inspectKnockoutTemplateSwitchState(input: {
  matches: KnockoutMatchForState[];
  nodes: KnockoutNodeForState[];
}): KnockoutTemplateSwitchDiagnostic {
  const nodeDiagnostics = input.nodes.map((node) => {
    const topologyOnly = isTopologyOnlyNode(node);
    const resolvedPairing = hasResolvedBracketPairing(node);
    if (node.linkedMatchId) {
      return { blocking: true, code: "linked_match" as const, node, reason: "มีคู่แข่งขันรอบน็อกเอาต์ที่เชื่อมอยู่แล้ว", resettable: false, resolvedPairing, topologyOnly };
    }
    if (nodeHasAssignedTeam(node)) {
      return { blocking: true, code: "team_assigned" as const, node, reason: "มีทีมถูกจัดลงสายแล้ว", resettable: false, resolvedPairing, topologyOnly };
    }
    return { blocking: false, code: null, node, reason: null, resettable: true, resolvedPairing, topologyOnly };
  });
  const fixtures = input.matches.map((match) => {
    const result = match.status === "finished" || Boolean(match.winnerTeamId);
    return result
      ? { code: "fixture_result" as const, match, reason: "มีผลการแข่งขันรอบน็อกเอาต์แล้ว" }
      : { code: "fixture_created" as const, match, reason: "สร้างโปรแกรมรอบน็อกเอาต์แล้ว" };
  });
  const blockingNodes = nodeDiagnostics.filter((entry): entry is Extract<typeof entry, { code: "linked_match" | "team_assigned" }> => entry.blocking);

  if (fixtures.some((entry) => entry.code === "fixture_result")) {
    return { allowed: false, blockingNodes, code: "fixture_result", fixtures, nodeDiagnostics, reason: "เปลี่ยนไม่ได้ เพราะมีผลการแข่งขันรอบน็อกเอาต์แล้ว", resettableNodes: nodeDiagnostics.filter((entry) => entry.resettable).map((entry) => entry.node) };
  }
  if (hasMaterializedKnockoutFixtures(input.matches)) {
    return { allowed: false, blockingNodes, code: "fixture_created", fixtures, nodeDiagnostics, reason: "เปลี่ยนไม่ได้ เพราะสร้างโปรแกรมรอบน็อกเอาต์แล้ว", resettableNodes: nodeDiagnostics.filter((entry) => entry.resettable).map((entry) => entry.node) };
  }
  if (blockingNodes[0]?.code === "linked_match") {
    return { allowed: false, blockingNodes, code: "linked_match", fixtures, nodeDiagnostics, reason: "เปลี่ยนไม่ได้ เพราะมีคู่แข่งขันรอบน็อกเอาต์ที่เชื่อมอยู่แล้ว", resettableNodes: nodeDiagnostics.filter((entry) => entry.resettable).map((entry) => entry.node) };
  }
  if (blockingNodes[0]?.code === "team_assigned") {
    return { allowed: false, blockingNodes, code: "team_assigned", fixtures, nodeDiagnostics, reason: "เปลี่ยนไม่ได้ เพราะมีทีมถูกจัดลงสายแล้ว", resettableNodes: nodeDiagnostics.filter((entry) => entry.resettable).map((entry) => entry.node) };
  }
  return { allowed: true, blockingNodes, code: "allowed", fixtures, nodeDiagnostics, resettableNodes: nodeDiagnostics.map((entry) => entry.node) };
}

export function getKnockoutTemplateSwitchGuard(input: {
  matches: KnockoutMatchForState[];
  nodes: KnockoutNodeForState[];
}): KnockoutTemplateSwitchGuard {
  const { allowed, code, reason } = inspectKnockoutTemplateSwitchState(input);
  return { allowed, code, reason };
}

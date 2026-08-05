export type KnockoutNodeForState = {
  id?: string;
  linkedMatchId?: string | null;
  matchOrder?: number;
  bracketPosition?: number;
  roundIndex?: number;
  roundLabel?: string;
  awaySource: { bestOrder?: number | null; groupId?: string | null; nodeId?: string | null; rank?: number | null; teamId?: string | null; type?: string | null };
  homeSource: { bestOrder?: number | null; groupId?: string | null; nodeId?: string | null; rank?: number | null; teamId?: string | null; type?: string | null };
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

export type KnockoutNodeState = "materialized_pairing" | "source_draft" | "topology_only";

export type DerivedQualificationSource = {
  bestOrder?: number | null;
  groupId?: string | null;
  rank?: number | null;
  teamId?: string | null;
  type?: string | null;
};

function isTopologySourceType(type: string | null | undefined) {
  return type === "unassigned" || type === "group_rank" || type === "node_winner";
}

export function topologySourceTeamId(type: string | null | undefined, teamId: string | null | undefined) {
  return isTopologySourceType(type) ? null : teamId ?? null;
}

function sourceHasExplicitTeamAssignment(source: KnockoutNodeForState["homeSource"]) {
  return source.type === "manual_team" && Boolean(source.teamId);
}

function sourceHasDraftMetadata(source: KnockoutNodeForState["homeSource"]) {
  return Boolean(source.teamId || source.groupId || source.nodeId || source.rank || source.type !== "unassigned");
}

export function hasDerivedSourceResolution(source: KnockoutNodeForState["homeSource"], derivedSources: DerivedQualificationSource[] = []) {
  if (!source.teamId || (source.type !== "best_ranked" && source.type !== "group_rank")) return false;
  return derivedSources.some((candidate) => candidate.type === source.type
    && candidate.teamId === source.teamId
    && candidate.groupId === source.groupId
    && candidate.rank === source.rank
    && (source.type !== "best_ranked" || candidate.bestOrder === source.bestOrder));
}

function sourceHasUnprovenTeamAssignment(source: KnockoutNodeForState["homeSource"], derivedSources: DerivedQualificationSource[]) {
  return Boolean(source.teamId) && !hasDerivedSourceResolution(source, derivedSources);
}

export function classifyKnockoutNodeState(node: KnockoutNodeForState, derivedSources: DerivedQualificationSource[] = []): KnockoutNodeState {
  if (
    node.linkedMatchId
    || sourceHasExplicitTeamAssignment(node.homeSource)
    || sourceHasExplicitTeamAssignment(node.awaySource)
    || sourceHasUnprovenTeamAssignment(node.homeSource, derivedSources)
    || sourceHasUnprovenTeamAssignment(node.awaySource, derivedSources)
  ) {
    return "materialized_pairing";
  }
  if (sourceHasDraftMetadata(node.homeSource) || sourceHasDraftMetadata(node.awaySource)) return "source_draft";
  return "topology_only";
}

export function isTopologyOnlyNode(node: KnockoutNodeForState, derivedSources: DerivedQualificationSource[] = []) {
  return classifyKnockoutNodeState(node, derivedSources) !== "materialized_pairing";
}

export function hasResolvedBracketPairing(node: KnockoutNodeForState, derivedSources: DerivedQualificationSource[] = []) {
  return classifyKnockoutNodeState(node, derivedSources) === "materialized_pairing";
}

export function hasMaterializedKnockoutFixtures(matches: KnockoutMatchForState[]) {
  return matches.length > 0;
}

export function inspectKnockoutTemplateSwitchState(input: {
  derivedSources?: DerivedQualificationSource[];
  matches: KnockoutMatchForState[];
  nodes: KnockoutNodeForState[];
}): KnockoutTemplateSwitchDiagnostic {
  const nodeDiagnostics = input.nodes.map((node) => {
    const topologyOnly = isTopologyOnlyNode(node, input.derivedSources);
    const resolvedPairing = hasResolvedBracketPairing(node, input.derivedSources);
    if (node.linkedMatchId) {
      return { blocking: true, code: "linked_match" as const, node, reason: "มีคู่แข่งขันรอบน็อกเอาต์ที่เชื่อมอยู่แล้ว", resettable: false, resolvedPairing, topologyOnly };
    }
    if (hasResolvedBracketPairing(node, input.derivedSources)) {
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
  derivedSources?: DerivedQualificationSource[];
  matches: KnockoutMatchForState[];
  nodes: KnockoutNodeForState[];
}): KnockoutTemplateSwitchGuard {
  const { allowed, code, reason } = inspectKnockoutTemplateSwitchState(input);
  return { allowed, code, reason };
}

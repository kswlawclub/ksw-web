export type KnockoutNodeSource = {
  bestOrder?: number | null;
  groupId?: string | null;
  nodeId?: string | null;
  rank?: number | null;
  teamId?: string | null;
  type?: string | null;
};

export type KnockoutNodeForState = {
  awaySource: KnockoutNodeSource;
  homeSource: KnockoutNodeSource;
  id?: string;
  linkedMatchId?: string | null;
};

export type KnockoutMatchForState = {
  awayScore?: number | null;
  id?: string;
  homeScore?: number | null;
  status: string | null | undefined;
  winnerTeamId: string | null | undefined;
};

export type QualificationSnapshotSource = Pick<KnockoutNodeSource, "bestOrder" | "groupId" | "rank" | "teamId" | "type">;

export type KnockoutNodeState = "draft" | "resolved_draft" | "materialized" | "played";

export type KnockoutTemplateSwitchReasonCode =
  | "allowed_draft_only"
  | "linked_knockout_match"
  | "knockout_result_exists"
  | "manual_team_assignment"
  | "unverified_team_assignment";

export type KnockoutNodeStateEntry = {
  nodeId: string;
  reasonCode?: Exclude<KnockoutTemplateSwitchReasonCode, "allowed_draft_only" | "knockout_result_exists">;
  state: KnockoutNodeState;
};

export type KnockoutTemplateSwitchGuard = {
  allowed: boolean;
  blockingNodeIds: string[];
  message: string;
  nodeStates: KnockoutNodeStateEntry[];
  reasonCode: KnockoutTemplateSwitchReasonCode;
  resettableNodeIds: string[];
};

export type KnockoutStateContext = {
  matches?: KnockoutMatchForState[];
  qualificationSnapshot?: QualificationSnapshotSource[];
};

function isScore(value: number | null | undefined) {
  return typeof value === "number";
}

export function hasLinkedKnockoutMatch(node: KnockoutNodeForState) {
  return Boolean(node.linkedMatchId);
}

export function hasPlayedKnockoutResult(match: KnockoutMatchForState) {
  return match.status === "finished" || match.status === "completed" || Boolean(match.winnerTeamId) || isScore(match.homeScore) || isScore(match.awayScore);
}

export function hasExplicitManualAssignment(source: KnockoutNodeSource) {
  return source.type === "manual_team" && Boolean(source.teamId);
}

function hasTeamId(source: KnockoutNodeSource) {
  return Boolean(source.teamId);
}

export function hasQualificationDerivedResolution(source: KnockoutNodeSource, qualificationSnapshot: QualificationSnapshotSource[] = []) {
  if (!source.teamId || (source.type !== "best_ranked" && source.type !== "group_rank")) return false;
  return qualificationSnapshot.some((candidate) => candidate.type === source.type
    && candidate.teamId === source.teamId
    && candidate.groupId === source.groupId
    && candidate.rank === source.rank
    && (source.type !== "best_ranked" || candidate.bestOrder === source.bestOrder));
}

function linkedMatchForNode(node: KnockoutNodeForState, matches: KnockoutMatchForState[]) {
  return node.linkedMatchId ? matches.find((match) => match.id === node.linkedMatchId) : undefined;
}

export function classifyKnockoutNodeState(node: KnockoutNodeForState, context: KnockoutStateContext = {}): KnockoutNodeState {
  const matches = context.matches ?? [];
  const linkedMatch = linkedMatchForNode(node, matches);
  if (linkedMatch && hasPlayedKnockoutResult(linkedMatch)) return "played";
  if (hasLinkedKnockoutMatch(node)) return "materialized";
  if (hasExplicitManualAssignment(node.homeSource) || hasExplicitManualAssignment(node.awaySource)) return "materialized";

  const sources = [node.homeSource, node.awaySource];
  const qualificationSnapshot = context.qualificationSnapshot ?? [];
  if (sources.some((source) => hasTeamId(source) && !hasQualificationDerivedResolution(source, qualificationSnapshot))) return "materialized";
  if (sources.some((source) => hasQualificationDerivedResolution(source, qualificationSnapshot))) return "resolved_draft";
  return "draft";
}

function nodeReasonCode(node: KnockoutNodeForState, state: KnockoutNodeState): KnockoutNodeStateEntry["reasonCode"] {
  if (state !== "materialized") return undefined;
  if (hasLinkedKnockoutMatch(node)) return "linked_knockout_match";
  if (hasExplicitManualAssignment(node.homeSource) || hasExplicitManualAssignment(node.awaySource)) return "manual_team_assignment";
  return "unverified_team_assignment";
}

function messageForReason(reasonCode: KnockoutTemplateSwitchReasonCode) {
  if (reasonCode === "knockout_result_exists") return "เปลี่ยนไม่ได้ เพราะมีผลการแข่งขันรอบน็อกเอาต์แล้ว";
  if (reasonCode === "linked_knockout_match") return "เปลี่ยนไม่ได้ เพราะสร้างโปรแกรมรอบน็อกเอาต์แล้ว";
  if (reasonCode === "manual_team_assignment") return "เปลี่ยนไม่ได้ เพราะมีทีมที่ผู้ดูแลจัดลงสายแล้ว";
  if (reasonCode === "unverified_team_assignment") return "เปลี่ยนไม่ได้ เพราะพบทีมในโครงสร้างที่ไม่สามารถยืนยันแหล่งที่มาได้";
  return "เปลี่ยนรูปแบบการแข่งขันได้ เพราะยังมีเพียงโครงร่างหรือข้อมูลร่าง";
}

export function getKnockoutTemplateSwitchGuard(input: {
  matches: KnockoutMatchForState[];
  nodes: KnockoutNodeForState[];
  qualificationSnapshot?: QualificationSnapshotSource[];
}): KnockoutTemplateSwitchGuard {
  const context: KnockoutStateContext = { matches: input.matches, qualificationSnapshot: input.qualificationSnapshot };
  const nodeStates = input.nodes.map((node, index) => {
    const state = classifyKnockoutNodeState(node, context);
    return { nodeId: node.id ?? `node-${index}`, reasonCode: nodeReasonCode(node, state), state };
  });
  const blockingNodeIds = nodeStates.filter((entry) => entry.state === "materialized" || entry.state === "played").map((entry) => entry.nodeId);
  const resettableNodeIds = nodeStates.filter((entry) => entry.state === "draft" || entry.state === "resolved_draft").map((entry) => entry.nodeId);
  const hasPlayedResult = input.matches.some(hasPlayedKnockoutResult) || nodeStates.some((entry) => entry.state === "played");
  const hasFixture = input.matches.length > 0;
  const firstBlockingNode = nodeStates.find((entry) => entry.state === "materialized");
  const reasonCode = hasPlayedResult
    ? "knockout_result_exists"
    : hasFixture || firstBlockingNode?.reasonCode === "linked_knockout_match"
      ? "linked_knockout_match"
      : firstBlockingNode?.reasonCode ?? "allowed_draft_only";

  return {
    allowed: reasonCode === "allowed_draft_only",
    blockingNodeIds,
    message: messageForReason(reasonCode),
    nodeStates,
    reasonCode,
    resettableNodeIds,
  };
}

/**
 * Public visibility predicate. This deliberately does not share the Admin
 * template-switch contract: a public bracket needs a visible pairing, not a
 * decision about whether an Admin may reset a draft topology.
 */
export function hasResolvedBracketPairing(node: Pick<KnockoutNodeForState, "awaySource" | "homeSource" | "linkedMatchId">) {
  return hasLinkedKnockoutMatch(node) || Boolean(node.homeSource.teamId && node.awaySource.teamId);
}

// Generator persistence invariant: topology sources never persist a direct team id.
export function topologySourceTeamId(type: string | null | undefined, teamId: string | null | undefined) {
  return type === "unassigned" || type === "group_rank" || type === "node_winner" ? null : teamId ?? null;
}

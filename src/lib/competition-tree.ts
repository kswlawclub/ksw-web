export type CompetitionTreeEntryMode = "bye" | "custom" | "preliminary";
export type CompetitionTreeSourceType = "bye" | "group_rank" | "manual_team" | "node_winner" | "unassigned";

export type CompetitionTreeSource = {
  groupId?: string;
  nodeId?: string;
  rank?: number;
  teamId?: string;
  type: CompetitionTreeSourceType;
};

export type CompetitionTreeNode = {
  awaySource: CompetitionTreeSource;
  bracketPosition: number;
  competitionId: string;
  homeSource: CompetitionTreeSource;
  id: string;
  linkedMatchId?: string;
  matchOrder: number;
  roundIndex: number;
  roundLabel: string;
};

export type CompetitionTreeBuildInput = {
  bracketCapacity: number;
  competitionId: string;
  entrantCount: number;
  entryMode: CompetitionTreeEntryMode;
  entrants: CompetitionTreeSource[];
  idFactory: () => string;
};

export type CompetitionTreeSummary = {
  byeNodeCount: number;
  entrantCount: number;
  leafNodeCount: number;
  nodeCount: number;
  preliminaryNodeCount: number;
  rootNodeId: string | null;
  roundCount: number;
  roundLabels: string[];
};

export type CompetitionTreeValidation = {
  errors: string[];
  summary: CompetitionTreeSummary;
  valid: boolean;
};

const supportedCapacities = [2, 4, 8, 16, 32, 64] as const;

function emptySource(type: "bye" | "unassigned"): CompetitionTreeSource {
  return { type };
}

function previousPowerOfTwo(value: number) {
  return [...supportedCapacities].reverse().find((capacity) => capacity <= value) ?? 2;
}

function roundLabel(matchCount: number, isPreliminary = false) {
  if (isPreliminary) return "Preliminary";
  if (matchCount === 1) return "Final";
  if (matchCount === 2) return "Semifinal";
  if (matchCount === 4) return "Quarterfinal";
  return `Round of ${matchCount * 2}`;
}

function assertBuildInput(input: CompetitionTreeBuildInput) {
  if (!supportedCapacities.includes(input.bracketCapacity as (typeof supportedCapacities)[number])) {
    throw new Error("Bracket capacity must be a supported power of two.");
  }
  if (!Number.isInteger(input.entrantCount) || input.entrantCount < 2 || input.entrantCount > 64) {
    throw new Error("Entrant count must be a whole number between 2 and 64.");
  }
  if (input.entryMode !== "bye" && input.entryMode !== "preliminary" && input.entryMode !== "custom") {
    throw new Error("Entry mode is invalid.");
  }
  if (input.entryMode !== "preliminary" && input.bracketCapacity < input.entrantCount) {
    throw new Error("Bracket capacity cannot be smaller than entrant count.");
  }
  if (input.entrants.length !== input.entrantCount) {
    throw new Error("Entrant sources do not match the configured entrant count.");
  }
}

function createNode(
  input: CompetitionTreeBuildInput,
  roundIndex: number,
  matchOrder: number,
  bracketPosition: number,
  label: string,
  homeSource: CompetitionTreeSource,
  awaySource: CompetitionTreeSource,
): CompetitionTreeNode {
  return {
    awaySource,
    bracketPosition,
    competitionId: input.competitionId,
    homeSource,
    id: input.idFactory(),
    matchOrder,
    roundIndex,
    roundLabel: label,
  };
}

function buildByeLeaves(input: CompetitionTreeBuildInput) {
  const byeCount = input.bracketCapacity - input.entrantCount;
  const leaves: CompetitionTreeNode[] = [];
  let entryIndex = 0;
  const label = roundLabel(input.bracketCapacity / 2);

  for (let index = 0; index < byeCount; index += 1) {
    leaves.push(
      createNode(
        input,
        0,
        index + 1,
        index + 1,
        label,
        input.entrants[entryIndex++],
        emptySource("bye"),
      ),
    );
  }

  while (entryIndex < input.entrants.length) {
    const matchOrder = leaves.length + 1;
    leaves.push(
      createNode(
        input,
        0,
        matchOrder,
        matchOrder,
        label,
        input.entrants[entryIndex++],
        input.entrants[entryIndex++] ?? emptySource("bye"),
      ),
    );
  }

  return leaves;
}

function buildPreliminaryTree(input: CompetitionTreeBuildInput) {
  const mainCapacity = previousPowerOfTwo(input.entrantCount);
  const preliminaryNodeCount = input.entrantCount - mainCapacity;
  const directEntrantCount = mainCapacity - preliminaryNodeCount;
  const nodes: CompetitionTreeNode[] = [];
  const preliminaryNodes: CompetitionTreeNode[] = [];
  let entryIndex = 0;

  for (let index = 0; index < preliminaryNodeCount; index += 1) {
    preliminaryNodes.push(
      createNode(
        input,
        0,
        index + 1,
        index + 1,
        roundLabel(preliminaryNodeCount, true),
        input.entrants[entryIndex++],
        input.entrants[entryIndex++],
      ),
    );
  }
  nodes.push(...preliminaryNodes);

  const mainSources: CompetitionTreeSource[] = [
    ...input.entrants.slice(entryIndex, entryIndex + directEntrantCount),
    ...preliminaryNodes.map((node) => ({ nodeId: node.id, type: "node_winner" as const })),
  ];
  const firstMainRound: CompetitionTreeNode[] = [];
  const firstMainMatchCount = mainCapacity / 2;
  for (let index = 0; index < firstMainMatchCount; index += 1) {
    const sourceIndex = index * 2;
    firstMainRound.push(
      createNode(
        input,
        1,
        index + 1,
        preliminaryNodeCount + index + 1,
        roundLabel(firstMainMatchCount),
        mainSources[sourceIndex],
        mainSources[sourceIndex + 1],
      ),
    );
  }
  nodes.push(...firstMainRound);
  return { nodes, nextRound: firstMainRound, nextRoundIndex: 2 };
}

function appendParents(
  input: CompetitionTreeBuildInput,
  nodes: CompetitionTreeNode[],
  initialRound: CompetitionTreeNode[],
  initialRoundIndex: number,
) {
  let children = initialRound;
  let roundIndex = initialRoundIndex;
  let positionOffset = nodes.length;

  while (children.length > 1) {
    const parentCount = children.length / 2;
    const parents = Array.from({ length: parentCount }, (_, index) => {
      const childIndex = index * 2;
      return createNode(
        input,
        roundIndex,
        index + 1,
        positionOffset + index + 1,
        roundLabel(parentCount),
        { nodeId: children[childIndex].id, type: "node_winner" },
        { nodeId: children[childIndex + 1].id, type: "node_winner" },
      );
    });
    nodes.push(...parents);
    children = parents;
    positionOffset += parents.length;
    roundIndex += 1;
  }
}

export function buildCompetitionTree(input: CompetitionTreeBuildInput) {
  assertBuildInput(input);
  const nodes: CompetitionTreeNode[] = [];

  if (input.entryMode === "preliminary" && !supportedCapacities.includes(input.entrantCount as (typeof supportedCapacities)[number])) {
    const preliminary = buildPreliminaryTree(input);
    nodes.push(...preliminary.nodes);
    appendParents(input, nodes, preliminary.nextRound, preliminary.nextRoundIndex);
  } else {
    const leaves = buildByeLeaves(input);
    nodes.push(...leaves);
    appendParents(input, nodes, leaves, 1);
  }

  const validation = validateCompetitionTree(nodes, input.entrantCount);
  if (!validation.valid) throw new Error(`Generated tree is invalid: ${validation.errors.join(" ")}`);
  return { nodes, summary: validation.summary };
}

function sourceReferencesNode(source: CompetitionTreeSource) {
  return source.type === "node_winner" ? source.nodeId ?? "" : "";
}

function sourceIsValid(source: CompetitionTreeSource) {
  if (source.type === "group_rank") return Boolean(source.groupId && Number.isInteger(source.rank) && source.rank! >= 1);
  if (source.type === "manual_team") return Boolean(source.teamId);
  if (source.type === "node_winner") return Boolean(source.nodeId);
  return source.type === "bye" || source.type === "unassigned";
}

export function validateCompetitionTree(nodes: CompetitionTreeNode[], entrantCount: number): CompetitionTreeValidation {
  const errors: string[] = [];
  const nodeById = new Map<string, CompetitionTreeNode>();
  const positionKeys = new Set<string>();
  const inboundParentCount = new Map<string, number>();
  const referencedNodeIds = new Set<string>();

  for (const node of nodes) {
    if (!node.id || nodeById.has(node.id)) errors.push(`Duplicate node id ${node.id || "(empty)"}.`);
    nodeById.set(node.id, node);
    const positionKey = `${node.competitionId}:${node.roundIndex}:${node.matchOrder}`;
    if (positionKeys.has(positionKey)) errors.push(`Duplicate node position ${positionKey}.`);
    positionKeys.add(positionKey);
    if (!sourceIsValid(node.homeSource) || !sourceIsValid(node.awaySource)) {
      errors.push(`Node ${node.id} has an invalid source shape.`);
    }
  }

  for (const node of nodes) {
    for (const source of [node.homeSource, node.awaySource]) {
      const sourceNodeId = sourceReferencesNode(source);
      if (!sourceNodeId) continue;
      const child = nodeById.get(sourceNodeId);
      if (!child) {
        errors.push(`Node ${node.id} references a missing source node.`);
        continue;
      }
      if (child.competitionId !== node.competitionId) errors.push(`Node ${node.id} references a cross-competition source.`);
      if (child.id === node.id || child.roundIndex >= node.roundIndex) {
        errors.push(`Node ${node.id} has a loop or non-descending source.`);
      }
      const parentCount = (inboundParentCount.get(child.id) ?? 0) + 1;
      inboundParentCount.set(child.id, parentCount);
      if (parentCount > 1) errors.push(`Source node ${child.id} has multiple parents.`);
      referencedNodeIds.add(child.id);
    }
  }

  const roots = nodes.filter((node) => !referencedNodeIds.has(node.id));
  if (nodes.length && roots.length !== 1) errors.push(`Expected one root node, found ${roots.length}.`);

  const reachable = new Set<string>();
  const visit = (node: CompetitionTreeNode) => {
    if (reachable.has(node.id)) return;
    reachable.add(node.id);
    for (const source of [node.homeSource, node.awaySource]) {
      const childId = sourceReferencesNode(source);
      const child = childId ? nodeById.get(childId) : undefined;
      if (child) visit(child);
    }
  };
  if (roots[0]) visit(roots[0]);
  if (reachable.size !== nodes.length) errors.push("Tree contains orphan or unreachable nodes.");

  const leafNodes = nodes.filter((node) => !sourceReferencesNode(node.homeSource) && !sourceReferencesNode(node.awaySource));
  const byeNodeCount = nodes.reduce(
    (count, node) => count + Number(node.homeSource.type === "bye") + Number(node.awaySource.type === "bye"),
    0,
  );
  const preliminaryNodeCount = nodes.filter((node) => node.roundLabel === "Preliminary").length;
  const roundIndexes = Array.from(new Set(nodes.map((node) => node.roundIndex))).sort((a, b) => a - b);

  return {
    errors,
    summary: {
      byeNodeCount,
      entrantCount,
      leafNodeCount: leafNodes.length,
      nodeCount: nodes.length,
      preliminaryNodeCount,
      rootNodeId: roots[0]?.id ?? null,
      roundCount: roundIndexes.length,
      roundLabels: roundIndexes.map((index) => nodes.find((node) => node.roundIndex === index)?.roundLabel ?? `Round ${index + 1}`),
    },
    valid: errors.length === 0,
  };
}

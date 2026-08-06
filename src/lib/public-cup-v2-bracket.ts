import type { PublicCupV2Node, PublicCupV2Source } from "@/lib/public-cup-v2-types";
import { hasResolvedBracketPairing } from "@/lib/knockout-template-switching";

export type PublicCupV2Round = {
  completed: boolean;
  current: boolean;
  finishedCount: number;
  nodes: PublicCupV2Node[];
  roundIndex: number;
  roundLabel: string;
};

function isFinishedNode(node: PublicCupV2Node) {
  return node.linkedMatch !== null && ["finished", "completed"].includes(node.linkedMatch.status);
}

function isByeNode(node: PublicCupV2Node) {
  return node.linkedMatch === null && (node.homeSource.type === "bye" || node.awaySource.type === "bye");
}

export function groupPublicCupV2Rounds(nodes: PublicCupV2Node[], partitionKey = "main"): PublicCupV2Round[] {
  const groups = new Map<number, PublicCupV2Node[]>();
  nodes
    .filter((node) => node.partitionKey === partitionKey && hasResolvedBracketPairing({
      linkedMatchId: node.linkedMatch?.id ?? null,
      awaySource: { teamId: node.awaySource.team?.id },
      homeSource: { teamId: node.homeSource.team?.id },
    }))
    .forEach((node) => groups.set(node.roundIndex, [...(groups.get(node.roundIndex) ?? []), node]));
  const rounds = Array.from(groups.entries())
    .sort(([left], [right]) => left - right)
    .map(([roundIndex, roundNodes]) => {
      const nodesInOrder = [...roundNodes].sort((left, right) => left.matchOrder - right.matchOrder);
      const finishedCount = nodesInOrder.filter((node) => isFinishedNode(node) || isByeNode(node)).length;
      return {
        completed: nodesInOrder.length > 0 && finishedCount === nodesInOrder.length,
        current: false,
        finishedCount,
        nodes: nodesInOrder,
        roundIndex,
        roundLabel: nodesInOrder[0]?.roundLabel || `Round ${roundIndex + 1}`,
      };
    });
  const currentIndex = rounds.findIndex((round) => !round.completed);
  if (currentIndex >= 0) rounds[currentIndex] = { ...rounds[currentIndex], current: true };
  return rounds;
}

export function publicCupV2SourceLabel(source: PublicCupV2Source) {
  if (source.team) return source.team.name;
  if (source.type === "group_rank") return `อันดับ ${source.rank ?? "?"} ${source.groupLabel ?? "จากกลุ่ม"}`;
  if (source.type === "best_ranked") return `ทีมอันดับเพิ่มเติม #${source.bestOrder ?? "?"}`;
  if (source.type === "node_winner") return "รอผู้ชนะจากคู่ก่อนหน้า";
  if (source.type === "bye") return "Bye";
  return "รอการยืนยันทีม";
}

export function publicCupV2SourcePresentation(source: PublicCupV2Source, nodes: PublicCupV2Node[]) {
  if (source.team) return source.team.name;
  if (source.type === "node_winner" && source.winnerNodeId) {
    const sourceNode = nodes.find((node) => node.id === source.winnerNodeId);
    if (sourceNode) return `ผู้ชนะ ${sourceNode.roundLabel} คู่ที่ ${sourceNode.matchOrder}`;
  }
  return publicCupV2SourceLabel(source);
}

export function publicCupV2ScoreLabel(node: PublicCupV2Node) {
  const match = node.linkedMatch;
  if (!match || match.homeScore === null || match.awayScore === null) return "VS";
  const normalTime = `${match.homeScore}-${match.awayScore}`;
  if (match.homePenaltyScore === null || match.awayPenaltyScore === null) return normalTime;
  return `${normalTime} (จุดโทษ ${match.homePenaltyScore}-${match.awayPenaltyScore})`;
}

export function isPublicCupKswMatch(node: PublicCupV2Node) {
  const teams = [
    node.linkedMatch?.homeTeam,
    node.linkedMatch?.awayTeam,
    node.homeSource.team,
    node.awaySource.team,
  ];

  return teams.some((team) => `${team?.name ?? ""} ${team?.shortName ?? ""}`.toLowerCase().includes("ksw"));
}

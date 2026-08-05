import type { CompetitionTreeNode } from "@/lib/competition-tree";

export type KnockoutCorrectionMatch = {
  awayScore: number | null;
  awayTeamId: string;
  id: string;
  homeScore: number | null;
  homeTeamId: string;
  manualWinnerTeamId?: string | null;
  penaltyAwayScore: number | null;
  penaltyHomeScore: number | null;
  status: string | null;
  venue: string | null;
  winnerTeamId: string | null;
};

export type KnockoutCorrectionProposal = {
  awayScore: number | null;
  homeScore: number | null;
  matchDate: string | null;
  penaltyAwayScore: number | null;
  penaltyHomeScore: number | null;
  status: "finished" | "scheduled";
  venue: string | null;
  winnerTeamId: string | null;
};

export type KnockoutCorrectionType = "editorial" | "result_same_winner" | "result_winner_changed";

export type KnockoutCorrectionPlan = {
  affectedMatchIds: string[];
  affectedNodeIds: string[];
  after: KnockoutCorrectionProposal;
  allowed: boolean;
  before: KnockoutCorrectionMatch | null;
  championAffected: boolean;
  championsToClear: string[];
  correctionType: KnockoutCorrectionType | null;
  message: string;
  newWinnerTeamId: string | null;
  oldWinnerTeamId: string | null;
  reasonCode: "invalid_target" | "target_not_finished" | "allowed";
  resultsToClear: string[];
  runtimeRoundIndex: number | null;
  winnerChanged: boolean;
};

export type KnockoutCorrectionInput = {
  matches: KnockoutCorrectionMatch[];
  nodes: CompetitionTreeNode[];
  proposed: KnockoutCorrectionProposal;
  targetMatchId: string;
};

function hasResult(match: KnockoutCorrectionMatch) {
  return match.status === "finished" || match.status === "completed" || match.homeScore !== null || match.awayScore !== null || match.penaltyHomeScore !== null || match.penaltyAwayScore !== null || Boolean(match.winnerTeamId) || Boolean(match.manualWinnerTeamId);
}

function sameResult(match: KnockoutCorrectionMatch, proposed: KnockoutCorrectionProposal) {
  return match.awayScore === proposed.awayScore
    && match.homeScore === proposed.homeScore
    && match.penaltyAwayScore === proposed.penaltyAwayScore
    && match.penaltyHomeScore === proposed.penaltyHomeScore
    && match.status === proposed.status
    && match.winnerTeamId === proposed.winnerTeamId;
}

/**
 * Read-only impact analysis for one finished knockout fixture. It follows
 * node_winner dependencies only, so unrelated bracket branches stay intact.
 */
export function analyzeKnockoutMatchCorrectionImpact(input: KnockoutCorrectionInput): KnockoutCorrectionPlan {
  const targetNode = input.nodes.find((node) => node.linkedMatchId === input.targetMatchId);
  const targetMatch = input.matches.find((match) => match.id === input.targetMatchId) ?? null;
  if (!targetNode || !targetMatch) {
    return { affectedMatchIds: [], affectedNodeIds: [], after: input.proposed, allowed: false, before: targetMatch, championAffected: false, championsToClear: [], correctionType: null, message: "ไม่พบแมตช์รอบน็อกเอาต์ของรายการนี้", newWinnerTeamId: null, oldWinnerTeamId: targetMatch?.winnerTeamId ?? null, reasonCode: "invalid_target", resultsToClear: [], runtimeRoundIndex: null, winnerChanged: false };
  }
  if (targetMatch.status !== "finished" && targetMatch.status !== "completed") {
    return { affectedMatchIds: [], affectedNodeIds: [], after: input.proposed, allowed: false, before: targetMatch, championAffected: false, championsToClear: [], correctionType: null, message: "แก้ไขย้อนหลังได้เฉพาะแมตช์รอบน็อกเอาต์ที่จบแล้ว", newWinnerTeamId: input.proposed.winnerTeamId, oldWinnerTeamId: targetMatch.winnerTeamId, reasonCode: "target_not_finished", resultsToClear: [], runtimeRoundIndex: targetNode.roundIndex, winnerChanged: false };
  }

  const oldWinnerTeamId = targetMatch.winnerTeamId;
  const newWinnerTeamId = input.proposed.winnerTeamId;
  const winnerChanged = oldWinnerTeamId !== newWinnerTeamId;
  const affectedNodeIds: string[] = [];
  const seen = new Set<string>([targetNode.id]);
  const queue = [targetNode.id];
  while (queue.length) {
    const sourceNodeId = queue.shift()!;
    input.nodes
      .filter((node) => node.homeSource.nodeId === sourceNodeId || node.awaySource.nodeId === sourceNodeId)
      .forEach((node) => {
        if (seen.has(node.id)) return;
        seen.add(node.id);
        affectedNodeIds.push(node.id);
        queue.push(node.id);
      });
  }
  const affectedNodes = input.nodes.filter((node) => affectedNodeIds.includes(node.id));
  const affectedMatchIds = affectedNodes.flatMap((node) => node.linkedMatchId ? [node.linkedMatchId] : []);
  const resultsToClear = input.matches.filter((match) => affectedMatchIds.includes(match.id) && hasResult(match)).map((match) => match.id);
  const finalRoundIndex = Math.max(...input.nodes.map((node) => node.roundIndex));
  const championAffected = winnerChanged && [targetNode, ...affectedNodes].some((node) => node.roundIndex === finalRoundIndex);
  const correctionType: KnockoutCorrectionType = !winnerChanged && !sameResult(targetMatch, input.proposed)
    ? "result_same_winner"
    : winnerChanged ? "result_winner_changed" : "editorial";
  const runtimeRoundIndex = winnerChanged
    ? affectedNodes.reduce<number | null>((minimum, node) => minimum === null || node.roundIndex < minimum ? node.roundIndex : minimum, null)
    : targetNode.roundIndex;

  return {
    affectedMatchIds: winnerChanged ? affectedMatchIds : [],
    affectedNodeIds: winnerChanged ? affectedNodeIds : [],
    after: input.proposed,
    allowed: true,
    before: targetMatch,
    championAffected,
    championsToClear: championAffected ? ["partition_champion"] : [],
    correctionType,
    message: winnerChanged
      ? "ผู้ชนะเปลี่ยน ระบบจะล้างเฉพาะโปรแกรมและผลในสายถัดไปที่รับผู้ชนะจากแมตช์นี้"
      : correctionType === "editorial" ? "ข้อมูลประกอบจะถูกแก้ไขโดยไม่กระทบผลการแข่งขัน" : "คะแนนจะถูกแก้ไขโดยไม่กระทบผู้ชนะหรือสายถัดไป",
    newWinnerTeamId,
    oldWinnerTeamId,
    reasonCode: "allowed",
    resultsToClear: winnerChanged ? resultsToClear : [],
    runtimeRoundIndex,
    winnerChanged,
  };
}

export const buildKnockoutCorrectionPlan = analyzeKnockoutMatchCorrectionImpact;

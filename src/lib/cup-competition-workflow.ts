import { calculateCupQualification } from "@/lib/cup-qualification";
import type { CupGroupRow } from "@/lib/cup-group-standings";
import { deriveKnockoutRoundState } from "@/lib/knockout-round-engine";
import type { CompetitionTreeNode } from "@/lib/competition-tree";

export type CupCompetitionWorkflowStep = {
  description: string;
  id: "teams" | "groups" | "group_matches" | "qualification" | "knockout_setup" | "knockout_matches" | "champion" | "completed";
  label: string;
  state: "complete" | "current" | "locked" | "upcoming";
  subStatus?: string;
};

export type CouncilWorkflowPartition = {
  approvalStatus: string | null;
  bracketConfirmed: boolean;
  championTeamId: string | null;
  partitionKey: "division_1" | "division_2";
  status: string | null;
};

function text(row: CupGroupRow | undefined, key: string) {
  return typeof row?.[key] === "string" ? row[key] as string : "";
}

export function calculateCupCompetitionWorkflow(input: {
  councilPartitions: CouncilWorkflowPartition[];
  groups: CupGroupRow[];
  matches: CupGroupRow[];
  nodes: CompetitionTreeNode[];
  competitionStatus: string | null;
  qualificationStatus: "approved" | "pending" | null;
  knockoutStatus: string | null;
  templateKey: string | null;
  teams: CupGroupRow[];
}) {
  const activeTeams = input.teams.filter((team) => team.is_active !== false);
  const groupIds = new Set(input.groups.map((group) => text(group, "id")).filter(Boolean));
  const teamsReady = activeTeams.length > 0;
  const groupsReady = teamsReady && groupIds.size > 0 && activeTeams.every((team) => groupIds.has(text(team, "group_id")));
  const qualification = calculateCupQualification({
    groups: input.groups,
    matches: input.matches,
    settings: { extraQualifierCount: 0, extraRank: null, extraRankEnabled: false },
    teams: input.teams,
  });
  const groupMatchesComplete = groupsReady && input.groups.length > 0 && input.groups.every((group) => qualification.groupComplete.get(text(group, "id")) === true);
  const qualificationApproved = input.qualificationStatus === "approved";
  const mainNodes = input.nodes.filter((node) => !node.partitionKey || node.partitionKey === "main");
  const finalNode = [...mainNodes].sort((a, b) => b.roundIndex - a.roundIndex)[0];
  const finalMatch = finalNode?.linkedMatchId ? input.matches.find((match) => text(match, "id") === finalNode.linkedMatchId) : undefined;
  const isCouncil = input.templateKey === "council_two_division";
  const knockoutMatches = input.matches.map((match) => ({
    id: text(match, "id"),
    status: text(match, "status") || null,
    winnerTeamId: text(match, "winner_team_id") || null,
  })).filter((match) => Boolean(match.id));
  const councilPartitions = (["division_1", "division_2"] as const).map((partitionKey) => {
    const partition = input.councilPartitions.find((entry) => entry.partitionKey === partitionKey);
    const runtime = deriveKnockoutRoundState({
      matches: knockoutMatches,
      nodes: input.nodes,
      partitionKey,
    });
    return {
      championCandidateReady: runtime.finalRound?.complete === true,
      fixturesCreated: runtime.rounds.some((round) => round.linkedMatchCount > 0),
      partition,
      runtime,
      topologyConfigured: runtime.rounds.length > 0,
    };
  });
  const councilDivisionApproved = councilPartitions.every(({ partition }) => partition?.approvalStatus === "approved");
  const councilSetupComplete = councilDivisionApproved && councilPartitions.every(({ partition, topologyConfigured }) => partition?.bracketConfirmed === true && topologyConfigured);
  const councilMatchesComplete = councilPartitions.every(({ runtime }) => runtime.finalRound?.complete === true);
  const councilChampionReady = councilPartitions.every(({ championCandidateReady }) => championCandidateReady);
  const kswSetupComplete = ["reviewed", "fixtures_created", "active", "completed"].includes(input.knockoutStatus ?? "");
  const kswMatchesComplete = text(finalMatch, "status") === "finished";
  const kswChampionReady = kswMatchesComplete && Boolean(text(finalMatch, "winner_team_id"));
  const knockoutSetupComplete = isCouncil ? councilSetupComplete : kswSetupComplete;
  const knockoutMatchesComplete = isCouncil ? councilMatchesComplete : kswMatchesComplete;
  const championReady = isCouncil ? councilChampionReady : kswChampionReady;
  const competitionCompleted = input.competitionStatus === "completed";

  const divisionLabel = ({ fixturesCreated, partition, runtime, topologyConfigured }: (typeof councilPartitions)[number]) => {
    const label = partition?.partitionKey === "division_1" ? "D1" : "D2";
    if (!partition?.bracketConfirmed || !topologyConfigured) return `${label} รอจัดสาย`;
    if (runtime.finalRound?.complete) return `${label} ✓`;
    if (!fixturesCreated && runtime.firstPlayableRound) return `${label} พร้อมสร้างโปรแกรม`;
    return `${label} กำลังแข่งขัน`;
  };
  const knockoutSubStatus = isCouncil ? councilPartitions.map(divisionLabel).join(" · ") : undefined;
  const championSubStatus = isCouncil
    ? councilPartitions.map(({ championCandidateReady, partition }) => `${partition?.partitionKey === "division_1" ? "D1" : "D2"} ${championCandidateReady ? "✓" : "รอผล"}`).join(" · ")
    : undefined;
  const definitions = [
    { complete: teamsReady, description: "เพิ่มทีมที่จะเข้าร่วมการแข่งขัน", id: "teams" as const, label: "ทีมที่เข้าแข่งขัน" },
    { complete: groupsReady, description: "จัดทีมทุกทีมเข้าสู่กลุ่ม", id: "groups" as const, label: "แบ่งกลุ่ม" },
    { complete: groupMatchesComplete, description: "บันทึกผลให้ครบทุกคู่ของทุกกลุ่ม", id: "group_matches" as const, label: "แข่งขันรอบแบ่งกลุ่ม" },
    { complete: qualificationApproved, description: "ตรวจสอบและยืนยันทีมผ่านเข้ารอบ", id: "qualification" as const, label: "ยืนยันทีมผ่านเข้ารอบ" },
    { complete: knockoutSetupComplete, description: "ตั้งค่าและยืนยันโครงสร้างรอบน็อกเอาต์", id: "knockout_setup" as const, label: "ตั้งค่ารอบน็อกเอาต์" },
    { complete: knockoutMatchesComplete, description: "แข่งขันจนถึงรอบชิงชนะเลิศ", id: "knockout_matches" as const, label: "แข่งขันรอบน็อกเอาต์", subStatus: knockoutSubStatus },
    { complete: championReady, description: "สรุปผู้ชนะการแข่งขัน", id: "champion" as const, label: "Champion", subStatus: championSubStatus },
    { complete: competitionCompleted, description: "ตรวจสอบผลและปิดการแข่งขัน", id: "completed" as const, label: "Completed" },
  ];

  const currentIndex = definitions.findIndex((step) => !step.complete);

  return definitions.map((step, index): CupCompetitionWorkflowStep => {
    const state = competitionCompleted || step.complete
      ? "complete"
      : index === currentIndex
        ? "current"
        : index === currentIndex + 1
          ? "upcoming"
          : "locked";
    return {
      description: step.description,
      id: step.id,
      label: step.label,
      state,
      subStatus: step.subStatus,
    };
  });
}

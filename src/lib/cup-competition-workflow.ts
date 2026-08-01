import { calculateCupQualification } from "@/lib/cup-qualification";
import type { CupGroupRow } from "@/lib/cup-group-standings";

export type CupCompetitionWorkflowStep = {
  description: string;
  id: "teams" | "groups" | "group_matches" | "qualification" | "knockout_setup" | "knockout_matches" | "champion";
  label: string;
  state: "complete" | "current" | "locked" | "upcoming";
};

function text(row: CupGroupRow | undefined, key: string) {
  return typeof row?.[key] === "string" ? row[key] as string : "";
}

export function calculateCupCompetitionWorkflow(input: {
  groups: CupGroupRow[];
  matches: CupGroupRow[];
  nodes: Array<{ linkedMatchId?: string; roundIndex: number }>;
  competitionStatus: string | null;
  qualificationStatus: "approved" | "pending" | null;
  knockoutStatus: string | null;
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
  const knockoutSetupComplete = ["reviewed", "fixtures_created", "active", "completed"].includes(input.knockoutStatus ?? "");
  const finalNode = [...input.nodes].sort((a, b) => b.roundIndex - a.roundIndex)[0];
  const finalMatch = finalNode?.linkedMatchId ? input.matches.find((match) => text(match, "id") === finalNode.linkedMatchId) : undefined;
  const knockoutMatchesComplete = text(finalMatch, "status") === "finished";
  const championReady = knockoutMatchesComplete && Boolean(text(finalMatch, "winner_team_id"));
  const championComplete = championReady && input.competitionStatus === "completed";
  const definitions = [
    { complete: teamsReady, description: "เพิ่มทีมที่จะเข้าร่วมการแข่งขัน", id: "teams" as const, label: "ทีมที่เข้าแข่งขัน" },
    { complete: groupsReady, description: "จัดทีมทุกทีมเข้าสู่กลุ่ม", id: "groups" as const, label: "แบ่งกลุ่ม" },
    { complete: groupMatchesComplete, description: "บันทึกผลให้ครบทุกคู่ของทุกกลุ่ม", id: "group_matches" as const, label: "แข่งขันรอบแบ่งกลุ่ม" },
    { complete: qualificationApproved, description: "ตรวจสอบและยืนยันทีมผ่านเข้ารอบ", id: "qualification" as const, label: "ยืนยันทีมผ่านเข้ารอบ" },
    { complete: knockoutSetupComplete, description: "ตั้งค่าและยืนยันโครงสร้างรอบน็อกเอาต์", id: "knockout_setup" as const, label: "ตั้งค่ารอบน็อกเอาต์" },
    { complete: knockoutMatchesComplete, description: "แข่งขันจนถึงรอบชิงชนะเลิศ", id: "knockout_matches" as const, label: "แข่งขันรอบน็อกเอาต์" },
    { complete: championComplete, description: "สรุปผู้ชนะการแข่งขัน", id: "champion" as const, label: "Champion" },
  ];

  const currentIndex = definitions.findIndex((step) => !step.complete);

  return definitions.map((step, index): CupCompetitionWorkflowStep => {
    const state = step.complete
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
    };
  });
}

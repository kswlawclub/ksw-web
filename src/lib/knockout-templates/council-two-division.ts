import type { CompetitionTreeSource } from "@/lib/competition-tree";
import type { KnockoutTemplateDefinition } from "@/lib/knockout-templates/types";

const supportedEntrantCounts = [4, 8, 16, 32];

function validateCouncilSources(sources: CompetitionTreeSource[]) {
  const groupWinnerCount = sources.filter((source) => source.type === "group_rank" && source.rank === 1).length;
  const runnerUpCount = sources.filter((source) => source.type === "group_rank" && source.rank === 2).length;
  const hasSupportedDivision1 = supportedEntrantCounts.includes(groupWinnerCount);
  const hasCapacityForDivision2 = supportedEntrantCounts.some((capacity) => capacity >= runnerUpCount);

  if (hasSupportedDivision1 && hasCapacityForDivision2) return { errors: [], valid: true };

  return {
    errors: ["คัพสภา – สองดิวิชั่นต้องมีแชมป์กลุ่ม 4, 8, 16 หรือ 32 ทีม และรองแชมป์กลุ่มต้องจัดลงสายได้"],
    valid: false,
  };
}

export const councilTwoDivisionTemplate: KnockoutTemplateDefinition = {
  buildPreview: () => ({
    error: "",
    partitions: [],
    sources: [],
    supported: true,
    templateKey: "council_two_division",
  }),
  championCount: 2,
  completionMode: "all_partitions_complete",
  description: "แยกทีมเป็นสองสายอิสระและมีแชมป์สองรายการ",
  diagram: {
    branches: [
      { championLabel: "แชมป์ D1", label: "Division 1" },
      { championLabel: "แชมป์ D2", label: "Division 2" },
    ],
    mode: "split",
    steps: ["รอบแบ่งกลุ่ม", "แยกดิวิชั่น"],
  },
  enabled: true,
  featureBullets: ["2 แชมป์", "2 สายน็อกเอาต์", "Division 1", "Division 2"],
  key: "council_two_division",
  name: "คัพสภา – สองดิวิชั่น",
  partitionCount: 2,
  partitions: [
    { championLabel: "แชมป์ดิวิชั่น 1", key: "division_1", label: "Division 1" },
    { championLabel: "แชมป์ดิวิชั่น 2", key: "division_2", label: "Division 2" },
  ],
  pairExplanation: () => "จัดคู่ข้ามกลุ่มจาก Division Snapshot ที่อนุมัติแล้ว",
  qualificationMode: "approved_snapshot",
  statusLabel: "พร้อมตั้งค่า",
  sourceLabel: (source) => source.type === "best_ranked" ? `อันดับเพิ่มเติม #${source.bestOrder ?? "?"}` : `${source.groupId ?? "?"}${source.rank ?? "?"}`,
  supportedEntrantCounts,
  supportsManualPairing: true,
  supportsMultipleBrackets: true,
  validateSources: validateCouncilSources,
};

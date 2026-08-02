import type { KnockoutTemplateDefinition } from "@/lib/knockout-templates/types";

export const councilTwoDivisionTemplate: KnockoutTemplateDefinition = {
  buildPreview: () => ({
    error: "Council Cup – Two Division ยังไม่พร้อมใช้งาน",
    partitions: [],
    sources: [],
    supported: false,
    templateKey: "council_two_division",
  }),
  championCount: 2,
  completionMode: "all_partitions_complete",
  description: "แยกทีมเป็นสองสายอิสระและมีแชมป์สองรายการ",
  enabled: false,
  key: "council_two_division",
  name: "คัพสภา – สองดิวิชั่น",
  partitionCount: 2,
  partitions: [
    { championLabel: "แชมป์ดิวิชั่น 1", key: "division_1", label: "Division 1" },
    { championLabel: "แชมป์ดิวิชั่น 2", key: "division_2", label: "Division 2" },
  ],
  pairExplanation: () => "ยังไม่พร้อมใช้งาน",
  qualificationMode: "approved_snapshot",
  sourceLabel: (source) => source.type === "best_ranked" ? `อันดับเพิ่มเติม #${source.bestOrder ?? "?"}` : `${source.groupId ?? "?"}${source.rank ?? "?"}`,
  supportsManualPairing: true,
  supportsMultipleBrackets: true,
  validateSources: () => ({ errors: ["Council Cup – Two Division ยังไม่พร้อมใช้งาน"], valid: false }),
};

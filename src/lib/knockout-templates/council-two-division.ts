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
  diagram: {
    branches: [
      { championLabel: "แชมป์ D1", label: "Division 1" },
      { championLabel: "แชมป์ D2", label: "Division 2" },
    ],
    mode: "split",
    steps: ["รอบแบ่งกลุ่ม", "แยกดิวิชั่น"],
  },
  enabled: false,
  featureBullets: ["2 แชมป์", "2 สายน็อกเอาต์", "Division 1", "Division 2"],
  key: "council_two_division",
  name: "คัพสภา – สองดิวิชั่น",
  partitionCount: 2,
  partitions: [
    { championLabel: "แชมป์ดิวิชั่น 1", key: "division_1", label: "Division 1" },
    { championLabel: "แชมป์ดิวิชั่น 2", key: "division_2", label: "Division 2" },
  ],
  pairExplanation: () => "ยังไม่พร้อมใช้งาน",
  qualificationMode: "approved_snapshot",
  statusLabel: "ยังไม่เปิดใช้งาน",
  sourceLabel: (source) => source.type === "best_ranked" ? `อันดับเพิ่มเติม #${source.bestOrder ?? "?"}` : `${source.groupId ?? "?"}${source.rank ?? "?"}`,
  supportsManualPairing: true,
  supportsMultipleBrackets: true,
  validateSources: () => ({ errors: ["Council Cup – Two Division ยังไม่พร้อมใช้งาน"], valid: false }),
};

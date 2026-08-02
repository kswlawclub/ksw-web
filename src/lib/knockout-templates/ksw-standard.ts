import { buildKswStandardPairing, explainKswStandardPair, kswSourceLabel } from "@/lib/ksw-knockout-template";
import type { KnockoutTemplateDefinition } from "@/lib/knockout-templates/types";

export const kswStandardTemplate: KnockoutTemplateDefinition = {
  buildPreview: (sources) => {
    const pairing = buildKswStandardPairing(sources);
    return {
      partitions: [{
        entrants: pairing.sources,
        key: "main",
        label: "รอบน็อกเอาต์",
        pairs: pairing.pairs,
      }],
      sources: pairing.sources,
      supported: true,
      templateKey: "ksw_standard",
    };
  },
  championCount: 1,
  completionMode: "single_champion",
  description: "แชมป์กลุ่มเป็นทีมวาง จับคู่ข้ามกลุ่ม และให้ Wild Card พบแชมป์กลุ่มก่อน",
  diagram: { mode: "linear", steps: ["รอบแบ่งกลุ่ม", "ทีมผ่านเข้ารอบ", "น็อกเอาต์", "แชมป์"] },
  enabled: true,
  featureBullets: ["1 แชมป์", "1 สายน็อกเอาต์", "จับคู่ข้ามกลุ่ม", "รองรับ Wild Card"],
  key: "ksw_standard",
  name: "KSW Standard",
  partitionCount: 1,
  partitions: [{ championLabel: "แชมป์การแข่งขัน", key: "main", label: "รอบน็อกเอาต์" }],
  pairExplanation: explainKswStandardPair,
  qualificationMode: "approved_snapshot",
  statusLabel: "พร้อมใช้งาน",
  sourceLabel: kswSourceLabel,
  supportedEntrantCounts: [2, 4, 8, 16, 32, 64],
  supportsManualPairing: true,
  supportsMultipleBrackets: false,
  validateSources: () => ({ errors: [], valid: true }),
};

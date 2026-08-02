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
  enabled: true,
  key: "ksw_standard",
  name: "KSW Standard",
  partitionCount: 1,
  partitions: [{ championLabel: "แชมป์การแข่งขัน", key: "main", label: "รอบน็อกเอาต์" }],
  pairExplanation: explainKswStandardPair,
  qualificationMode: "approved_snapshot",
  sourceLabel: kswSourceLabel,
  supportsManualPairing: true,
  supportsMultipleBrackets: false,
  validateSources: () => ({ errors: [], valid: true }),
};

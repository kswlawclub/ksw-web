export const competitionEngineV2Statuses = ["draft", "reviewed", "fixtures_created", "active", "completed"] as const;

export type CompetitionEngineV2Status = (typeof competitionEngineV2Statuses)[number];

export type CompetitionEngineV2Integrity = {
  hasConfig: boolean;
  hasLinkedMatches: boolean;
  hasValidTree: boolean;
  isEngineV2: boolean;
  status: CompetitionEngineV2Status | null;
  warning: string | null;
};

const labels: Record<CompetitionEngineV2Status, { en: string; th: string }> = {
  active: { en: "Active", th: "กำลังแข่งขัน" },
  completed: { en: "Completed", th: "จบการแข่งขัน" },
  draft: { en: "Draft", th: "กำลังตั้งค่า" },
  fixtures_created: { en: "Fixtures created", th: "สร้างโปรแกรมแล้ว" },
  reviewed: { en: "Reviewed", th: "ตรวจสอบแล้ว" },
};

const transitions: Record<CompetitionEngineV2Status, CompetitionEngineV2Status[]> = {
  active: ["completed"],
  completed: [],
  draft: ["reviewed"],
  fixtures_created: ["active"],
  reviewed: ["draft", "fixtures_created"],
};

export function isCompetitionEngineV2Status(value: unknown): value is CompetitionEngineV2Status {
  return typeof value === "string" && competitionEngineV2Statuses.includes(value as CompetitionEngineV2Status);
}

export function competitionEngineV2StatusLabel(status: CompetitionEngineV2Status) {
  return labels[status];
}

export function canEditQualification(status: CompetitionEngineV2Status) {
  return status === "draft";
}

export function canGenerateTree(status: CompetitionEngineV2Status) {
  return status === "draft";
}

export function canReviewTree(status: CompetitionEngineV2Status) {
  return status === "draft";
}

export function canCreateFixtures(status: CompetitionEngineV2Status) {
  return status === "reviewed";
}

export function canManageMatches(status: CompetitionEngineV2Status) {
  return status === "fixtures_created" || status === "active";
}

export function canCompleteCompetition(status: CompetitionEngineV2Status) {
  return status === "active";
}

export function assertAllowedTransition(from: CompetitionEngineV2Status, to: CompetitionEngineV2Status) {
  if (!transitions[from].includes(to)) {
    throw new Error(`Knockout competition workflow cannot transition from ${from} to ${to}.`);
  }
}

export function deriveCompetitionEngineV2Integrity(input: {
  engineVersion: number | null;
  hasConfig: boolean;
  hasLinkedMatches: boolean;
  hasValidTree: boolean;
  status: CompetitionEngineV2Status | null;
}): CompetitionEngineV2Integrity {
  const isEngineV2 = input.engineVersion === 2;
  let warning: string | null = null;

  if (isEngineV2 && !input.hasConfig) warning = "ยังไม่มีการตั้งค่ารอบน็อกเอาต์";
  if (isEngineV2 && input.status === "reviewed" && (!input.hasConfig || !input.hasValidTree)) {
    warning = "สถานะตรวจสอบแล้วไม่สอดคล้องกับการตั้งค่าหรือโครงสร้างการแข่งขัน";
  }
  if (isEngineV2 && input.status === "fixtures_created" && !input.hasLinkedMatches) {
    warning = "สถานะสร้างโปรแกรมแล้ว แต่ยังไม่พบแมตช์ที่ผูกกับโครงสร้างการแข่งขัน";
  }

  return {
    hasConfig: input.hasConfig,
    hasLinkedMatches: input.hasLinkedMatches,
    hasValidTree: input.hasValidTree,
    isEngineV2,
    status: input.status,
    warning,
  };
}

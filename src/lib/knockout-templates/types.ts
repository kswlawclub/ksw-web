import type { CompetitionTreeSource } from "@/lib/competition-tree";

export const knockoutTemplateKeys = ["ksw_standard", "council_two_division"] as const;

export type KnockoutTemplateKey = (typeof knockoutTemplateKeys)[number];

export type KnockoutTemplatePartition = {
  championLabel: string;
  key: string;
  label: string;
};

export type KnockoutTemplatePair = {
  away: CompetitionTreeSource;
  home: CompetitionTreeSource;
  reason: string;
};

export type KnockoutTemplatePreview = {
  error?: string;
  partitions: Array<{
    entrants: CompetitionTreeSource[];
    key: string;
    label: string;
    pairs: KnockoutTemplatePair[];
  }>;
  sources: CompetitionTreeSource[];
  supported: boolean;
  templateKey: KnockoutTemplateKey;
};

export type KnockoutTemplateDefinition = {
  buildPreview: (sources: CompetitionTreeSource[]) => KnockoutTemplatePreview;
  championCount: number;
  completionMode: "all_partitions_complete" | "single_champion";
  description: string;
  enabled: boolean;
  key: KnockoutTemplateKey;
  name: string;
  partitionCount: number;
  partitions: KnockoutTemplatePartition[];
  pairExplanation: (home: CompetitionTreeSource, away: CompetitionTreeSource) => string;
  qualificationMode: "approved_snapshot";
  sourceLabel: (source: CompetitionTreeSource) => string;
  supportsManualPairing: boolean;
  supportsMultipleBrackets: boolean;
  validateSources: (sources: CompetitionTreeSource[]) => { errors: string[]; valid: boolean };
};

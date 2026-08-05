import { councilTwoDivisionTemplate } from "@/lib/knockout-templates/council-two-division";
import { kswStandardTemplate } from "@/lib/knockout-templates/ksw-standard";
import { knockoutTemplateKeys, type KnockoutTemplateDefinition, type KnockoutTemplateKey } from "@/lib/knockout-templates/types";
import type { CompetitionTreeSource } from "@/lib/competition-tree";

const templates = [kswStandardTemplate, councilTwoDivisionTemplate] as const satisfies readonly KnockoutTemplateDefinition[];

export function getKnockoutTemplate(key: KnockoutTemplateKey) {
  return templates.find((template) => template.key === key);
}

export function isKnockoutTemplateKey(value: unknown): value is KnockoutTemplateKey {
  return typeof value === "string" && knockoutTemplateKeys.includes(value as KnockoutTemplateKey);
}

export function getDefaultKnockoutTemplate() {
  return kswStandardTemplate;
}

export function listKnockoutTemplates() {
  return templates;
}

export function buildKnockoutTemplatePreview(key: KnockoutTemplateKey, sources: CompetitionTreeSource[]) {
  return (getKnockoutTemplate(key) ?? getDefaultKnockoutTemplate()).buildPreview(sources);
}

export function validateKnockoutTemplateSources(key: KnockoutTemplateKey, sources: CompetitionTreeSource[]) {
  return (getKnockoutTemplate(key) ?? getDefaultKnockoutTemplate()).validateSources(sources);
}

export function getKnockoutTemplateCompletionMode(key: KnockoutTemplateKey) {
  return (getKnockoutTemplate(key) ?? getDefaultKnockoutTemplate()).completionMode;
}

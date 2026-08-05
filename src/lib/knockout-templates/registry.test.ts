import assert from "node:assert/strict";
import test from "node:test";
import { getKnockoutTemplate, isKnockoutTemplateKey, listKnockoutTemplates, validateKnockoutTemplateSources } from "./registry.ts";

test("lists the shared selectable knockout templates with stable keys", () => {
  assert.deepEqual(listKnockoutTemplates().map((template) => template.key), ["ksw_standard", "council_two_division"]);
  assert.equal(isKnockoutTemplateKey("ksw_standard"), true);
  assert.equal(isKnockoutTemplateKey("council_two_division"), true);
  assert.equal(isKnockoutTemplateKey("unknown"), false);
  assert.equal(getKnockoutTemplate("ksw_standard")?.enabled, true);
});

test("allows KSW Standard from an approved source snapshot and gates Council on valid divisions", () => {
  const sources = ["a", "b", "c", "d"].flatMap((groupId) => [
    { groupId, rank: 1, teamId: `${groupId}-winner`, type: "group_rank" as const },
    { groupId, rank: 2, teamId: `${groupId}-runner-up`, type: "group_rank" as const },
  ]);

  assert.equal(validateKnockoutTemplateSources("ksw_standard", sources).valid, true);
  assert.equal(validateKnockoutTemplateSources("council_two_division", sources).valid, true);
  assert.equal(validateKnockoutTemplateSources("council_two_division", []).valid, false);
});

test("accepts three group winners so Council preflight can fill each division from ranked third-place teams", () => {
  const sources = ["a", "b", "c"].flatMap((groupId) => [
    { groupId, rank: 1, teamId: `${groupId}-winner`, type: "group_rank" as const },
    { groupId, rank: 2, teamId: `${groupId}-runner-up`, type: "group_rank" as const },
  ]);

  assert.equal(validateKnockoutTemplateSources("council_two_division", sources).valid, true);
});

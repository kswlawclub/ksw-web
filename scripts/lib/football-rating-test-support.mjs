import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as icons from "lucide-react";
import * as members from "../../src/lib/club-members.ts";

export function loadRatingModule(path, imports = {}) {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => {
    assert.ok(Object.hasOwn(imports, name), `Unmocked import blocked: ${name}`);
    return imports[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

export const ratingContract = loadRatingModule("src/lib/member-football-rating.ts", { "./club-members": members });
export const ratingDiagnostics = loadRatingModule("src/lib/member-football-rating-diagnostics.ts");
export const card = loadRatingModule("src/components/member-football-card.tsx", {
  "react/jsx-runtime": jsx, "@/lib/member-football-rating": ratingContract,
  "next/image": ({ unoptimized, ...props }) => { assert.equal(unoptimized, true); return React.createElement("img", props); },
});
export const publicRating = loadRatingModule("src/components/public-member-rating.tsx", {
  react: React, "react/jsx-runtime": jsx, "lucide-react": icons, "@/components/member-football-card": card,
});
export const fixtureId = (index = 1) => `e950da1b-7788-4e80-bcec-${String(index).padStart(12, "0")}`;
export function ratingInput(type = "player", memberId = fixtureId(), value = 60) {
  return { member_id: memberId, rating_type: type, ...Object.fromEntries(ratingContract.footballStats[type].map(({ field }) => [field, value])) };
}
export function ratingRow(type = "player", memberId = fixtureId(), value = 60) {
  return { ...ratingContract.parseFootballRatingInput(ratingInput(type, memberId, value)).payload, overall: value };
}

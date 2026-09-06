// Real loader/client/Card/CSS with read-only in-memory public queries. No DB/auth/network access.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "node:http";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack");
const { chromium } = require(process.env.KSW_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "ksw-lineup-rating-"));
const generated = (name, source) => { const path = join(temp, name); writeFileSync(path, source); return path; };
const loader = generated("ts-loader.cjs", `const ts=require(${JSON.stringify(require.resolve("typescript"))});const babel=require(${JSON.stringify(require.resolve("next/dist/compiled/babel/core"))});module.exports=function(source){const styled=babel.transformSync(source,{filename:this.resourcePath,babelrc:false,configFile:false,parserOpts:{plugins:["typescript","jsx"]},plugins:[${JSON.stringify(require.resolve("styled-jsx/babel"))}]});return ts.transpileModule(styled.code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
const fixture = generated("fixture.ts", `
import { parseFootballRatingInput, footballOverallPreview } from "@/lib/member-football-rating";
const id=n=>"e950da1b-7788-4e80-bcec-"+String(n).padStart(12,"0");
const names=["Alpha","Keeper","NoRating","Backup","Inactive","Disabled"];
const members=names.map((nickname,i)=>({id:id(i+1),nickname,photo_url:"/images/staff/staff-01.png",membership_type:i===1?"extraordinary":"ordinary",shirt_number:i+1,birth_year_be:i===3?null:new Date().getFullYear()+543-(30+i*10),is_active:i!==4,lineup_enabled:i!==5}));
const makeRating=(n,type)=>{const fields=type==="player"?["pace","shooting","passing","dribbling","defending","physical"]:["gk_diving","gk_handling","gk_kicking","gk_reflexes","gk_speed","gk_positioning"];const payload=parseFootballRatingInput({member_id:id(n),rating_type:type,...Object.fromEntries(fields.map(f=>[f,80]))}).payload;return {...payload,overall:footballOverallPreview(type,payload)};};
const ratings=[makeRating(1,"player"),makeRating(2,"goalkeeper"),makeRating(5,"player"),makeRating(6,"player")];
const snapshot=JSON.stringify(members);window.qa={calls:[],unchanged:()=>JSON.stringify(members)===snapshot};
export function getSupabase(){return {from(table){window.qa.calls.push(table);if(table==="club_member_football_ratings")return {select(){return {in(_column,ids){return Promise.resolve({data:ratings.filter(r=>ids.includes(r.member_id)),error:location.search.includes("ratingError")?{}:null});}};}};if(table==="teams")return {select(){return {order(){return Promise.resolve({data:[],error:null});}};}};if(table!=="club_members")throw new Error("Unexpected table");const query={select(){return query;},eq(){return query;},order(){return Promise.resolve({data:members.filter(m=>m.is_active&&m.lineup_enabled),error:null});}};return query;}};}
`);
const entry = generated("entry.tsx", `
import React from "react";import {hydrateRoot} from "react-dom/client";import {renderToString} from "react-dom/server.browser";
import Page from ${JSON.stringify(join(root, "src/app/lineup-builder/page.tsx"))};
async function main(){const root=document.getElementById("root");const page=await Page();root.innerHTML=renderToString(page);hydrateRoot(root,page);window.qa.ready=true;}main();
`);
await new Promise((resolve, reject) => webpack({
  mode: "development", devtool: false, context: root, entry,
  output: { path: temp, filename: "bundle.js" },
  resolve: { extensions: [".tsx", ".ts", ".js", ".mjs"], modules: [join(root, "node_modules")], alias: { "@": join(root, "src"), "@/lib/supabase$": fixture } },
  module: { rules: [{ test: /\.tsx?$/, use: [loader] }] },
  plugins: [new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: "development" }) }), new webpack.NormalModuleReplacementPlugin(/^@\/lib\/supabase$/, fixture)],
}, (error, stats) => {
  if (error || stats.hasErrors()) return reject(error ?? new Error(stats.toString({ all: false, errors: true })));
  assert.ok(!stats.toJson({ all: false, modules: true }).modules.some((module) => /supabase-admin|admin-server-auth|@supabase/.test(module.name ?? "")));
  resolve();
}));
function cssFiles(path) { return readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? cssFiles(join(path, entry.name)) : entry.name.endsWith(".css") ? [join(path, entry.name)] : []); }
const css = cssFiles(join(root, ".next/static")).map((path) => readFileSync(path, "utf8")).join("\n");
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/bundle.js") { response.setHeader("Content-Type", "application/javascript"); response.end(readFileSync(join(temp, "bundle.js"))); }
  else if (path === "/style.css") { response.setHeader("Content-Type", "text/css"); response.end(css); }
  else if (path === "/images/staff/staff-01.png") { response.setHeader("Content-Type", "image/png"); response.end(readFileSync(join(root, "public/images/staff/staff-01.png"))); }
  else { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end('<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.KSW_BROWSER_CHANNEL || "chrome" });
  for (const [width, touch] of [[375, true], [768, true], [1440, false], [768, false], [1440, true]]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, hasTouch: touch, reducedMotion: "reduce" });
    await context.route("**/*", (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error" && message.text() !== "public lineup football ratings unavailable") errors.push(message.text()); });
    await page.goto(base);
    await page.waitForFunction(() => window.qa?.ready);
    const marker = page.getByRole("button", { name: "Select player for GK", exact: true });
    const picker = page.locator('[role="dialog"]').filter({ has: page.getByRole("heading", { name: "Select Player for GK", exact: true }) });
    const row = (name) => picker.locator(".lineup-picker-scroll").getByRole("button", { name: new RegExp(`^#\\d ${name} ·`) });
    const click = (target) => touch ? target.tap() : target.click();
    await click(marker);
    await picker.waitFor({ state: "visible" });
    assert.deepEqual(await picker.locator('.lineup-picker-scroll > div > button:first-child').allTextContents(), [
      "#1 Alpha · Age 30U35", "#2 Keeper · Age 4040-44", "#3 NoRating · Age 5050+", "#4 Backup · Age -Age -",
    ]);
    assert.doesNotMatch(await picker.innerText(), /Inactive|Disabled|OVR/);
    if (width === 375) {
      const guide = picker.getByRole("button", { name: "ดูหน้าที่ตำแหน่งนี้" });
      await guide.tap();
      assert.equal(await picker.getByRole("button", { name: "ซ่อนหน้าที่ตำแหน่งนี้" }).getAttribute("aria-expanded"), "true");
      await picker.getByRole("button", { name: "Close player picker" }).tap();
      await marker.tap();
      assert.equal(await guide.getAttribute("aria-expanded"), "false");
    }
    if (!touch) {
      await row("NoRating").hover();
      assert.equal(await page.locator("[data-lineup-rating-overlay]").count(), 0);
      await row("Alpha").hover();
      const preview = page.locator('[data-lineup-rating-overlay="preview"]');
      await preview.waitFor({ state: "visible" });
      await assertCard(preview, "Player");
      await assertFits(page, preview);
      assert.ok(!overlaps(await row("Alpha").boundingBox(), await preview.boundingBox()), "Preview does not cover selectable row");
      await page.screenshot({ path: join(temp, `selector-${width}-mouse.png`) });
      await page.mouse.move(10, 10);
      await preview.waitFor({ state: "detached" });
      await row("NoRating").hover();
      await row("Alpha").focus();
      await preview.waitFor({ state: "visible" });
      await preview.hover();
      await preview.getByRole("button", { name: "ปิด Football Rating" }).focus();
      await page.mouse.move(10, 10);
      await page.waitForTimeout(300);
      assert.ok(await preview.isVisible(), "Mouse leave preserves keyboard focus inside the Rating Card");
      await page.keyboard.press("Escape");
      await preview.waitFor({ state: "detached" });
      assert.ok(await picker.isVisible(), "Escape dismisses Rating, not the picker underneath");
      assert.ok(await row("Alpha").evaluate((element) => element === document.activeElement));
    } else {
      await picker.getByRole("button", { name: "ดู Football Rating ทนายAlpha", exact: true }).tap();
      const info = page.locator('[data-lineup-rating-overlay="info"]');
      await info.waitFor({ state: "visible" });
      await assertCard(info, "Player");
      await assertFits(page, info);
      assert.equal(await page.locator(".lineup-marker-selected").count(), 0);
      await info.getByRole("button", { name: "ปิด Football Rating" }).tap();
      await info.waitFor({ state: "detached" });
      assert.ok(await picker.isVisible());
      await picker.getByRole("button", { name: "ดู Football Rating Keeper", exact: true }).tap();
      await assertCard(info, "Goalkeeper");
      await page.touchscreen.tap(2, 2);
      await info.waitFor({ state: "detached" });
      assert.equal(await page.locator(".lineup-marker-selected").count(), 0);
    }
    await click(row("Alpha"));
    await picker.waitFor({ state: "detached" });
    assert.equal(await page.locator(".lineup-marker-selected").count(), 1);
    assert.doesNotMatch(await page.locator("main").innerText(), /OVR/);
    if (!touch) {
      await marker.hover();
      const preview = page.locator('[data-lineup-rating-overlay="preview"]');
      await preview.waitFor({ state: "visible" });
      await assertCard(preview, "Player");
      await page.keyboard.press("Escape");
      await preview.waitFor({ state: "detached" });
      await page.keyboard.press("Tab");
      await marker.focus();
      await preview.waitFor({ state: "visible" });
      await assertCard(preview, "Player");
      await marker.click();
      await picker.waitFor({ state: "visible" });
      assert.equal(await page.locator('[data-lineup-rating-overlay="actions"]').count(), 0);
      await picker.getByRole("button", { name: "Clear Position", exact: true }).click();
    } else {
      await marker.tap();
      const sheet = page.locator('[data-lineup-rating-overlay="actions"]');
      await sheet.waitFor({ state: "visible" });
      await assertCard(sheet, "Player");
      await assertFits(page, sheet);
      await page.screenshot({ path: join(temp, `pitch-${width}-touch.png`) });
      await sheet.getByRole("button", { name: "เปลี่ยนผู้เล่น" }).tap();
      await picker.waitFor({ state: "visible" });
      await row("Keeper").tap();
      await marker.tap();
      await assertCard(sheet, "Goalkeeper");
      await sheet.getByRole("button", { name: "นำออกจากตำแหน่ง" }).tap();
    }
    assert.equal(await page.locator(".lineup-marker-selected").count(), 0);
    await click(marker);
    await click(row("NoRating"));
    if (touch) {
      await marker.tap();
      const sheet = page.locator('[data-lineup-rating-overlay="actions"]');
      await sheet.getByText("ยังไม่มี Football Rating", { exact: true }).waitFor();
      assert.equal(await sheet.locator("svg[data-rating-radar], dd").count(), 0);
      assert.doesNotMatch(await sheet.innerText(), /OVR/);
      await sheet.getByRole("button", { name: "เปลี่ยนผู้เล่น" }).tap();
      await picker.getByRole("button", { name: "Cancel", exact: true }).tap();
      assert.equal(await page.locator(".lineup-marker-selected").count(), 1);
      await marker.tap();
      await sheet.getByRole("button", { name: "นำออกจากตำแหน่ง" }).tap();
    } else {
      await marker.hover();
      assert.equal(await page.locator("[data-lineup-rating-overlay]").count(), 0);
      await marker.click();
      await picker.getByRole("button", { name: "Clear Position", exact: true }).click();
    }
    await click(marker);
    await click(row("Alpha"));
    await click(page.getByRole("button", { name: "Select player for LB", exact: true }));
    const otherPicker = page.locator('[role="dialog"]').filter({ has: page.getByRole("heading", { name: "Select Player for LB", exact: true }) });
    assert.ok(await otherPicker.getByRole("button", { name: /^#1 Alpha/ }).isDisabled());
    await click(otherPicker.getByRole("button", { name: "Cancel", exact: true }));
    await click(page.locator("label").filter({ hasText: "Move Positions" }).getByRole("button"));
    const movable = page.getByRole("button", { name: "Move GK marker", exact: true });
    const before = await movable.locator("..").getAttribute("style");
    const bounds = await movable.boundingBox();
    await movable.dispatchEvent("pointerdown", { pointerType: touch ? "touch" : "mouse", clientX: bounds.x, clientY: bounds.y });
    await page.evaluate(({ x, y, touch }) => {
      document.dispatchEvent(new PointerEvent("pointermove", { pointerType: touch ? "touch" : "mouse", clientX: x + 30, clientY: y - 30, bubbles: true }));
      document.dispatchEvent(new PointerEvent("pointerup", { pointerType: touch ? "touch" : "mouse", bubbles: true }));
    }, { ...bounds, touch });
    assert.notEqual(await movable.locator("..").getAttribute("style"), before);
    assert.equal(await page.locator("[data-lineup-rating-overlay]").count(), 0);
    await page.getByRole("combobox", { name: /^Formation/ }).selectOption("4-4-2");
    assert.equal(await page.locator(".lineup-marker-selected").count(), 0);
    assert.equal(await page.locator(".lineup-marker").count(), 11);
    assert.ok(await page.evaluate(() => window.qa.unchanged()));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px ${touch ? "touch" : "mouse"}: selector/card/role-guide, pitch/change/clear/no-rating, duplicate prevention, drag/formation, hydration, no overflow`);
    await context.close();
  }

  // Touch-primary tablet with an attached fine pointer: actual input, not width,
  // chooses the interaction on the same hydrated component instance.
  const hybrid = await browser.newContext({ viewport: { width: 768, height: 950 }, hasTouch: true, reducedMotion: "reduce" });
  await hybrid.route("**/*", (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());
  const hybridPage = await hybrid.newPage();
  await hybridPage.addInitScript(() => {
    const native = window.matchMedia.bind(window);
    window.matchMedia = (query) => query === "(any-hover: hover) and (any-pointer: fine)" ? { ...native(query), matches: true } : native(query);
  });
  await hybridPage.goto(base);
  await hybridPage.waitForFunction(() => window.qa?.ready);
  const hybridMarker = hybridPage.getByRole("button", { name: "Select player for GK", exact: true });
  await hybridMarker.tap();
  const hybridRow = hybridPage.getByRole("button", { name: /^#1 Alpha/ });
  await hybridRow.hover();
  await hybridPage.locator('[data-lineup-rating-overlay="preview"]').waitFor({ state: "visible" });
  await hybridRow.tap();
  await hybridMarker.tap();
  const hybridSheet = hybridPage.locator('[data-lineup-rating-overlay="actions"]');
  await hybridSheet.waitFor({ state: "visible" });
  await hybridPage.keyboard.press("Tab");
  assert.ok(await hybridSheet.evaluate((element) => element.contains(document.activeElement)), "Modal retains keyboard focus");
  await hybridSheet.getByRole("button", { name: "ปิด", exact: true }).tap();
  await hybridMarker.hover();
  await hybridPage.locator('[data-lineup-rating-overlay="preview"]').waitFor({ state: "visible" });
  await hybridMarker.click();
  await hybridPage.getByRole("heading", { name: "Select Player for GK", exact: true }).waitFor();
  assert.equal(await hybridPage.locator('[data-lineup-rating-overlay="actions"]').count(), 0);
  await hybrid.close();
  console.log("PASS hybrid tablet: touch and attached mouse switch interaction without reload; modal focus retained");

  const failureContext = await browser.newContext({ viewport: { width: 375, height: 950 }, hasTouch: true });
  await failureContext.route("**/*", (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());
  const failurePage = await failureContext.newPage();
  await failurePage.goto(`${base}/?ratingError`);
  await failurePage.waitForFunction(() => window.qa?.ready);
  await failurePage.getByRole("button", { name: "Select player for GK", exact: true }).tap();
  assert.equal(await failurePage.getByRole("button", { name: /^ดู Football Rating/ }).count(), 0);
  await failurePage.getByRole("button", { name: /^#1 Alpha/ }).tap();
  assert.equal(await failurePage.locator(".lineup-marker-selected").count(), 1);
  assert.ok(await failurePage.evaluate(() => window.qa.unchanged()));
  await failureContext.close();
  console.log("PASS Rating query failure: real page still renders eligible players and supports selection");
  console.log(`Screenshots: ${temp}`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}

async function assertCard(panel, type) {
  await panel.waitFor({ state: "visible" });
  assert.ok(await panel.getByText(type, { exact: true }).isVisible());
  assert.ok(await panel.getByText("OVR", { exact: true }).isVisible());
  assert.equal(await panel.locator("dd").count(), 6);
  assert.ok(await panel.locator('[data-rating-radar="true"]').isVisible());
}
function overlaps(a, b) { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
async function assertFits(page, panel) {
  const rect = await panel.boundingBox();
  const { width, height } = page.viewportSize();
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= height);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
}

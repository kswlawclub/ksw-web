// Offline browser QA: real components + real CSS; all data/actions replaced BEFORE bundling.
// Run after npm run build. KSW_PLAYWRIGHT_MODULE may point at the bundled desktop Playwright.
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
const temp = mkdtempSync(join(tmpdir(), "ksw-rating-qa-"));
const generated = (name, source) => { const path = join(temp, name); writeFileSync(path, source); return path; };
const loader = generated("ts-loader.cjs", `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);

const fixture = generated("fixture.ts", `
import { parseMemberPayload } from "@/lib/club-members";
import { footballOverallPreview, parseFootballRatingInput, mapFootballRatings } from "@/lib/member-football-rating";
import { footballRatingFailure } from "@/lib/member-football-rating-diagnostics";
const id=(n)=>"e950da1b-7788-4e80-bcec-"+String(n).padStart(12,"0");
export const members=Array.from({length:9},(_,i)=>({ ...parseMemberPayload({nickname:i===0?"ทดสอบชื่อสมาชิกยาวเพื่อดูการตัดบรรทัด": "ตัวอย่าง "+i, membership_type:i>3?"extraordinary":"ordinary",club_role:i===7?"coach":"member",is_active:i!==8,lineup_enabled:false,photo_url:"/images/staff/staff-01.png"}).payload,id:id(i+1),created_at:"2026-09-06",updated_at:null }));
const row=(type,n)=>{const fields=type==="player"?["pace","shooting","passing","dribbling","defending","physical"]:["gk_diving","gk_handling","gk_kicking","gk_reflexes","gk_speed","gk_positioning"];const input={member_id:id(n),rating_type:type,...Object.fromEntries(fields.map((f,i)=>[f,60+i*5]))};const parsed=parseFootballRatingInput(input);return {...parsed.payload,overall:footballOverallPreview(type,parsed.payload)};};
export const ratings=new Map([row("player",1),row("goalkeeper",5),row("player",8),row("player",9)].map(r=>[r.member_id,r]));
const snapshot=JSON.stringify(members);
window.qa={writes:[],members,ratings,assertUnchanged:()=>JSON.stringify(members)===snapshot};
export const listMembers=async()=>({ok:true,members});
export const listMemberFootballRatings=async(ids)=>({ok:true,ratings:mapFootballRatings([...ratings.values()],ids)});
export async function saveMemberFootballRating(input){
  window.qa.writes.push(["save",input]);await new Promise(r=>setTimeout(r,180));
  if(window.qa.ratingFailure==="RATING_TRANSPORT")throw new Error("PRIVATE fixture action exception");
  if(window.qa.ratingFailure)return {...footballRatingFailure(window.qa.ratingFailure),error:"PRIVATE fixture DB error"};
  const parsed=parseFootballRatingInput(input);if(!parsed.ok)return footballRatingFailure("RATING_VALIDATION");
  const rating={...parsed.payload,overall:footballOverallPreview(parsed.payload.rating_type,parsed.payload)};ratings.set(rating.member_id,rating);return {ok:true,rating};
}
export async function clearMemberFootballRating(id){window.qa.writes.push(["clear",id]);await new Promise(r=>setTimeout(r,180));ratings.delete(id);return {ok:true,rating:null};}
const forbidden=()=>{throw Error("Member mutation forbidden in browser QA");};
export const createMember=forbidden,setMemberActive=forbidden,removeMemberPhoto=forbidden,updateMember=forbidden,uploadMemberPhoto=forbidden;
export function getSupabase(){return {from(table){if(table==="club_member_football_ratings")return {select(){return {in(_field,ids){return Promise.resolve({data:[...ratings.values()].filter(r=>ids.includes(r.member_id)),error:null});}};}};if(table!=="club_members")throw Error("Unexpected table");return {select(){return {eq(){return {order(){return Promise.resolve({data:members.filter(m=>m.is_active),error:null});}};}};}};}};}
`);
const link = generated("link.tsx", 'export default function Link({children,...props}){return <a {...props}>{children}</a>;}');
const entry = generated("entry.tsx", `
import React from "react";
import {createRoot,hydrateRoot} from "react-dom/client";
import {renderToString} from "react-dom/server.browser";
import ${JSON.stringify(fixture)};
import Admin from ${JSON.stringify(join(root, "src/app/admin/members/page.tsx"))};
import Team from ${JSON.stringify(join(root, "src/app/team/page.tsx"))};
async function main(){const root=document.getElementById("root");if(location.pathname==="/admin"){createRoot(root).render(<Admin/>);}else{const page=await Team();root.innerHTML=renderToString(page);hydrateRoot(root,page);}window.qa.ready=true;}
main();
`);

await new Promise((accept, reject) => webpack({
  mode: "development", devtool: false, context: root, entry,
  output: { path: temp, filename: "bundle.js" },
  resolve: { extensions: [".tsx", ".ts", ".js", ".mjs"], modules: [join(root, "node_modules")], alias: { "@": join(root, "src"), "next/link$": link } },
  module: { rules: [{ test: /\.tsx?$/, use: [loader] }] },
  plugins: [new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: "development" }) }), new webpack.NormalModuleReplacementPlugin(/rating-actions|\.\/actions|@\/lib\/supabase$/, (resource) => {
    if (resource.request.includes("rating-actions") || resource.request === "@/lib/supabase" || resource.context === join(root, "src/app/admin/members")) resource.request = fixture;
  })],
}, (error, stats) => {
  if (error || stats.hasErrors()) return reject(error ?? new Error(stats.toString({ all: false, errors: true })));
  const modules = stats.toJson({ all: false, modules: true }).modules.map((module) => module.name ?? "");
  assert.ok(!modules.some((name) => /supabase-admin|admin-server-auth|@supabase|sharp\//.test(name)), "Real DB/auth must not be bundled");
  accept();
}));

function cssFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? cssFiles(join(directory, entry.name)) : entry.name.endsWith(".css") ? [join(directory, entry.name)] : []);
}
const css = cssFiles(join(root, ".next/static")).map((path) => readFileSync(path, "utf8")).join("\n");
assert.ok(css.includes("popover"), "Run npm run build before browser QA");
const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/bundle.js") { response.setHeader("Content-Type", "application/javascript; charset=utf-8"); response.end(readFileSync(join(temp, "bundle.js"))); }
  else if (pathname === "/style.css") { response.setHeader("Content-Type", "text/css"); response.end(css); }
  else if (pathname === "/images/staff/staff-01.png") { response.setHeader("Content-Type", "image/png"); response.end(readFileSync(join(root, "public/images/staff/staff-01.png"))); }
  else { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end('<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); }
});
await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.KSW_BROWSER_CHANNEL || "chrome" });
  for (const width of [375, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 375, reducedMotion: "reduce" });
    await context.route("**/*", (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => { errors.push(error.message); console.error(error.message); });
    page.on("console", (message) => { if (message.type() === "error") { errors.push(message.text()); console.error(message.text()); } });
    await page.goto(`${base}/team`);
    await page.waitForFunction(() => window.qa?.ready);
    const trigger = page.getByRole("button", { name: /ดู Football Rating/ }).first();
    await trigger.scrollIntoViewIfNeeded();
    await assertRestingMemberGrid(page);
    await page.screenshot({ path: join(temp, `public-resting-${width}.png`) });
    if (width === 375) await trigger.tap(); else await trigger.hover();
    const popover = page.locator('[popover]:popover-open');
    await popover.waitFor({ state: "visible" });
    assert.equal(await popover.locator("dd").count(), 6);
    assert.ok(await popover.getByText("OVR", { exact: true }).isVisible());
    assert.ok(await popover.locator('[data-rating-radar="true"]').isVisible());
    await assertFits(page, popover);
    await page.screenshot({ path: join(temp, `public-${width}.png`) });
    await popover.getByRole("button", { name: "ปิด Football Rating" }).click();
    assert.equal(await page.locator(":popover-open").count(), 0);
    await page.locator("h1").click();
    await trigger.focus();
    await popover.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(":popover-open").count(), 0);
    await trigger.click();
    await popover.waitFor({ state: "visible" });
    await page.mouse.click(width - 3, 3);
    assert.equal(await page.locator(":popover-open").count(), 0);
    await assertRestingMemberGrid(page);
    assert.ok(await page.evaluate(() => window.qa.assertUnchanged()));
    assert.deepEqual(errors, [], "Public hydration/runtime errors");

    await page.goto(`${base}/admin`);
    const adminTrigger = page.getByRole("button", { name: /^Football Rating/ }).first();
    await adminTrigger.click();
    const modal = page.getByRole("dialog", { name: "KSW Football Rating" });
    await modal.waitFor({ state: "visible" });
    assert.equal(await modal.getByRole("spinbutton").count(), 6);
    assert.equal(await modal.getByRole("spinbutton").first().inputValue(), "60");
    await assertFits(page, modal);
    await page.screenshot({ path: join(temp, `admin-${width}.png`) });
    await modal.getByRole("radio", { name: "Goalkeeper" }).check();
    assert.deepEqual(await modal.getByRole("spinbutton").evaluateAll((inputs) => inputs.map((input) => input.value)), ["", "", "", "", "", ""]);
    assert.ok(await modal.getByRole("button", { name: "Save Rating" }).isDisabled());
    for (const input of await modal.getByRole("spinbutton").all()) await input.fill("81");
    assert.equal(await modal.getByLabel("Overall preview").textContent(), "81");
    await modal.getByRole("button", { name: "Save Rating" }).click();
    assert.ok(await modal.getByRole("button", { name: "กำลังบันทึก..." }).isDisabled());
    await modal.getByRole("status").filter({ hasText: "OVR 81" }).waitFor();
    assert.equal(await page.evaluate(() => window.qa.writes.length), 1);
    await modal.getByRole("button", { name: "Clear Rating", exact: true }).click();
    assert.equal(await page.evaluate(() => window.qa.writes.length), 1);
    await modal.getByRole("button", { name: "ยืนยันล้าง Rating" }).click();
    await modal.getByRole("status").filter({ hasText: "ล้าง Rating แล้ว" }).waitFor();
    assert.equal(await modal.getByRole("button", { name: "Clear Rating", exact: true }).count(), 0);
    assert.ok(await page.evaluate(() => window.qa.assertUnchanged()));
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.ok(await adminTrigger.evaluate((element) => element === document.activeElement));
    await page.getByRole("tab", { name: /รายชื่อที่ไม่ใช้งาน/ }).click();
    await page.getByRole("button", { name: /^Football Rating/ }).click();
    await modal.waitFor({ state: "visible" });
    assert.equal(await modal.getByRole("spinbutton").first().inputValue(), "60");
    await page.keyboard.press("Tab");
    assert.ok(await modal.evaluate((element) => element.contains(document.activeElement)), "Modal keeps keyboard focus");
    await page.mouse.click(2, 2);
    assert.equal(await page.locator("dialog[open]").count(), 0);
    await page.getByRole("tab", { name: /สมาชิกปัจจุบัน/ }).click();
    await adminTrigger.click();
    await modal.waitFor({ state: "visible" });
    assert.ok(await modal.getByText("ยังไม่ได้ตั้งค่าความสามารถ", { exact: true }).isVisible());
    assert.ok(await modal.getByRole("radio", { name: "Player", exact: true }).isChecked());
    assert.deepEqual(await modal.getByRole("spinbutton").evaluateAll((inputs) => inputs.map((input) => input.value)), ["", "", "", "", "", ""]);
    for (const input of await modal.getByRole("spinbutton").all()) await input.fill("80");
    for (const code of ["RATING_VALIDATION", "RATING_AUTH", "RATING_CLIENT_INIT", "RATING_DB_WRITE", "RATING_READBACK", "RATING_REVALIDATE", "RATING_SERVER", "RATING_TRANSPORT"]) {
      await page.evaluate((value) => { window.qa.ratingFailure = value; }, code);
      await modal.getByRole("button", { name: "Save Rating" }).click();
      const alert = modal.getByRole("alert");
      await alert.filter({ hasText: `[รหัส: ${code}]` }).waitFor();
      assert.match(await alert.textContent(), new RegExp(`^บันทึกไม่สำเร็จ \\[รหัส: ${code}\\]`));
      assert.doesNotMatch(await alert.textContent(), /PRIVATE/);
      assert.equal(await modal.locator('[role="status"]').count(), 0);
      await alert.scrollIntoViewIfNeeded();
      await assertFits(page, modal);
    }
    await page.screenshot({ path: join(temp, `admin-diagnostic-${width}.png`) });
    assert.ok(await page.evaluate(() => window.qa.assertUnchanged()));
    await page.keyboard.press("Escape");
    assert.deepEqual(errors, [], "Admin runtime errors");
    console.log(`PASS ${width}px: badge-free identical portrait geometry, hover/focus/tap, dismiss, hydration, modal/type/save/clear, inactive, focus, safe diagnostic codes, no overflow`);
    await context.close();
  }
  console.log(`Screenshots: ${temp}`);
} finally {
  await browser?.close();
  await new Promise((accept) => server.close(accept));
}

async function assertRestingMemberGrid(page) {
  assert.equal(await page.locator(":popover-open").count(), 0);
  const cards = await page.locator("main article").evaluateAll((articles) => articles.map((article) => {
    const trigger = article.querySelector('button[aria-haspopup="dialog"]');
    const portrait = trigger ? trigger.firstElementChild : article.firstElementChild;
    const name = article.querySelector(":scope > h3");
    const rect = portrait.getBoundingClientRect();
    const style = getComputedStyle(portrait);
    const resting = article.cloneNode(true);
    resting.querySelectorAll("[popover]").forEach((panel) => panel.remove());
    return {
      rated: Boolean(trigger),
      text: resting.textContent,
      triggerChildren: trigger?.children.length,
      triggerSize: trigger ? [trigger.offsetWidth, trigger.offsetHeight] : null,
      geometry: {
        width: rect.width, height: rect.height,
        border: style.border, radius: style.borderRadius, shadow: style.boxShadow,
        nameGap: Math.round(name.getBoundingClientRect().top - rect.bottom),
        nameClass: name.className, cardClass: article.className,
      },
    };
  }));
  const normal = cards.find((card) => !card.rated);
  assert.ok(normal, "Fixture includes a member without Rating");
  assert.ok(cards.some((card) => card.rated), "Fixture includes rated members");
  for (const card of cards) {
    assert.doesNotMatch(card.text, /OVR/);
    assert.deepEqual(card.geometry, normal.geometry);
    if (card.rated) {
      assert.equal(card.triggerChildren, 1, "No extra badge/icon/indicator beside the portrait");
      assert.deepEqual(card.triggerSize, [normal.geometry.width, normal.geometry.height]);
    }
  }
}

async function assertFits(page, element) {
  const size = await element.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, contentWidth: node.scrollWidth, width: node.clientWidth, viewport: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth };
  });
  assert.ok(size.left >= 0 && size.right <= size.viewport && size.top >= 0 && size.bottom <= size.height, JSON.stringify(size));
  assert.ok(size.contentWidth <= size.width + 1 && size.pageWidth <= size.viewport, JSON.stringify(size));
  const brokenImages = await page.locator("img").evaluateAll((images) => images.filter((image) => image.complete && image.naturalWidth === 0).length);
  assert.equal(brokenImages, 0);
}

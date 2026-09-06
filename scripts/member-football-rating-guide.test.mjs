import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as icons from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadRatingModule, ratingContract } from "./lib/football-rating-test-support.mjs";

function harness() {
  let expanded = false;
  const guide = loadRatingModule("src/components/admin-football-rating-guide.tsx", {
    react: { ...React, useId: () => "guide-fixture", useState: () => [expanded, (next) => { expanded = next(expanded); }] },
    "react/jsx-runtime": jsx, "lucide-react": icons,
    "@/lib/member-football-rating": ratingContract,
  });
  function render(type = "player") { return guide.AdminFootballRatingGuide({ type }); }
  function elements(type, predicate) {
    function visit(node) {
      if (Array.isArray(node)) return node.flatMap(visit);
      if (!React.isValidElement(node)) return [];
      return [...(predicate(node) ? [node] : []), ...visit(node.props.children)];
    }
    return visit(render(type));
  }
  const button = () => elements("player", (node) => node.type === "button")[0];
  return { render, elements, button, toggle: () => button().props.onClick() };
}

function text(node) {
  if (Array.isArray(node)) return node.map(text).join("");
  if (React.isValidElement(node)) return text(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}

test("Guide defaults closed; its non-submit control toggles only local disclosure state with linked ARIA semantics", () => {
  const h = harness();
  const section = () => h.elements("player", (node) => node.type === "section")[0];
  assert.equal(h.button().props.type, "button");
  assert.equal(h.button().props["aria-expanded"], false);
  assert.equal(h.button().props["aria-controls"], section().props.id);
  assert.equal(section().props.hidden, true);
  h.toggle();
  assert.equal(h.button().props["aria-expanded"], true);
  assert.equal(section().props.hidden, false);
  h.toggle();
  assert.equal(section().props.hidden, true);
  assert.match(h.button().props.className, /min-h-11.*focus-visible/);
  assert.equal(h.elements("player", (node) => node.type === "input" || node.type === "dialog" || node.type === "form").length, 0);
});

test("Player/GK guide follows the existing stat contract and updates all six rows while staying open", () => {
  const h = harness();
  h.toggle();
  for (const type of ["player", "goalkeeper", "player"]) {
    const terms = h.elements(type, (node) => node.type === "dt" && Array.isArray(node.props.children));
    assert.equal(terms.length, 6);
    assert.deepEqual(terms.map((node) => text(node.props.children[0])), ratingContract.footballStats[type].map((stat) => stat.label));
    for (const { name } of ratingContract.footballStats[type]) assert.ok(text(h.render(type)).includes(name));
    assert.equal(h.elements(type, (node) => node.type === "section")[0].props.hidden, false);
    assert.match(text(h.render(type)), new RegExp(`เกณฑ์รายด้าน: ${type === "player" ? "Player" : "Goalkeeper"}`));
  }
  const player = text(h.render("player"));
  for (const criterion of ["การเร่งตัวช่วงแรก", "ความเร็วสูงสุด", "การเลือกมุม", "ให้เพื่อนเล่นต่อได้ง่าย", "First touch", "พื้นที่แคบ", "การหนีแรงกดดัน", "การรักษาบอล", "จังหวะเข้าสกัด", "การตัดสินใจเข้า/ถอย", "Balance", "ความอึด", "รูปร่างใหญ่ไม่เท่ากับ PHY", "อย่าดูเฉพาะวิ่งทางตรง", "ไม่ควรได้สูงเพราะแรงอย่างเดียว", "ไม่จำเป็นต้องมีท่าเลี้ยงสวย", "อย่าให้คะแนนจากการสไลด์"]) assert.ok(player.includes(criterion), criterion);
  const gk = text(h.render("goalkeeper"));
  for (const criterion of ["ระยะเอื้อม", "เทคนิคการพุ่ง", "ออกห่างตัว", "รับบอลอยู่มือ", "ลดการกระฉอก", "ลูกกลางอากาศ", "การเปิดเกมจากประตู", "น้ำหนักบอล", "เซฟระยะใกล้", "ลูกเปลี่ยนทาง", "Reaction speed", "ออกมาปิดมุม", "วิ่งตัดบอล", "ออกจากเส้น", "ไม่ใช่ Pace แบบผู้เล่นสนาม", "การตัดสินใจออก/อยู่", "ความสม่ำเสมอในการอยู่ถูกที่"]) assert.ok(gk.includes(criterion), criterion);
  assert.ok(!gk.includes("เกณฑ์รายด้าน: Player"));
  assert.ok(!player.includes("เกณฑ์รายด้าน: Goalkeeper"));
});

test("KSW standards, exact bands, calibration and equal-weight note remain presentation content only", () => {
  const h = harness();
  const descriptions = h.elements("player", (node) => node.type === "dl")[0];
  assert.deepEqual(descriptions.props.children.map((node) => node.props.children.map(text)), [
    ["90–99", "เด่นมากระดับหัวแถว"], ["80–89", "ดีมาก / เป็นจุดแข็งชัดเจน"],
    ["70–79", "ดี / เหนือค่าเฉลี่ย"], ["60–69", "ปานกลาง / ใช้งานได้"],
    ["50–59", "ต่ำกว่าค่าเฉลี่ย"], ["1–49", "เป็นจุดอ่อนชัดเจน"],
  ]);
  const content = text(h.render());
  for (const required of ["มาตรฐาน KSW Football Rating", "เทียบกับสมาชิก KSW ด้วยกัน", "3–5 นัดหรือการซ้อม", "ไม่ตัดสินจากเกมเดียว", "คะแนน 80+", "คะแนน 90+", "ความสนิท ชื่อเสียง หรือตำแหน่ง", "คิดก่อนให้คะแนน", "60 = ทำได้ตามระดับทั่วไปของ KSW", "70 = เห็นว่าดีกว่าค่าเฉลี่ย", "80 = เป็นจุดแข็งจริงของคนนี้", "90 = อยู่ระดับหัวแถวของ KSW", "1–3 คะแนน", "10–15 คะแนน", "OVR ปัจจุบันคำนวณจากค่าเฉลี่ย 6 ด้านโดยให้น้ำหนักเท่ากัน"]) assert.ok(content.includes(required), required);
  const source = readFileSync(new URL("../src/components/admin-football-rating-guide.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /rating-actions|saveMember|setForm|onSaved|footballOverallPreview|fetch\(|supabase|useEffect/);
  const modal = readFileSync(new URL("../src/components/admin-member-rating-modal.tsx", import.meta.url), "utf8");
  assert.match(modal, /<AdminFootballRatingGuide type=\{form\.rating_type\} \/>/);
  const html = renderToStaticMarkup(h.render());
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /hidden=""/);
  assert.match(html, /aria-hidden="true"/);
});

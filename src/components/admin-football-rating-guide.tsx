"use client";

import { useId, useState } from "react";
import { ChevronDown, CircleHelp } from "lucide-react";
import { footballStats, type FootballRatingType, type FootballStatField } from "@/lib/member-football-rating";

const statGuidance: Record<FootballStatField, { title: string; criteria: string; caution?: string }> = {
  pace: {
    title: "ความเร็ว",
    criteria: "การเร่งตัวช่วงแรก · ความเร็วสูงสุด · ความเร็วขณะเล่นจริง พาบอล หรือไล่คู่แข่ง",
    caution: "อย่าดูเฉพาะวิ่งทางตรง",
  },
  shooting: {
    title: "การยิง",
    criteria: "ความแม่น · คุณภาพการจบสกอร์ · การเลือกมุม · น้ำหนักและความแรงที่ใช้งานจริง",
    caution: "ยิงแรงแต่ไม่ตรงกรอบ ไม่ควรได้สูงเพราะแรงอย่างเดียว",
  },
  passing: {
    title: "การจ่ายบอล",
    criteria: "ความแม่น · น้ำหนักบอล · การมองเห็นช่องและเพื่อน · การตัดสินใจให้เพื่อนเล่นต่อได้ง่าย",
  },
  dribbling: {
    title: "การควบคุมและพาบอล",
    criteria: "First touch · การคุมบอลในพื้นที่แคบ · การพาบอล · การหนีแรงกดดัน · การรักษาบอล",
    caution: "ไม่จำเป็นต้องมีท่าเลี้ยงสวยจึงจะได้คะแนนสูง",
  },
  defending: {
    title: "เกมรับ",
    criteria: "การยืนตำแหน่ง · อ่านทางบอล · ประกบ · ตัดบอล · จังหวะเข้าสกัด · การตัดสินใจเข้า/ถอย",
    caution: "อย่าให้คะแนนจากการสไลด์หรือปะทะอย่างเดียว",
  },
  physical: {
    title: "สภาพร่างกาย",
    criteria: "ความแข็งแรง · Balance · ความอึด · การปะทะ · การรักษาประสิทธิภาพเมื่อเกมผ่านไปนาน",
    caution: "รูปร่างใหญ่ไม่เท่ากับ PHY สูงโดยอัตโนมัติ",
  },
  gk_diving: { title: "การพุ่งเซฟ", criteria: "ระยะเอื้อม · เทคนิคการพุ่ง · เซฟลูกที่ออกห่างตัว" },
  gk_handling: { title: "การรับบอล", criteria: "รับบอลอยู่มือ · ลดการกระฉอก · ควบคุมบอลจากลูกยิงและลูกกลางอากาศ" },
  gk_kicking: { title: "การออกบอลด้วยเท้า", criteria: "ความแม่น · ระยะ · การเปิดเกมจากประตู · น้ำหนักบอล" },
  gk_reflexes: { title: "ปฏิกิริยาตอบสนอง", criteria: "เซฟระยะใกล้ · ตอบสนองต่อลูกเปลี่ยนทาง · Reaction speed" },
  gk_speed: {
    title: "ความเร็วผู้รักษาประตู",
    criteria: "ออกมาปิดมุม · วิ่งตัดบอล · เคลื่อนที่ออกจากเส้น",
    caution: "ไม่ใช่ Pace แบบผู้เล่นสนามโดยตรง",
  },
  gk_positioning: { title: "การยืนตำแหน่ง", criteria: "การเลือกตำแหน่ง · ปิดมุม · อ่านเกม · การตัดสินใจออก/อยู่ · ความสม่ำเสมอในการอยู่ถูกที่" },
};

const ratingBands = [
  ["90–99", "เด่นมากระดับหัวแถว"],
  ["80–89", "ดีมาก / เป็นจุดแข็งชัดเจน"],
  ["70–79", "ดี / เหนือค่าเฉลี่ย"],
  ["60–69", "ปานกลาง / ใช้งานได้"],
  ["50–59", "ต่ำกว่าค่าเฉลี่ย"],
  ["1–49", "เป็นจุดอ่อนชัดเจน"],
];

export function AdminFootballRatingGuide({ type }: { type: FootballRatingType }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-3 min-w-0">
      <button type="button" aria-expanded={expanded} aria-controls={id}
        onClick={() => setExpanded((current) => !current)}
        className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-bold text-[#061426] hover:bg-amber-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9b1c1f]">
        <CircleHelp aria-hidden="true" className="size-4 shrink-0" />
        วิธีให้คะแนน
        <ChevronDown aria-hidden="true" className={`size-4 shrink-0 ${expanded ? "rotate-180" : ""}`} />
      </button>
      <section id={id} hidden={!expanded} aria-labelledby={`${id}-title`} className="mt-2 border-y border-[#d8ad45]/50 py-4 text-sm leading-relaxed">
        <h3 id={`${id}-title`} className="font-black text-[#061426]">มาตรฐาน KSW Football Rating</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
          <li>ประเมินเมื่อเทียบกับสมาชิก KSW ด้วยกัน</li>
          <li>ควรดูผลงานประมาณ 3–5 นัดหรือการซ้อม ไม่ตัดสินจากเกมเดียว</li>
          <li>คะแนน <strong>80+</strong> หมายถึงด้านนั้นเป็นจุดเด่นที่สังเกตได้จริง</li>
          <li>คะแนน <strong>90+</strong> ควรสงวนไว้สำหรับผู้ที่โดดเด่นระดับหัวแถวของชมรม</li>
          <li>อย่าให้คะแนนจากความสนิท ชื่อเสียง หรือตำแหน่งเพียงอย่างเดียว</li>
        </ul>

        <h4 className="mt-4 font-bold">ช่วงคะแนน</h4>
        <dl className="mt-2 grid gap-x-5 sm:grid-cols-2">
          {ratingBands.map(([range, description]) => (
            <div key={range} className="grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)] gap-2 border-t border-slate-200 py-2">
              <dt className="font-black tabular-nums">{range}</dt>
              <dd className="break-words text-slate-600">{description}</dd>
            </div>
          ))}
        </dl>

        <h4 className="mt-4 font-bold">เกณฑ์รายด้าน: {type === "player" ? "Player" : "Goalkeeper"}</h4>
        <dl className="mt-2 grid gap-x-5 sm:grid-cols-2">
          {footballStats[type].map(({ field, label, name }) => {
            const guide = statGuidance[field];
            return (
              <div key={field} className="min-w-0 border-t border-slate-200 py-3">
                <dt className="break-words"><span className="mr-2 font-black text-[#8b6414]">{label}</span><span className="font-bold">{name} / {guide.title}</span></dt>
                <dd className="mt-1 break-words text-slate-700">
                  <p>{guide.criteria}</p>
                  {guide.caution ? <p className="mt-1 text-xs text-slate-600">{guide.caution}</p> : null}
                </dd>
              </div>
            );
          })}
        </dl>

        <aside aria-labelledby={`${id}-calibration`} className="mt-3 rounded-md bg-slate-50 p-3">
          <h4 id={`${id}-calibration`} className="font-bold">คิดก่อนให้คะแนน</h4>
          <ul className="mt-2 grid gap-x-4 gap-y-1 text-slate-700 sm:grid-cols-2">
            <li><strong>60</strong> = ทำได้ตามระดับทั่วไปของ KSW</li>
            <li><strong>70</strong> = เห็นว่าดีกว่าค่าเฉลี่ย</li>
            <li><strong>80</strong> = เป็นจุดแข็งจริงของคนนี้</li>
            <li><strong>90</strong> = อยู่ระดับหัวแถวของ KSW ในด้านนี้</li>
          </ul>
          <p className="mt-2 text-slate-700">ถ้าผู้เล่น A และ B อยู่ระดับใกล้กัน ให้ต่างกันประมาณ 1–3 คะแนน อย่าให้ต่าง 10–15 คะแนนถ้าความสามารถจริงใกล้เคียงกัน</p>
        </aside>
        <p className="mt-3 text-xs text-slate-600">OVR ปัจจุบันคำนวณจากค่าเฉลี่ย 6 ด้านโดยให้น้ำหนักเท่ากัน</p>
      </section>
    </div>
  );
}

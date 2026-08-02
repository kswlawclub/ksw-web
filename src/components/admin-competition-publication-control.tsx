"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setCompetitionPublication } from "@/app/admin/competitions/actions";
import { ActionButton, useActionFeedback } from "@/components/admin-action-feedback";

export function AdminCompetitionPublicationControl({ competitionId, initiallyPublished, seasonStatus }: { competitionId: string; initiallyPublished: boolean; seasonStatus: string }) {
  const router = useRouter();
  const { runAction } = useActionFeedback();
  const [published, setPublished] = useState(initiallyPublished);
  const toggle = async () => {
    if (published && !window.confirm("ต้องการซ่อนรายการนี้จากเว็บไซต์ใช่หรือไม่")) return;
    const result = await runAction({ errorMessage: (value) => !value.ok ? value.error ?? "ไม่สามารถอัปเดตสถานะการเผยแพร่ได้" : null, id: `competition-publication:${competitionId}`, loadingMessage: published ? "กำลังซ่อน…" : "กำลังเผยแพร่…", successMessage: published ? "ซ่อนแล้ว" : "เผยแพร่แล้ว" }, () => setCompetitionPublication(competitionId, !published));
    if (!result?.ok) return;
    setPublished(!published);
    router.refresh();
  };
  const label = published ? "เผยแพร่แล้ว" : seasonStatus === "completed" ? "การแข่งขันเสร็จสิ้นแต่ซ่อนอยู่" : "ยังไม่เผยแพร่";
  return <section className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 lg:px-10"><div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-3"><div><p className="text-sm font-black">การเผยแพร่สู่เว็บไซต์</p><p className={`mt-1 text-xs font-bold ${published ? "text-emerald-800" : "text-slate-600"}`}>{label}</p></div><ActionButton actionId={`competition-publication:${competitionId}`} className={`rounded px-3 py-2 text-sm font-black ${published ? "border border-amber-300 text-amber-950" : "bg-[#061426] text-[#f4d58a]"}`} loadingLabel={published ? "กำลังซ่อน…" : "กำลังเผยแพร่…"} onClick={toggle} successLabel={published ? "ซ่อนแล้ว" : "เผยแพร่แล้ว"} type="button">{published ? "ซ่อนจากเว็บไซต์" : "เผยแพร่สู่เว็บไซต์"}</ActionButton></div></section>;
}

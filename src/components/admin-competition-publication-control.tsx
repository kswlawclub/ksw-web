"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Globe2 } from "lucide-react";
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
  return <section className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 lg:px-10"><div className="grid min-w-0 gap-3 rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm shadow-slate-900/5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:p-4 lg:grid-cols-[auto_minmax(0,1fr)_auto]"><div className="flex size-12 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-[#061426] sm:size-14"><Globe2 aria-hidden="true" className="size-6 shrink-0" /></div><div className="min-w-0"><p className="text-base font-black text-[#061426]">การเผยแพร่สู่เว็บไซต์</p><p className={`mt-1 text-sm font-semibold ${published ? "text-emerald-800" : "text-slate-600"}`}>{label}</p></div><div className="border-t border-slate-200 pt-3 sm:col-span-2 lg:col-span-1 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0"><ActionButton actionId={`competition-publication:${competitionId}`} className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-black lg:w-auto ${published ? "border border-amber-300 text-amber-950" : "bg-[#061426] text-[#f4d58a]"}`} loadingLabel={published ? "กำลังซ่อน…" : "กำลังเผยแพร่…"} onClick={toggle} successLabel={published ? "ซ่อนแล้ว" : "เผยแพร่แล้ว"} type="button"><ExternalLink aria-hidden="true" className="size-4 shrink-0" />{published ? "ซ่อนจากเว็บไซต์" : "เผยแพร่สู่เว็บไซต์"}</ActionButton></div></div></section>;
}

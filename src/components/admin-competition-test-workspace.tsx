"use client";

import { useState } from "react";
import {
  runCompetitionAcceptanceCheck,
  type CompetitionAcceptanceCheckId,
  type CompetitionAcceptanceResult,
} from "@/app/admin/system/competition-test/actions";

type Check = { id: CompetitionAcceptanceCheckId; label: string };
type Group = { checks: Check[]; title: string };

const groups: Group[] = [
  { title: "League", checks: [
    { id: "league-create", label: "Create" }, { id: "league-publish", label: "Publish" }, { id: "league-fixture", label: "Fixture" }, { id: "league-matchweek", label: "Matchweek" }, { id: "league-reschedule", label: "Reschedule" }, { id: "league-champion", label: "Champion" }, { id: "league-complete", label: "Complete" }, { id: "league-archive", label: "Archive" },
  ] },
  { title: "KSW Cup", checks: [
    { id: "ksw-qualification", label: "Qualification" }, { id: "ksw-group", label: "Group" }, { id: "ksw-knockout", label: "Knockout" }, { id: "ksw-champion", label: "Champion" }, { id: "ksw-complete", label: "Complete" },
  ] },
  { title: "Council Cup", checks: [
    { id: "council-division", label: "Division" }, { id: "council-champion-d1", label: "Champion D1" }, { id: "council-champion-d2", label: "Champion D2" }, { id: "council-complete", label: "Complete" },
  ] },
  { title: "Public", checks: [
    { id: "public-home", label: "Home" }, { id: "public-detail", label: "Competition Detail" }, { id: "public-archive", label: "Archive" }, { id: "public-hidden", label: "Hidden Competition" },
  ] },
  { title: "Analytics", checks: [
    { id: "analytics-page-view", label: "Page View" }, { id: "analytics-competition-view", label: "Competition View" }, { id: "analytics-sponsor-click", label: "Sponsor Click" },
  ] },
];

const statusClass = { FAIL: "border-red-200 bg-red-50 text-red-900", PASS: "border-emerald-200 bg-emerald-50 text-emerald-900", WARNING: "border-amber-200 bg-amber-50 text-amber-900" };

export function AdminCompetitionTestWorkspace() {
  const [results, setResults] = useState<Record<string, CompetitionAcceptanceResult>>({});
  const [pending, setPending] = useState<string | null>(null);
  const run = async (check: Check) => {
    if (pending) return;
    setPending(check.id);
    try {
      const value = await runCompetitionAcceptanceCheck(check.id);
      setResults((current) => ({ ...current, [check.id]: value }));
    } catch (error) {
      setResults((current) => ({ ...current, [check.id]: { detail: error instanceof Error ? error.message : "ไม่สามารถตรวจสอบได้", status: "FAIL", testedAt: new Date().toISOString() } }));
    } finally {
      setPending(null);
    }
  };
  const runAll = async () => {
    for (const group of groups) for (const check of group.checks) await run(check);
  };
  return (
    <main className="min-h-screen bg-[#f6f2ea] text-[#061426]">
      <section className="border-b border-[#d8ad45]/30 bg-[linear-gradient(135deg,#061426,#0b2745)] px-4 py-10 text-white sm:px-6 lg:px-10">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-end justify-between gap-5">
          <div><p className="text-xs font-black uppercase tracking-[0.2em] text-[#d8ad45]">Admin System</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">Competition Test</h1><p className="mt-3 max-w-2xl text-sm font-semibold text-slate-300">ตรวจหลักฐานจริงจากฐานข้อมูลแบบ read-only โดยไม่สร้างหรือแก้ไขข้อมูลการแข่งขัน</p></div>
          <button className="min-h-11 rounded-md bg-[#d8ad45] px-5 py-3 text-sm font-black text-[#061426] disabled:cursor-not-allowed disabled:opacity-60" disabled={Boolean(pending)} onClick={() => void runAll()} type="button">{pending ? "กำลังตรวจสอบ..." : "Run All Tests"}</button>
        </div>
      </section>
      <section className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-8 sm:px-6 lg:px-10">
        {groups.map((group) => <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg shadow-slate-900/5" key={group.title}>
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-4"><h2 className="text-xl font-black">{group.title}</h2></div>
          <div className="divide-y divide-slate-100">{group.checks.map((check) => {
            const checkResult = results[check.id];
            const loading = pending === check.id;
            return <div className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={check.id}>
              <div className="min-w-0"><p className="font-black">{check.label}</p>{checkResult ? <p className={`mt-1 rounded-md border px-3 py-2 text-sm font-semibold ${statusClass[checkResult.status]}`}><strong>{checkResult.status}</strong> · {checkResult.detail}</p> : <p className="mt-1 text-sm font-semibold text-slate-500">ยังไม่ได้ตรวจสอบ</p>}</div>
              <button aria-busy={loading || undefined} className="min-h-10 rounded-md border border-[#061426] px-4 py-2 text-sm font-black text-[#061426] disabled:cursor-not-allowed disabled:opacity-50" disabled={Boolean(pending)} onClick={() => void run(check)} type="button">{loading ? "กำลังตรวจ..." : "Run Test"}</button>
            </div>;
          })}</div>
        </section>)}
      </section>
    </main>
  );
}

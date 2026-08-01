"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  generateCompetitionTreeV2,
  createCompetitionFixturesV2,
  previewCompetitionFixturesV2,
  reopenCompetitionTreeV2,
  reviewCompetitionTreeV2,
} from "@/app/admin/competitions/[id]/competition-engine-v2-actions";
import type { CompetitionFixturesV2Result } from "@/app/admin/competitions/[id]/competition-engine-v2-actions";
import {
  canCreateFixtures,
  canGenerateTree,
  canReviewTree,
  competitionEngineV2StatusLabel,
  type CompetitionEngineV2Integrity,
} from "@/lib/competition-engine-v2-state";
import type { CompetitionTreeSummary } from "@/lib/competition-tree";

type AdminCompetitionTreeEngineV2Props = {
  bracketCapacity: number | null;
  competitionId: string;
  configReady: boolean;
  initialSummary: CompetitionTreeSummary | null;
  workflow: CompetitionEngineV2Integrity | null;
};

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 break-words text-xl font-black text-[#061426]">{value}</p>
    </div>
  );
}

export function AdminCompetitionTreeEngineV2({
  bracketCapacity,
  competitionId,
  configReady,
  initialSummary,
  workflow,
}: AdminCompetitionTreeEngineV2Props) {
  const router = useRouter();
  const [generatedSummary, setGeneratedSummary] = useState<CompetitionTreeSummary | null>(null);
  const [currentWorkflow, setCurrentWorkflow] = useState(workflow);
  const [fixtureResult, setFixtureResult] = useState<CompetitionFixturesV2Result | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const summary = generatedSummary ?? initialSummary;
  const status = currentWorkflow?.status ?? "draft";
  const statusLabel = competitionEngineV2StatusLabel(status);

  useEffect(() => {
    if (!configReady || (status !== "reviewed" && status !== "fixtures_created")) return;
    let active = true;
    void previewCompetitionFixturesV2(competitionId).then((result) => {
      if (active) setFixtureResult(result);
    });
    return () => {
      active = false;
    };
  }, [competitionId, configReady, status]);

  function generateTree() {
    setError("");
    setMessage("");
    startTransition(async () => {
      const result = await generateCompetitionTreeV2(competitionId);
      if (!result.ok) {
        setError(result.error ?? "ไม่สามารถสร้างโครงสร้างการแข่งขันได้");
        return;
      }
      setGeneratedSummary(result.summary ?? null);
      setCurrentWorkflow((current) => current ? { ...current, hasValidTree: true, warning: null } : current);
      setMessage(initialSummary ? "โครงสร้างการแข่งขันถูกต้องและไม่มีการเปลี่ยนแปลง" : "บันทึกโครงสร้างการแข่งขันแล้ว ยังไม่ได้สร้างโปรแกรมแข่งขัน");
      router.refresh();
    });
  }

  function reviewTree() {
    setError("");
    setMessage("");
    startTransition(async () => {
      const result = await reviewCompetitionTreeV2(competitionId);
      if (!result.ok) {
        setError(result.error ?? "ไม่สามารถตรวจสอบโครงสร้างการแข่งขันได้");
        return;
      }
      setCurrentWorkflow(result.workflow ?? currentWorkflow);
      setMessage("ยืนยันโครงสร้างการแข่งขันแล้ว พร้อมสำหรับการสร้างโปรแกรมในขั้นถัดไป");
      router.refresh();
    });
  }

  function reopenTree() {
    if (!window.confirm("กลับไปแก้ไขโครงสร้างการแข่งขัน? การดำเนินการนี้จะไม่ลบ configuration หรือ tree ที่บันทึกไว้")) return;
    setError("");
    setMessage("");
    startTransition(async () => {
      const result = await reopenCompetitionTreeV2(competitionId, "REOPEN");
      if (!result.ok) {
        setError(result.error ?? "ไม่สามารถกลับไปแก้ไขโครงสร้างการแข่งขันได้");
        return;
      }
      setCurrentWorkflow(result.workflow ?? currentWorkflow);
      setMessage("กลับสู่สถานะกำลังตั้งค่าแล้ว โครงสร้างเดิมยังคงอยู่");
      router.refresh();
    });
  }

  function createFixtures() {
    setError("");
    setMessage("");
    startTransition(async () => {
      const result = await createCompetitionFixturesV2(competitionId);
      setFixtureResult(result);
      if (!result.ok) {
        setError(result.error ?? result.errors[0] ?? "Could not create knockout fixtures.");
        return;
      }
      setCurrentWorkflow((current) => current ? { ...current, hasLinkedMatches: result.linkedCount > 0, status: result.status ?? current.status } : current);
      setMessage(`สร้าง ${result.createdCount} คู่, ข้าม ${result.skippedCount} คู่, รอ ${result.pendingCount} คู่`);
      router.refresh();
    });
  }

  return (
    <section className="mx-auto w-full max-w-7xl scroll-mt-28 px-4 pb-10 sm:px-6 lg:px-10" id="competition-tree-v2">
      <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10">
        <div className="mb-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-2xl font-black text-[#061426]">จัดการแข่งขันรอบน็อกเอาต์</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              Knockout Competition Management
            </p>
          </div>
          <span className="inline-flex w-fit shrink-0 rounded-full bg-[#fff7e6] px-3 py-2 text-sm font-black text-[#8a6418]">
            {statusLabel.th} / {statusLabel.en}
          </span>
        </div>

        <ol className="mt-5 grid gap-2 text-sm font-bold text-slate-600 sm:grid-cols-2 lg:grid-cols-3">
          {[
            "1. ตั้งค่าทีมเข้ารอบ",
            "2. สร้างโครงสร้างการแข่งขัน",
            "3. ตรวจสอบและยืนยัน",
            "4. สร้างโปรแกรมการแข่งขัน",
            "5. จัดการแข่งขันและบันทึกผล",
            "6. สรุปผลการแข่งขัน",
          ].map((step) => <li className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2" key={step}>{step}</li>)}
        </ol>

        {!configReady ? (
          <p className="mt-4 rounded-md border border-[#8a6418]/25 bg-[#fff7e6] px-3 py-2 text-sm font-bold text-[#8a6418]">
            ตั้งค่าทีมเข้ารอบก่อนสร้างโครงสร้างการแข่งขัน
          </p>
        ) : null}

        {summary ? (
          <details className="mt-5 min-w-0 rounded-md border border-slate-200 bg-slate-50 p-4">
            <summary className="cursor-pointer text-sm font-black text-[#061426]">ข้อมูลทางเทคนิคสำหรับผู้ดูแล</summary>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Rounds" value={summary.roundCount} />
              <Stat label="Nodes" value={summary.nodeCount} />
              <Stat label="Leaves" value={summary.leafNodeCount} />
              <Stat label="Roots" value={summary.rootNodeId ? 1 : 0} />
              <Stat label="Entrants" value={summary.entrantCount} />
              <Stat label="Capacity" value={bracketCapacity ?? "Not set"} />
              <Stat label="Bye Sources" value={summary.byeNodeCount} />
              <Stat label="Preliminary Nodes" value={summary.preliminaryNodeCount} />
              <Stat label="Root Node" value={summary.rootNodeId ? "Valid" : "Missing"} />
            </div>
            <p className="mt-4 break-words text-sm font-bold text-slate-600">{summary.roundLabels.join(" → ")}</p>
          </details>
        ) : (
          <p className="mt-5 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-600">
            ยังไม่ได้สร้างโครงสร้างการแข่งขัน
          </p>
        )}

        {currentWorkflow?.warning ? (
          <p className="mt-4 rounded-md border border-[#8a6418]/25 bg-[#fff7e6] px-3 py-2 text-sm font-bold text-[#8a6418]">{currentWorkflow.warning}</p>
        ) : null}

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {canGenerateTree(status) ? (
            <button
              className="min-h-11 rounded-md bg-[#061426] px-5 py-3 text-sm font-black text-[#f4d58a] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!configReady || isPending}
              onClick={generateTree}
              type="button"
            >
              {isPending ? "กำลังสร้าง..." : summary ? "ตรวจสอบโครงสร้างการแข่งขัน" : "สร้างโครงสร้างการแข่งขัน"}
            </button>
          ) : null}
          {canReviewTree(status) && currentWorkflow?.hasValidTree ? (
            <button
              className="min-h-11 rounded-md border border-[#d8ad45] bg-[#fff7e6] px-5 py-3 text-sm font-black text-[#8a6418] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending}
              onClick={reviewTree}
              type="button"
            >
              ยืนยันโครงสร้างการแข่งขัน
            </button>
          ) : null}
          {status === "reviewed" ? (
            <button
              className="min-h-11 rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-black text-[#061426] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending}
              onClick={reopenTree}
              type="button"
            >
              กลับไปแก้ไขโครงสร้าง
            </button>
          ) : null}
          {canCreateFixtures(status) ? (
            <button
              className="min-h-11 rounded-md bg-[#061426] px-5 py-3 text-sm font-black text-[#f4d58a] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending || fixtureResult?.nodes.filter((node) => node.state === "eligible").length === 0}
              onClick={createFixtures}
              type="button"
            >
              {isPending ? "กำลังสร้าง..." : "สร้างโปรแกรมรอบน็อกเอาต์"}
            </button>
          ) : null}
        </div>

        {fixtureResult ? (
          <details className="mt-5 min-w-0 rounded-md border border-slate-200 bg-slate-50 p-4">
            <summary className="cursor-pointer text-sm font-black text-[#061426]">ข้อมูลทางเทคนิคสำหรับผู้ดูแล</summary>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Ready" value={fixtureResult.nodes.filter((node) => node.state === "eligible").length} />
              <Stat label="Waiting" value={fixtureResult.nodes.filter((node) => node.state === "waiting_winner").length} />
              <Stat label="Bye" value={fixtureResult.nodes.filter((node) => node.state === "bye").length} />
              <Stat label="Incomplete" value={fixtureResult.nodes.filter((node) => node.state === "incomplete").length} />
              <Stat label="Created" value={fixtureResult.createdCount} />
              <Stat label="Skipped" value={fixtureResult.skippedCount} />
              <Stat label="Pending" value={fixtureResult.pendingCount} />
              <Stat label="Linked" value={fixtureResult.linkedCount} />
            </div>
            <div className="mt-4 grid gap-2">
              {fixtureResult.nodes.filter((node) => node.state === "linked").map((node) => (
                <p className="break-words rounded-md border border-emerald-700/20 bg-white px-3 py-2 text-sm font-bold text-emerald-800" key={node.nodeId}>
                  {node.roundLabel}: {node.homeTeamName ?? node.homeTeamId ?? "?"} vs {node.awayTeamName ?? node.awayTeamId ?? "?"} · Match {node.matchId}
                </p>
              ))}
            </div>
            {fixtureResult.errors.length ? <p className="mt-3 text-sm font-bold text-[#9b1c1f]">{fixtureResult.errors.join(" ")}</p> : null}
          </details>
        ) : null}

        {error ? <p className="mt-4 rounded-md border border-[#9b1c1f]/25 bg-[#9b1c1f]/10 px-3 py-2 text-sm font-bold text-[#9b1c1f]">{error}</p> : null}
        {message ? <p className="mt-4 rounded-md border border-emerald-700/20 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{message}</p> : null}
      </article>
    </section>
  );
}

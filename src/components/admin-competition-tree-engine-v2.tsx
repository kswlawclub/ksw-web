"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateCompetitionTreeV2 } from "@/app/admin/competitions/[id]/competition-engine-v2-actions";
import type { CompetitionTreeSummary } from "@/lib/competition-tree";

type AdminCompetitionTreeEngineV2Props = {
  bracketCapacity: number | null;
  competitionId: string;
  configReady: boolean;
  initialSummary: CompetitionTreeSummary | null;
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
}: AdminCompetitionTreeEngineV2Props) {
  const router = useRouter();
  const [generatedSummary, setGeneratedSummary] = useState<CompetitionTreeSummary | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const summary = generatedSummary ?? initialSummary;

  function generateTree() {
    setError("");
    setMessage("");
    startTransition(async () => {
      const result = await generateCompetitionTreeV2(competitionId);
      if (!result.ok) {
        setError(result.error ?? "Could not generate Competition Tree V2.");
        return;
      }
      setGeneratedSummary(result.summary ?? null);
      setMessage(initialSummary ? "Competition Tree V2 is already valid and unchanged." : "Competition Tree V2 has been saved. No matches were created.");
      router.refresh();
    });
  }

  return (
    <section className="mx-auto w-full max-w-7xl scroll-mt-28 px-4 pb-10 sm:px-6 lg:px-10" id="competition-tree-v2">
      <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10">
        <div className="mb-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#8a6418]">Competition Engine V2</p>
            <h2 className="mt-1 text-2xl font-black text-[#061426]">Competition Tree Debug Summary</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              Tree is the source of truth. This creates topology only; no bracket UI, match, or winner progression is created.
            </p>
          </div>
          <button
            className="min-h-11 shrink-0 rounded-md bg-[#061426] px-5 py-3 text-sm font-black text-[#f4d58a] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!configReady || isPending}
            onClick={generateTree}
            type="button"
          >
            {isPending ? "Generating..." : summary ? "Verify Tree" : "Generate Competition Tree"}
          </button>
        </div>

        {!configReady ? (
          <p className="mt-4 rounded-md border border-[#8a6418]/25 bg-[#fff7e6] px-3 py-2 text-sm font-bold text-[#8a6418]">
            Confirm Competition Wizard V2 before generating a tree.
          </p>
        ) : null}

        {summary ? (
          <div className="mt-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          </div>
        ) : (
          <p className="mt-5 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-600">
            No Competition Tree V2 has been generated yet.
          </p>
        )}

        {error ? <p className="mt-4 rounded-md border border-[#9b1c1f]/25 bg-[#9b1c1f]/10 px-3 py-2 text-sm font-bold text-[#9b1c1f]">{error}</p> : null}
        {message ? <p className="mt-4 rounded-md border border-emerald-700/20 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{message}</p> : null}
      </article>
    </section>
  );
}

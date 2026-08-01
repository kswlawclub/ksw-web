"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  generateCompetitionTreeV2,
  createCompetitionFixturesV2,
  previewCompetitionFixturesV2,
  reopenCompetitionTreeV2,
  reviewCompetitionTreeV2,
  saveCompetitionKnockoutMatchV2,
} from "@/app/admin/competitions/[id]/competition-engine-v2-actions";
import type { CompetitionFixturesV2Result, CompetitionKnockoutMatchV2 } from "@/app/admin/competitions/[id]/competition-engine-v2-actions";
import {
  canCreateFixtures,
  canGenerateTree,
  canReviewTree,
  competitionEngineV2StatusLabel,
  type CompetitionEngineV2Integrity,
} from "@/lib/competition-engine-v2-state";
import type { CompetitionTreeNode, CompetitionTreeSummary } from "@/lib/competition-tree";
import { TeamLogo } from "@/components/team-logo";

type AdminCompetitionTreeEngineV2Props = {
  bracketCapacity: number | null;
  competitionId: string;
  configReady: boolean;
  initialSummary: CompetitionTreeSummary | null;
  initialMatches: CompetitionKnockoutMatchV2[];
  nodes: CompetitionTreeNode[];
  teams: Array<{ id: string; logo_url: string | null; name: string; short_name: string | null }>;
  workflow: CompetitionEngineV2Integrity | null;
};

type ResultForm = {
  awayScore: string;
  homeScore: string;
  manualWinnerTeamId: string;
  matchDate: string;
  penaltyAwayScore: string;
  penaltyHomeScore: string;
  status: "finished" | "scheduled";
  venue: string;
};

function dateValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { dateStyle: "short", hour: "2-digit", hour12: false, minute: "2-digit", timeZone: "Asia/Bangkok" }).formatToParts(date);
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));
  return `${valueByType.get("year")}-${valueByType.get("month")}-${valueByType.get("day")}T${valueByType.get("hour")}:${valueByType.get("minute")}`;
}

function formFromMatch(match: CompetitionKnockoutMatchV2): ResultForm {
  return {
    awayScore: match.away_score === null ? "" : String(match.away_score),
    homeScore: match.home_score === null ? "" : String(match.home_score),
    manualWinnerTeamId: match.manual_winner_team_id ?? "",
    matchDate: dateValue(match.match_date),
    penaltyAwayScore: match.penalty_away_score === null ? "" : String(match.penalty_away_score),
    penaltyHomeScore: match.penalty_home_score === null ? "" : String(match.penalty_home_score),
    status: match.status === "finished" ? "finished" : "scheduled",
    venue: match.venue ?? "",
  };
}

function score(value: string) {
  return value.trim() === "" ? null : Number(value);
}

function compactMatchDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(date);
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 break-words text-xl font-black text-[#061426]">{value}</p>
    </div>
  );
}

function KnockoutMatchCard({
  match,
  onSave,
  teamsById,
}: {
  match: CompetitionKnockoutMatchV2;
  onSave: (match: CompetitionKnockoutMatchV2, draft: ResultForm) => Promise<{ error?: string; ok: boolean }>;
  teamsById: Map<string, { id: string; logo_url: string | null; name: string; short_name: string | null }>;
}) {
  const [draft, setDraft] = useState(() => formFromMatch(match));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const home = teamsById.get(match.home_team_id);
  const away = teamsById.get(match.away_team_id);
  const isDraw = draft.status === "finished" && draft.homeScore !== "" && draft.homeScore === draft.awayScore;
  const hasScore = match.home_score !== null && match.away_score !== null;
  const compactDraw = hasScore && match.home_score === match.away_score;
  const winner = match.winner_team_id ? teamsById.get(match.winner_team_id) : undefined;

  function cancelEdit() {
    setDraft(formFromMatch(match));
    setError("");
    setSaved(false);
    setEditing(false);
  }

  function updateDraft(patch: Partial<ResultForm>) {
    setError("");
    setSaved(false);
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const result = await onSave(match, draft);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "ไม่สามารถบันทึกผลการแข่งขันได้");
      return;
    }
    setSaved(true);
    setEditing(false);
  }

  if (match.status === "finished" && !editing) {
    const date = compactMatchDate(match.match_date);
    const penaltyResult = match.penalty_home_score !== null && match.penalty_away_score !== null
      ? `จุดโทษ ${match.penalty_home_score}-${match.penalty_away_score}`
      : null;
    const specialResult = compactDraw && !penaltyResult && winner ? `ผลตัดสินพิเศษ: ${winner.name}` : null;
    return (
      <article className="min-w-0 rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-3" id={`knockout-match-${match.id}`}>
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-800"><span aria-hidden="true">✓</span>จบการแข่งขัน</span>
          <button className="min-h-10 rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-sm font-black text-emerald-800" onClick={() => { setSaved(false); setEditing(true); }} type="button">แก้ไขผล</button>
        </div>
        <div className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-4">
          <div className={`flex min-w-0 items-center gap-2 ${winner?.id === home?.id ? "font-black text-[#061426]" : "text-slate-700"}`}><TeamLogo className="!size-8 shrink-0 bg-[#061426]" initials={(home?.short_name || home?.name || "ทีม").slice(0, 3)} logoUrl={home?.logo_url ?? ""} teamName={home?.name ?? "ทีมเหย้า"} /><span className="min-w-0 break-words text-sm">{home?.name ?? "ทีมเหย้า"}</span></div>
          <p className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-center text-xl font-black tabular-nums text-[#061426]">{hasScore ? `${match.home_score} - ${match.away_score}` : "-"}</p>
          <div className={`flex min-w-0 items-center justify-end gap-2 text-right ${winner?.id === away?.id ? "font-black text-[#061426]" : "text-slate-700"}`}><span className="min-w-0 break-words text-sm">{away?.name ?? "ทีมเยือน"}</span><TeamLogo className="!size-8 shrink-0 bg-[#061426]" initials={(away?.short_name || away?.name || "ทีม").slice(0, 3)} logoUrl={away?.logo_url ?? ""} teamName={away?.name ?? "ทีมเยือน"} /></div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-slate-600"><span>{compactDraw ? "เสมอ" : winner ? `ผู้ชนะ: ${winner.name}` : "รอผลสกอร์"}</span>{date ? <span>{date}</span> : null}{match.venue ? <span>{match.venue}</span> : null}</div>
        {penaltyResult || specialResult ? <p className="mt-1 text-xs font-bold text-[#8a6418]">{penaltyResult ?? specialResult}</p> : null}
        {saved ? <p className="mt-2 text-xs font-bold text-emerald-800">บันทึกแล้ว</p> : null}
      </article>
    );
  }

  return (
    <form className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4" id={`knockout-match-${match.id}`} onSubmit={save}>
      <div className="grid gap-3 sm:grid-cols-2">
        {[{ side: "home", team: home, value: draft.homeScore }, { side: "away", team: away, value: draft.awayScore }].map(({ side, team, value }) => (
          <label className="flex min-w-0 items-center gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm font-black" key={side}>
            <TeamLogo className="!size-9 shrink-0 bg-[#061426]" initials={(team?.short_name || team?.name || "ทีม").slice(0, 3)} logoUrl={team?.logo_url ?? ""} teamName={team?.name ?? "รอผลรอบก่อน"} />
            <span className="min-w-0 flex-1 break-words">{team?.name ?? "รอผลรอบก่อน"}</span>
            <input className="min-h-11 w-16 shrink-0 rounded-md border border-slate-200 px-2 text-center" max="999" min="0" onChange={(event) => updateDraft(side === "home" ? { homeScore: event.target.value } : { awayScore: event.target.value })} step="1" type="number" value={value} />
          </label>
        ))}
      </div>
      <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1 text-xs font-black">วันและเวลา<input className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 px-3" onChange={(event) => updateDraft({ matchDate: event.target.value })} type="datetime-local" value={draft.matchDate} /></label>
        <label className="grid min-w-0 gap-1 text-xs font-black">สนาม<input className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 px-3" onChange={(event) => updateDraft({ venue: event.target.value })} value={draft.venue} /></label>
        <label className="grid min-w-0 gap-1 text-xs font-black">สถานะ<select className="min-h-11 w-full rounded-md border border-slate-200 px-3" onChange={(event) => updateDraft({ status: event.target.value as ResultForm["status"] })} value={draft.status}><option value="scheduled">รอแข่งขัน</option><option value="finished">จบการแข่งขัน</option></select></label>
      </div>
      {(draft.homeScore !== "" || draft.awayScore !== "") && draft.status !== "finished" ? <p className="mt-3 rounded-md border border-[#d8ad45]/35 bg-[#fff7e6] px-3 py-2 text-xs font-bold text-[#8a6418]">มีสกอร์แล้ว แต่ยังไม่ยืนยันจบการแข่งขัน</p> : null}
      {isDraw ? <div className="mt-3 grid gap-3 rounded-md border border-[#d8ad45]/35 bg-[#fff7e6] p-3 sm:grid-cols-2"><label className="grid gap-1 text-xs font-black">จุดโทษ ทีมเหย้า<input className="min-h-11 rounded-md border border-slate-200 px-3" max="999" min="0" onChange={(event) => updateDraft({ penaltyHomeScore: event.target.value })} step="1" type="number" value={draft.penaltyHomeScore} /></label><label className="grid gap-1 text-xs font-black">จุดโทษ ทีมเยือน<input className="min-h-11 rounded-md border border-slate-200 px-3" max="999" min="0" onChange={(event) => updateDraft({ penaltyAwayScore: event.target.value })} step="1" type="number" value={draft.penaltyAwayScore} /></label><details className="sm:col-span-2"><summary className="cursor-pointer text-xs font-black">คำตัดสินพิเศษ</summary><select className="mt-2 min-h-11 w-full rounded-md border border-slate-200 px-3" onChange={(event) => updateDraft({ manualWinnerTeamId: event.target.value })} value={draft.manualWinnerTeamId}><option value="">เลือกเมื่อจำเป็น</option><option value={match.home_team_id}>{home?.name ?? "ทีมเหย้า"}</option><option value={match.away_team_id}>{away?.name ?? "ทีมเยือน"}</option></select></details></div> : null}
      {error ? <p className="mt-3 rounded-md border border-[#9b1c1f]/25 bg-[#9b1c1f]/10 px-3 py-2 text-sm font-bold text-[#9b1c1f]">{error}</p> : null}
      {saved ? <p className="mt-3 rounded-md border border-emerald-700/20 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{draft.status === "finished" ? "บันทึกแล้ว ผู้ชนะจะเข้าสู่รอบถัดไปเมื่อคู่แข่งขันพร้อม" : "บันทึกแล้ว"}</p> : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">{match.status === "finished" ? <button className="min-h-11 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-black text-[#061426]" disabled={saving} onClick={cancelEdit} type="button">ยกเลิก</button> : null}<button className="min-h-11 rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] disabled:opacity-60" disabled={saving} type="submit">{saving ? "กำลังบันทึก..." : saved ? "บันทึกแล้ว" : "บันทึกแมตช์"}</button></div>
    </form>
  );
}

export function AdminCompetitionTreeEngineV2({
  bracketCapacity,
  competitionId,
  configReady,
  initialMatches,
  initialSummary,
  nodes,
  teams,
  workflow,
}: AdminCompetitionTreeEngineV2Props) {
  const router = useRouter();
  const [generatedSummary, setGeneratedSummary] = useState<CompetitionTreeSummary | null>(null);
  const [currentWorkflow, setCurrentWorkflow] = useState(workflow);
  const [fixtureResult, setFixtureResult] = useState<CompetitionFixturesV2Result | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [knockoutMatches, setKnockoutMatches] = useState(initialMatches);
  const [activeCardId, setActiveCardId] = useState("");
  const activeCardRef = useRef("");
  const summary = generatedSummary ?? initialSummary;
  const status = currentWorkflow?.status ?? "draft";
  const statusLabel = competitionEngineV2StatusLabel(status);
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const nodeByMatchId = useMemo(
    () => new Map(nodes.filter((node) => node.linkedMatchId).map((node) => [node.linkedMatchId as string, node])),
    [nodes],
  );
  const matchesByRound = useMemo(() => {
    const grouped = new Map<string, CompetitionKnockoutMatchV2[]>();
    knockoutMatches.forEach((match) => {
      const node = nodeByMatchId.get(match.id);
      const label = node?.roundLabel || "รอบน็อกเอาต์";
      grouped.set(label, [...(grouped.get(label) ?? []), match]);
    });
    return Array.from(grouped.entries()).sort(([, matchesA], [, matchesB]) =>
      (nodeByMatchId.get(matchesA[0]?.id)?.roundIndex ?? 0) - (nodeByMatchId.get(matchesB[0]?.id)?.roundIndex ?? 0),
    );
  }, [knockoutMatches, nodeByMatchId]);
  const champion = useMemo(() => {
    const finalNode = [...nodes].sort((a, b) => b.roundIndex - a.roundIndex || b.matchOrder - a.matchOrder)[0];
    const finalMatch = finalNode?.linkedMatchId ? knockoutMatches.find((match) => match.id === finalNode.linkedMatchId) : undefined;
    return finalMatch?.status === "finished" && finalMatch.winner_team_id ? teamsById.get(finalMatch.winner_team_id) : undefined;
  }, [knockoutMatches, nodes, teamsById]);

  useEffect(() => {
    if (!activeCardId) return;
    const element = document.getElementById(activeCardId);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) element.scrollIntoView({ block: "center" });
  }, [activeCardId, knockoutMatches]);

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

  async function saveMatch(match: CompetitionKnockoutMatchV2, form: ResultForm) {
    const cardId = `knockout-match-${match.id}`;
    activeCardRef.current = cardId;
    setActiveCardId(cardId);
    const result = await saveCompetitionKnockoutMatchV2({
      awayScore: score(form.awayScore),
      competitionId,
      homeScore: score(form.homeScore),
      manualWinnerTeamId: form.manualWinnerTeamId || null,
      matchDate: form.matchDate ? new Date(`${form.matchDate}:00+07:00`).toISOString() : null,
      matchId: match.id,
      penaltyAwayScore: score(form.penaltyAwayScore),
      penaltyHomeScore: score(form.penaltyHomeScore),
      status: form.status,
      venue: form.venue.trim() || null,
    });
    if (!result.ok || !result.matches) return { error: result.error ?? "ไม่สามารถบันทึกผลการแข่งขันได้", ok: false };
    setKnockoutMatches(result.matches);
    // The new downstream node is read from the current page only after its own match is created.
    if (result.matches.length !== knockoutMatches.length) router.refresh();
    return { ok: true };
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
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Stat label="ทีมเข้ารอบ" value={summary.entrantCount} />
            <Stat label="จำนวนรอบ" value={summary.roundCount} />
            <Stat label="ความจุสาย" value={bracketCapacity ?? "—"} />
          </div>
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

        {fixtureResult?.errors.length ? <p className="mt-4 rounded-md border border-[#9b1c1f]/25 bg-[#9b1c1f]/10 px-3 py-2 text-sm font-bold text-[#9b1c1f]">{fixtureResult.errors.join(" ")}</p> : null}

        {error ? <p className="mt-4 rounded-md border border-[#9b1c1f]/25 bg-[#9b1c1f]/10 px-3 py-2 text-sm font-bold text-[#9b1c1f]">{error}</p> : null}
        {message ? <p className="mt-4 rounded-md border border-emerald-700/20 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{message}</p> : null}

        {matchesByRound.length ? (
          <div className="mt-6 grid gap-5">
            {matchesByRound.map(([roundLabel, roundMatches]) => (
              <section className="min-w-0 rounded-lg border border-slate-200 p-4" key={roundLabel}>
                <h3 className="text-xl font-black text-[#061426]">{roundLabel}</h3>
                <p className="mt-1 text-sm font-semibold text-slate-600">กำหนดวันเวลา สนาม และบันทึกผลของแต่ละคู่ได้ที่นี่</p>
                <div className="mt-4 grid gap-3">{roundMatches.map((match) => <KnockoutMatchCard key={match.id} match={match} onSave={saveMatch} teamsById={teamsById} />)}</div>
              </section>
            ))}
          </div>
        ) : summary ? (
          <p className="mt-5 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-600">เมื่อทีมผ่านเข้ารอบพร้อม ระบบจะแสดงคู่แข่งขันในส่วนนี้</p>
        ) : null}
        <section className="mt-6 rounded-lg border border-[#d8ad45]/35 bg-[#fff7e6] p-4">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8a6418]">Champion</p>
          <p className="mt-1 text-xl font-black text-[#061426]">{champion?.name ?? "รอผลการแข่งขันรอบชิงชนะเลิศ"}</p>
        </section>
      </article>
    </section>
  );
}

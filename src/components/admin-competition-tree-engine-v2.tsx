"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  completeCupCompetitionV2,
  generateCompetitionTreeV2,
  createCompetitionFixturesV2,
  previewCompetitionFixturesV2,
  reopenCompetitionTreeV2,
  reviewCompetitionTreeV2,
  saveCompetitionKnockoutMatchV2,
  selectCompetitionKnockoutTemplateV2,
} from "@/app/admin/competitions/[id]/competition-engine-v2-actions";
import type { CompetitionFixturesV2Result, CompetitionKnockoutMatchV2 } from "@/app/admin/competitions/[id]/competition-engine-v2-actions";
import { approveCouncilDivisionsV2, getCouncilDivisionStateV2, getCouncilTemplatePreflightV2, reopenCouncilDivisionsV2, saveCouncilDivisionDraftV2 } from "@/app/admin/competitions/[id]/council-division-actions";
import type { CouncilDivisionExtraSelections, CouncilDivisionState, CouncilTemplatePreflightResult } from "@/app/admin/competitions/[id]/council-division-actions";
import {
  completeCouncilCupCompetitionV2,
  confirmCouncilBracketV2,
  createCouncilPartitionFixturesV2,
  getCouncilBracketStateV2,
  saveCouncilPartitionMatchV2,
} from "@/app/admin/competitions/[id]/council-bracket-actions";
import type { CouncilBracketMatch, CouncilBracketState } from "@/app/admin/competitions/[id]/council-bracket-actions";
import {
  canGenerateTree,
  canReviewTree,
  competitionEngineV2StatusLabel,
  type CompetitionEngineV2Integrity,
} from "@/lib/competition-engine-v2-state";
import { buildCompetitionTree, type CompetitionTreeEntryMode, type CompetitionTreeNode, type CompetitionTreeSource, type CompetitionTreeSummary } from "@/lib/competition-tree";
import { buildKnockoutTemplatePreview, getKnockoutTemplate, listKnockoutTemplates, validateKnockoutTemplateSources } from "@/lib/knockout-templates/registry";
import { getKnockoutTemplateSwitchGuard, inspectKnockoutTemplateSwitchState } from "@/lib/knockout-template-switching";
import type { KnockoutTemplateDiagram, KnockoutTemplateKey } from "@/lib/knockout-templates/types";
import type { KswQualificationSource } from "@/lib/ksw-knockout-template";
import { TeamLogo } from "@/components/team-logo";

type AdminCompetitionTreeEngineV2Props = {
  bracketCapacity: number | null;
  competitionId: string;
  competitionStatus: string | null;
  configReady: boolean;
  entryMode: CompetitionTreeEntryMode;
  initialSummary: CompetitionTreeSummary | null;
  initialMatches: CompetitionKnockoutMatchV2[];
  nodes: CompetitionTreeNode[];
  qualificationApproved: boolean;
  qualificationSnapshot: CompetitionTreeSource[];
  groupNames: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; logo_url: string | null; name: string; short_name: string | null }>;
  templateKey: KnockoutTemplateKey | null;
  workflow: CompetitionEngineV2Integrity | null;
};

type ResultForm = {
  awayScore: string;
  homeScore: string;
  matchDate: string;
  penaltyAwayScore: string;
  penaltyHomeScore: string;
  status: "finished" | "scheduled";
  venue: string;
};

type KnockoutRoundView = {
  allMatchesReady: boolean;
  complete: boolean;
  label: string;
  matches: CompetitionKnockoutMatchV2[];
  nodes: CompetitionTreeNode[];
  roundIndex: number;
};

function knockoutRoundTitle(label: string) {
  if (label === "Final") return "รอบชิงชนะเลิศ";
  if (label === "Semifinal") return "รอบรองชนะเลิศ";
  if (label === "Quarterfinal") return "รอบ 8 ทีม";
  if (label === "Preliminary") return "รอบคัดเลือก";
  const roundOf = /^Round of (\d+)$/.exec(label);
  return roundOf ? `รอบ ${roundOf[1]} ทีม` : label;
}

function KnockoutStateDiagnostic({ matches, nodes, qualificationSnapshot, templateKey }: { matches: CompetitionKnockoutMatchV2[]; nodes: CompetitionTreeNode[]; qualificationSnapshot: CompetitionTreeSource[]; templateKey: KnockoutTemplateKey | null }) {
  const diagnostic = inspectKnockoutTemplateSwitchState({
    derivedSources: qualificationSnapshot,
    matches: matches.map((match) => ({ awayScore: match.away_score, awayTeamId: match.away_team_id, homeScore: match.home_score, homeTeamId: match.home_team_id, id: match.id, status: match.status, winnerTeamId: match.winner_team_id })),
    nodes,
  });
  const linkedNodeIds = new Map(nodes.filter((node) => node.linkedMatchId).map((node) => [node.linkedMatchId, node.id]));
  const sourceText = (source: { groupId?: string | null; nodeId?: string | null; rank?: number | null; teamId?: string | null; type?: string | null }) => `type=${source.type ?? "—"} group=${source.groupId ?? "—"} rank=${source.rank ?? "—"} node=${source.nodeId ?? "—"} team=${source.teamId ?? "—"}`;

  return <details className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50/70 p-3 text-xs text-slate-700"><summary className="cursor-pointer font-black text-[#061426]">ตรวจสอบสถานะ Knockout</summary><div className="mt-3 grid gap-3"><dl className="grid gap-2 sm:grid-cols-3"><div><dt className="font-bold text-slate-500">Template</dt><dd className="mt-0.5 break-all font-mono">{templateKey ?? "—"}</dd></div><div><dt className="font-bold text-slate-500">Guard</dt><dd className="mt-0.5 font-black">{String(diagnostic.allowed)} · {diagnostic.code}</dd></div><div><dt className="font-bold text-slate-500">Reason</dt><dd className="mt-0.5 break-words">{diagnostic.reason ?? "—"}</dd></div><div><dt className="font-bold text-slate-500">Bracket nodes</dt><dd className="mt-0.5 font-black">{nodes.length}</dd></div><div><dt className="font-bold text-slate-500">Knockout fixtures</dt><dd className="mt-0.5 font-black">{matches.length}</dd></div><div><dt className="font-bold text-slate-500">Resettable / blocking</dt><dd className="mt-0.5 font-black">{diagnostic.resettableNodes.length} / {diagnostic.blockingNodes.length}</dd></div></dl><div className="grid gap-2"><p className="font-black text-[#061426]">Bracket nodes</p>{diagnostic.nodeDiagnostics.length ? diagnostic.nodeDiagnostics.map(({ blocking, code, node, reason, resettable, resolvedPairing, topologyOnly }) => <article className="min-w-0 rounded border border-slate-200 bg-white p-2" key={node.id}><p className="break-all font-mono font-bold">{node.id}</p><p className="mt-1">round={node.roundLabel} ({node.roundIndex}) · order={node.matchOrder} · position={node.bracketPosition} · linkedMatch={node.linkedMatchId ?? "—"}</p><p className="mt-1 break-words">home: {sourceText(node.homeSource)}</p><p className="break-words">away: {sourceText(node.awaySource)}</p><p className="mt-1 font-bold">topologyOnly={String(topologyOnly)} · resolvedPairing={String(resolvedPairing)} · resettable={String(resettable)} · blocking={String(blocking)}{code ? ` (${code})` : ""}{reason ? ` · ${reason}` : ""}</p></article>) : <p>ไม่มี bracket node</p>}</div><div className="grid gap-2"><p className="font-black text-[#061426]">Knockout fixtures</p>{diagnostic.fixtures.length ? diagnostic.fixtures.map(({ code, match, reason }) => <article className="min-w-0 rounded border border-slate-200 bg-white p-2" key={match.id}><p className="break-all font-mono font-bold">{match.id ?? "—"}</p><p className="mt-1">round node={linkedNodeIds.get(match.id) ?? "—"} · status={match.status ?? "—"} · code={code}</p><p>home={match.homeTeamId ?? "—"} away={match.awayTeamId ?? "—"} · score={match.homeScore ?? "—"}-{match.awayScore ?? "—"} · winner={match.winnerTeamId ?? "—"}</p><p className="mt-1 font-bold">{reason}</p></article>) : <p>ไม่มี knockout fixture</p>}</div></div></details>;
}

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

function TemplateMiniDiagram({ diagram }: { diagram: KnockoutTemplateDiagram }) {
  if (diagram.mode === "linear") {
    return (
      <div aria-label="ลำดับรูปแบบการแข่งขัน" className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
        <div className="flex flex-col items-center gap-1.5 text-center text-xs font-black text-slate-700">
          {diagram.steps.map((step, index) => <div className="contents" key={step}><span className="w-full rounded border border-slate-200 bg-white px-2 py-1.5">{step}</span>{index < diagram.steps.length - 1 ? <span aria-hidden="true" className="leading-none text-[#8a6418]">↓</span> : null}</div>)}
        </div>
      </div>
    );
  }

  return (
    <div aria-label="ลำดับรูปแบบการแข่งขัน" className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="flex flex-col items-center gap-1.5 text-center text-xs font-black text-slate-700">
        {diagram.steps.map((step, index) => <div className="contents" key={step}><span className="w-full rounded border border-slate-200 bg-white px-2 py-1.5">{step}</span>{index < diagram.steps.length - 1 ? <span aria-hidden="true" className="leading-none text-[#8a6418]">↓</span> : null}</div>)}
        <div aria-hidden="true" className="grid w-full grid-cols-2 gap-2 text-[#8a6418]"><span>↙</span><span>↘</span></div>
        <div className="grid w-full grid-cols-2 gap-2">
          {diagram.branches.map((branch) => <div className="min-w-0" key={branch.label}><span className="block rounded border border-slate-200 bg-white px-2 py-1.5 break-words">{branch.label}</span><span aria-hidden="true" className="my-1 block leading-none text-[#8a6418]">↓</span><span className="block rounded border border-[#d8ad45]/35 bg-[#fffdf7] px-2 py-1.5 break-words text-[#8a6418]">{branch.championLabel}</span></div>)}
        </div>
      </div>
    </div>
  );
}

function CouncilDivisionApproval({
  error,
  extras,
  onApprove,
  onExtrasChange,
  onReopen,
  onSaveDraft,
  pending,
  state,
}: {
  error: string;
  extras: { division1: string[]; division2: string[] };
  onApprove: () => void;
  onExtrasChange: (value: { division1: string[]; division2: string[] }) => void;
  onReopen: () => void;
  onSaveDraft: () => void;
  pending: boolean;
  state: CouncilDivisionState | null;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  if (!state) return <section className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4" id="cup-division-approval"><h3 className="font-black text-[#061426]">ตรวจสอบและแบ่งดิวิชั่น</h3><p className="mt-2 text-sm font-semibold text-slate-600">กำลังโหลดข้อมูลการแบ่งดิวิชั่น...</p></section>;
  const approved = state.approvalStatus === "approved";
  const selectedExtras = [...state.division1.entries, ...state.division2.entries].filter((entry) => entry.sourceType !== "group_rank");
  const candidateOptions = [...selectedExtras, ...state.candidatePool].filter((entry, index, entries) => entries.findIndex((candidate) => candidate.teamId === entry.teamId) === index);
  const divisionCard = (key: "division-1" | "division-2", title: string, division: CouncilDivisionState["division1"], detail: string) => {
    const theme = key === "division-1" ? { accent: "border-blue-200", badge: "border-[#d8ad45]/45 bg-[#fffdf7] text-[#8a6418]", heading: "text-blue-900", panel: "bg-blue-50/40" } : { accent: "border-emerald-200", badge: "border-slate-300 bg-slate-50 text-slate-700", heading: "text-emerald-900", panel: "bg-emerald-50/40" };
    return <article className={`min-w-0 rounded-md border ${theme.accent} ${theme.panel} p-4`} id={`cup-${key}`}><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className={`text-lg font-black ${theme.heading}`}>{title}</h4><p className="mt-1 text-sm font-semibold text-slate-600">{detail}</p></div><span className={`rounded-full border px-2.5 py-1 text-xs font-black ${theme.badge}`}>{division.entries.length} ทีม</span></div><div className="mt-3 grid gap-2 text-sm font-bold sm:grid-cols-3"><span>เริ่มรอบ {division.bracketCapacity ?? "-"} ทีม</span><span>ทีมเติม {division.extraCount}/{division.extraNeeded} ทีม</span><span>สถานะ: {approved ? "พร้อมจัดสาย" : division.error ?? "รออนุมัติ"}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{division.entries.map((entry) => <div className="min-w-0 rounded border border-slate-200 bg-white/80 px-3 py-2" key={entry.teamId}><p className="break-words text-sm font-black text-[#061426]">{entry.teamName}</p><p className="mt-1 text-xs font-bold text-slate-500">{entry.label} · {entry.reason}</p></div>)}</div></article>;
  };
  const extraControl = (key: "division1" | "division2", title: string, needed: number) => !approved && needed > 0 ? <div className="mt-4 rounded-md border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-black text-[#061426]">{title}</p><div className="flex gap-2"><button className="text-sm font-black text-[#8a6418]" onClick={() => onExtrasChange({ division1: state.recommendedDivision1ExtraTeamIds, division2: state.recommendedDivision2ExtraTeamIds })} type="button">ใช้การจัดลำดับอัตโนมัติ</button><button className="text-sm font-black text-blue-800" onClick={() => setEditing((value) => !value)} type="button">{editing ? "ปิดการแก้ไข" : "เลือกทีม"}</button></div></div>{editing ? <div className="mt-3 grid gap-2">{Array.from({ length: needed }, (_, index) => <label className="grid gap-1 text-sm font-bold" key={index}>ทีมเติม {index + 1}<select className="min-h-10 rounded-md border border-slate-200 bg-white px-2" onChange={(event) => onExtrasChange({ ...extras, [key]: extras[key].map((teamId, teamIndex) => teamIndex === index ? event.target.value : teamId) })} value={extras[key][index] ?? ""}><option value="">เลือกทีม</option>{candidateOptions.map((entry) => <option key={entry.teamId} value={entry.teamId}>{entry.teamName} · {entry.label}</option>)}</select></label>)}</div> : null}</div> : null;
  return <section className="mt-5 min-w-0 rounded-lg border border-blue-200 bg-blue-50/30 p-4" id="cup-division-approval"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-black text-[#061426]">ตรวจสอบและแบ่งดิวิชั่น</h3><p className="mt-1 text-sm font-semibold text-slate-600">คัพสภา – สองดิวิชั่น ใช้ผลการคัดเลือกและอันดับ 3 ที่ดีที่สุด</p></div><span className={`rounded-full border px-3 py-1.5 text-xs font-black ${approved ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-[#d8ad45]/40 bg-[#fff7e6] text-[#8a6418]"}`}>{approved ? "อนุมัติการแบ่งดิวิชั่นแล้ว" : "รออนุมัติการแบ่งดิวิชั่น"}</span></div>{state.thirdPlaceTieRequiresConfirmation ? <p className="mt-3 rounded-md border border-[#8a6418]/25 bg-[#fff7e6] px-3 py-2 text-sm font-bold text-[#8a6418]">ต้องยืนยันทีมอันดับ 3 ที่ดีที่สุด เนื่องจากคะแนนและสถิติยังเสมอกัน</p> : null}<div className="mt-4 grid gap-3">{divisionCard("division-1", "Division 1", state.division1, "แชมป์กลุ่มและทีมอันดับ 3 ที่ดีที่สุด")}{divisionCard("division-2", "Division 2", state.division2, "รองแชมป์กลุ่มและทีมอันดับ 3 ที่เหลือ")}</div>{extraControl("division1", "ทีมเติม Division 1", state.division1.extraNeeded)}{extraControl("division2", "ทีมเติม Division 2", state.division2.extraNeeded)}{!approved ? <button className="mt-4 min-h-10 rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-black text-blue-800" onClick={() => setPreviewOpen((value) => !value)} type="button">{previewOpen ? "ซ่อนตัวอย่างสายแข่งขัน" : "ดูตัวอย่างสายแข่งขัน"}</button> : null}{previewOpen ? <div className="mt-3 grid gap-3"><p className="text-sm font-black text-[#061426]">ตัวอย่างสายแข่งขันจากร่างปัจจุบัน</p>{[state.division1, state.division2].map((division, index) => <div className="rounded-md border border-slate-200 bg-white p-3" key={index}><p className="text-sm font-black text-[#061426]">Division {index + 1} · เริ่มรอบ {division.bracketCapacity} ทีม</p><ol className="mt-2 grid gap-1 text-sm font-semibold text-slate-700 sm:grid-cols-2">{division.entries.map((entry, position) => <li key={entry.teamId}>{position + 1}. {entry.teamName} ({entry.label})</li>)}</ol></div>)}</div> : null}{error ? <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800">{error}</p> : null}<div className="mt-5 flex flex-wrap gap-2">{approved ? <><button className="min-h-10 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-black text-[#061426]" onClick={() => setDetailsOpen((value) => !value)} type="button">{detailsOpen ? "พับรายละเอียด" : "แสดงรายละเอียด"}</button><button className="min-h-10 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-black text-blue-800 disabled:opacity-60" disabled={pending} onClick={onReopen} type="button">เปิดการแบ่งดิวิชั่นเพื่อแก้ไข</button></> : <><button className="min-h-10 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-black text-[#061426] disabled:opacity-60" disabled={pending || Boolean(state.division1.error || state.division2.error)} onClick={onSaveDraft} type="button">บันทึกร่าง</button><button className="min-h-10 rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] disabled:opacity-60" disabled={pending || Boolean(state.division1.error || state.division2.error)} onClick={onApprove} type="button">ยืนยันการแบ่งดิวิชั่น</button></>}</div></section>;
}

function KnockoutMatchCard({
  match,
  onEditingChange,
  onSave,
  teamsById,
}: {
  match: CompetitionKnockoutMatchV2;
  onEditingChange?: (editing: boolean) => void;
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
  const normalScoreDraw = draft.homeScore !== "" && draft.awayScore !== "" && score(draft.homeScore) === score(draft.awayScore);
  const showPenaltyInputs = normalScoreDraw || draft.penaltyHomeScore !== "" || draft.penaltyAwayScore !== "";
  const hasScore = match.home_score !== null && match.away_score !== null;
  const compactDraw = hasScore && match.home_score === match.away_score;
  const winner = match.winner_team_id ? teamsById.get(match.winner_team_id) : undefined;

  function cancelEdit() {
    setDraft(formFromMatch(match));
    setError("");
    setSaved(false);
    setEditing(false);
    onEditingChange?.(false);
  }

  function updateDraft(patch: Partial<ResultForm>) {
    setError("");
    setSaved(false);
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft.status === "finished" && normalScoreDraw) {
      if (draft.penaltyHomeScore === "" || draft.penaltyAwayScore === "") {
        setError("เสมอในเวลาปกติ กรุณากรอกผลการดวลจุดโทษ");
        return;
      }
      if (score(draft.penaltyHomeScore) === score(draft.penaltyAwayScore)) {
        setError("ผลการดวลจุดโทษต้องไม่เสมอกัน");
        return;
      }
    }
    setSaving(true);
    setError("");
    const normalizedDraft = normalScoreDraw
      ? draft
      : { ...draft, penaltyAwayScore: "", penaltyHomeScore: "" };
    const result = await onSave(match, normalizedDraft);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "ไม่สามารถบันทึกผลการแข่งขันได้");
      return;
    }
    setSaved(true);
    setEditing(false);
    onEditingChange?.(false);
  }

  if (match.status === "finished" && !editing) {
    const date = compactMatchDate(match.match_date);
    const penaltyResult = match.penalty_home_score !== null && match.penalty_away_score !== null
      ? `ชนะจุดโทษ ${match.penalty_home_score}-${match.penalty_away_score}`
      : null;
    return (
      <article className="min-w-0 rounded-md border border-emerald-200 bg-emerald-50/40 px-2.5 py-2" id={`knockout-match-${match.id}`}>
        <div className="flex min-w-0 items-center gap-2">
          <span aria-label="จบการแข่งขัน" className="size-2 shrink-0 rounded-full bg-emerald-600" title="จบการแข่งขัน" />
          <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
            <div className={`flex min-w-0 items-center gap-1.5 ${winner?.id === home?.id ? "font-black text-[#061426]" : "text-slate-700"}`}><TeamLogo className="!size-7 shrink-0 bg-[#061426]" initials={(home?.short_name || home?.name || "ทีม").slice(0, 3)} logoUrl={home?.logo_url ?? ""} teamName={home?.name ?? "ทีมเหย้า"} /><span className="min-w-0 break-words text-sm leading-4">{home?.name ?? "ทีมเหย้า"}</span></div>
            <p className="rounded border border-emerald-200 bg-white px-2 py-1 text-center text-lg font-black tabular-nums text-[#061426]">{hasScore ? `${match.home_score}-${match.away_score}` : "-"}</p>
            <div className={`flex min-w-0 items-center justify-end gap-1.5 text-right ${winner?.id === away?.id ? "font-black text-[#061426]" : "text-slate-700"}`}><span className="min-w-0 break-words text-sm leading-4">{away?.name ?? "ทีมเยือน"}</span><TeamLogo className="!size-7 shrink-0 bg-[#061426]" initials={(away?.short_name || away?.name || "ทีม").slice(0, 3)} logoUrl={away?.logo_url ?? ""} teamName={away?.name ?? "ทีมเยือน"} /></div>
          </div>
          <button aria-label="แก้ไขผลการแข่งขัน" className="min-h-8 shrink-0 rounded border border-emerald-200 bg-white px-2 py-1 text-xs font-black text-emerald-800" onClick={() => { setSaved(false); setEditing(true); onEditingChange?.(true); }} type="button">แก้ไข</button>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-bold leading-4 text-slate-600"><span>{winner ? `ผู้ชนะ: ${winner.name}` : compactDraw ? "เสมอ" : "รอผลสกอร์"}</span>{date ? <span>{date}</span> : null}{match.venue ? <span>{match.venue}</span> : null}{penaltyResult ? <span className="text-[#8a6418]">{penaltyResult}</span> : null}{saved ? <span className="text-emerald-800">บันทึกแล้ว</span> : null}</div>
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
      {showPenaltyInputs ? <div className="mt-3 grid gap-3 rounded-md border border-[#d8ad45]/35 bg-[#fff7e6] p-3 sm:grid-cols-2"><p className="text-xs font-bold text-[#8a6418] sm:col-span-2">เสมอในเวลาปกติ กรุณากรอกผลการดวลจุดโทษ</p><label className="grid gap-1 text-xs font-black">จุดโทษ ทีมเหย้า<input className="min-h-11 rounded-md border border-slate-200 px-3" max="999" min="0" onChange={(event) => updateDraft({ penaltyHomeScore: event.target.value })} step="1" type="number" value={draft.penaltyHomeScore} /></label><label className="grid gap-1 text-xs font-black">จุดโทษ ทีมเยือน<input className="min-h-11 rounded-md border border-slate-200 px-3" max="999" min="0" onChange={(event) => updateDraft({ penaltyAwayScore: event.target.value })} step="1" type="number" value={draft.penaltyAwayScore} /></label></div> : null}
      {error ? <p className="mt-3 rounded-md border border-[#9b1c1f]/25 bg-[#9b1c1f]/10 px-3 py-2 text-sm font-bold text-[#9b1c1f]">{error}</p> : null}
      {saved ? <p className="mt-3 rounded-md border border-emerald-700/20 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{draft.status === "finished" ? "บันทึกแล้ว ผู้ชนะจะเข้าสู่รอบถัดไปเมื่อคู่แข่งขันพร้อม" : "บันทึกแล้ว"}</p> : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">{match.status === "finished" ? <button className="min-h-11 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-black text-[#061426]" disabled={saving} onClick={cancelEdit} type="button">ยกเลิก</button> : null}<button className="min-h-11 rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] disabled:opacity-60" disabled={saving} type="submit">{saving ? "กำลังบันทึก..." : saved ? "บันทึกแล้ว" : "บันทึกแมตช์"}</button></div>
    </form>
  );
}

function KnockoutRoundMatches({
  current,
  matches,
  onSave,
  roundComplete,
  roundLabel,
  teamsById,
}: {
  current: boolean;
  matches: CompetitionKnockoutMatchV2[];
  onSave: (match: CompetitionKnockoutMatchV2, draft: ResultForm) => Promise<{ error?: string; ok: boolean }>;
  roundComplete: boolean;
  roundLabel: string;
  teamsById: Map<string, { id: string; logo_url: string | null; name: string; short_name: string | null }>;
}) {
  const [finishedCollapsed, setFinishedCollapsed] = useState(roundComplete);
  const [editingMatchId, setEditingMatchId] = useState("");
  const finishedMatches = matches.filter((match) => match.status === "finished");
  const displayedMatches = finishedCollapsed ? matches.filter((match) => match.status !== "finished") : matches;
  const finishedGoals = finishedMatches.reduce((total, match) => total + (match.home_score ?? 0) + (match.away_score ?? 0), 0);

  return (
    <section className="min-w-0 rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-xl font-black text-[#061426]">{roundLabel}</h3>{current ? <span className="rounded-full bg-[#fff7e6] px-2 py-1 text-xs font-black text-[#8a6418]">รอบปัจจุบัน</span> : null}</div><p className="mt-1 text-sm font-semibold text-slate-600">{roundComplete ? `จบแล้ว ${finishedMatches.length} คู่` : "กำหนดวันเวลา สนาม และบันทึกผลของแต่ละคู่ได้ที่นี่"}</p></div>{finishedMatches.length ? <button className="min-h-10 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-black text-[#061426] disabled:opacity-50" disabled={Boolean(editingMatchId)} onClick={() => setFinishedCollapsed((current) => !current)} title={editingMatchId ? "ปิดการแก้ไขผลก่อนพับรายการ" : undefined} type="button">{finishedCollapsed ? "แสดงผลการแข่งขัน" : "พับผลการแข่งขัน"}</button> : null}</div>
      {finishedCollapsed ? <p className="mt-2 text-xs font-bold text-slate-600">จบแล้ว {finishedMatches.length} นัด · รวม {finishedGoals} ประตู</p> : null}
      <div className="mt-4 grid gap-3">{displayedMatches.map((match) => <KnockoutMatchCard key={match.id} match={match} onEditingChange={(editing) => setEditingMatchId(editing ? match.id : "")} onSave={onSave} teamsById={teamsById} />)}</div>
    </section>
  );
}

function councilSourceLabel(source: CompetitionTreeSource, groupsById: Map<string, string>) {
  if (source.type === "best_ranked") return `อันดับเพิ่มเติม #${source.bestOrder ?? "?"}`;
  if (source.type === "manual_team") return "ผู้ดูแลเลือก";
  return `${groupsById.get(source.groupId ?? "") ?? "กลุ่ม"}${source.rank ?? "?"}`;
}

function CouncilPartitionBracket({
  competitionId,
  groupsById,
  partitionKey,
  teamsById,
}: {
  competitionId: string;
  groupsById: Map<string, string>;
  partitionKey: "division_1" | "division_2";
  teamsById: Map<string, { id: string; logo_url: string | null; name: string; short_name: string | null }>;
}) {
  const router = useRouter();
  const [state, setState] = useState<CouncilBracketState | null>(null);
  const [draftSources, setDraftSources] = useState<CompetitionTreeSource[]>([]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const theme = partitionKey === "division_1"
    ? { accent: "border-blue-200", badge: "border-[#d8ad45]/45 bg-[#fffdf7] text-[#8a6418]", heading: "text-blue-900", surface: "bg-blue-50/30" }
    : { accent: "border-emerald-200", badge: "border-slate-300 bg-slate-50 text-slate-700", heading: "text-emerald-900", surface: "bg-emerald-50/30" };

  useEffect(() => {
    let active = true;
    void getCouncilBracketStateV2(competitionId, partitionKey).then((result) => {
      if (!active) return;
      if (!result.ok || !("nodes" in result)) {
        setError(result.error ?? "ไม่สามารถโหลดสายการแข่งขันได้");
        return;
      }
      setState(result);
      setDraftSources(result.pairingSources);
    });
    return () => { active = false; };
  }, [competitionId, partitionKey]);

  const rounds = useMemo(() => {
    if (!state) return [];
    const matchesById = new Map(state.matches.map((match) => [match.id, match]));
    const grouped = new Map<number, CompetitionTreeNode[]>();
    state.nodes.forEach((node) => grouped.set(node.roundIndex, [...(grouped.get(node.roundIndex) ?? []), node]));
    return Array.from(grouped.entries()).sort(([left], [right]) => left - right).map(([roundIndex, nodes]) => {
      const matches = nodes.flatMap((node) => node.linkedMatchId ? [matchesById.get(node.linkedMatchId)].filter((match): match is CouncilBracketMatch => Boolean(match)) : []);
      return { complete: nodes.length > 0 && nodes.every((node) => {
        const match = node.linkedMatchId ? matchesById.get(node.linkedMatchId) : undefined;
        return match?.status === "finished" && Boolean(match.winner_team_id);
      }), label: knockoutRoundTitle(nodes[0]?.roundLabel ?? `Round ${roundIndex + 1}`), matches, nodes, roundIndex };
    });
  }, [state]);
  const currentRound = rounds.find((round) => !round.complete);

  function swapSource(currentIndex: number, nextIndex: number) {
    if (currentIndex === nextIndex) return;
    setDraftSources((current) => current.map((source, index) => index === currentIndex ? current[nextIndex] : index === nextIndex ? current[currentIndex] : source));
  }

  function confirmBracket() {
    if (!state) return;
    setError("");
    startTransition(async () => {
      const result = await confirmCouncilBracketV2(competitionId, partitionKey, draftSources);
      if (!result.ok || !("nodes" in result)) return setError(result.error ?? "ไม่สามารถยืนยันการจัดสายได้");
      setState(result);
      setDraftSources(result.pairingSources);
      setEditing(false);
      setMessage("ยืนยันการจัดสายแล้ว พร้อมสร้างโปรแกรมทีละรอบ");
      router.refresh();
    });
  }

  function createFixtures(roundIndex: number, label: string) {
    setError("");
    startTransition(async () => {
      const result = await createCouncilPartitionFixturesV2(competitionId, partitionKey, roundIndex);
      if (!result.ok || !("nodes" in result)) return setError(result.error ?? "ไม่สามารถสร้างโปรแกรมการแข่งขันได้");
      setState(result);
      setMessage(`สร้างโปรแกรม${label}แล้ว`);
      router.refresh();
    });
  }

  async function saveMatch(match: CompetitionKnockoutMatchV2, draft: ResultForm) {
    const result = await saveCouncilPartitionMatchV2({
      awayScore: score(draft.awayScore), competitionId, homeScore: score(draft.homeScore), matchDate: draft.matchDate ? new Date(draft.matchDate).toISOString() : null, matchId: match.id, partitionKey, penaltyAwayScore: score(draft.penaltyAwayScore), penaltyHomeScore: score(draft.penaltyHomeScore), status: draft.status, venue: draft.venue.trim() || null,
    });
    if (!result.ok || !("nodes" in result)) return { error: result.error, ok: false };
    setState(result);
    window.dispatchEvent(new CustomEvent("council-bracket-updated"));
    router.refresh();
    return { ok: true };
  }

  const firstRoundPairs = useMemo(() => Array.from({ length: Math.floor(draftSources.length / 2) }, (_, index) => [draftSources[index * 2], draftSources[index * 2 + 1]] as const), [draftSources]);
  const label = partitionKey === "division_1" ? "Knockout Division 1" : "Knockout Division 2";
  return <section className={`mt-5 min-w-0 scroll-mt-28 rounded-lg border ${theme.accent} ${theme.surface} p-4 sm:p-5`} id={partitionKey === "division_1" ? "cup-knockout-d1" : "cup-knockout-d2"}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className={`text-xl font-black ${theme.heading}`}>{label}</h3><p className="mt-1 text-sm font-semibold text-slate-600">จัดสาย สร้างโปรแกรม และบันทึกผลของดิวิชั่นนี้อย่างอิสระ</p></div><span className={`rounded-full border px-3 py-1.5 text-xs font-black ${theme.badge}`}>{state?.status === "completed" ? "ได้แชมป์แล้ว" : state?.nodes.length ? "จัดสายแล้ว" : "รอจัดสาย"}</span></div>
    {error ? <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800">{error}</p> : null}
    {message ? <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{message}</p> : null}
    {!state ? <p className="mt-4 text-sm font-bold text-slate-600">กำลังโหลด...</p> : !state.nodes.length ? <><div className="mt-4 flex flex-wrap gap-2"><button className="min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-black text-[#061426]" onClick={() => { setDraftSources(state.pairingSources); setEditing(false); }} type="button">ใช้การจัดสายอัตโนมัติ</button><button className="min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-black text-[#061426]" onClick={() => setEditing((value) => !value)} type="button">{editing ? "ดูตัวอย่างคู่" : "แก้ไขคู่ก่อนยืนยัน"}</button></div><div className="mt-4 grid gap-2 sm:grid-cols-2">{firstRoundPairs.map(([home, away], pairIndex) => <article className="min-w-0 rounded-md border border-slate-200 bg-white p-3" key={pairIndex}><p className={`text-xs font-black ${theme.heading}`}>คู่ที่ {pairIndex + 1}</p>{[home, away].map((source, side) => <div className="mt-2" key={`${pairIndex}-${side}`}>{editing ? <select className="min-h-10 w-full rounded-md border border-slate-200 px-2 text-sm font-bold" onChange={(event) => swapSource(pairIndex * 2 + side, Number(event.target.value))} value={pairIndex * 2 + side}>{draftSources.map((candidate, candidateIndex) => <option key={`${candidate.teamId}-${candidateIndex}`} value={candidateIndex}>{teamsById.get(candidate.teamId ?? "")?.name ?? "ทีม"} · {councilSourceLabel(candidate, groupsById)}</option>)}</select> : <p className="break-words text-sm font-black text-[#061426]">{teamsById.get(source?.teamId ?? "")?.name ?? "ทีม"} <span className="text-xs text-slate-500">{source ? councilSourceLabel(source, groupsById) : ""}</span></p>}{side === 0 ? <p className="py-1 text-center text-xs font-bold text-slate-400">พบ</p> : null}</div>)}</article>)}</div><button className="mt-4 min-h-11 rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] disabled:opacity-60" disabled={pending || draftSources.length !== state.entrantCount} onClick={confirmBracket} type="button">{pending ? "กำลังยืนยัน..." : "ยืนยันการจัดสาย"}</button></> : <div className="mt-5 grid gap-4">{rounds.map((round, index) => {
      const previous = rounds[index - 1];
      const current = currentRound?.roundIndex === round.roundIndex;
      if (round.complete || (current && round.matches.length === round.nodes.length)) return <KnockoutRoundMatches current={current} key={round.roundIndex} matches={round.matches as CompetitionKnockoutMatchV2[]} onSave={saveMatch} roundComplete={round.complete} roundLabel={round.label} teamsById={teamsById} />;
      return <section className="rounded-md border border-slate-200 bg-white p-4" key={round.roundIndex}><h4 className="text-lg font-black text-[#061426]">{round.label}</h4>{current ? <><p className="mt-1 text-sm font-semibold text-slate-600">ทีมพร้อมแล้ว กรุณาสร้างโปรแกรมการแข่งขันรอบนี้</p><button className="mt-3 min-h-10 rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] disabled:opacity-60" disabled={pending} onClick={() => createFixtures(round.roundIndex, round.label)} type="button">{pending ? "กำลังสร้าง..." : `สร้างโปรแกรม${round.label}`}</button></> : <><p className="mt-1 text-sm font-semibold text-slate-600">รอผลการแข่งขัน${previous?.label ?? "รอบก่อนหน้า"}</p><p className="mt-1 text-xs font-bold text-slate-500">{round.nodes.length} คู่ รอผู้ชนะจากรอบก่อน</p></>}</section>;
    })}</div>}
  </section>;
}

function CouncilChampions({ competitionId, competitionStatus, teamsById }: { competitionId: string; competitionStatus: string | null; teamsById: Map<string, { id: string; logo_url: string | null; name: string; short_name: string | null }> }) {
  const router = useRouter();
  const [division1, setDivision1] = useState<CouncilBracketState | null>(null);
  const [division2, setDivision2] = useState<CouncilBracketState | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    let active = true;
    const load = () => { void Promise.all([getCouncilBracketStateV2(competitionId, "division_1"), getCouncilBracketStateV2(competitionId, "division_2")]).then(([d1, d2]) => { if (!active) return; if (d1.ok && "nodes" in d1) setDivision1(d1); if (d2.ok && "nodes" in d2) setDivision2(d2); }); };
    load();
    window.addEventListener("council-bracket-updated", load);
    return () => { active = false; window.removeEventListener("council-bracket-updated", load); };
  }, [competitionId]);
  const champion = (state: CouncilBracketState | null) => state?.championTeamId ? teamsById.get(state.championTeamId) : undefined;
  const championDate = (state: CouncilBracketState | null) => state?.championAt ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(state.championAt)) : "";
  const d1Champion = champion(division1);
  const d2Champion = champion(division2);
  const ready = Boolean(d1Champion && d2Champion);
  function complete() { if (!ready || !window.confirm(`ปิดการแข่งขันโดยยืนยันแชมป์ Division 1: ${d1Champion?.name} และ Division 2: ${d2Champion?.name}?`)) return; setError(""); startTransition(async () => { const result = await completeCouncilCupCompetitionV2(competitionId); if (!result.ok) return setError(result.error ?? "ไม่สามารถปิดการแข่งขันได้"); router.refresh(); }); }
  return <section className="mt-6 min-w-0 scroll-mt-28 rounded-lg border border-slate-200 bg-white p-4 sm:p-5" id="cup-champion"><h3 className="text-xl font-black text-[#061426]">Champion</h3><div className="mt-4 grid gap-3 sm:grid-cols-2"><article className="rounded-md border border-blue-200 bg-blue-50/30 p-3"><p className="text-xs font-black text-blue-900">Champion Division 1</p><p className="mt-1 text-lg font-black text-[#061426]">{d1Champion?.name ?? "รอผลรอบชิงชนะเลิศ"}</p>{d1Champion ? <p className="mt-1 text-xs font-bold text-blue-800">ได้แชมป์: {championDate(division1)}</p> : null}</article><article className="rounded-md border border-emerald-200 bg-emerald-50/30 p-3"><p className="text-xs font-black text-emerald-900">Champion Division 2</p><p className="mt-1 text-lg font-black text-[#061426]">{d2Champion?.name ?? "รอผลรอบชิงชนะเลิศ"}</p>{d2Champion ? <p className="mt-1 text-xs font-bold text-emerald-800">ได้แชมป์: {championDate(division2)}</p> : null}</article></div><div className="mt-4 flex flex-wrap gap-2 text-xs font-black"><span className={d1Champion ? "rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-blue-900" : "rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-500"}>Champion D1 {d1Champion ? "✓" : "รอผล"}</span><span className={d2Champion ? "rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-900" : "rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-500"}>Champion D2 {d2Champion ? "✓" : "รอผล"}</span></div>{error ? <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800">{error}</p> : null}{ready && competitionStatus !== "completed" ? <div className="mt-4 flex flex-wrap items-center gap-3"><span className="rounded-full border border-[#d8ad45]/40 bg-[#fff7e6] px-3 py-1.5 text-sm font-black text-[#8a6418]">พร้อมปิดการแข่งขัน</span><button className="min-h-11 rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] disabled:opacity-60" disabled={pending} onClick={complete} type="button">ตรวจสอบและปิดการแข่งขัน</button></div> : null}{competitionStatus === "completed" ? <span className="mt-4 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-black text-emerald-800">Completed · การแข่งขันเสร็จสิ้น</span> : null}</section>;
}

export function AdminCompetitionTreeEngineV2({
  bracketCapacity,
  competitionId,
  competitionStatus,
  configReady,
  entryMode,
  initialMatches,
  initialSummary,
  nodes,
  qualificationApproved,
  qualificationSnapshot,
  groupNames,
  teams,
  templateKey,
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
  const [competitionCompleted, setCompetitionCompleted] = useState(competitionStatus === "completed");
  const isCompetitionCompleted = competitionCompleted || competitionStatus === "completed";
  const [localNodeLinks, setLocalNodeLinks] = useState<Record<string, string>>({});
  const [activeCardId, setActiveCardId] = useState("");
  const qualifiedSources = useMemo<KswQualificationSource[]>(() => {
    const groupsById = new Map(groupNames.map((group) => [group.id, group.name]));
    const teamsById = new Map(teams.map((team) => [team.id, team.name]));
    return qualificationSnapshot.map((source) => ({
      ...source,
      label: source.type === "best_ranked"
        ? `อันดับเพิ่มเติม #${source.bestOrder ?? "?"}`
        : `${groupsById.get(source.groupId ?? "") ?? "กลุ่ม"}${source.rank ?? "?"}`,
      teamName: source.teamId ? teamsById.get(source.teamId) : undefined,
    }));
  }, [groupNames, qualificationSnapshot, teams]);
  const templateValidation = useMemo(
    () => new Map(listKnockoutTemplates().map((template) => [template.key, validateKnockoutTemplateSources(template.key, qualifiedSources)])),
    [qualifiedSources],
  );
  const [selectedTemplate, setSelectedTemplate] = useState<KnockoutTemplateKey | null>(templateKey);
  const [councilState, setCouncilState] = useState<CouncilDivisionState | null>(null);
  const [councilPreflight, setCouncilPreflight] = useState<CouncilTemplatePreflightResult | null>(null);
  const [councilExtras, setCouncilExtras] = useState<CouncilDivisionExtraSelections>({ division1: [], division2: [] });
  const [templateSelectionOpen, setTemplateSelectionOpen] = useState(false);
  const selectedTemplateDefinition = selectedTemplate ? getKnockoutTemplate(selectedTemplate) : undefined;
  const defaultPairing = useMemo(
    () => selectedTemplateDefinition ? buildKnockoutTemplatePreview(selectedTemplateDefinition.key, qualifiedSources) : null,
    [qualifiedSources, selectedTemplateDefinition],
  );
  const [draftSources, setDraftSources] = useState<KswQualificationSource[]>(() => (defaultPairing?.sources as KswQualificationSource[] | undefined) ?? []);
  const [editingPairing, setEditingPairing] = useState(false);
  const activeCardRef = useRef("");
  const summary = generatedSummary ?? initialSummary;
  const status = currentWorkflow?.status ?? "draft";
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const visibleKnockoutMatches = useMemo(() => {
    const matchesById = new Map(initialMatches.map((match) => [match.id, match]));
    knockoutMatches.forEach((match) => matchesById.set(match.id, match));
    return Array.from(matchesById.values());
  }, [initialMatches, knockoutMatches]);
  const effectiveNodes = useMemo(
    () => nodes.map((node) => localNodeLinks[node.id] ? { ...node, linkedMatchId: localNodeLinks[node.id] } : node),
    [localNodeLinks, nodes],
  );
  const templateSwitchGuard = getKnockoutTemplateSwitchGuard({
    derivedSources: qualificationSnapshot,
    matches: visibleKnockoutMatches.map((match) => ({ status: match.status, winnerTeamId: match.winner_team_id })),
    nodes: effectiveNodes,
  });
  const knockoutRounds = useMemo<KnockoutRoundView[]>(() => {
    const matchesById = new Map(visibleKnockoutMatches.map((match) => [match.id, match]));
    const grouped = new Map<number, CompetitionTreeNode[]>();
    effectiveNodes.forEach((node) => grouped.set(node.roundIndex, [...(grouped.get(node.roundIndex) ?? []), node]));
    return Array.from(grouped.entries())
      .sort(([roundA], [roundB]) => roundA - roundB)
      .map(([roundIndex, roundNodes]) => {
        const matches = roundNodes.flatMap((node) => node.linkedMatchId ? [matchesById.get(node.linkedMatchId)].filter((match): match is CompetitionKnockoutMatchV2 => Boolean(match)) : []);
        return {
          allMatchesReady: matches.length === roundNodes.length,
          complete: roundNodes.length > 0 && roundNodes.every((node) => {
            const match = node.linkedMatchId ? matchesById.get(node.linkedMatchId) : undefined;
            return match?.status === "finished" && Boolean(match.winner_team_id);
          }),
          label: knockoutRoundTitle(roundNodes[0]?.roundLabel ?? `Round ${roundIndex + 1}`),
          matches,
          nodes: roundNodes,
          roundIndex,
        };
      });
  }, [effectiveNodes, visibleKnockoutMatches]);
  const currentRoundIndex = knockoutRounds.find((round) => !round.complete)?.roundIndex ?? null;
  const currentRound = knockoutRounds.find((round) => round.roundIndex === currentRoundIndex);
  const statusLabel = status === "fixtures_created" && currentRound
    ? { en: "Current round", th: currentRound.allMatchesReady ? `กำลังแข่งขัน${currentRound.label}` : `พร้อมสร้างโปรแกรม${currentRound.label}` }
    : competitionEngineV2StatusLabel(status);
  const champion = useMemo(() => {
    const finalNode = [...effectiveNodes].sort((a, b) => b.roundIndex - a.roundIndex || b.matchOrder - a.matchOrder)[0];
    const finalMatch = finalNode?.linkedMatchId ? visibleKnockoutMatches.find((match) => match.id === finalNode.linkedMatchId) : undefined;
    return finalMatch?.status === "finished" && finalMatch.winner_team_id ? teamsById.get(finalMatch.winner_team_id) : undefined;
  }, [effectiveNodes, teamsById, visibleKnockoutMatches]);
  const previewMatches = useMemo(() => {
    if (!configReady || !bracketCapacity || !draftSources.length) return [];
    try {
      const preview = buildCompetitionTree({
        bracketCapacity,
        competitionId,
        entrantCount: draftSources.length,
        entryMode,
        entrants: draftSources,
        idFactory: () => crypto.randomUUID(),
      });
      const firstRound = Math.min(...preview.nodes.map((node) => node.roundIndex));
      return preview.nodes.filter((node) => node.roundIndex === firstRound);
    } catch {
      return [];
    }
  }, [bracketCapacity, competitionId, configReady, draftSources, entryMode]);

  useEffect(() => {
    if (!activeCardId) return;
    const element = document.getElementById(activeCardId);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) element.scrollIntoView({ block: "center" });
  }, [activeCardId, knockoutMatches]);

  useEffect(() => {
    if (!configReady || !qualificationApproved || (status !== "reviewed" && status !== "fixtures_created")) return;
    let active = true;
    void previewCompetitionFixturesV2(competitionId).then((result) => {
      if (active) setFixtureResult(result);
    });
    return () => {
      active = false;
    };
  }, [competitionId, configReady, qualificationApproved, status]);

  useEffect(() => {
    if (selectedTemplate !== "council_two_division" || !qualificationApproved) return;
    let active = true;
    void getCouncilDivisionStateV2(competitionId).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setError(result.error ?? "ไม่สามารถโหลดข้อมูลการแบ่งดิวิชั่น");
        return;
      }
      setCouncilState(result.state ?? null);
      setCouncilExtras({ division1: result.state?.recommendedDivision1ExtraTeamIds ?? [], division2: result.state?.recommendedDivision2ExtraTeamIds ?? [] });
    });
    return () => { active = false; };
  }, [competitionId, qualificationApproved, selectedTemplate]);

  useEffect(() => {
    if (selectedTemplate !== "council_two_division") return;
    let active = true;
    void getCouncilTemplatePreflightV2(competitionId).then((result) => {
      if (active) setCouncilPreflight(result);
    });
    return () => { active = false; };
  }, [competitionId, selectedTemplate]);

  function generateTree() {
    setError("");
    setMessage("");
    startTransition(async () => {
      const result = await generateCompetitionTreeV2(competitionId, draftSources);
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

  function chooseTemplate(templateKey: KnockoutTemplateKey) {
    const template = getKnockoutTemplate(templateKey);
    if (!template?.enabled) return;
    setError("");
    setMessage("");
    startTransition(async () => {
      const result = await selectCompetitionKnockoutTemplateV2(competitionId, templateKey);
      if (!result.ok) {
        setError(result.error ?? "ไม่สามารถเลือกรูปแบบการแข่งขันได้");
        return;
      }
      setSelectedTemplate(templateKey);
      setCouncilState(null);
      setCouncilPreflight(null);
      setCouncilExtras({ division1: [], division2: [] });
      setTemplateSelectionOpen(false);
      setDraftSources(buildKnockoutTemplatePreview(template.key, qualifiedSources).sources as KswQualificationSource[]);
      setEditingPairing(false);
      setMessage(`เลือก ${template.name} แล้ว`);
      router.refresh();
    });
  }

  function saveCouncilDraft() {
    setError("");
    startTransition(async () => {
      const result = await saveCouncilDivisionDraftV2(competitionId, councilExtras);
      if (!result.ok) return setError(result.error ?? "ไม่สามารถบันทึกร่างการแบ่งดิวิชั่น");
      setCouncilState(result.state ?? null);
      setMessage("บันทึกร่างการแบ่งดิวิชั่นแล้ว");
      router.refresh();
    });
  }

  function approveCouncilDivisions() {
    setError("");
    startTransition(async () => {
      const result = await approveCouncilDivisionsV2(competitionId, councilExtras);
      if (!result.ok) return setError(result.error ?? "ไม่สามารถยืนยันการแบ่งดิวิชั่น");
      setCouncilState(result.state ?? null);
      setMessage("อนุมัติการแบ่งดิวิชั่นแล้ว พร้อมจัดสายแยกในขั้นถัดไป");
      router.refresh();
    });
  }

  function reopenCouncilDivisions() {
    if (!window.confirm("เปิดการแบ่งดิวิชั่นเพื่อแก้ไข? ยังไม่มีการสร้างสายหรือแมตช์ของทั้งสองดิวิชั่น")) return;
    setError("");
    startTransition(async () => {
      const result = await reopenCouncilDivisionsV2(competitionId);
      if (!result.ok) return setError(result.error ?? "ไม่สามารถเปิดการแบ่งดิวิชั่นเพื่อแก้ไข");
      setCouncilState(result.state ?? null);
      setCouncilExtras({ division1: result.state?.recommendedDivision1ExtraTeamIds ?? [], division2: result.state?.recommendedDivision2ExtraTeamIds ?? [] });
      setMessage("เปิดการแบ่งดิวิชั่นเพื่อแก้ไขแล้ว");
      router.refresh();
    });
  }

  function openTemplateSelection() {
    if (!templateSwitchGuard.allowed) {
      setError(templateSwitchGuard.reason ?? "เปลี่ยนรูปแบบการแข่งขันไม่ได้");
      return;
    }
    if (!window.confirm("เปลี่ยนรูปแบบการแข่งขัน? โครงร่างรอบน็อกเอาต์ที่ยังไม่มีคู่แข่งขันจะถูกล้างเมื่อยืนยันรูปแบบใหม่")) return;
    setError("");
    setMessage("");
    setTemplateSelectionOpen(true);
  }

  function sourceKey(source: CompetitionTreeSource) {
    return `${source.type}:${source.teamId ?? ""}:${source.groupId ?? ""}:${source.rank ?? ""}:${source.bestOrder ?? ""}`;
  }

  function selectSource(currentSourceKey: string, replacementSourceKey: string) {
    const currentIndex = draftSources.findIndex((source) => sourceKey(source) === currentSourceKey);
    const replacementIndex = draftSources.findIndex((source) => sourceKey(source) === replacementSourceKey);
    if (currentIndex < 0 || replacementIndex < 0 || currentIndex === replacementIndex) return;
    setDraftSources((current) => current.map((source, index) => index === currentIndex ? current[replacementIndex] : index === replacementIndex ? current[currentIndex] : source));
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

  function createFixtures(roundIndex: number, roundLabel: string) {
    setError("");
    setMessage("");
    startTransition(async () => {
      const result = await createCompetitionFixturesV2(competitionId, roundIndex);
      setFixtureResult(result);
      if (!result.ok) {
        setError(result.error ?? result.errors[0] ?? "Could not create knockout fixtures.");
        return;
      }
      if (!result.matches || !result.roundMatches || !result.linkedNodes || result.roundMatches.length !== result.linkedNodes.length) {
        setError("สร้างโปรแกรมแล้ว แต่ไม่สามารถโหลดคู่แข่งขันของรอบนี้ได้");
        return;
      }
      setKnockoutMatches(result.matches);
      setLocalNodeLinks((current) => ({
        ...current,
        ...Object.fromEntries(result.linkedNodes!.map((link) => [link.nodeId, link.matchId])),
      }));
      setCurrentWorkflow((current) => current ? { ...current, hasLinkedMatches: result.linkedCount > 0, status: result.status ?? current.status } : current);
      setMessage(result.createdCount ? `สร้างโปรแกรม${roundLabel} ${result.createdCount} คู่แล้ว` : `โปรแกรม${roundLabel} ถูกสร้างไว้แล้ว`);
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

  function completeCompetition() {
    if (!champion) return;
    if (!window.confirm(`ตรวจสอบผลแล้วปิดการแข่งขัน โดยประกาศ ${champion.name} เป็นแชมป์?`)) return;
    setError("");
    setMessage("");
    startTransition(async () => {
      const result = await completeCupCompetitionV2(competitionId);
      if (!result.ok) {
        setError(result.error ?? "ไม่สามารถปิดการแข่งขันได้");
        return;
      }
      setCompetitionCompleted(true);
      setMessage(`ปิดการแข่งขันแล้ว · แชมป์: ${champion.name}`);
      router.refresh();
    });
  }

  if (selectedTemplate === "council_two_division" && qualificationApproved && !templateSelectionOpen) {
    const groupsById = new Map(groupNames.map((group) => [group.id, group.name]));
    return (
      <section className="mx-auto w-full max-w-7xl scroll-mt-28 px-4 pb-8 sm:px-6 lg:px-10" id="cup-knockout">
        <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-black text-[#061426]">จัดการแข่งขันรอบน็อกเอาต์</h2><p className="mt-1 text-sm font-semibold text-slate-600">Council Cup – Two Division</p><div className="mt-3 flex flex-wrap gap-2"><a className="inline-flex min-h-10 items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-black text-[#061426]" href="#cup-workspace-nav">กลับเมนูลัด</a><button className="min-h-10 rounded-md border border-[#d8ad45] bg-white px-3 py-2 text-sm font-black text-[#8a6418]" onClick={openTemplateSelection} type="button">เปลี่ยนรูปแบบการแข่งขัน</button></div></div><span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-900">สองดิวิชั่น · สองแชมป์</span></div>
          <CouncilDivisionApproval error={error} extras={councilExtras} onApprove={approveCouncilDivisions} onExtrasChange={setCouncilExtras} onReopen={reopenCouncilDivisions} onSaveDraft={saveCouncilDraft} pending={isPending} state={councilState} />
          {councilState?.approvalStatus === "approved" ? <><CouncilPartitionBracket competitionId={competitionId} groupsById={groupsById} partitionKey="division_1" teamsById={teamsById} /><CouncilPartitionBracket competitionId={competitionId} groupsById={groupsById} partitionKey="division_2" teamsById={teamsById} /><CouncilChampions competitionId={competitionId} competitionStatus={competitionStatus} teamsById={teamsById} /></> : null}
        </article>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-7xl scroll-mt-28 px-4 pb-10 sm:px-6 lg:px-10" id="cup-knockout">
      <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10">
        <div className="mb-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-2xl font-black text-[#061426]">จัดการแข่งขันรอบน็อกเอาต์</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              Knockout Competition Management
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className="inline-flex min-h-10 items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-black text-[#061426]" href="#cup-workspace-nav">กลับเมนูลัด</a>
              {selectedTemplate === "ksw_standard" ? <button className="min-h-10 rounded-md border border-[#d8ad45] bg-white px-3 py-2 text-sm font-black text-[#8a6418]" onClick={openTemplateSelection} type="button">เปลี่ยนรูปแบบการแข่งขัน</button> : null}
            </div>
            <KnockoutStateDiagnostic matches={visibleKnockoutMatches} nodes={effectiveNodes} qualificationSnapshot={qualificationSnapshot} templateKey={selectedTemplate} />
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

        {!qualificationApproved ? (
          <p className="mt-4 rounded-md border border-[#8a6418]/25 bg-[#fff7e6] px-3 py-2 text-sm font-bold text-[#8a6418]">
            รอตรวจสอบและยืนยันทีมผ่านเข้ารอบก่อนตั้งค่ารอบน็อกเอาต์
          </p>
        ) : !configReady ? (
          <p className="mt-4 rounded-md border border-[#8a6418]/25 bg-[#fff7e6] px-3 py-2 text-sm font-bold text-[#8a6418]">
            ยังไม่ได้ตั้งค่ารอบน็อกเอาต์
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

        {configReady && (!summary || templateSelectionOpen) ? (
          <>
            <section className="mt-5 min-w-0 rounded-md border border-slate-200 bg-white p-4">
              <div>
                <h3 className="font-black text-[#061426]">เลือกรูปแบบการแข่งขันรอบน็อกเอาต์</h3>
                <p className="mt-1 text-sm font-semibold text-slate-600">เลือกรูปแบบก่อนตรวจสอบตัวอย่างและยืนยันการจัดสาย</p>
              </div>
              <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
                {listKnockoutTemplates().map((template) => {
                  const selected = selectedTemplate === template.key;
                  const validation = templateValidation.get(template.key);
                  const selectable = template.enabled;
                  const className = `min-w-0 rounded-md border p-4 text-left ${selectable ? "transition hover:border-[#d8ad45] disabled:cursor-wait disabled:opacity-60" : "border-dashed opacity-75"} ${selected ? "border-[#d8ad45] bg-[#fffdf7] ring-1 ring-[#d8ad45]/30" : "border-slate-200 bg-white"}`;
                  const statusLabel = selected ? "เลือกแล้ว" : template.statusLabel;
                  const content = <><div className="flex flex-wrap items-start justify-between gap-2"><span className="text-base font-black text-[#061426]">{template.name}</span><span className={`rounded-full border px-2 py-1 text-[11px] font-black ${selectable ? "border-[#d8ad45]/40 bg-white text-[#8a6418]" : "border-slate-200 bg-white text-slate-600"}`}>{statusLabel}</span></div><p className="mt-2 text-sm font-semibold text-slate-600">{template.description}</p>{!validation?.valid ? <p className="mt-2 text-xs font-bold leading-5 text-slate-500">เลือกได้ทันที · สร้างสายเมื่อ {validation?.errors[0]}</p> : null}<div className="mt-3 flex flex-wrap gap-1.5">{template.featureBullets.map((feature) => <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-black text-slate-600" key={feature}>{feature}</span>)}</div><TemplateMiniDiagram diagram={template.diagram} /></>;
                  return selectable ? <button aria-pressed={selected} className={className} disabled={isPending} key={template.key} onClick={() => chooseTemplate(template.key)} type="button">{content}</button> : <article className={className} data-disabled="true" key={template.key}>{content}</article>;
                })}
              </div>
            </section>
            {selectedTemplate === "council_two_division" && qualificationApproved ? <><CouncilDivisionApproval error={error} extras={councilExtras} onApprove={approveCouncilDivisions} onExtrasChange={setCouncilExtras} onReopen={reopenCouncilDivisions} onSaveDraft={saveCouncilDraft} pending={isPending} state={councilState} />{councilPreflight && !councilPreflight.ok ? <section className="mt-5 min-w-0 rounded-md border border-[#8a6418]/25 bg-[#fff7e6] p-4"><p className="font-black text-[#8a6418]">{councilPreflight.message}</p>{councilPreflight.missingRequirements.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-semibold text-slate-700">{councilPreflight.missingRequirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul> : null}</section> : null}</> : selectedTemplate === "council_two_division" ? <section className="mt-5 min-w-0 rounded-md border border-[#d8ad45]/40 bg-[#fffdf7] p-4"><h3 className="font-black text-[#061426]">เลือกคัพสภา – สองดิวิชั่นแล้ว</h3><p className="mt-1 text-sm font-semibold text-slate-600">ยังสร้างโครงสร้างการแข่งขันไม่ได้จนกว่าข้อมูลด้านล่างจะพร้อม</p>{councilPreflight ? councilPreflight.ok ? <p className="mt-3 text-sm font-bold text-emerald-800">{councilPreflight.message}</p> : <div className="mt-3 rounded-md border border-[#8a6418]/25 bg-white px-3 py-3 text-sm font-semibold text-slate-700"><p className="font-black text-[#8a6418]">{councilPreflight.message}</p>{councilPreflight.missingRequirements.length ? <ul className="mt-2 list-disc space-y-1 pl-5">{councilPreflight.missingRequirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul> : null}</div> : <p className="mt-3 text-sm font-semibold text-slate-600">กำลังตรวจสอบความพร้อมของข้อมูล</p>}</section> : selectedTemplate === "ksw_standard" && selectedTemplateDefinition && defaultPairing ? <section className="mt-5 min-w-0 rounded-md border border-[#d8ad45]/40 bg-[#fffdf7] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="font-black text-[#061426]">ตัวอย่างการจัดสาย: {selectedTemplateDefinition.name}</h3><p className="mt-1 text-sm font-semibold text-slate-600">{selectedTemplateDefinition.description}</p></div>
              <div className="flex flex-wrap gap-2"><button className="min-h-10 rounded-md border border-[#d8ad45] bg-white px-3 py-2 text-sm font-black text-[#8a6418]" onClick={() => setDraftSources(defaultPairing.sources)} type="button">ใช้การจัดสายอัตโนมัติ</button><button className="min-h-10 rounded-md border border-[#d8ad45] bg-white px-3 py-2 text-sm font-black text-[#8a6418]" onClick={() => setEditingPairing((current) => !current)} type="button">{editingPairing ? "ดูตัวอย่างคู่" : "แก้ไขคู่ก่อนยืนยัน"}</button></div>
            </div>
            <TemplateMiniDiagram diagram={selectedTemplateDefinition.diagram} />
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {previewMatches.map((match, index) => (
                <div className="min-w-0 rounded-md border border-slate-200 bg-white p-3" key={`${match.roundIndex}-${match.matchOrder}`}>
                  <p className="text-xs font-black text-[#8a6418]">คู่ที่ {index + 1}</p>
                  {editingPairing ? <div className="mt-2 grid gap-2">{([match.homeSource, match.awaySource] as CompetitionTreeSource[]).map((source, side) => source.type === "bye" ? <p className="rounded border border-slate-200 bg-slate-50 px-2 py-2 text-sm font-bold" key={`${side}-bye`}>Bye</p> : <select aria-label={`${side === 0 ? "ทีมเหย้า" : "ทีมเยือน"}คู่ที่ ${index + 1}`} className="min-h-10 min-w-0 rounded border border-slate-200 px-2 text-sm font-bold" key={side} onChange={(event) => selectSource(sourceKey(source), event.target.value)} value={sourceKey(source)}>{draftSources.map((candidate) => <option key={sourceKey(candidate)} value={sourceKey(candidate)}>{selectedTemplateDefinition.sourceLabel(candidate)}{candidate.teamName ? ` - ${candidate.teamName}` : ""}</option>)}</select>)}<span className="-order-1 text-center text-xs font-black text-slate-500">พบ</span></div> : <><p className="mt-2 break-words text-sm font-black text-[#061426]">{selectedTemplateDefinition.sourceLabel(match.homeSource)}{match.homeSource.teamId ? ` - ${teamsById.get(match.homeSource.teamId)?.name ?? "รอผล"}` : ""} พบ {match.awaySource.type === "bye" ? "Bye" : `${selectedTemplateDefinition.sourceLabel(match.awaySource)}${match.awaySource.teamId ? ` - ${teamsById.get(match.awaySource.teamId)?.name ?? "รอผล"}` : ""}`}</p><p className="mt-1 text-xs font-semibold text-slate-600">{selectedTemplateDefinition.pairExplanation(match.homeSource, match.awaySource)}</p></>}
                </div>
              ))}
            </div>
            </section> : null}
          </>
        ) : null}

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {selectedTemplate === "ksw_standard" && canGenerateTree(status) ? (
            <button
              className="min-h-11 rounded-md bg-[#061426] px-5 py-3 text-sm font-black text-[#f4d58a] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!configReady || !qualificationApproved || isPending}
              onClick={generateTree}
              type="button"
            >
              {isPending ? "กำลังสร้าง..." : summary ? "ตรวจสอบโครงสร้างการแข่งขัน" : "ยืนยันการจัดสาย"}
            </button>
          ) : null}
          {selectedTemplate === "ksw_standard" && canReviewTree(status) && currentWorkflow?.hasValidTree ? (
            <button
              className="min-h-11 rounded-md border border-[#d8ad45] bg-[#fff7e6] px-5 py-3 text-sm font-black text-[#8a6418] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!qualificationApproved || isPending}
              onClick={reviewTree}
              type="button"
            >
              ยืนยันโครงสร้างการแข่งขัน
            </button>
          ) : null}
          {selectedTemplate === "ksw_standard" && status === "reviewed" ? (
            <button
              className="min-h-11 rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-black text-[#061426] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!qualificationApproved || isPending}
              onClick={reopenTree}
              type="button"
            >
              กลับไปแก้ไขโครงสร้าง
            </button>
          ) : null}
        </div>

        {fixtureResult?.errors.length ? <p className="mt-4 rounded-md border border-[#9b1c1f]/25 bg-[#9b1c1f]/10 px-3 py-2 text-sm font-bold text-[#9b1c1f]">{fixtureResult.errors.join(" ")}</p> : null}

        {error ? <p className="mt-4 rounded-md border border-[#9b1c1f]/25 bg-[#9b1c1f]/10 px-3 py-2 text-sm font-bold text-[#9b1c1f]">{error}</p> : null}
        {message ? <p className="mt-4 rounded-md border border-emerald-700/20 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{message}</p> : null}

        {knockoutRounds.length ? (
          <div className="mt-6 grid gap-5">
            {knockoutRounds.map((round, index) => {
              const current = round.roundIndex === currentRoundIndex;
              const previousRound = knockoutRounds[index - 1];
              if (round.complete || (current && round.allMatchesReady)) {
                return <KnockoutRoundMatches current={current} key={`${round.roundIndex}-${round.complete ? "complete" : "active"}`} matches={round.matches} onSave={saveMatch} roundComplete={round.complete} roundLabel={round.label} teamsById={teamsById} />;
              }
              return (
                <section className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4" key={round.roundIndex}>
                  <h3 className="text-xl font-black text-[#061426]">{round.label}</h3>
                  {current ? <><p className="mt-2 text-sm font-bold text-slate-600">ทีมในรอบนี้พร้อมแล้ว กรุณาสร้างโปรแกรมการแข่งขัน</p><button className="mt-3 min-h-11 rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] disabled:cursor-not-allowed disabled:opacity-60" disabled={isPending} onClick={() => createFixtures(round.roundIndex, round.label)} type="button">{isPending ? "กำลังสร้าง..." : `สร้างโปรแกรม${round.label}`}</button></> : <><p className="mt-2 text-sm font-bold text-slate-600">{`รอผลการแข่งขัน${previousRound ? previousRound.label : "รอบก่อนหน้า"}`}</p><p className="mt-1 text-xs font-semibold text-slate-500">{round.nodes.length} คู่ รอผู้ชนะจากรอบก่อน</p></>}
                </section>
              );
            })}
          </div>
        ) : summary ? (
          <p className="mt-5 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-600">เมื่อทีมผ่านเข้ารอบพร้อม ระบบจะแสดงคู่แข่งขันในส่วนนี้</p>
        ) : null}
        <section className="mt-6 scroll-mt-28 rounded-lg border border-[#d8ad45]/35 bg-[#fff7e6] p-4" id="cup-champion">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8a6418]">Champion</p>
          <p className="mt-1 text-xl font-black text-[#061426]">{champion?.name ?? "รอผลการแข่งขันรอบชิงชนะเลิศ"}</p>
          {champion && !isCompetitionCompleted ? <div className="mt-3 flex flex-wrap items-center gap-3"><span className="rounded-full border border-[#d8ad45]/40 bg-white px-3 py-1.5 text-sm font-black text-[#8a6418]">พร้อมปิดการแข่งขัน</span><button className="min-h-11 rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] disabled:opacity-60" disabled={isPending} onClick={completeCompetition} type="button">ตรวจสอบและปิดการแข่งขัน</button></div> : null}
          {isCompetitionCompleted ? <span className="mt-3 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-black text-emerald-800">การแข่งขันเสร็จสิ้น</span> : null}
        </section>
      </article>
    </section>
  );
}

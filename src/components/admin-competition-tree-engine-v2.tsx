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
} from "@/app/admin/competitions/[id]/competition-engine-v2-actions";
import type { CompetitionFixturesV2Result, CompetitionKnockoutMatchV2 } from "@/app/admin/competitions/[id]/competition-engine-v2-actions";
import {
  canGenerateTree,
  canReviewTree,
  competitionEngineV2StatusLabel,
  type CompetitionEngineV2Integrity,
} from "@/lib/competition-engine-v2-state";
import { buildCompetitionTree, type CompetitionTreeEntryMode, type CompetitionTreeNode, type CompetitionTreeSource, type CompetitionTreeSummary } from "@/lib/competition-tree";
import { buildKnockoutTemplatePreview, getDefaultKnockoutTemplate, getKnockoutTemplate, listKnockoutTemplates } from "@/lib/knockout-templates/registry";
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
  const [selectedTemplate, setSelectedTemplate] = useState<KnockoutTemplateKey>(getDefaultKnockoutTemplate().key);
  const selectedTemplateDefinition = getKnockoutTemplate(selectedTemplate) ?? getDefaultKnockoutTemplate();
  const defaultPairing = useMemo(() => buildKnockoutTemplatePreview(selectedTemplateDefinition.key, qualifiedSources), [qualifiedSources, selectedTemplateDefinition.key]);
  const [draftSources, setDraftSources] = useState<KswQualificationSource[]>(() => defaultPairing.sources as KswQualificationSource[]);
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
    setSelectedTemplate(templateKey);
    setDraftSources(buildKnockoutTemplatePreview(template.key, qualifiedSources).sources as KswQualificationSource[]);
    setEditingPairing(false);
    setError("");
    setMessage(`เลือก ${template.name} แล้ว ตรวจสอบตัวอย่างคู่แข่งขันก่อนยืนยันการจัดสาย`);
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
            <a className="mt-3 inline-flex min-h-10 items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-black text-[#061426]" href="#cup-workspace-nav">กลับเมนูลัด</a>
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

        {qualificationApproved && !summary && qualifiedSources.length ? (
          <>
            <section className="mt-5 min-w-0 rounded-md border border-slate-200 bg-white p-4">
              <div>
                <h3 className="font-black text-[#061426]">เลือกรูปแบบการแข่งขันรอบน็อกเอาต์</h3>
                <p className="mt-1 text-sm font-semibold text-slate-600">เลือกรูปแบบก่อนตรวจสอบตัวอย่างและยืนยันการจัดสาย</p>
              </div>
              <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
                {listKnockoutTemplates().map((template) => {
                  const selected = selectedTemplate === template.key;
                  const className = `min-w-0 rounded-md border p-4 text-left ${template.enabled ? "transition" : "border-dashed opacity-75"} ${selected ? "border-[#d8ad45] bg-[#fffdf7] ring-1 ring-[#d8ad45]/30" : "border-slate-200 bg-white"}`;
                  const content = <><div className="flex flex-wrap items-start justify-between gap-2"><span className="text-base font-black text-[#061426]">{template.name}</span><span className={`rounded-full border px-2 py-1 text-[11px] font-black ${template.enabled ? "border-[#d8ad45]/40 bg-white text-[#8a6418]" : "border-slate-200 bg-white text-slate-600"}`}>{template.statusLabel}</span></div><p className="mt-2 text-sm font-semibold text-slate-600">{template.description}</p><div className="mt-3 flex flex-wrap gap-1.5">{template.featureBullets.map((feature) => <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-black text-slate-600" key={feature}>{feature}</span>)}</div><TemplateMiniDiagram diagram={template.diagram} /></>;
                  return template.enabled ? <button aria-pressed={selected} className={className} key={template.key} onClick={() => chooseTemplate(template.key)} type="button">{content}</button> : <article className={className} data-disabled="true" key={template.key}>{content}</article>;
                })}
              </div>
            </section>
            <section className="mt-5 min-w-0 rounded-md border border-[#d8ad45]/40 bg-[#fffdf7] p-4">
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
            </section>
          </>
        ) : null}

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {canGenerateTree(status) ? (
            <button
              className="min-h-11 rounded-md bg-[#061426] px-5 py-3 text-sm font-black text-[#f4d58a] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!configReady || !qualificationApproved || isPending}
              onClick={generateTree}
              type="button"
            >
              {isPending ? "กำลังสร้าง..." : summary ? "ตรวจสอบโครงสร้างการแข่งขัน" : "ยืนยันการจัดสาย"}
            </button>
          ) : null}
          {canReviewTree(status) && currentWorkflow?.hasValidTree ? (
            <button
              className="min-h-11 rounded-md border border-[#d8ad45] bg-[#fff7e6] px-5 py-3 text-sm font-black text-[#8a6418] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!qualificationApproved || isPending}
              onClick={reviewTree}
              type="button"
            >
              ยืนยันโครงสร้างการแข่งขัน
            </button>
          ) : null}
          {status === "reviewed" ? (
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

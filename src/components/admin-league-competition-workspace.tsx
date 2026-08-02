"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  confirmStandardLeagueFixtures,
  confirmStandardLeagueMatchweek,
  generateStandardLeagueFixturePreview,
  rescheduleStandardLeagueMatch,
  saveStandardLeagueConfigDraft,
  saveStandardLeagueMatch,
  saveStandardLeagueMatchweekDraft,
} from "@/app/admin/competitions/[id]/league-actions";
import { ActionButton, useActionFeedback } from "@/components/admin-action-feedback";
import type { AdminCompetitionMatch, AdminCompetitionMatchTeam } from "@/components/admin-competition-match-manager";
import { TeamLogo } from "@/components/team-logo";
import { calculateLeagueCompetitionWorkflow, calculateLeagueMatchweekSummary } from "@/lib/league-competition-workflow";
import { calculateLeagueMatchweekReadiness } from "@/lib/league-matchweek-readiness";
import { canEditFinishedLeagueMatch, canRescheduleMatch, isEditingFinishedLeagueMatch, isRescheduledMatch, isSupplementalMatchweek, movedMatchweekCounts, sortRescheduleHistory, validateRescheduleDraft } from "@/lib/league-matchweek-rescheduling";
import { calculateStandardLeagueStandings } from "@/lib/league-template/standings";
import type {
  LeagueFixturePlan,
  StandardLeagueConfig,
  StandardLeagueMatchweek,
  StandardLeagueRescheduleConflict,
  StandardLeagueRescheduleHistory,
} from "@/lib/league-template/types";

type FixtureDraft = { awayTeamId: string; homeTeamId: string; matchDate: string; venue: string };
type RescheduleReason = "organizer" | "other" | "team" | "venue" | "weather";

const venueOptions = ["V1", "V2", "V3"];
const rescheduleReasonLabels: Record<RescheduleReason, string> = {
  organizer: "Organizer decision",
  other: "Other",
  team: "Team request",
  venue: "Venue unavailable",
  weather: "Weather",
};

function toInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function toIso(value: string) {
  return value ? new Date(`${value}:00+07:00`).toISOString() : null;
}

function effectiveWeek(match: AdminCompetitionMatch) {
  if (match.effectiveMatchweek) return match.effectiveMatchweek;
  if (match.originalMatchweek) return match.originalMatchweek;
  if (match.matchweek) return match.matchweek;
  return 0;
}

function nameFor(teams: Map<string, AdminCompetitionMatchTeam>, id: string) {
  return teams.get(id)?.name ?? "รอข้อมูลทีม";
}

function statusLabel(status: StandardLeagueMatchweek["status"]) {
  return ({ completed: "✓ แข่งขันครบแล้ว", confirmed: "✓ ยืนยันคู่แข่งขันแล้ว", draft: "ร่าง", unconfigured: "ยังไม่ได้กำหนด" })[status];
}

function statusClass(status: StandardLeagueMatchweek["status"]) {
  if (status === "completed") return "bg-emerald-100 text-emerald-800";
  if (status === "confirmed") return "bg-blue-100 text-blue-800";
  if (status === "draft") return "bg-amber-100 text-amber-900";
  return "bg-slate-100 text-slate-600";
}

function venueParts(value: string | null) {
  return venueOptions.includes(value ?? "") ? { other: "", value: value ?? "" } : { other: value ?? "", value: value ? "Other" : "" };
}

function formatDateTime(value: string | null) {
  if (!value) return "ยังไม่กำหนดวันเวลา";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function VenueControl({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const parts = venueParts(value || null);
  const [mode, setMode] = useState(parts.value);
  return (
    <div>
      <label className="text-xs font-bold">สนาม
        <select className="mt-1 w-full rounded border p-2" disabled={disabled} onChange={(event) => {
          setMode(event.target.value);
          onChange(event.target.value === "Other" ? (parts.value === "Other" ? parts.other : "") : event.target.value);
        }} value={mode}>
          <option value="">เลือกสนาม</option>
          {venueOptions.map((venue) => <option key={venue} value={venue}>{venue}</option>)}
          <option value="Other">Other</option>
        </select>
      </label>
      {mode === "Other" ? <label className="mt-2 block text-xs font-bold">สนามอื่น<input className="mt-1 w-full rounded border p-2" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={parts.other} /></label> : null}
    </div>
  );
}

function RescheduleHistoryPanel({ history }: { history: StandardLeagueRescheduleHistory[] }) {
  const [open, setOpen] = useState(false);
  if (!history.length) return null;
  const sorted = sortRescheduleHistory(history);
  return (
    <div className="mt-2">
      <button className="text-xs font-bold text-slate-700 underline" onClick={() => setOpen((current) => !current)} type="button">
        {open ? "ซ่อนประวัติการเลื่อน" : "ดูประวัติการเลื่อน"}
      </button>
      {open ? <ol className="mt-2 space-y-2 border-l-2 border-slate-200 pl-3 text-xs text-slate-700">
        {sorted.map((entry) => <li key={entry.id}><p className="font-bold">Matchweek {entry.fromMatchweek} ไป Matchweek {entry.toMatchweek}</p><p>{entry.reason}</p><p className="text-slate-500">{formatDateTime(entry.changedAt)}{entry.changedByLabel ? ` · ${entry.changedByLabel}` : ""}</p></li>)}
      </ol> : null}
    </div>
  );
}

function RescheduleModal({
  competitionId,
  match,
  structuralMaximum,
  teams,
  onClose,
  onSaved,
}: {
  competitionId: string;
  match: AdminCompetitionMatch;
  structuralMaximum: number;
  teams: Map<string, AdminCompetitionMatchTeam>;
  onClose: () => void;
  onSaved: (result: Awaited<ReturnType<typeof rescheduleStandardLeagueMatch>>) => void;
}) {
  const { runAction } = useActionFeedback();
  const currentWeek = effectiveWeek(match);
  const targetWeeks = Array.from(new Set([...Array.from({ length: Math.max(structuralMaximum, 1) }, (_, index) => index + 1), structuralMaximum + 1, structuralMaximum + 2])).filter((week) => week >= 1 && week <= 99);
  const [targetChoice, setTargetChoice] = useState(String(targetWeeks.find((week) => week !== currentWeek) ?? currentWeek));
  const [otherTarget, setOtherTarget] = useState("");
  const [reasonChoice, setReasonChoice] = useState<RescheduleReason>("venue");
  const [otherReason, setOtherReason] = useState("");
  const [acknowledgeConflict, setAcknowledgeConflict] = useState(false);
  const [conflicts, setConflicts] = useState<StandardLeagueRescheduleConflict[]>([]);
  const [error, setError] = useState("");
  const targetMatchweek = targetChoice === "other" ? Number(otherTarget) : Number(targetChoice);
  const reason = reasonChoice === "other" ? otherReason.trim() : rescheduleReasonLabels[reasonChoice];

  const submit = async () => {
    setError("");
    setConflicts([]);
    const validationError = validateRescheduleDraft(currentWeek, targetMatchweek, reason);
    if (validationError) { setError(validationError); return; }
    const result = await runAction({
      errorMessage: (value) => !value.success ? value.error : null,
      id: `league-match-reschedule:${match.id}`,
      loadingMessage: "กำลังเลื่อน…",
      successMessage: "เลื่อนการแข่งขันแล้ว",
    }, () => rescheduleStandardLeagueMatch({ acknowledgeConflict, competitionId, matchId: match.id, reason, targetMatchweek }));
    if (!result) return;
    if (!result.success) {
      if (result.conflict) setConflicts(result.conflicts);
      setError(result.error);
      return;
    }
    onSaved(result);
  };

  return (
    <div aria-modal="true" className="fixed inset-0 z-50 flex items-end bg-slate-950/45 p-3 sm:items-center sm:justify-center" role="dialog">
      <section className="max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-4 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-black text-[#061426]">เลื่อนการแข่งขัน</h3><p className="mt-1 text-sm font-bold">{nameFor(teams, match.home_team_id)} พบ {nameFor(teams, match.away_team_id)}</p></div><button aria-label="ปิด" className="min-h-9 min-w-9 rounded border text-lg" onClick={onClose} type="button">×</button></div>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm"><div className="rounded bg-slate-50 p-2"><dt className="text-xs text-slate-500">Matchweek เดิม</dt><dd className="font-black">{match.originalMatchweek ?? match.matchweek ?? "-"}</dd></div><div className="rounded bg-slate-50 p-2"><dt className="text-xs text-slate-500">Matchweek ปัจจุบัน</dt><dd className="font-black">{currentWeek}</dd></div></dl>
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">Matchweek เป้าหมาย<select className="mt-1 w-full rounded border p-2" onChange={(event) => setTargetChoice(event.target.value)} value={targetChoice}>{targetWeeks.map((week) => <option key={week} value={week}>Matchweek {week}{week > structuralMaximum ? " · นัดตกค้าง / สัปดาห์เพิ่มเติม" : ""}</option>)}<option value="other">Other Matchweek</option></select></label><label className="text-sm font-bold">เหตุผล<select className="mt-1 w-full rounded border p-2" onChange={(event) => setReasonChoice(event.target.value as RescheduleReason)} value={reasonChoice}>{Object.entries(rescheduleReasonLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
        {targetChoice === "other" ? <label className="mt-3 block text-sm font-bold">Other Matchweek<input className="mt-1 w-full rounded border p-2" inputMode="numeric" max="99" min="1" onChange={(event) => setOtherTarget(event.target.value)} type="number" value={otherTarget} /></label> : null}
        {reasonChoice === "other" ? <label className="mt-3 block text-sm font-bold">Other reason<input className="mt-1 w-full rounded border p-2" onChange={(event) => setOtherReason(event.target.value)} value={otherReason} /></label> : null}
        {conflicts.length ? <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-black">พบทีมที่มีโปรแกรมซ้ำใน Matchweek ปลายทาง</p><ul className="mt-2 list-disc space-y-1 pl-5">{conflicts.map((conflict) => <li key={conflict.matchId}>{nameFor(teams, conflict.homeTeamId ?? "")} พบ {nameFor(teams, conflict.awayTeamId ?? "")}</li>)}</ul><label className="mt-3 flex items-start gap-2 font-bold"><input checked={acknowledgeConflict} onChange={(event) => setAcknowledgeConflict(event.target.checked)} type="checkbox" />ยืนยันแม้มีโปรแกรมซ้ำใน Matchweek นี้</label></div> : null}
        {error ? <p className="mt-3 rounded bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2"><button className="rounded border px-3 py-2 text-sm font-bold" onClick={onClose} type="button">ยกเลิก</button><ActionButton actionId={`league-match-reschedule:${match.id}`} className="rounded bg-[#061426] px-3 py-2 text-sm font-black text-[#f4d58a]" loadingLabel="กำลังเลื่อน…" onClick={submit} successLabel="เลื่อนการแข่งขันแล้ว" type="button">ยืนยันการเลื่อนการแข่งขัน</ActionButton></div>
      </section>
    </div>
  );
}

function MatchweekSection({
  competitionId,
  competitionStatus,
  initialMatches,
  state,
  teams,
  historyByMatch,
  movedOutCount,
  isSourceWeekEmpty,
  supplemental,
  onPersisted,
  onReschedule,
}: {
  competitionId: string;
  competitionStatus: string;
  initialMatches: AdminCompetitionMatch[];
  state: StandardLeagueMatchweek;
  teams: Map<string, AdminCompetitionMatchTeam>;
  historyByMatch: Map<string, StandardLeagueRescheduleHistory[]>;
  movedOutCount: number;
  isSourceWeekEmpty: boolean;
  supplemental: boolean;
  onPersisted: (matches: AdminCompetitionMatch[], state: StandardLeagueMatchweek) => void;
  onReschedule: (match: AdminCompetitionMatch) => void;
}) {
  const router = useRouter();
  const { runAction } = useActionFeedback();
  const [drafts, setDrafts] = useState<Record<string, FixtureDraft>>(() => Object.fromEntries(initialMatches.map((match) => [match.id, { awayTeamId: match.away_team_id, homeTeamId: match.home_team_id, matchDate: toInput(match.match_date), venue: match.venue ?? "" }])));
  const [scores, setScores] = useState<Record<string, { away: string; home: string; status: "finished" | "scheduled" }>>({});
  const [editingFinishedMatchId, setEditingFinishedMatchId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState(state.status === "completed");
  const update = (id: string, change: Partial<FixtureDraft>) => setDrafts((current) => ({ ...current, [id]: { ...current[id], ...change } }));
  const swap = (id: string) => { const current = drafts[id]; update(id, { awayTeamId: current.homeTeamId, homeTeamId: current.awayTeamId }); };
  const saveDraft = async () => {
    setSaving(true); setError("");
    const result = await runAction({ errorMessage: (value) => !value.ok ? value.error ?? "บันทึกร่างไม่สำเร็จ" : null, id: `league-matchweek-draft:${competitionId}:${state.matchweek}`, loadingMessage: "กำลังบันทึกร่าง...", successMessage: `บันทึกร่าง Matchweek ${state.matchweek} แล้ว` }, () => saveStandardLeagueMatchweekDraft(competitionId, state.matchweek, initialMatches.map((match) => ({ awayTeamId: drafts[match.id].awayTeamId, homeTeamId: drafts[match.id].homeTeamId, matchDate: toIso(drafts[match.id].matchDate), matchId: match.id, venue: drafts[match.id].venue }))));
    setSaving(false);
    if (!result?.ok || !result.matchweekState || !result.matches) { setError(result?.error ?? "บันทึกร่างไม่สำเร็จ"); return; }
    const next = initialMatches.map((match) => { const saved = result.matches?.find((item) => item.matchId === match.id); return saved ? { ...match, away_team_id: saved.awayTeamId, home_team_id: saved.homeTeamId, match_date: saved.matchDate, venue: saved.venue } : match; });
    onPersisted(next, result.matchweekState); router.refresh();
  };
  const confirm = async () => {
    setSaving(true); setError("");
    const editableFixtures = initialMatches.filter((match) => !["finished", "completed"].includes(match.status)).map((match) => ({ awayTeamId: drafts[match.id].awayTeamId, homeTeamId: drafts[match.id].homeTeamId, matchId: match.id }));
    const result = await runAction({ errorMessage: (value) => !value.ok ? value.error ?? "Matchweek นี้ยังไม่พร้อมยืนยันคู่แข่งขัน" : null, id: `league-matchweek-confirm:${competitionId}:${state.matchweek}`, loadingMessage: "กำลังยืนยัน Matchweek...", successMessage: `ยืนยัน Matchweek ${state.matchweek} แล้ว` }, () => confirmStandardLeagueMatchweek(competitionId, state.matchweek, editableFixtures));
    setSaving(false);
    if (!result?.ok || !result.matchweekState) { setError(result?.error?.includes("ขาดวัน เวลา สนาม") ? "ไม่สามารถยืนยันคู่แข่งขันได้ กรุณาตรวจสอบคู่แข่งขันใน Matchweek นี้" : result?.error ?? "ไม่สามารถยืนยันคู่แข่งขัน Matchweek นี้ได้"); return; }
    onPersisted(initialMatches, result.matchweekState); router.refresh();
  };
  const saveResult = async (match: AdminCompetitionMatch) => {
    const value = scores[match.id] ?? { away: match.away_score?.toString() ?? "", home: match.home_score?.toString() ?? "", status: ["finished", "completed"].includes(match.status) ? "finished" : "scheduled" };
    const result = await runAction({ errorMessage: (saved) => !saved.ok ? saved.error ?? "บันทึกผลไม่สำเร็จ" : null, id: `league-match-save:${match.id}`, loadingMessage: "กำลังบันทึกผล...", successMessage: "บันทึกผลการแข่งขันแล้ว" }, () => saveStandardLeagueMatch(competitionId, { awayScore: value.away === "" ? null : Number(value.away), homeScore: value.home === "" ? null : Number(value.home), matchDate: toIso(drafts[match.id].matchDate), matchId: match.id, status: value.status, venue: drafts[match.id].venue.trim() || null }));
    if (!result?.ok) { setError(result?.error ?? "บันทึกผลไม่สำเร็จ"); return; }
    const nextState = result.matchweekState ?? state;
    onPersisted(initialMatches.map((item) => item.id === match.id ? { ...item, away_score: value.away === "" ? null : Number(value.away), home_score: value.home === "" ? null : Number(value.home), status: value.status } : item), nextState);
    setEditingFinishedMatchId("");
    setCollapsed(nextState.status === "completed");
    router.refresh();
  };
  const readiness = calculateLeagueMatchweekReadiness(initialMatches.map((match) => ({ matchDate: match.match_date, venue: match.venue })));
  const totalGoals = initialMatches.reduce((sum, match) => sum + (match.home_score ?? 0) + (match.away_score ?? 0), 0);
  const finishedMatches = initialMatches.filter((match) => ["finished", "completed"].includes(match.status)).length;
  const canConfirmPairings = state.status === "draft" || state.status === "unconfigured";
  const changedAfterConfirmation = state.status === "draft" && (movedOutCount > 0 || initialMatches.some((match) => isRescheduledMatch({ id: match.id, originalMatchweek: match.originalMatchweek ?? match.matchweek ?? 0, scheduledMatchweek: match.scheduledMatchweek })));
  return <article className="rounded-lg border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-black">{supplemental ? "นัดตกค้าง / สัปดาห์เพิ่มเติม" : "Matchweek"} {state.matchweek}</h3><span className={`rounded-full px-2 py-1 text-xs font-bold ${statusClass(state.status)}`}>{statusLabel(state.status)}</span>{initialMatches.length ? <><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">พร้อม {readiness.readyMatches}/{readiness.totalMatches} คู่</span>{readiness.incompleteMatches ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">รอกำหนด {readiness.incompleteMatches} คู่</span> : null}<span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">จบแล้ว {finishedMatches}/{initialMatches.length} คู่</span></> : null}</div>{state.status === "completed" ? <button className="text-xs font-bold" onClick={() => setCollapsed((current) => !current)} type="button">{collapsed ? "แสดงผล" : "พับผล"}</button> : null}</div>
    {movedOutCount ? <p className="mt-2 text-xs font-bold text-amber-900">เลื่อนออก {movedOutCount} คู่</p> : null}
    {isSourceWeekEmpty ? <p className="mt-2 rounded bg-slate-50 p-2 text-sm font-bold text-slate-700">ทุกคู่ถูกเลื่อนไป Matchweek อื่น</p> : null}
    {changedAfterConfirmation ? <p className="mt-2 text-xs font-bold text-amber-900">มีการเปลี่ยนแปลงหลังยืนยัน กรุณายืนยันคู่แข่งขันใหม่</p> : null}
    {state.status !== "completed" && initialMatches.length && readiness.incompleteMatches ? <p className="mt-2 rounded bg-amber-50 p-2 text-xs font-semibold text-amber-950">ยังมี {readiness.incompleteMatches} คู่ที่รอกำหนดวัน เวลา หรือสนาม · สามารถเติมวัน เวลา และสนามภายหลังได้</p> : null}
    {state.status === "completed" && collapsed ? <p className="mt-2 text-sm text-slate-600">จบแล้ว {initialMatches.length} คู่ · {totalGoals} ประตู</p> : null}
    {state.status !== "completed" || !collapsed ? <>
      <div className="mt-3 space-y-3">{initialMatches.map((match) => {
      const draft = drafts[match.id];
      const result = scores[match.id] ?? { away: match.away_score?.toString() ?? "", home: match.home_score?.toString() ?? "", status: ["finished", "completed"].includes(match.status) ? "finished" : "scheduled" };
      const finished = ["finished", "completed"].includes(match.status);
      const editingFinishedMatch = finished && isEditingFinishedLeagueMatch(match.id, editingFinishedMatchId);
      const competitionCompleted = !canEditFinishedLeagueMatch(competitionStatus);
      const locked = competitionCompleted || (finished && !editingFinishedMatch);
      const canSaveResult = !competitionCompleted && (state.status === "confirmed" || (state.status === "completed" && editingFinishedMatch));
      const history = historyByMatch.get(match.id) ?? [];
      const latestHistory = sortRescheduleHistory(history)[0];
      const moved = isRescheduledMatch({ id: match.id, originalMatchweek: match.originalMatchweek ?? match.matchweek ?? 0, scheduledMatchweek: match.scheduledMatchweek });
      if (finished && !editingFinishedMatch) {
        const homeWon = (match.home_score ?? 0) > (match.away_score ?? 0);
        const awayWon = (match.away_score ?? 0) > (match.home_score ?? 0);
        return <article className="rounded border border-emerald-200 bg-emerald-50/50 px-3 py-2" key={match.id}><div className="flex flex-wrap items-center gap-2"><span className="text-emerald-700">✓</span><span className={`min-w-0 flex-1 text-sm ${homeWon ? "font-black" : "font-semibold"}`}>{nameFor(teams, draft.homeTeamId)}</span><strong className="text-base">{match.home_score ?? 0}–{match.away_score ?? 0}</strong><span className={`min-w-0 flex-1 text-right text-sm ${awayWon ? "font-black" : "font-semibold"}`}>{nameFor(teams, draft.awayTeamId)}</span><button className="text-xs font-black text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={competitionCompleted} onClick={() => setEditingFinishedMatchId(match.id)} type="button">แก้ไข</button></div><p className="mt-1 text-xs text-emerald-900">จบการแข่งขัน · {match.venue ?? "ยังไม่กำหนดสนาม"} · {formatDateTime(match.match_date)} · {homeWon ? "เจ้าบ้านชนะ" : awayWon ? "ทีมเยือนชนะ" : "เสมอ"}</p><RescheduleHistoryPanel history={history} /></article>;
      }
      return <div className="rounded border bg-slate-50 p-3" key={match.id}><div className="flex min-w-0 flex-wrap items-center justify-between gap-2"><p className="min-w-0 truncate text-sm font-black">เจ้าบ้าน: {nameFor(teams, draft.homeTeamId)} · ทีมเยือน: {nameFor(teams, draft.awayTeamId)}</p><div className="flex flex-wrap gap-2"><button className="rounded border px-2 py-1 text-xs font-bold disabled:opacity-50" disabled={competitionCompleted || finished} onClick={() => swap(match.id)} type="button">สลับเจ้าบ้าน–ทีมเยือน</button>{canRescheduleMatch(match.status, competitionStatus) ? <button className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-950" onClick={() => onReschedule(match)} type="button">เลื่อนการแข่งขัน</button> : null}</div></div>{moved ? <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-950"><span className="font-black">เลื่อนมาจาก Matchweek {match.originalMatchweek ?? match.matchweek}</span>{match.rescheduleReason ? <span> · {match.rescheduleReason}</span> : null}{match.rescheduledAt ? <span> · {formatDateTime(match.rescheduledAt)}</span> : null}{latestHistory?.changedByLabel ? <span> · {latestHistory.changedByLabel}</span> : null}</div> : null}<p className="mt-1 text-xs text-slate-500">แข่งขันสนามกลาง</p>{(!draft.matchDate || !draft.venue.trim()) ? <p className="mt-1 text-xs font-bold text-amber-800">ข้อมูลยังไม่พร้อม: รอกำหนดวัน เวลา หรือสนาม</p> : null}<div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><label className="text-xs font-bold">วันเวลา<input className="mt-1 w-full rounded border p-2" disabled={locked} onChange={(event) => update(match.id, { matchDate: event.target.value })} type="datetime-local" value={draft.matchDate} /></label><VenueControl disabled={locked} value={draft.venue} onChange={(venue) => update(match.id, { venue })} /><label className="text-xs font-bold">สถานะ<select className="mt-1 w-full rounded border p-2" disabled={!canSaveResult} onChange={(event) => setScores({ ...scores, [match.id]: { ...result, status: event.target.value === "finished" ? "finished" : "scheduled" } })} value={result.status}><option value="scheduled">รอแข่งขัน</option><option value="finished">จบการแข่งขัน</option></select></label><label className="text-xs font-bold">ประตูเหย้า<input className="mt-1 w-full rounded border p-2" disabled={locked} min="0" onChange={(event) => setScores({ ...scores, [match.id]: { ...result, home: event.target.value } })} type="number" value={result.home} /></label><label className="text-xs font-bold">ประตูเยือน<input className="mt-1 w-full rounded border p-2" disabled={locked} min="0" onChange={(event) => setScores({ ...scores, [match.id]: { ...result, away: event.target.value } })} type="number" value={result.away} /></label></div>{canSaveResult && !locked ? <ActionButton actionId={`league-match-save:${match.id}`} className="mt-3 rounded border px-3 py-2 text-sm font-bold" loadingLabel="กำลังบันทึกผล…" onClick={() => saveResult(match)} successLabel="บันทึกผลแล้ว" type="button">บันทึกผลการแข่งขัน</ActionButton> : null}<RescheduleHistoryPanel history={history} /></div>;
      })}</div>
      {error ? <p className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}
      {state.status !== "completed" && initialMatches.length ? <div className="mt-4 flex flex-wrap gap-2"><ActionButton actionId={`league-matchweek-draft:${competitionId}:${state.matchweek}`} className="rounded border border-[#061426] px-3 py-2 text-sm font-bold" disabled={saving} loadingLabel="กำลังบันทึกร่าง…" onClick={saveDraft} successLabel="บันทึกร่างแล้ว" type="button">บันทึกร่าง</ActionButton>{canConfirmPairings ? <ActionButton actionId={`league-matchweek-confirm:${competitionId}:${state.matchweek}`} className="rounded bg-[#061426] px-3 py-2 text-sm font-black text-[#f4d58a]" disabled={saving} loadingLabel="กำลังยืนยัน…" onClick={confirm} successLabel="ยืนยันแล้ว" type="button">ยืนยันคู่แข่งขัน Matchweek {state.matchweek}</ActionButton> : <ActionButton actionId={`league-matchweek-confirm:${competitionId}:${state.matchweek}`} className="rounded bg-emerald-100 px-3 py-2 text-sm font-black text-emerald-800" disabled loadingLabel="กำลังยืนยัน…" successLabel="✓ ยืนยันคู่แข่งขันแล้ว" type="button">✓ ยืนยันคู่แข่งขันแล้ว</ActionButton>}</div> : null}
    </> : null}
  </article>;
}

export function AdminLeagueCompetitionWorkspace({ competitionId, competitionName, competitionStatus, initialConfig, initialMatches, initialMatchweeks, rescheduleHistory: initialRescheduleHistory, teams }: { competitionId: string; competitionName: string; competitionStatus: string; initialConfig: StandardLeagueConfig | null; initialMatches: AdminCompetitionMatch[]; initialMatchweeks: StandardLeagueMatchweek[]; rescheduleHistory: StandardLeagueRescheduleHistory[]; teams: AdminCompetitionMatchTeam[] }) {
  const router = useRouter();
  const { runAction } = useActionFeedback();
  const [config, setConfig] = useState(initialConfig);
  const [matches, setMatches] = useState(initialMatches);
  const [matchweeks, setMatchweeks] = useState(initialMatchweeks);
  const [rescheduleHistory, setRescheduleHistory] = useState(initialRescheduleHistory);
  const [rescheduleMatch, setRescheduleMatch] = useState<AdminCompetitionMatch | null>(null);
  const [preview, setPreview] = useState<LeagueFixturePlan | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({ drawPoints: initialConfig?.drawPoints ?? 1, lossPoints: initialConfig?.lossPoints ?? 0, standingsPolicyKey: "standard_league_v1" as const, winPoints: initialConfig?.winPoints ?? 3 });
  const teamMap = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const leagueMatches = matches.filter((match) => !config || match.league_fixture_version === config.fixtureVersion);
  const historyByMatch = useMemo(() => rescheduleHistory.reduce((history, entry) => { const entries = history.get(entry.matchId) ?? []; entries.push(entry); history.set(entry.matchId, entries); return history; }, new Map<string, StandardLeagueRescheduleHistory[]>()), [rescheduleHistory]);
  const structuralMaximum = Math.max(0, ...leagueMatches.map((match) => match.originalMatchweek ?? match.matchweek ?? 0));
  const matchweeksByNumber = new Map(matchweeks.map((state) => [state.matchweek, state]));
  const allWeeks = Array.from(new Set([...matchweeks.map((state) => state.matchweek), ...leagueMatches.map(effectiveWeek)])).filter((week) => week > 0).sort((a, b) => a - b);
  const standings = calculateStandardLeagueStandings({ config: config ?? settings, matches: leagueMatches.map((match) => ({ awayScore: match.away_score, awayTeamId: match.away_team_id, fixtureKey: match.league_fixture_key ?? null, homeScore: match.home_score, homeTeamId: match.home_team_id, status: match.status })), teams: teams.map((team) => ({ id: team.id, name: team.name })) });
  const workflow = calculateLeagueCompetitionWorkflow({ competitionStatus, config, matches: leagueMatches.map((match) => ({ awayScore: match.away_score, awayTeamId: match.away_team_id, fixtureKey: match.league_fixture_key ?? null, homeScore: match.home_score, homeTeamId: match.home_team_id, status: match.status })), matchweeks, plan: preview, standings: standings.rows, teamCount: teams.length });
  const summary = calculateLeagueMatchweekSummary(matchweeks);
  const scheduleReadiness = calculateLeagueMatchweekReadiness(leagueMatches.map((match) => ({ matchDate: match.match_date, venue: match.venue })));
  const saveSettings = async () => { setSaving(true); const result = await runAction({ errorMessage: (value) => !value.ok ? value.error ?? "บันทึกไม่สำเร็จ" : null, id: `league-settings:${competitionId}`, loadingMessage: "กำลังบันทึกการตั้งค่า...", successMessage: "บันทึกการตั้งค่าลีกแล้ว" }, () => saveStandardLeagueConfigDraft(competitionId, settings)); setSaving(false); if (!result?.ok) { setError(result?.error ?? "บันทึกไม่สำเร็จ"); return; } setConfig(result.config ?? null); };
  const createPreview = async () => { const result = await runAction({ errorMessage: (value) => !value.ok ? value.error ?? "สร้างตัวอย่างไม่สำเร็จ" : null, id: `league-structure-preview:${competitionId}`, loadingMessage: "กำลังสร้างตัวอย่าง...", successMessage: "สร้างตัวอย่างโครงสร้างแล้ว" }, () => generateStandardLeagueFixturePreview(competitionId)); if (!result?.ok || !result.plan) { setError(result?.error ?? "สร้างตัวอย่างไม่สำเร็จ"); return; } setPreview(result.plan); };
  const confirmStructure = async () => { const result = await runAction({ errorMessage: (value) => !value.ok ? value.error ?? "ยืนยันโครงสร้างไม่สำเร็จ" : null, id: `league-structure-confirm:${competitionId}`, loadingMessage: "กำลังยืนยันโครงสร้าง...", successMessage: "ยืนยันโครงสร้างการแข่งขันแล้ว" }, () => confirmStandardLeagueFixtures(competitionId)); if (!result?.ok) { setError(result?.error ?? "ยืนยันโครงสร้างไม่สำเร็จ"); return; } setConfig(result.config ?? null); router.refresh(); };
  const persistWeek = (weekMatches: AdminCompetitionMatch[], state: StandardLeagueMatchweek) => { setMatches((current) => current.map((match) => weekMatches.find((next) => next.id === match.id) ?? match)); setMatchweeks((current) => { const remaining = current.filter((item) => item.matchweek !== state.matchweek); return [...remaining, state].sort((a, b) => a.matchweek - b.matchweek); }); };
  const handleRescheduleSaved = (result: Awaited<ReturnType<typeof rescheduleStandardLeagueMatch>>) => {
    if (!result.success) return;
    setMatches((current) => current.map((match) => match.id === result.updatedMatch.id ? { ...match, ...result.updatedMatch } : match));
    setMatchweeks((current) => {
      const updates = [result.sourceMatchweekState, result.targetMatchweekState].filter((state): state is StandardLeagueMatchweek => state !== null);
      const next = new Map(current.map((state) => [state.matchweek, state]));
      updates.forEach((state) => next.set(state.matchweek, state));
      return Array.from(next.values()).sort((a, b) => a.matchweek - b.matchweek);
    });
    setRescheduleHistory((current) => [result.history, ...current.filter((entry) => entry.id !== result.history.id)]);
    setRescheduleMatch(null);
    router.refresh();
  };
  return <section className="mx-auto w-full max-w-7xl space-y-5 px-4 pb-12 sm:px-6 lg:px-10">
    {rescheduleMatch ? <RescheduleModal competitionId={competitionId} match={rescheduleMatch} onClose={() => setRescheduleMatch(null)} onSaved={handleRescheduleSaved} structuralMaximum={structuralMaximum} teams={teamMap} /> : null}
    <section className="rounded-lg border bg-white p-4"><h1 className="text-xl font-black">{competitionName}</h1><p className="text-sm text-slate-600">ลีก 1 เลก · ทุกทีมพบกันครั้งเดียว · แข่งขันสนามกลาง</p></section>
    <section className="rounded-lg border bg-white p-4"><h2 className="font-black">ลำดับการทำงาน</h2><div className="mt-3 flex flex-wrap gap-2">{workflow.map((step, index) => <span className={`rounded-full px-3 py-1 text-xs font-bold ${step.state === "complete" ? "bg-emerald-100 text-emerald-800" : step.state === "current" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-500"}`} key={step.id}>{index + 1}. {step.label}</span>)}</div></section>
    {error ? <p className="rounded bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
    <section className="rounded-lg border bg-white p-4"><div className="flex items-center justify-between"><h2 className="text-xl font-black">ทีมที่เข้าแข่งขัน</h2><Link className="rounded bg-[#061426] px-3 py-2 text-sm font-bold text-[#f4d58a]" href={`/admin/teams?competition=${competitionId}`}>จัดการทีม</Link></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{teams.map((team) => <div className="flex min-w-0 items-center gap-2 rounded border bg-slate-50 p-2" key={team.id}><TeamLogo className="!size-8" initials={team.name.slice(0, 2)} logoUrl={team.logo_url ?? ""} teamName={team.name} /><span className="truncate text-sm font-bold">{team.name}</span></div>)}</div></section>
    <section className="rounded-lg border bg-white p-4"><h2 className="text-xl font-black">ตั้งค่าลีก</h2>{config?.fixtureStatus === "confirmed" ? <p className="mt-2 text-sm font-bold text-emerald-700">ยืนยันโครงสร้างแล้ว</p> : <><p className="mt-2 text-sm">ทุกทีมพบกันครั้งเดียว · วัน เวลา สนาม และลำดับเจ้าบ้าน/ทีมเยือนกำหนดทีละ Matchweek ได้</p><div className="mt-3 grid gap-2 sm:grid-cols-3">{(["winPoints", "drawPoints", "lossPoints"] as const).map((key) => <label className="text-sm font-bold" key={key}>{key === "winPoints" ? "คะแนนชนะ" : key === "drawPoints" ? "คะแนนเสมอ" : "คะแนนแพ้"}<input className="mt-1 w-full rounded border p-2" min="0" onChange={(event) => setSettings({ ...settings, [key]: Number(event.target.value) })} type="number" value={settings[key]} /></label>)}</div><ActionButton actionId={`league-settings:${competitionId}`} className="mt-3 rounded bg-[#061426] px-3 py-2 text-sm font-black text-[#f4d58a]" disabled={saving} loadingLabel="กำลังบันทึก…" onClick={saveSettings} successLabel="บันทึกแล้ว" type="button">บันทึกการตั้งค่าลีก</ActionButton></>}</section>
    <section className="rounded-lg border bg-white p-4"><h2 className="text-xl font-black">โครงสร้างการแข่งขัน</h2>{config?.fixtureStatus === "confirmed" ? <p className="mt-2 text-sm font-bold text-emerald-700">สร้างคู่และ Matchweek ครบทั้งฤดูกาลแล้ว</p> : <><ActionButton actionId={`league-structure-preview:${competitionId}`} className="mt-3 rounded border px-3 py-2 text-sm font-bold" loadingLabel="กำลังสร้าง…" onClick={createPreview} successLabel="สร้างแล้ว" type="button">สร้างตัวอย่างโครงสร้าง</ActionButton>{preview ? <><p className="mt-3 text-sm font-bold">{preview.summary.roundCount} Matchweek · {preview.summary.fixtureCount} คู่</p><ActionButton actionId={`league-structure-confirm:${competitionId}`} className="mt-3 rounded bg-[#061426] px-3 py-2 text-sm font-black text-[#f4d58a]" loadingLabel="กำลังยืนยัน…" onClick={confirmStructure} successLabel="ยืนยันแล้ว" type="button">ยืนยันโครงสร้างการแข่งขัน</ActionButton></> : null}</>}</section>
    {config?.fixtureStatus === "confirmed" ? <section className="space-y-4"><div className="rounded-lg border bg-white p-4"><h2 className="text-xl font-black">จัดการโปรแกรมราย Matchweek</h2><p className="mt-1 text-sm text-slate-600">ยืนยันคู่แข่งขันแล้ว {summary.confirmed}/{matchweeks.length} Matchweek · ข้อมูลพร้อม {scheduleReadiness.readyMatches}/{scheduleReadiness.totalMatches} คู่ · รอกำหนด {scheduleReadiness.incompleteMatches} คู่ · แข่งขันครบแล้ว {summary.completed} Matchweek</p></div>{allWeeks.map((week) => { const state = matchweeksByNumber.get(week) ?? { confirmedAt: null, confirmedBy: null, matchweek: week, status: "unconfigured" as const, updatedAt: null }; const weekMatches = leagueMatches.filter((match) => effectiveWeek(match) === week); const moved = movedMatchweekCounts(leagueMatches.map((match) => ({ id: match.id, originalMatchweek: match.originalMatchweek ?? match.matchweek ?? 0, scheduledMatchweek: match.scheduledMatchweek })), week); const structuralMatches = leagueMatches.filter((match) => (match.originalMatchweek ?? match.matchweek) === week); return <MatchweekSection competitionId={competitionId} competitionStatus={competitionStatus} historyByMatch={historyByMatch} initialMatches={weekMatches} isSourceWeekEmpty={structuralMatches.length > 0 && weekMatches.length === 0} key={`${week}-${state.status}-${state.updatedAt ?? ""}-${weekMatches.map((match) => `${match.id}:${effectiveWeek(match)}`).join("|")}`} movedOutCount={moved.movedOut} onPersisted={persistWeek} onReschedule={setRescheduleMatch} state={state} supplemental={isSupplementalMatchweek(week, structuralMaximum)} teams={teamMap} />; })}</section> : null}
    <section className="rounded-lg border bg-white p-4"><h2 className="text-xl font-black">ตารางคะแนน</h2><div className="mt-3 overflow-x-auto"><table className="min-w-[620px] w-full text-sm"><thead><tr><th>#</th><th>ทีม</th><th>แข่ง</th><th>ชนะ</th><th>เสมอ</th><th>แพ้</th><th>ได้</th><th>เสีย</th><th>+/-</th><th>คะแนน</th></tr></thead><tbody>{standings.rows.map((row, index) => <tr className="border-t" key={row.teamId}><td>{index + 1}</td><td className="py-2 font-bold">{row.teamName}</td><td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.goalDifference}</td><td className="font-black">{row.points}</td></tr>)}</tbody></table></div></section>
  </section>;
}

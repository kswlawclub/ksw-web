"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState, useTransition } from "react";
import { updateMatch } from "@/app/admin/matches/actions";
import { approveCupQualification, reopenCupQualification, saveCupQualificationSettings } from "@/app/admin/competitions/[id]/qualification-actions";
import { AdminCompetitionGroupsManager, type AdminCompetitionGroup, type AdminCompetitionGroupTeam } from "@/components/admin-competition-groups-manager";
import { AdminCompetitionTreeEngineV2 } from "@/components/admin-competition-tree-engine-v2";
import { AdminCompetitionWizardV2 } from "@/components/admin-competition-wizard-v2";
import { TeamLogo } from "@/components/team-logo";
import { calculateCupQualification } from "@/lib/cup-qualification";
import { sortTeamsByName } from "@/lib/team-sort";
import type { CompetitionEngineV2Config, CompetitionKnockoutMatchV2 } from "@/app/admin/competitions/[id]/competition-engine-v2-actions";
import type { CompetitionEngineV2Integrity } from "@/lib/competition-engine-v2-state";
import type { CompetitionTreeNode, CompetitionTreeSummary } from "@/lib/competition-tree";
import type { AdminCompetitionMatch, AdminCompetitionMatchTeam } from "@/components/admin-competition-match-manager";

type MatchForm = { awayScore: string; homeScore: string; matchDate: string; status: "finished" | "scheduled"; venue: string };

function asDateInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { dateStyle: "short", hour: "2-digit", hour12: false, minute: "2-digit", timeZone: "Asia/Bangkok" }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}T${byType.get("hour")}:${byType.get("minute")}`;
}

function formFromMatch(match: AdminCompetitionMatch): MatchForm {
  return {
    awayScore: match.away_score === null ? "" : String(match.away_score),
    homeScore: match.home_score === null ? "" : String(match.home_score),
    matchDate: asDateInput(match.match_date),
    status: match.status === "finished" ? "finished" : "scheduled",
    venue: match.venue ?? "",
  };
}

function number(value: string) { return value.trim() === "" ? null : Number(value); }

function compactMatchDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(date);
}

function CupGroupMatchCard({
  away,
  home,
  match,
  onSave,
}: {
  away: AdminCompetitionMatchTeam | undefined;
  home: AdminCompetitionMatchTeam | undefined;
  match: AdminCompetitionMatch;
  onSave: (match: AdminCompetitionMatch, draft: MatchForm) => Promise<{ error?: string; ok: boolean }>;
}) {
  const [draft, setDraft] = useState(() => formFromMatch(match));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const isFinished = match.status === "finished";
  const hasScore = match.home_score !== null && match.away_score !== null;
  const isDraw = hasScore && match.home_score === match.away_score;
  const winner = !isDraw && hasScore
    ? match.home_score! > match.away_score! ? home : away
    : undefined;

  function cancelEdit() {
    setDraft(formFromMatch(match));
    setError("");
    setSaved(false);
    setEditing(false);
  }

  function updateDraft(patch: Partial<MatchForm>) {
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
      setError(result.error ?? "ไม่สามารถบันทึกแมตช์ได้");
      return;
    }
    setSaved(true);
    setEditing(false);
  }

  if (isFinished && !editing) {
    const date = compactMatchDate(match.match_date);
    return (
      <article className="min-w-0 rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-3" id={`group-match-${match.id}`}>
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-800"><span aria-hidden="true">✓</span>จบการแข่งขัน</span>
          <button className="min-h-10 rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-sm font-black text-emerald-800" onClick={() => { setSaved(false); setEditing(true); }} type="button">แก้ไขผล</button>
        </div>
        <div className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-4">
          <div className={`flex min-w-0 items-center gap-2 ${winner?.id === home?.id ? "font-black text-[#061426]" : "text-slate-700"}`}><TeamLogo className="!size-8 shrink-0 bg-[#061426]" initials={(home?.short_name || home?.name || "ทีม").slice(0, 3)} logoUrl={home?.logo_url ?? ""} teamName={home?.name ?? "ทีมเหย้า"} /><span className="min-w-0 break-words text-sm">{home?.name ?? "ทีมเหย้า"}</span></div>
          <p className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-center text-xl font-black tabular-nums text-[#061426]">{hasScore ? `${match.home_score} - ${match.away_score}` : "-"}</p>
          <div className={`flex min-w-0 items-center justify-end gap-2 text-right ${winner?.id === away?.id ? "font-black text-[#061426]" : "text-slate-700"}`}><span className="min-w-0 break-words text-sm">{away?.name ?? "ทีมเยือน"}</span><TeamLogo className="!size-8 shrink-0 bg-[#061426]" initials={(away?.short_name || away?.name || "ทีม").slice(0, 3)} logoUrl={away?.logo_url ?? ""} teamName={away?.name ?? "ทีมเยือน"} /></div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-slate-600"><span>{isDraw ? "เสมอ" : winner ? `ผู้ชนะ: ${winner.name}` : "รอผลสกอร์"}</span>{date ? <span>{date}</span> : null}{match.venue ? <span>{match.venue}</span> : null}</div>
        {saved ? <p className="mt-2 text-xs font-bold text-emerald-800">บันทึกแล้ว</p> : null}
      </article>
    );
  }

  return (
    <form className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3" id={`group-match-${match.id}`} onSubmit={save}>
      <div className="grid gap-3 sm:grid-cols-2">{[{ key: "homeScore", team: home }, { key: "awayScore", team: away }].map(({ key, team }) => <label className="flex min-w-0 items-center gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm font-black" key={key}><TeamLogo className="!size-9 shrink-0 bg-[#061426]" initials={(team?.short_name || team?.name || "ทีม").slice(0, 3)} logoUrl={team?.logo_url ?? ""} teamName={team?.name ?? "ทีม"} /><span className="min-w-0 flex-1 break-words">{team?.name ?? "ทีม"}</span><input className="min-h-11 w-16 shrink-0 rounded-md border border-slate-200 px-2 text-center" max="999" min="0" onChange={(event) => updateDraft({ [key]: event.target.value })} step="1" type="number" value={draft[key as "homeScore" | "awayScore"]} /></label>)}</div>
      {(draft.homeScore !== "" || draft.awayScore !== "") && draft.status !== "finished" ? <p className="mt-3 rounded-md border border-[#d8ad45]/35 bg-[#fff7e6] px-3 py-2 text-xs font-bold text-[#8a6418]">มีสกอร์แล้ว แต่ยังไม่ยืนยันจบการแข่งขัน</p> : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="grid min-w-0 gap-1 text-xs font-black">วันและเวลา<input className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 px-3" onChange={(event) => updateDraft({ matchDate: event.target.value })} type="datetime-local" value={draft.matchDate} /></label><label className="grid min-w-0 gap-1 text-xs font-black">สนาม<input className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 px-3" onChange={(event) => updateDraft({ venue: event.target.value })} value={draft.venue} /></label><label className="grid min-w-0 gap-1 text-xs font-black">สถานะ<select className="min-h-11 w-full rounded-md border border-slate-200 px-3" onChange={(event) => updateDraft({ status: event.target.value as MatchForm["status"] })} value={draft.status}><option value="scheduled">รอแข่งขัน</option><option value="finished">จบการแข่งขัน</option></select></label></div>
      {error ? <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800">{error}</p> : null}
      {saved ? <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{draft.status === "finished" ? "บันทึกแล้ว ตารางคะแนนและทีมผ่านเข้ารอบอัปเดตทันที" : "บันทึกแล้ว"}</p> : null}
      <div className="mt-3 flex flex-wrap justify-end gap-2">{isFinished ? <button className="min-h-11 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-black text-[#061426]" disabled={saving} onClick={cancelEdit} type="button">ยกเลิก</button> : null}<button className="min-h-11 rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] disabled:opacity-60" disabled={saving} type="submit">{saving ? "กำลังบันทึก..." : saved ? "บันทึกแล้ว" : "บันทึกแมตช์"}</button></div>
    </form>
  );
}

function CupGroupProgram({
  group,
  matches,
  onSave,
  teamsById,
}: {
  group: AdminCompetitionGroup;
  matches: AdminCompetitionMatch[];
  onSave: (match: AdminCompetitionMatch, draft: MatchForm) => Promise<{ error?: string; ok: boolean }>;
  teamsById: Map<string, AdminCompetitionMatchTeam>;
}) {
  const groupMatches = matches.filter((match) => match.competition_stage === "group" && match.group_id === group.id);
  return (
    <section className="mt-5 min-w-0 border-t border-slate-200 pt-5">
      <h4 className="text-lg font-black text-[#061426]">โปรแกรมการแข่งขัน</h4>
      <div className="mt-3 grid gap-3">
        {groupMatches.length ? groupMatches.map((match) => <CupGroupMatchCard away={teamsById.get(match.away_team_id)} home={teamsById.get(match.home_team_id)} key={match.id} match={match} onSave={onSave} />) : <p className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">ยังไม่มีโปรแกรมของกลุ่มนี้ กด “สร้างโปรแกรมการแข่งขัน” ด้านบน</p>}
      </div>
    </section>
  );
}

function CupQualificationPanel({ competitionId, config, groups, matches, teams }: { competitionId: string; config: CompetitionEngineV2Config | null; groups: AdminCompetitionGroup[]; matches: AdminCompetitionMatch[]; teams: AdminCompetitionGroupTeam[] }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(config?.extraRankEnabled ?? false);
  const [rank, setRank] = useState(String(config?.extraRank ?? 3));
  const [count, setCount] = useState(String(config?.extraQualifierCount ?? 0));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [workflowState, setWorkflowState] = useState<"approved" | "editing" | "pending">(config?.qualificationStatus === "approved" ? "approved" : "pending");
  const [pending, startTransition] = useTransition();
  const result = useMemo(() => calculateCupQualification({ groups: groups as unknown as Record<string, unknown>[], matches: matches as unknown as Record<string, unknown>[], settings: { extraRankEnabled: enabled, extraRank: enabled ? Number(rank) : null, extraQualifierCount: enabled ? Number(count) : 0 }, teams: teams as unknown as Record<string, unknown>[] }), [count, enabled, groups, matches, rank, teams]);
  const approved = workflowState === "approved";
  const status = approved
    ? { className: "border-emerald-200 bg-emerald-50 text-emerald-800", icon: "✓", label: "อนุมัติแล้ว" }
    : workflowState === "editing"
      ? { className: "border-blue-200 bg-blue-50 text-blue-800", icon: "▣", label: "เปิดแก้ไข" }
      : { className: "border-[#d8ad45]/40 bg-[#fff7e6] text-[#8a6418]", icon: "◷", label: "รอการตรวจสอบ" };
  const approvedAt = config?.qualificationApprovedAt
    ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(config.qualificationApprovedAt))
    : null;

  function save() {
    startTransition(async () => {
      const response = await saveCupQualificationSettings(competitionId, enabled, enabled ? Number(rank) : null, enabled ? Number(count) : 0);
      if (!response.ok) { setError(response.error ?? "บันทึกไม่สำเร็จ"); return; }
      setError("");
      setMessage("บันทึกกติกาแล้ว");
      setWorkflowState("pending");
      router.refresh();
    });
  }

  function approve() {
    startTransition(async () => {
      const response = await approveCupQualification(competitionId);
      if (!response.ok) { setError(response.error ?? "ยืนยันไม่สำเร็จ"); return; }
      setError("");
      setMessage("ยืนยันทีมผ่านเข้ารอบแล้ว");
      setWorkflowState("approved");
      router.refresh();
    });
  }

  function reopen() {
    startTransition(async () => {
      const response = await reopenCupQualification(competitionId);
      if (!response.ok) { setError(response.error ?? "ยกเลิกการยืนยันไม่สำเร็จ"); return; }
      setError("");
      setMessage("เปิดให้แก้ไขรายชื่อทีมผ่านเข้ารอบแล้ว");
      setWorkflowState("editing");
      router.refresh();
    });
  }

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10">
      <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-2xl font-black text-[#061426]">ทีมผ่านเข้ารอบ</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">ตรวจสอบรายชื่อก่อนนำไปใช้ในรอบน็อกเอาต์</p>
          </div>
          <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-black ${status.className}`}><span aria-hidden="true">{status.icon}</span>{status.label}</span>
        </div>

        {approved ? <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-900"><p><strong>ผู้อนุมัติ:</strong> {config?.qualificationApprovedByLabel ?? "ผู้ดูแลระบบ"}</p>{approvedAt ? <p className="mt-1"><strong>วันเวลาอนุมัติ:</strong> {approvedAt}</p> : null}</div> : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <label className="flex min-h-11 items-center gap-2 text-sm font-bold"><input checked={enabled} disabled={approved} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />ใช้อันดับเพิ่มเติม</label>
          <label className="grid gap-1 text-sm font-bold">อันดับเพิ่มเติม<input className="min-h-11 rounded-md border border-slate-200 px-3 disabled:bg-slate-100" disabled={!enabled || approved} min="1" onChange={(event) => setRank(event.target.value)} type="number" value={rank} /></label>
          <label className="grid gap-1 text-sm font-bold">จำนวนทีม<input className="min-h-11 rounded-md border border-slate-200 px-3 disabled:bg-slate-100" disabled={!enabled || approved} min="0" onChange={(event) => setCount(event.target.value)} type="number" value={count} /></label>
        </div>

        {result.unevenGroups ? <p className="mt-3 rounded-md border border-[#d8ad45]/35 bg-[#fff7e6] px-3 py-2 text-sm font-bold text-[#8a6418]">ขนาดกลุ่มไม่เท่ากัน จึงใช้คะแนนต่อเกมก่อนผลต่างประตูต่อเกม</p> : null}
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {result.preview.length ? result.preview.map((entry) => <div className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-black text-[#061426]" key={`${entry.type}-${entry.bestOrder ?? entry.groupId}-${entry.teamId}`}><span className="mb-1 block text-xs font-black text-slate-500">{entry.label}{entry.temporary ? " · อันดับชั่วคราว" : ""}</span><span className="break-words">{entry.teamName}</span></div>) : <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-600 sm:col-span-2">ยังไม่มีทีมที่ยืนยันได้ รอให้แต่ละกลุ่มแข่งขันครบก่อน</p>}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {Array.from(result.groupComplete.entries()).map(([id, complete]) => <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black ${complete ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-[#d8ad45]/40 bg-[#fff7e6] text-[#8a6418]"}`} key={id}><span aria-hidden="true">●</span>{groups.find((group) => group.id === id)?.label || "กลุ่ม"}: {complete ? "แข่งครบแล้ว" : "รอผลการแข่งขัน"}</span>)}
        </div>

        {error ? <div className="mt-5 rounded-md border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900"><p>{error}</p><button className="mt-3 min-h-11 rounded-md border border-red-300 bg-white px-4 py-2 font-black text-red-800" onClick={() => { setError(""); router.refresh(); }} type="button">ลองใหม่</button></div> : null}
        {message ? <p className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{message}</p> : null}

        <div className="mt-5 flex flex-wrap gap-3 border-t border-slate-100 pt-5">
          {!approved ? <button className="min-h-11 rounded-md border border-slate-200 px-4 py-2 text-sm font-black text-[#061426] disabled:opacity-60" disabled={pending} onClick={save} type="button">บันทึกกติกา</button> : null}
          {approved ? <button className="min-h-11 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-black text-blue-800 disabled:opacity-60" disabled={pending} onClick={reopen} type="button">ยกเลิกการยืนยันเพื่อแก้ไข</button> : <button className="min-h-11 rounded-md bg-[#061426] px-5 py-2 text-sm font-black text-[#f4d58a] disabled:opacity-60" disabled={pending || result.preview.some((entry) => entry.temporary)} onClick={approve} type="button">{pending ? "กำลังดำเนินการ..." : "ยืนยันทีมผ่านเข้ารอบ"}</button>}
        </div>
      </article>
    </section>
  );
}

export function AdminCupCompetitionWorkspace({
  competitionId,
  engineConfig,
  engineSummary,
  engineWorkflow,
  groups,
  groupDataReady,
  groupTeams,
  initialMatches,
  matchTeams,
  nodes,
  teams,
}: {
  competitionId: string;
  engineConfig: CompetitionEngineV2Config | null;
  engineSummary: CompetitionTreeSummary | null;
  engineWorkflow: CompetitionEngineV2Integrity | null;
  groups: AdminCompetitionGroup[];
  groupDataReady: boolean;
  groupTeams: AdminCompetitionGroupTeam[];
  initialMatches: AdminCompetitionMatch[];
  matchTeams: AdminCompetitionMatchTeam[];
  nodes: CompetitionTreeNode[];
  teams: AdminCompetitionMatchTeam[];
}) {
  const [matches, setMatches] = useState(initialMatches);
  const teamsById = useMemo(() => new Map(matchTeams.map((team) => [team.id, team])), [matchTeams]);
  const [showAllTeams, setShowAllTeams] = useState(false);
  const sortedTeams = useMemo(() => sortTeamsByName(teams), [teams]);
  const visibleTeams = showAllTeams ? sortedTeams : sortedTeams.slice(0, 16);

  async function saveGroupMatch(match: AdminCompetitionMatch, form: MatchForm) {
    const result = await updateMatch(match.id, {
      away_score: number(form.awayScore),
      away_team_id: match.away_team_id,
      home_score: number(form.homeScore),
      home_team_id: match.home_team_id,
      league_id: competitionId,
      match_date: form.matchDate ? new Date(`${form.matchDate}:00+07:00`).toISOString() : null,
      status: form.status,
      venue: form.venue.trim() || null,
    }, competitionId);
    if (!result.ok) return result;
    const updated: AdminCompetitionMatch = {
      ...match,
      away_score: number(form.awayScore),
      home_score: number(form.homeScore),
      match_date: form.matchDate ? new Date(`${form.matchDate}:00+07:00`).toISOString() : null,
      status: form.status,
      venue: form.venue.trim() || null,
    };
    setMatches((current) => current.map((item) => item.id === match.id ? updated : item));
    return { ok: true };
  }

  return (
    <>
      <section className="mx-auto w-full max-w-7xl px-4 pb-7 sm:px-6 lg:px-10">
        <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="text-2xl font-black text-[#061426]">ทีมที่เข้าแข่งขัน</h2><p className="mt-1 text-sm font-semibold text-slate-600">รายชื่อทีมในรายการนี้</p></div>
            <Link className="inline-flex min-h-11 w-fit items-center rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] hover:bg-[#091f39]" href={`/admin/teams?competition=${encodeURIComponent(competitionId)}`}>จัดการทีม</Link>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-600"><span>ทีมทั้งหมด <strong className="text-[#061426]">{sortedTeams.length}</strong></span><span>ทีม KSW <strong className="text-[#8a6418]">{sortedTeams.filter((team) => team.is_ksw).length}</strong></span></div>
          <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {visibleTeams.map((team) => <div className="flex min-w-0 items-center gap-2 rounded-md border border-slate-100 bg-slate-50 px-2.5 py-2" key={team.id}><TeamLogo className="!size-8 shrink-0 bg-[#061426]" initials={(team.short_name || team.name || "ทีม").slice(0, 3)} logoUrl={team.logo_url ?? ""} teamName={team.name} /><div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm font-black leading-5 text-[#061426]">{team.name}</p></div>{team.is_ksw ? <span className="shrink-0 rounded-full bg-[#fff7e6] px-2 py-1 text-[10px] font-black text-[#8a6418]">KSW</span> : null}</div>)}
          </div>
          {sortedTeams.length > 16 ? <button className="mt-4 min-h-11 rounded-md border border-slate-200 px-4 py-2 text-sm font-black text-[#061426] hover:border-[#d8ad45]" onClick={() => setShowAllTeams((current) => !current)} type="button">{showAllTeams ? "แสดงน้อยลง" : "แสดงทั้งหมด / Show all"}</button> : null}
        </article>
      </section>
      <AdminCompetitionGroupsManager competitionId={competitionId} groups={groups} matches={matches} onMatchesChange={(nextMatches) => setMatches(nextMatches as AdminCompetitionMatch[])} renderGroupProgram={(group) => <CupGroupProgram group={group} matches={matches} onSave={saveGroupMatch} teamsById={teamsById} />} schemaReady={groupDataReady} teams={groupTeams} />
      <CupQualificationPanel competitionId={competitionId} config={engineConfig} groups={groups} matches={matches} teams={groupTeams} />
      <AdminCompetitionWizardV2 competitionId={competitionId} competitionType="cup" existingConfig={engineConfig} groupCount={groups.length} groups={groups} participantCount={groupTeams.length} workflow={engineWorkflow} />
      <AdminCompetitionTreeEngineV2 bracketCapacity={engineConfig?.bracketCapacity ?? null} competitionId={competitionId} configReady={Boolean(engineConfig)} initialMatches={matches.filter((match) => match.competition_stage === "knockout").map((match) => ({ ...match, manual_winner_team_id: match.manual_winner_team_id ?? null, penalty_away_score: match.penalty_away_score ?? null, penalty_home_score: match.penalty_home_score ?? null, winner_team_id: match.winner_team_id ?? null })) as CompetitionKnockoutMatchV2[]} initialSummary={engineSummary} nodes={nodes} teams={matchTeams.map(({ id, logo_url, name, short_name }) => ({ id, logo_url, name, short_name }))} workflow={engineWorkflow} />
    </>
  );
}

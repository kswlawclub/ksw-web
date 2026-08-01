"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { updateMatch } from "@/app/admin/matches/actions";
import { AdminCompetitionGroupsManager, type AdminCompetitionGroup, type AdminCompetitionGroupTeam } from "@/components/admin-competition-groups-manager";
import { AdminCompetitionTreeEngineV2 } from "@/components/admin-competition-tree-engine-v2";
import { AdminCompetitionWizardV2 } from "@/components/admin-competition-wizard-v2";
import { TeamLogo } from "@/components/team-logo";
import { calculateCupGroupStandings } from "@/lib/cup-group-standings";
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
  }

  return (
    <form className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3" id={`group-match-${match.id}`} onSubmit={save}>
      <div className="grid gap-3 sm:grid-cols-2">{[{ key: "homeScore", team: home }, { key: "awayScore", team: away }].map(({ key, team }) => <label className="flex min-w-0 items-center gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm font-black" key={key}><TeamLogo className="!size-9 shrink-0 bg-[#061426]" initials={(team?.short_name || team?.name || "ทีม").slice(0, 3)} logoUrl={team?.logo_url ?? ""} teamName={team?.name ?? "ทีม"} /><span className="min-w-0 flex-1 break-words">{team?.name ?? "ทีม"}</span><input className="min-h-11 w-16 shrink-0 rounded-md border border-slate-200 px-2 text-center" max="999" min="0" onChange={(event) => updateDraft({ [key]: event.target.value })} step="1" type="number" value={draft[key as "homeScore" | "awayScore"]} /></label>)}</div>
      {(draft.homeScore !== "" || draft.awayScore !== "") && draft.status !== "finished" ? <p className="mt-3 rounded-md border border-[#d8ad45]/35 bg-[#fff7e6] px-3 py-2 text-xs font-bold text-[#8a6418]">มีสกอร์แล้ว แต่ยังไม่ยืนยันจบการแข่งขัน</p> : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="grid min-w-0 gap-1 text-xs font-black">วันและเวลา<input className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 px-3" onChange={(event) => updateDraft({ matchDate: event.target.value })} type="datetime-local" value={draft.matchDate} /></label><label className="grid min-w-0 gap-1 text-xs font-black">สนาม<input className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 px-3" onChange={(event) => updateDraft({ venue: event.target.value })} value={draft.venue} /></label><label className="grid min-w-0 gap-1 text-xs font-black">สถานะ<select className="min-h-11 w-full rounded-md border border-slate-200 px-3" onChange={(event) => updateDraft({ status: event.target.value as MatchForm["status"] })} value={draft.status}><option value="scheduled">รอแข่งขัน</option><option value="finished">จบการแข่งขัน</option></select></label></div>
      {error ? <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800">{error}</p> : null}
      {saved ? <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{draft.status === "finished" ? "บันทึกแล้ว ตารางคะแนนและทีมผ่านเข้ารอบอัปเดตทันที" : "บันทึกแล้ว"}</p> : null}
      <div className="mt-3 flex justify-end"><button className="min-h-11 rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] disabled:opacity-60" disabled={saving} type="submit">{saving ? "กำลังบันทึก..." : saved ? "บันทึกแล้ว" : "บันทึกแมตช์"}</button></div>
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
  const standings = useMemo(() => calculateCupGroupStandings({ groups, matches, teams: groupTeams }), [groups, matches, groupTeams]);
  const qualifiers = useMemo(() => standings.flatMap((standing) => standing.rows.filter((row) => row.qualifies)), [standings]);
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
      <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10"><article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-2xl font-black">ทีมผ่านเข้ารอบ</h2><p className="mt-1 text-sm font-semibold text-slate-600">คำนวณจากตารางคะแนนและจำนวนทีมผ่านเข้ารอบของแต่ละกลุ่ม</p><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{qualifiers.length ? qualifiers.map((row) => <div className="rounded-md border border-[#d8ad45]/35 bg-[#fff7e6] px-3 py-2 text-sm font-black" key={row.team_id}>{row.team_name}</div>) : <p className="text-sm font-semibold text-slate-600">รอผลการแข่งขันรอบแบ่งกลุ่ม</p>}</div></article></section>
      <AdminCompetitionWizardV2 competitionId={competitionId} competitionType="cup" existingConfig={engineConfig} groupCount={groups.length} groups={groups} participantCount={groupTeams.length} workflow={engineWorkflow} />
      <AdminCompetitionTreeEngineV2 bracketCapacity={engineConfig?.bracketCapacity ?? null} competitionId={competitionId} configReady={Boolean(engineConfig)} initialMatches={matches.filter((match) => match.competition_stage === "knockout").map((match) => ({ ...match, manual_winner_team_id: match.manual_winner_team_id ?? null, penalty_away_score: match.penalty_away_score ?? null, penalty_home_score: match.penalty_home_score ?? null, winner_team_id: match.winner_team_id ?? null })) as CompetitionKnockoutMatchV2[]} initialSummary={engineSummary} nodes={nodes} teams={matchTeams.map(({ id, logo_url, name, short_name }) => ({ id, logo_url, name, short_name }))} workflow={engineWorkflow} />
    </>
  );
}

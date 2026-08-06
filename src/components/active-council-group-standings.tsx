"use client";

import { useState } from "react";
import { ChevronDown, ListOrdered } from "lucide-react";
import { TeamLogo } from "@/components/team-logo";
import type { Row } from "@/lib/competition-data";
import type { CupGroupStanding } from "@/lib/cup-group-standings";
import { derivePublicGroupStagePresentation, togglePublicGroupStageGroup, type PublicGroupStageStatus } from "@/lib/public-cup-group-stage-presentation";

function value(row: Row, keys: string[], fallback = "") {
  for (const key of keys) {
    const candidate = row[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (typeof candidate === "number") return String(candidate);
  }
  return fallback;
}

function score(match: Row) {
  const home = match.home_score;
  const away = match.away_score;
  return typeof home === "number" && typeof away === "number" ? `${home}-${away}` : "VS";
}

function statusLabel(status: PublicGroupStageStatus) {
  if (status === "complete") return "แข่งครบแล้ว";
  if (status === "in_progress") return "กำลังแข่งขัน";
  return "ยังไม่เริ่ม";
}

function statusClass(status: PublicGroupStageStatus) {
  if (status === "complete") return "bg-emerald-50 text-emerald-800";
  if (status === "in_progress") return "bg-[#fff4dc] text-[#8a6418]";
  return "bg-slate-100 text-slate-600";
}

function GroupMatchCard({ match }: { match: Row }) {
  const homeName = value(match, ["home_team_name"], "ทีมเหย้า");
  const awayName = value(match, ["away_team_name"], "ทีมเยือน");
  const matchStatus = value(match, ["status"]);
  return (
    <article className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2"><TeamLogo className="!size-7 shrink-0" initials={homeName.slice(0, 3).toUpperCase()} logoUrl={value(match, ["home_team_logo_url"])} teamName={homeName} /><p className="min-w-0 break-words text-sm font-black leading-5 text-[#061426]">{homeName}</p></div>
      <span className="rounded-md bg-[#061426] px-2.5 py-1 text-xs font-black text-white">{score(match)}</span>
      <div className="flex min-w-0 items-center justify-end gap-2 text-right"><p className="min-w-0 break-words text-sm font-black leading-5 text-[#061426]">{awayName}</p><TeamLogo className="!size-7 shrink-0" initials={awayName.slice(0, 3).toUpperCase()} logoUrl={value(match, ["away_team_logo_url"])} teamName={awayName} /></div>
      {matchStatus ? <p className="col-span-3 text-right text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">{matchStatus}</p> : null}
    </article>
  );
}

export function ActiveCouncilGroupStandings({ matches, standings }: { matches: Row[]; standings: CupGroupStanding[] }) {
  const presentation = derivePublicGroupStagePresentation({ matches, standings });
  const [openGroupIds, setOpenGroupIds] = useState(() => presentation.groups[0] ? [presentation.groups[0].id] : []);

  if (!presentation.groups.length) return null;

  const matchSummary = presentation.totalMatches
    ? `${presentation.totalPlayedMatches === presentation.totalMatches ? "แข่งขันครบ" : "แข่งแล้ว"} ${presentation.totalPlayedMatches}/${presentation.totalMatches} แมตช์`
    : "";
  const headerSummary = [
    `${presentation.groups.length} กลุ่ม`,
    matchSummary,
    presentation.qualifiedTeams ? `ผ่านเข้ารอบ ${presentation.qualifiedTeams} ทีม` : "",
  ].filter(Boolean).join(" · ");

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10" id="group-standings">
      <div className="border-l-2 border-[#9b1c1f] pl-4 sm:pl-5">
        <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-[#9b1c1f]"><ListOrdered aria-hidden="true" className="size-4 shrink-0" />GROUP STAGE</p>
        <h2 className="mt-1 text-3xl font-black text-[#061426]">รอบแบ่งกลุ่ม</h2>
        {headerSummary ? <p className="mt-2 text-sm font-semibold text-slate-600">{headerSummary}</p> : null}
      </div>
      <div className="mt-5 grid gap-3">
        {presentation.groups.map((group, index) => {
          const open = openGroupIds.includes(group.id);
          const contentId = `group-standing-${group.id}`;
          return (
            <article className={`overflow-hidden rounded-xl border bg-white shadow-sm shadow-slate-900/10 ${index === 0 && open ? "border-[#d8ad45]/55" : "border-slate-200"}`} key={group.id}>
              <button aria-controls={contentId} aria-expanded={open} className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-[#fffaf0] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#d8ad45] sm:px-5" onClick={() => setOpenGroupIds((current) => togglePublicGroupStageGroup(current, group.id))} type="button">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-black text-[#061426]">{group.standing.group_label}</h3><span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${statusClass(group.status)}`}>{statusLabel(group.status)}</span></div>
                  <p className="mt-1 break-words text-xs font-bold leading-5 text-slate-600">{group.standing.team_count} ทีม · แข่งแล้ว {group.playedMatches}/{group.totalMatches} · ผ่านเข้ารอบ {group.qualifiedTeams} ทีม</p>
                  {group.leaderName ? <p className="mt-1 text-xs font-bold text-[#8a6418]">ผู้นำ: {group.leaderName}</p> : null}
                </div>
                <ChevronDown aria-hidden="true" className={`size-5 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
              {open ? <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-4 sm:px-5" id={contentId}>
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full min-w-[660px] border-separate border-spacing-0 text-left text-xs">
                    <thead className="bg-[#061426] text-white"><tr>{["#", "Team", "P", "W", "D", "L", "GF", "GA", "GD", "Pts", "Status"].map((label) => <th className="px-3 py-2 font-black" key={label}>{label}</th>)}</tr></thead>
                    <tbody>{group.standing.rows.map((row) => <tr className={row.qualifies ? "bg-[#fff7e6]" : "bg-white"} key={row.team_id}><td className="border-b border-slate-100 px-3 py-2 font-black">{row.position}</td><td className="min-w-48 border-b border-slate-100 px-3 py-2 font-black"><span className="break-words">{row.team_name}</span>{row.tie_unresolved ? <span className="mt-1 block text-[10px] font-bold text-[#8a6418]">อันดับยังเสมอกัน</span> : null}</td>{[row.played, row.won, row.drawn, row.lost, row.goals_for, row.goals_against, row.goal_difference, row.points].map((entry, entryIndex) => <td className="border-b border-slate-100 px-3 py-2 font-bold" key={entryIndex}>{entry}</td>)}<td className="border-b border-slate-100 px-3 py-2">{row.qualifies ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">ผ่านเข้ารอบ</span> : null}</td></tr>)}</tbody>
                  </table>
                </div>
                <div className="mt-4"><p className="text-xs font-black uppercase tracking-[0.16em] text-[#8a6418]">ผลการแข่งขัน</p>{group.matches.length ? <div className="mt-2 grid gap-2">{group.matches.map((match) => <GroupMatchCard key={value(match, ["id"])} match={match} />)}</div> : <p className="mt-2 text-sm font-semibold text-slate-500">ยังไม่มีโปรแกรมการแข่งขันของกลุ่มนี้</p>}</div>
              </div> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

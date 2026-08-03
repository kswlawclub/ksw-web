import { TeamLogo } from "@/components/team-logo";
import {
  groupPublicCupV2Rounds,
  publicCupV2ScoreLabel,
  publicCupV2SourceLabel,
} from "@/lib/public-cup-v2-bracket";
import type { PublicCupV2Data, PublicCupV2Node, PublicCupV2Team } from "@/lib/public-cup-v2-types";

function teamInitials(team: PublicCupV2Team | null, fallback: string) {
  const name = team?.shortName || team?.name || fallback;
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 3).toUpperCase();
}

function formatDateTime(value: string | null) {
  if (!value) return "รอกำหนดวันและเวลา";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).format(date);
}

function MatchTeamRow({ align, team, winner }: { align: "left" | "right"; team: PublicCupV2Team | null; winner: boolean }) {
  const name = team?.name || "รอผู้ชนะจากคู่ก่อนหน้า";
  return (
    <div className={`flex min-w-0 items-center gap-2 ${align === "right" ? "justify-end text-right" : ""}`}>
      {align === "right" ? <p className={`min-w-0 text-wrap text-sm leading-5 ${winner ? "font-black text-emerald-700" : "font-bold text-[#061426]"}`}>{name}</p> : null}
      <TeamLogo className="!size-7" initials={teamInitials(team, "?")} logoUrl={team?.logoUrl ?? ""} teamName={name} />
      {align === "left" ? <p className={`min-w-0 text-wrap text-sm leading-5 ${winner ? "font-black text-emerald-700" : "font-bold text-[#061426]"}`}>{name}</p> : null}
    </div>
  );
}

function PublicKnockoutMatchCard({ node }: { node: PublicCupV2Node }) {
  const match = node.linkedMatch;
  const home = match?.homeTeam ?? node.homeSource.team;
  const away = match?.awayTeam ?? node.awaySource.team;
  const finished = match ? ["finished", "completed"].includes(match.status) : false;
  const homeWinner = match?.winner?.id === home?.id;
  const awayWinner = match?.winner?.id === away?.id;
  const waitingForTeam = !match && (!node.homeSource.team || !node.awaySource.team);

  return (
    <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <MatchTeamRow align="left" team={home} winner={homeWinner} />
        <span className="whitespace-nowrap rounded-md bg-[#061426] px-2.5 py-1 text-xs font-black text-white">
          {publicCupV2ScoreLabel(node)}
        </span>
        <MatchTeamRow align="right" team={away} winner={awayWinner} />
      </div>
      {waitingForTeam ? <p className="mt-2 text-xs font-bold text-slate-500">{publicCupV2SourceLabel(node.homeSource)} · {publicCupV2SourceLabel(node.awaySource)}</p> : null}
      {match ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-500">
          <span>{formatDateTime(match.matchDate)}{match.venue ? ` · ${match.venue}` : ""}</span>
          <span className={finished ? "font-black text-emerald-700" : "font-black text-[#8a6418]"}>{finished ? "จบการแข่งขัน" : "รอแข่งขัน"}</span>
        </div>
      ) : null}
      {match?.winner ? <p className="mt-2 text-xs font-black text-emerald-700">ผู้ชนะ: {match.winner.name}</p> : null}
    </article>
  );
}

export function PublicKnockoutBracket({ data, seasonCompleted }: { data: PublicCupV2Data; seasonCompleted: boolean }) {
  const rounds = groupPublicCupV2Rounds(data.nodes);
  if (!rounds.length) return null;
  const champion = data.champions.main;

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10" id="knockout-bracket">
      <div className="border-y border-[#d8ad45]/30 bg-white shadow-xl shadow-slate-900/10">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-5 sm:px-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#8a6418]">KSW Standard</p>
            <h2 className="mt-1 text-2xl font-black text-[#061426]">สายการแข่งขันรอบน็อกเอาต์</h2>
          </div>
          {seasonCompleted ? <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">จบการแข่งขัน</span> : null}
        </div>
        {champion ? (
          <div className="border-b border-[#d8ad45]/25 bg-[#fff9ea] px-4 py-4 sm:px-6">
            <p className="text-xs font-black text-[#8a6418]">Champion</p>
            <div className="mt-2 flex min-w-0 items-center gap-3">
              <TeamLogo className="!size-10" initials={teamInitials(champion, "?")} logoUrl={champion.logoUrl ?? ""} teamName={champion.name} />
              <p className="min-w-0 text-wrap text-xl font-black text-[#061426]">{champion.name}</p>
            </div>
          </div>
        ) : null}
        <div className="grid gap-4 bg-slate-100 p-4 sm:p-6">
          {rounds.map((round) => (
            <details className="overflow-hidden rounded-lg border border-slate-200 bg-white" key={round.roundIndex} open={round.current}>
              <summary className="cursor-pointer list-none px-4 py-3 hover:bg-[#fffaf0]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-black text-[#061426]">{round.roundLabel}</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-black ${round.completed ? "bg-emerald-50 text-emerald-700" : round.current ? "bg-[#fff4dc] text-[#8a6418]" : "bg-slate-100 text-slate-600"}`}>
                    {round.completed ? `จบแล้ว ${round.finishedCount}/${round.nodes.length} คู่` : round.current ? "กำลังแข่งขัน" : "รอผลรอบก่อน"}
                  </span>
                </div>
              </summary>
              <div className="grid gap-2 border-t border-slate-100 p-3 sm:grid-cols-2 xl:grid-cols-3">
                {round.nodes.map((node) => <PublicKnockoutMatchCard key={node.id} node={node} />)}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

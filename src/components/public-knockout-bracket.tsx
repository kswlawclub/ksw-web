import { TeamLogo } from "@/components/team-logo";
import {
  groupPublicCupV2Rounds,
  publicCupV2ScoreLabel,
  publicCupV2SourceLabel,
} from "@/lib/public-cup-v2-bracket";
import type { PublicCupV2Data, PublicCupV2Node, PublicCupV2Team } from "@/lib/public-cup-v2-types";

type BracketTheme = "division_1" | "division_2" | "main";

const themes: Record<BracketTheme, { accent: string; badge: string; champion: string; eyebrow: string }> = {
  division_1: {
    accent: "border-[#d8ad45]/30",
    badge: "bg-[#fff4dc] text-[#8a6418]",
    champion: "bg-[#f7f9fc]",
    eyebrow: "text-[#8a6418]",
  },
  division_2: {
    accent: "border-emerald-800/25",
    badge: "bg-emerald-50 text-emerald-800",
    champion: "bg-[#f4faf6]",
    eyebrow: "text-emerald-800",
  },
  main: {
    accent: "border-[#d8ad45]/30",
    badge: "bg-[#fff4dc] text-[#8a6418]",
    champion: "bg-[#fff9ea]",
    eyebrow: "text-[#8a6418]",
  },
};

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

function partitionStatusLabel(status: string) {
  if (status === "completed") return "แข่งขันครบแล้ว";
  if (status === "active" || status === "fixtures_created") return "กำลังแข่งขัน";
  if (status === "reviewed") return "ยืนยันสายแล้ว";
  return "รอจัดสาย";
}

export function PublicKnockoutBracket({
  championLabel = "Champion",
  data,
  eyebrow = "KSW Standard",
  partitionKey = "main",
  roundOrder = "ascending",
  sectionId = "knockout-bracket",
  seasonCompleted,
  theme = "main",
  title = "สายการแข่งขันรอบน็อกเอาต์",
}: {
  championLabel?: string;
  data: PublicCupV2Data;
  eyebrow?: string;
  partitionKey?: string;
  roundOrder?: "ascending" | "descending";
  sectionId?: string;
  seasonCompleted: boolean;
  theme?: BracketTheme;
  title?: string;
}) {
  const rounds = groupPublicCupV2Rounds(data.nodes, partitionKey);
  if (!rounds.length) return null;
  const partition = data.partitions.find((entry) => entry.key === partitionKey);
  const champion = partition?.champion ?? null;
  const palette = themes[theme];

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10" id={sectionId}>
      <div className={`border-y bg-white shadow-xl shadow-slate-900/10 ${palette.accent}`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-5 sm:px-6">
          <div>
            <p className={`text-xs font-black uppercase tracking-[0.18em] ${palette.eyebrow}`}>{eyebrow}</p>
            <h2 className="mt-1 text-2xl font-black text-[#061426]">{title}</h2>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-black ${seasonCompleted ? "bg-emerald-50 text-emerald-700" : palette.badge}`}>{seasonCompleted ? "จบการแข่งขัน" : partitionStatusLabel(partition?.status ?? "draft")}</span>
        </div>
        {champion ? (
          <div className={`border-b border-slate-200 px-4 py-4 sm:px-6 ${palette.champion}`}>
            <p className={`text-xs font-black ${palette.eyebrow}`}>{championLabel}</p>
            <div className="mt-2 flex min-w-0 items-center gap-3">
              <TeamLogo className="!size-10" initials={teamInitials(champion, "?")} logoUrl={champion.logoUrl ?? ""} teamName={champion.name} />
              <p className="min-w-0 text-wrap text-xl font-black text-[#061426]">{champion.name}</p>
            </div>
          </div>
        ) : null}
        <div className="grid gap-4 bg-slate-100 p-4 sm:p-6">
          {(roundOrder === "descending" ? [...rounds].reverse() : rounds).map((round) => (
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

export function PublicCouncilCupBrackets({ data, seasonCompleted }: { data: PublicCupV2Data; seasonCompleted: boolean }) {
  const division1 = data.partitions.find((partition) => partition.key === "division_1");
  const division2 = data.partitions.find((partition) => partition.key === "division_2");
  const hasDivision1 = data.nodes.some((node) => node.partitionKey === "division_1");
  const hasDivision2 = data.nodes.some((node) => node.partitionKey === "division_2");
  if (!hasDivision1 && !hasDivision2) return null;
  const completedWithTwoChampions = seasonCompleted && Boolean(division1?.champion && division2?.champion);

  return (
    <>
      <section className="mx-auto w-full max-w-7xl px-4 pb-4 sm:px-6 lg:px-10" id="knockout-bracket">
        <div className="border-y border-slate-200 bg-white px-4 py-5 shadow-xl shadow-slate-900/10 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Council Cup</p>
              <h2 className="mt-1 text-2xl font-black text-[#061426]">สายการแข่งขันสองดิวิชั่น</h2>
            </div>
            {completedWithTwoChampions ? <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">จบการแข่งขัน · 2 Champions</span> : null}
          </div>
        </div>
      </section>
      {hasDivision1 ? <PublicKnockoutBracket championLabel="Champion Division 1" data={data} eyebrow="Council Cup" partitionKey="division_1" sectionId="knockout-division-1" seasonCompleted={division1?.status === "completed"} theme="division_1" title="Division 1" /> : null}
      {hasDivision2 ? <PublicKnockoutBracket championLabel="Champion Division 2" data={data} eyebrow="Council Cup" partitionKey="division_2" sectionId="knockout-division-2" seasonCompleted={division2?.status === "completed"} theme="division_2" title="Division 2" /> : null}
    </>
  );
}

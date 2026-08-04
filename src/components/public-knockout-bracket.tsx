import { TeamLogo } from "@/components/team-logo";
import {
  groupPublicCupV2Rounds,
  isPublicCupKswMatch,
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

function PublicKnockoutMatchCard({ compact, node }: { compact: boolean; node: PublicCupV2Node }) {
  const match = node.linkedMatch;
  const home = match?.homeTeam ?? node.homeSource.team;
  const away = match?.awayTeam ?? node.awaySource.team;
  const finished = match ? ["finished", "completed"].includes(match.status) : false;
  const homeWinner = match?.winner?.id === home?.id;
  const awayWinner = match?.winner?.id === away?.id;
  const waitingForTeam = !match && (!node.homeSource.team || !node.awaySource.team);
  const isKswMatch = isPublicCupKswMatch(node);

  return (
    <article className={`min-w-0 rounded-lg border shadow-sm ${compact ? "p-2.5" : "p-3"} ${isKswMatch ? "border-[#d8ad45]/80 bg-[#fffaf0] shadow-[#d8ad45]/15" : "border-slate-200 bg-white"}`}>
      {isKswMatch ? <span className="mb-2 inline-flex rounded-full bg-[#fff0c8] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-[#8a6418]">KSW Match</span> : null}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <MatchTeamRow align="left" team={home} winner={homeWinner} />
        <span className="whitespace-nowrap rounded-md bg-[#061426] px-2.5 py-1 text-xs font-black text-white">
          {publicCupV2ScoreLabel(node)}
        </span>
        <MatchTeamRow align="right" team={away} winner={awayWinner} />
      </div>
      {waitingForTeam ? <p className="mt-1.5 text-xs font-bold text-slate-500">{publicCupV2SourceLabel(node.homeSource)} · {publicCupV2SourceLabel(node.awaySource)}</p> : null}
      {match ? (
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-500">
          <span>{formatDateTime(match.matchDate)}{match.venue ? ` · ${match.venue}` : ""}</span>
          <span className={finished ? "font-black text-emerald-700" : "font-black text-[#8a6418]"}>{finished ? "จบการแข่งขัน" : "รอแข่งขัน"}</span>
        </div>
      ) : null}
      {match?.winner ? <p className="mt-1.5 text-xs font-black text-emerald-700">ผู้ชนะ: {match.winner.name}</p> : null}
    </article>
  );
}

function partitionStatusLabel(status: string) {
  if (status === "completed") return "แข่งขันครบแล้ว";
  if (status === "active" || status === "fixtures_created") return "กำลังแข่งขัน";
  if (status === "reviewed") return "ยืนยันสายแล้ว";
  return "รอจัดสาย";
}

function localizedRoundLabel(label: string, localized: boolean) {
  if (!localized) return label;
  const normalized = label.toLowerCase();
  if (normalized.includes("final") && !normalized.includes("semi")) return "รอบชิงชนะเลิศ";
  if (normalized.includes("semi")) return "รอบรองชนะเลิศ";
  if (normalized.includes("quarter")) return "รอบก่อนรองชนะเลิศ";
  if (normalized.includes("group")) return "รอบแบ่งกลุ่ม";
  if (normalized.includes("round")) return "รอบน็อกเอาต์ก่อนหน้า";
  return label;
}

export function PublicKnockoutBracket({
  championLabel = "Champion",
  compact = false,
  data,
  eyebrow = "KSW Standard",
  localized = false,
  partitionKey = "main",
  roundOrder = "ascending",
  sectionId = "knockout-bracket",
  seasonCompleted,
  theme = "main",
  title = "สายการแข่งขันรอบน็อกเอาต์",
}: {
  championLabel?: string;
  compact?: boolean;
  data: PublicCupV2Data;
  eyebrow?: string;
  localized?: boolean;
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
    <section className={`mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10 ${compact ? "pb-6" : "pb-10"}`} id={sectionId}>
      <div className={`border-y bg-white shadow-xl shadow-slate-900/10 ${palette.accent}`}>
        <div className={`flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 sm:px-6 ${compact ? "py-3" : "py-5"}`}>
          <div>
            <p className={`text-xs font-black uppercase tracking-[0.18em] ${palette.eyebrow}`}>{eyebrow}</p>
            <h2 className="mt-1 text-2xl font-black text-[#061426]">{title}</h2>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-black ${seasonCompleted ? "bg-emerald-50 text-emerald-700" : palette.badge}`}>{seasonCompleted ? "จบการแข่งขัน" : partitionStatusLabel(partition?.status ?? "draft")}</span>
        </div>
        {champion ? (
          <div className={`border-b border-slate-200 px-4 sm:px-6 ${palette.champion} ${compact ? "py-3" : "py-4"}`}>
            <p className={`text-xs font-black ${palette.eyebrow}`}>{championLabel}</p>
            <div className="mt-2 flex min-w-0 items-center gap-3">
              <TeamLogo className="!size-10" initials={teamInitials(champion, "?")} logoUrl={champion.logoUrl ?? ""} teamName={champion.name} />
              <p className="min-w-0 text-wrap text-xl font-black text-[#061426]">{champion.name}</p>
            </div>
          </div>
        ) : null}
        <div className={`grid bg-slate-100 ${compact ? "gap-2 p-2.5 sm:p-3" : "gap-4 p-4 sm:p-6"}`}>
          {(roundOrder === "descending" ? [...rounds].reverse() : rounds).map((round) => (
            <details className="overflow-hidden rounded-lg border border-slate-200 bg-white" key={round.roundIndex} open={round.current}>
              <summary className={`cursor-pointer list-none hover:bg-[#fffaf0] ${compact ? "px-3 py-2.5" : "px-4 py-3"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-black text-[#061426]">{localizedRoundLabel(round.roundLabel, localized)}</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-black ${round.completed ? "bg-emerald-50 text-emerald-700" : round.current ? "bg-[#fff4dc] text-[#8a6418]" : "bg-slate-100 text-slate-600"}`}>
                    {round.completed ? `จบแล้ว ${round.finishedCount}/${round.nodes.length} คู่` : round.current ? "กำลังแข่งขัน" : "รอผลรอบก่อน"}
                  </span>
                </div>
              </summary>
              <div className={`grid gap-2 border-t border-slate-100 sm:grid-cols-2 xl:grid-cols-3 ${compact ? "p-2.5" : "p-3"}`}>
                {round.nodes.map((node) => <PublicKnockoutMatchCard compact={compact} key={node.id} node={node} />)}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function PublicCouncilCupBrackets({ compact = false, data, localized = false, seasonCompleted, showOverview = true }: { compact?: boolean; data: PublicCupV2Data; localized?: boolean; seasonCompleted: boolean; showOverview?: boolean }) {
  const division1 = data.partitions.find((partition) => partition.key === "division_1");
  const division2 = data.partitions.find((partition) => partition.key === "division_2");
  const hasDivision1 = data.nodes.some((node) => node.partitionKey === "division_1");
  const hasDivision2 = data.nodes.some((node) => node.partitionKey === "division_2");
  if (!hasDivision1 && !hasDivision2) return null;
  const completedWithTwoChampions = seasonCompleted && Boolean(division1?.champion && division2?.champion);

  return (
    <>
      {showOverview ? <section className="mx-auto w-full max-w-7xl px-4 pb-4 sm:px-6 lg:px-10" id="knockout-bracket">
        <div className="border-y border-slate-200 bg-white px-4 py-5 shadow-xl shadow-slate-900/10 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Council Cup</p>
              <h2 className="mt-1 text-2xl font-black text-[#061426]">สายการแข่งขันสองดิวิชั่น</h2>
            </div>
            {completedWithTwoChampions ? <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">จบการแข่งขัน · 2 Champions</span> : null}
          </div>
        </div>
      </section> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        {hasDivision1 ? <PublicKnockoutBracket championLabel={localized ? "แชมป์ Division 1" : "Champion Division 1"} compact={compact} data={data} eyebrow={localized ? "คัพสภาทนายความ" : "Council Cup"} localized={localized} partitionKey="division_1" sectionId="knockout-division-1" seasonCompleted={division1?.status === "completed"} theme="division_1" title="Division 1" /> : null}
        {hasDivision2 ? <PublicKnockoutBracket championLabel={localized ? "แชมป์ Division 2" : "Champion Division 2"} compact={compact} data={data} eyebrow={localized ? "คัพสภาทนายความ" : "Council Cup"} localized={localized} partitionKey="division_2" sectionId="knockout-division-2" seasonCompleted={division2?.status === "completed"} theme="division_2" title="Division 2" /> : null}
      </div>
    </>
  );
}

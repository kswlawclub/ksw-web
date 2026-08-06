import { TeamLogo } from "@/components/team-logo";
import { Activity, CalendarDays, CheckCircle2, ChevronDown, CircleDot, Clock3, Flag, GitBranch, MapPin, Trophy } from "lucide-react";
import {
  groupPublicCupV2Rounds,
  isPublicCupKswMatch,
  publicCupV2ScoreLabel,
  publicCupV2SourcePresentation,
  publicCupV2SourceLabel,
} from "@/lib/public-cup-v2-bracket";
import type { PublicCupV2Data, PublicCupV2Node, PublicCupV2Team } from "@/lib/public-cup-v2-types";
import { derivePublicCouncilLiveDivisionState, publicCouncilDivisionPresentation, type PublicCouncilCupPresentation, type PublicCouncilLiveDivisionState, type PublicCouncilLiveDivisionStatus } from "@/lib/public-council-cup-presentation";

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
      {align === "right" ? <p className={`min-w-0 max-w-full break-words whitespace-normal [overflow-wrap:anywhere] text-sm leading-5 ${winner ? "font-black text-emerald-700" : "font-bold text-[#061426]"}`}>{name}</p> : null}
      <TeamLogo className="!size-7 shrink-0" initials={teamInitials(team, "?")} logoUrl={team?.logoUrl ?? ""} teamName={name} />
      {align === "left" ? <p className={`min-w-0 max-w-full break-words whitespace-normal [overflow-wrap:anywhere] text-sm leading-5 ${winner ? "font-black text-emerald-700" : "font-bold text-[#061426]"}`}>{name}</p> : null}
    </div>
  );
}

function PublicKnockoutMatchCard({ chronicle = false, compact, liveCenter = false, node, placeholder = false, sourceLabels }: { chronicle?: boolean; compact: boolean; liveCenter?: boolean; node: PublicCupV2Node; placeholder?: boolean; sourceLabels?: { away: string; home: string } }) {
  const match = node.linkedMatch;
  const home = match?.homeTeam ?? node.homeSource.team;
  const away = match?.awayTeam ?? node.awaySource.team;
  const finished = match ? ["finished", "completed"].includes(match.status) : false;
  const homeWinner = match?.winner?.id === home?.id;
  const awayWinner = match?.winner?.id === away?.id;
  const waitingForTeam = !match && (!node.homeSource.team || !node.awaySource.team);
  const isKswMatch = isPublicCupKswMatch(node);
  const isLive = match?.status === "active";

  return (
    <article className={`min-w-0 border ${placeholder ? "rounded-lg border-dashed border-slate-300 bg-slate-50 shadow-none" : chronicle ? "rounded-md px-3 py-3 shadow-none" : `rounded-lg shadow-sm ${compact ? "p-2.5" : "p-3"}`} ${placeholder ? "" : liveCenter && finished ? "border-emerald-200 bg-emerald-50/40" : liveCenter && isLive ? "border-[#d8ad45]/70 bg-[#fffaf0] shadow-[#d8ad45]/15" : isKswMatch ? "border-[#d8ad45]/80 bg-[#fffaf0] shadow-[#d8ad45]/15" : "border-slate-200 bg-white"}`}>
      {isKswMatch ? <span className={`mb-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-[#8a6418] ${chronicle ? "bg-[#fff7df]" : "bg-[#fff0c8]"}`}>KSW Match</span> : null}
      {liveCenter && match ? <div className="mb-2 flex justify-end"><span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] ${finished ? "bg-emerald-100 text-emerald-800" : isLive ? "bg-[#fff0c8] text-[#8a6418]" : "bg-slate-100 text-slate-600"}`}>{finished ? "FT" : isLive ? "LIVE" : "Scheduled"}</span></div> : null}
      <div className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center ${chronicle ? "gap-3" : "gap-2"}`}>
        <MatchTeamRow align="left" team={home} winner={homeWinner} />
        <span className="whitespace-nowrap rounded-md bg-[#061426] px-2.5 py-1 text-xs font-black text-white">
          {publicCupV2ScoreLabel(node)}
        </span>
        <MatchTeamRow align="right" team={away} winner={awayWinner} />
      </div>
      {waitingForTeam || placeholder ? <p className="mt-1.5 text-xs font-bold text-slate-500">{sourceLabels?.home ?? publicCupV2SourceLabel(node.homeSource)} · {sourceLabels?.away ?? publicCupV2SourceLabel(node.awaySource)}</p> : null}
      {match ? (
        <div className={`flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-500 ${chronicle ? "mt-2 border-t border-slate-100 pt-2" : "mt-1.5"}`}>
          <span className="flex min-w-0 items-center gap-1.5">{chronicle ? <CalendarDays aria-hidden="true" className="size-3.5 shrink-0" /> : null}{formatDateTime(match.matchDate)}{match.venue ? <><span aria-hidden="true">·</span>{chronicle ? <MapPin aria-hidden="true" className="size-3.5 shrink-0" /> : null}{match.venue}</> : null}</span>
          <span className={finished ? "font-black text-emerald-700" : "font-black text-[#8a6418]"}>{finished ? "จบการแข่งขัน" : "รอแข่งขัน"}</span>
        </div>
      ) : placeholder ? <div className="mt-2 flex justify-end"><span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-600">{node.homeSource.team && node.awaySource.team ? "รอประกาศโปรแกรม" : "รอผลการแข่งขัน"}</span></div> : null}
      {match?.winner ? <p className="mt-1.5 flex items-center gap-1.5 text-xs font-black text-emerald-700">{chronicle || liveCenter ? <Trophy aria-hidden="true" className="size-3.5 shrink-0" /> : null}ผู้ชนะ: {match.winner.name}</p> : null}
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
  if (normalized.includes("quarter")) return "รอบก่อนรองชนะเลิศ";
  if (normalized.includes("semi")) return "รอบรองชนะเลิศ";
  if (normalized.includes("final")) return "รอบชิงชนะเลิศ";
  if (normalized.includes("group")) return "รอบแบ่งกลุ่ม";
  if (normalized.includes("round")) return "รอบน็อกเอาต์ก่อนหน้า";
  return label;
}

function isFinishedMatch(match: PublicCupV2Node["linkedMatch"]) {
  return Boolean(match && ["finished", "completed"].includes(match.status));
}

function liveRoundTimeline(data: PublicCupV2Data, partitionKey: "division_1" | "division_2") {
  const visibleRounds = groupPublicCupV2Rounds(data.nodes, partitionKey);
  const visibleRoundByIndex = new Map(visibleRounds.map((round) => [round.roundIndex, round]));
  const groups = new Map<number, PublicCupV2Node[]>();
  data.nodes
    .filter((node) => node.partitionKey === partitionKey)
    .forEach((node) => groups.set(node.roundIndex, [...(groups.get(node.roundIndex) ?? []), node]));

  return Array.from(groups.entries())
    .sort(([left], [right]) => left - right)
    .map(([roundIndex, nodes]) => {
      const visible = visibleRoundByIndex.get(roundIndex);
      const orderedNodes = [...nodes].sort((left, right) => left.matchOrder - right.matchOrder);
      const finishedCount = orderedNodes.filter((node) => isFinishedMatch(node.linkedMatch)).length;
      return {
        completed: visible?.completed ?? false,
        current: visible?.current ?? false,
        finishedCount,
        hasPublicPairing: Boolean(visible),
        nodes: orderedNodes,
        roundIndex,
        roundLabel: orderedNodes[0]?.roundLabel || `Round ${roundIndex + 1}`,
      };
    });
}

function LiveDivisionOverview({ data, partitionKey, presentation, theme, title }: {
  data: PublicCupV2Data;
  partitionKey: "division_1" | "division_2";
  presentation: PublicCouncilCupPresentation;
  theme: Extract<BracketTheme, "division_1" | "division_2">;
  title: string;
}) {
  const palette = themes[theme];
  const partition = data.partitions.find((entry) => entry.key === partitionKey);
  const rounds = liveRoundTimeline(data, partitionKey);
  const currentRound = rounds.find((round) => round.current) ?? null;
  const matches = rounds.flatMap((round) => round.nodes.map((node) => node.linkedMatch).filter((match): match is NonNullable<typeof match> => Boolean(match)));
  const remainingMatches = matches.filter((match) => !isFinishedMatch(match)).length;
  const latestWinner = [...matches]
    .filter((match) => match.winner)
    .sort((left, right) => (right.matchDate ?? "").localeCompare(left.matchDate ?? ""))[0]?.winner ?? null;
  const progress = matches.length ? Math.round((matches.filter(isFinishedMatch).length / matches.length) * 100) : 0;
  const awaitingCompletion = presentation.state === "awaiting_completion";
  const finalState = publicCouncilDivisionPresentation(presentation, partitionKey);

  return (
    <article className={`min-w-0 overflow-hidden rounded-xl border bg-white shadow-sm shadow-slate-900/10 ${palette.accent}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <p className={`text-xs font-black uppercase tracking-[0.18em] ${palette.eyebrow}`}>Council Cup</p>
          <h3 className="mt-1 text-xl font-black text-[#061426]">{title}</h3>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-black ${palette.badge}`}>{awaitingCompletion ? "รอปิดการแข่งขัน" : partitionStatusLabel(partition?.status ?? "draft")}</span>
      </header>
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{awaitingCompletion ? "สถานะ" : "Current round"}</p>
            <p className="mt-1 break-words font-black text-[#061426]">{awaitingCompletion ? "รอบทั้งหมดแข่งขันครบแล้ว" : currentRound ? localizedRoundLabel(currentRound.roundLabel, true) : "รอจัดโปรแกรม"}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{awaitingCompletion ? "ผลรอบชิง" : "Matches remaining"}</p>
            <p className="mt-1 font-black text-[#061426]">{awaitingCompletion ? "ครบถ้วน" : `${remainingMatches} คู่`}</p>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between gap-3 text-xs font-bold text-slate-600"><span>ความคืบหน้า</span><span>{progress}%</span></div>
          <div aria-label={`ความคืบหน้า ${title} ${awaitingCompletion ? 100 : progress}%`} className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemax={100} aria-valuemin={0} aria-valuenow={awaitingCompletion ? 100 : progress}>
            <div className={`h-full rounded-full ${theme === "division_1" ? "bg-[#d8ad45]" : "bg-emerald-600"}`} style={{ width: `${awaitingCompletion ? 100 : progress}%` }} />
          </div>
        </div>
        {awaitingCompletion && finalState?.candidateWinner ? <div className={`flex min-w-0 items-center gap-2 border-t border-slate-100 pt-3 text-sm font-bold ${palette.eyebrow}`}><Trophy aria-hidden="true" className="size-4 shrink-0" /><span className="min-w-0 break-words">ผู้ชนะรอรับรอง: {finalState.candidateWinner.name}</span></div> : latestWinner ? <div className={`flex min-w-0 items-center gap-2 border-t border-slate-100 pt-3 text-sm font-bold ${palette.eyebrow}`}><Trophy aria-hidden="true" className="size-4 shrink-0" /><span className="min-w-0 break-words">ผู้ท้าชิงล่าสุด: {latestWinner.name}</span></div> : null}
      </div>
    </article>
  );
}

function LiveCurrentMatches({ data, otherDivisionState, partitionKey, presentation, theme, title }: {
  data: PublicCupV2Data;
  otherDivisionState: PublicCouncilLiveDivisionState;
  partitionKey: "division_1" | "division_2";
  presentation: PublicCouncilCupPresentation;
  theme: Extract<BracketTheme, "division_1" | "division_2">;
  title: string;
}) {
  const state = derivePublicCouncilLiveDivisionState({ data, partitionKey, presentation });
  const statusCopy: Record<Exclude<PublicCouncilLiveDivisionStatus, "awaiting_completion">, { chip: string; icon: typeof Clock3; message: string }> = {
    awaiting_next_round: { chip: "รอผลการแข่งขัน", icon: Clock3, message: state.waitingFor ? `กำลังรอ ${state.waitingFor}` : "กำลังรอผู้ชนะจากรอบก่อนหน้า" },
    playing: { chip: "กำลังแข่งขัน", icon: CircleDot, message: "ติดตามผลการแข่งขันในรอบนี้" },
    ready_for_next_round: { chip: "พร้อมสร้างรอบถัดไป", icon: CalendarDays, message: "ผู้ชนะครบแล้ว รอผู้ดูแลประกาศโปรแกรมการแข่งขัน" },
    round_complete: { chip: "จบรอบแล้ว", icon: CheckCircle2, message: otherDivisionState.status === "playing" ? `ผลการแข่งขันรอบนี้ครบแล้ว · กำลังรอ ${otherDivisionState.roundLabel ? "Division อื่นแข่งขันให้ครบ" : "ความพร้อมของรอบถัดไป"}` : state.waitingFor ? `ผลการแข่งขันรอบนี้ครบแล้ว · กำลังรอ ${state.waitingFor}` : "ผลการแข่งขันรอบนี้ครบแล้ว รอผู้ดูแลสร้างโปรแกรมรอบถัดไป" },
  };
  const display = statusCopy[state.status === "awaiting_completion" ? "round_complete" : state.status];
  const StatusIcon = display.icon;

  return (
    <article className={`min-w-0 overflow-hidden rounded-xl border bg-white shadow-sm shadow-slate-900/10 ${themes[theme].accent}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
        <div className="min-w-0"><p className={`text-xs font-black uppercase tracking-[0.16em] ${themes[theme].eyebrow}`}>{title}</p><h3 className="mt-1 text-lg font-black text-[#061426]">{state.roundLabel ? localizedRoundLabel(state.roundLabel, true) : "รอบน็อกเอาต์"}</h3></div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-black ${themes[theme].badge}`}>{display.chip}</span>
      </header>
      <div className="grid grid-cols-3 gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3 text-center text-xs font-bold text-slate-600 sm:px-5"><span>ทั้งหมด {state.matchCount}</span><span>จบแล้ว {state.completedMatches}</span><span>เหลือ {state.remainingMatches}</span></div>
      <div className="flex min-w-0 items-start gap-3 px-4 py-4 sm:px-5"><StatusIcon aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${themes[theme].eyebrow}`} /><div className="min-w-0"><p className="break-words text-sm font-black text-[#061426]">{display.message}</p>{state.nextRoundLabel ? <p className="mt-1 text-sm font-semibold text-slate-600">ขั้นตอนถัดไป: {localizedRoundLabel(state.nextRoundLabel, true)}</p> : null}</div></div>
    </article>
  );
}

function LiveNextRoundPreview({ data, partitionKey, title }: { data: PublicCupV2Data; partitionKey: "division_1" | "division_2"; title: string }) {
  const rounds = liveRoundTimeline(data, partitionKey);
  const currentRound = rounds.find((round) => round.current);
  const nextRound = currentRound ? rounds.find((round) => round.roundIndex > currentRound.roundIndex) : rounds[0];
  if (!nextRound) return null;
  return <article className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 sm:px-5"><p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{title}</p><div className="mt-2 flex min-w-0 items-center gap-2"><Clock3 aria-hidden="true" className="size-4 shrink-0 text-slate-500" /><p className="min-w-0 break-words text-base font-black text-[#061426]">{localizedRoundLabel(nextRound.roundLabel, true)}</p></div><p className="mt-2 text-sm font-semibold text-slate-600">{nextRound.hasPublicPairing ? "รอผลจากรอบปัจจุบัน" : "รอผู้ชนะจากรอบก่อนหน้า"}</p></article>;
}

function LiveBracketTimeline({ data, partitionKey, presentation, theme, title }: { data: PublicCupV2Data; partitionKey: "division_1" | "division_2"; presentation: PublicCouncilCupPresentation; theme: Extract<BracketTheme, "division_1" | "division_2">; title: string }) {
  const rounds = liveRoundTimeline(data, partitionKey);
  const finalState = publicCouncilDivisionPresentation(presentation, partitionKey);
  if (!rounds.length) return null;
  return <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/10 sm:p-5"><p className={`text-xs font-black uppercase tracking-[0.16em] ${themes[theme].eyebrow}`}>{title}</p><div className="mt-3 grid gap-2 sm:grid-cols-3">{rounds.map((round) => {
    const state = round.completed ? "completed" : round.current ? "current" : "future";
    const isFinal = finalState?.finalRoundIndex === round.roundIndex;
    return <div className={`min-w-0 rounded-lg border px-3 py-3 ${state === "completed" ? "border-emerald-200 bg-emerald-50" : state === "current" ? themes[theme].badge : "border-slate-200 bg-slate-50"}`} key={round.roundIndex}><div className="flex items-start justify-between gap-2"><p className="min-w-0 break-words text-sm font-black text-[#061426]">{localizedRoundLabel(round.roundLabel, true)}</p>{state === "completed" ? <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-emerald-700" /> : state === "current" ? <CircleDot aria-hidden="true" className={`size-4 shrink-0 ${themes[theme].eyebrow}`} /> : <Flag aria-hidden="true" className="size-4 shrink-0 text-slate-400" />}</div><p className="mt-2 text-xs font-bold text-slate-600">{state === "completed" ? "จบแล้ว" : state === "current" ? "กำลังแข่งขัน" : "รอผลรอบก่อน"}</p>{isFinal && finalState?.candidateWinner ? <p className={`mt-2 break-words text-xs font-black ${themes[theme].eyebrow}`}>ผู้ชนะ: {finalState.candidateWinner.name}</p> : null}</div>;
  })}</div></article>;
}

function AwaitingCompletionChampionSummary({ presentation }: { presentation: PublicCouncilCupPresentation }) {
  if (presentation.state !== "awaiting_completion") return null;
  return <section className="mx-auto w-full max-w-7xl px-4 pb-8 sm:px-6 lg:px-10" id="winner-summary"><div className="rounded-xl border border-[#d8ad45]/30 bg-white p-4 shadow-sm shadow-slate-900/10 sm:p-5"><div><p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-[#8a6418]"><Trophy aria-hidden="true" className="size-4 shrink-0" />Results confirmed</p><h2 className="mt-1 text-2xl font-black text-[#061426]">ผู้ชนะการแข่งขัน</h2><p className="mt-1 text-sm font-semibold text-slate-600">ผลรอบชิงครบแล้ว รอการรับรองอย่างเป็นทางการเมื่อปิดการแข่งขัน</p></div><div className="mt-4 grid gap-4 xl:grid-cols-2 xl:gap-5">{presentation.divisions.map((division) => { const gold = division.partitionKey === "division_1"; const winner = division.candidateWinner; return <article className={`min-w-0 rounded-xl border p-4 ${gold ? "border-[#d8ad45]/35 bg-[#fffaf0]" : "border-emerald-200 bg-emerald-50/60"}`} key={division.partitionKey}><p className={`text-xs font-black uppercase tracking-[0.16em] ${gold ? "text-[#8a6418]" : "text-emerald-800"}`}>Division {gold ? "1" : "2"}</p><div className="mt-3 flex min-w-0 items-center gap-3"><TeamLogo className="!size-11 shrink-0" initials={teamInitials(winner, "?")} logoUrl={winner?.logoUrl ?? ""} teamName={winner?.name ?? "ทีมรอรับรอง"} /><div className="min-w-0"><p className="break-words text-lg font-black text-[#061426]">{winner?.name ?? "ทีมรอรับรอง"}</p><p className="mt-1 text-sm font-bold text-slate-600">ชนะเลิศ Division {gold ? "1" : "2"}</p></div></div><span className={`mt-4 inline-flex rounded-full px-2.5 py-1 text-xs font-black ${gold ? "bg-[#fff0c8] text-[#8a6418]" : "bg-emerald-100 text-emerald-800"}`}>ผู้ชนะรอรับรอง</span></article>; })}</div></div></section>;
}

function LiveLatestResults({ data }: { data: PublicCupV2Data }) {
  const results = data.linkedMatches.filter(isFinishedMatch).sort((left, right) => (right.matchDate ?? "").localeCompare(left.matchDate ?? "")).slice(0, 5);
  if (!results.length) return null;
  return <section className="mx-auto w-full max-w-7xl px-4 pb-8 sm:px-6 lg:px-10" id="tournament-results"><div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-900/10"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5"><div><p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-[#8a6418]"><Activity aria-hidden="true" className="size-4 shrink-0" />Latest results</p><h2 className="mt-1 text-2xl font-black text-[#061426]">ผลการแข่งขันล่าสุด</h2></div><a className="text-sm font-black text-[#8a6418] underline decoration-[#d8ad45]/60 underline-offset-4 hover:text-[#061426]" href="#bracket-timeline">ดูเส้นทางการแข่งขัน</a></div><div className="divide-y divide-slate-100">{results.map((match) => <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4 py-3 sm:px-5" key={match.id}><p className="min-w-0 break-words text-sm font-bold text-[#061426]">{match.homeTeam?.name ?? "ทีมเหย้า"}</p><span className="rounded-md bg-[#061426] px-2.5 py-1 text-xs font-black text-white">{match.homeScore ?? 0}-{match.awayScore ?? 0}</span><p className="min-w-0 break-words text-right text-sm font-bold text-[#061426]">{match.awayTeam?.name ?? "ทีมเยือน"}</p><p className="col-span-3 text-xs font-semibold text-slate-500">FT · {formatDateTime(match.matchDate)}</p></div>)}</div></div></section>;
}

export function PublicCouncilCupLiveCenter({ data, presentation }: { data: PublicCupV2Data; presentation: PublicCouncilCupPresentation }) {
  const divisionKeys = ["division_1", "division_2"] as const;
  const divisions = divisionKeys.filter((partitionKey) => data.partitions.some((partition) => partition.key === partitionKey) || data.nodes.some((node) => node.partitionKey === partitionKey));
  if (!divisions.length) return null;
  const allRounds = divisions.flatMap((partitionKey) => liveRoundTimeline(data, partitionKey));
  const currentRounds = allRounds.filter((round) => round.current);
  const matches = data.linkedMatches;
  const remainingMatches = matches.filter((match) => !isFinishedMatch(match)).length;
  const progress = matches.length ? Math.round((matches.filter(isFinishedMatch).length / matches.length) * 100) : 0;
  const awaitingCompletion = presentation.state === "awaiting_completion";
  const divisionStates = new Map(divisions.map((partitionKey) => [partitionKey, derivePublicCouncilLiveDivisionState({ data, partitionKey, presentation })]));
  const hasPlayingDivision = Array.from(divisionStates.values()).some((state) => state.status === "playing");
  const hasMixedDivisionPace = new Set(Array.from(divisionStates.values()).map((state) => state.status)).size > 1;
  const liveCenterSubtitle = hasPlayingDivision ? (hasMixedDivisionPace ? "แต่ละ Division อาจอยู่คนละจังหวะของการแข่งขัน" : "ติดตามคู่แข่งขันของแต่ละ Division") : "กำลังรอผลหรือการสร้างโปรแกรมรอบถัดไป";

  return <>
    <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-10" id="live-status"><div className="rounded-xl border border-[#d8ad45]/30 bg-white p-4 shadow-sm shadow-slate-900/10 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-[#8a6418]"><Activity aria-hidden="true" className="size-4 shrink-0" />{awaitingCompletion ? "Results confirmed" : "Current tournament status"}</p><h2 className="mt-1 text-2xl font-black text-[#061426]">{awaitingCompletion ? "การแข่งขันครบแล้ว" : "ตอนนี้การแข่งขันอยู่ที่"}</h2><p className="mt-1 text-sm font-semibold text-slate-600">{awaitingCompletion ? "ผลรอบชิงครบทั้งสอง Division · รอการยืนยันปิดการแข่งขัน" : null}</p></div><span className="rounded-full bg-[#fff4dc] px-3 py-1.5 text-xs font-black text-[#8a6418]">{awaitingCompletion ? "รอปิดการแข่งขัน" : currentRounds.length ? currentRounds.map((round) => localizedRoundLabel(round.roundLabel, true)).filter((value, index, values) => values.indexOf(value) === index).join(" · ") : "รอจัดโปรแกรม"}</span></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"><p className="text-xs font-bold text-slate-500">แมตช์ที่เหลือ</p><p className="mt-1 text-2xl font-black text-[#061426]">{awaitingCompletion ? 0 : remainingMatches}</p></div><div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"><p className="text-xs font-bold text-slate-500">แมตช์ที่แข่งแล้ว</p><p className="mt-1 text-2xl font-black text-[#061426]">{matches.filter(isFinishedMatch).length}</p></div><div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"><p className="text-xs font-bold text-slate-500">ความคืบหน้ารายการ</p><p className="mt-1 text-2xl font-black text-[#061426]">{awaitingCompletion ? 100 : progress}%</p></div></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#d8ad45]" style={{ width: `${awaitingCompletion ? 100 : progress}%` }} /></div>{presentation.hasFinalWinnerGap ? <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-600">ผลรอบชิงครบแล้ว แต่ยังยืนยันผู้ชนะจากข้อมูลการแข่งขันไม่ได้</p> : null}</div></section>
    {presentation.state === "completed" ? <AwaitingCompletionChampionSummary presentation={presentation} /> : null}
    {presentation.state === "completed" ? <section className="mx-auto w-full max-w-7xl px-4 pb-8 sm:px-6 lg:px-10"><div className="grid gap-4 xl:grid-cols-2 xl:gap-5">{divisions.map((partitionKey) => <LiveDivisionOverview data={data} key={partitionKey} partitionKey={partitionKey} presentation={presentation} theme={partitionKey === "division_1" ? "division_1" : "division_2"} title={partitionKey === "division_1" ? "Division 1" : "Division 2"} />)}</div></section> : null}
    {!awaitingCompletion ? <section className="mx-auto w-full max-w-7xl px-4 pb-8 sm:px-6 lg:px-10" id="current-matches"><div className="mb-4"><p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-[#8a6418]"><CircleDot aria-hidden="true" className="size-4 shrink-0" />LIVE MATCH CENTER</p><h2 className="mt-1 text-2xl font-black text-[#061426]">สถานะการแข่งขันรอบปัจจุบัน</h2><p className="mt-1 text-sm font-semibold text-slate-600">{liveCenterSubtitle}</p></div><div className="grid gap-4 xl:grid-cols-2 xl:gap-5">{divisions.map((partitionKey) => <LiveCurrentMatches data={data} key={partitionKey} otherDivisionState={divisionStates.get(partitionKey === "division_1" ? "division_2" : "division_1") ?? divisionStates.get(partitionKey)!} partitionKey={partitionKey} presentation={presentation} theme={partitionKey === "division_1" ? "division_1" : "division_2"} title={partitionKey === "division_1" ? "Division 1" : "Division 2"} />)}</div></section> : null}
    {presentation.state === "completed" ? <section className="mx-auto grid w-full max-w-7xl gap-4 px-4 pb-8 sm:px-6 xl:grid-cols-2 xl:gap-5 lg:px-10" id="bracket-timeline">{!awaitingCompletion ? <div className="min-w-0"><p className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500"><Clock3 aria-hidden="true" className="size-4 shrink-0" />Next round preview</p><div className="grid gap-3">{divisions.map((partitionKey) => <LiveNextRoundPreview data={data} key={partitionKey} partitionKey={partitionKey} title={partitionKey === "division_1" ? "Division 1" : "Division 2"} />)}</div></div> : null}<div className={awaitingCompletion ? "min-w-0 xl:col-span-2" : "min-w-0"}><p className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500"><GitBranch aria-hidden="true" className="size-4 shrink-0" />Bracket timeline</p><div className={`grid gap-3 ${awaitingCompletion ? "xl:grid-cols-2" : ""}`}>{divisions.map((partitionKey) => <LiveBracketTimeline data={data} key={partitionKey} partitionKey={partitionKey} presentation={presentation} theme={partitionKey === "division_1" ? "division_1" : "division_2"} title={partitionKey === "division_1" ? "Division 1" : "Division 2"} />)}</div></div></section> : null}
    {presentation.state === "completed" ? <LiveLatestResults data={data} /> : null}
  </>;
}

export function PublicKnockoutBracket({
  championLabel = "Champion",
  compact = false,
  data,
  eyebrow = "KSW Standard",
  localized = false,
  openAllRounds = false,
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
  openAllRounds?: boolean;
  partitionKey?: string;
  roundOrder?: "ascending" | "descending";
  sectionId?: string;
  seasonCompleted: boolean;
  theme?: BracketTheme;
  title?: string;
}) {
  const resolvedRounds = groupPublicCupV2Rounds(data.nodes, partitionKey);
  const resolvedByIndex = new Map(resolvedRounds.map((round) => [round.roundIndex, round]));
  const topologyRounds = Array.from(new Map(data.nodes.filter((node) => node.partitionKey === partitionKey).map((node) => [node.roundIndex, [] as PublicCupV2Node[]])).entries())
    .map(([roundIndex]) => {
      const nodes = data.nodes.filter((node) => node.partitionKey === partitionKey && node.roundIndex === roundIndex).sort((left, right) => left.matchOrder - right.matchOrder);
      const resolved = resolvedByIndex.get(roundIndex);
      const finishedCount = nodes.filter((node) => isFinishedMatch(node.linkedMatch)).length;
      return { completed: nodes.length > 0 && finishedCount === nodes.length, current: resolved?.current ?? false, finishedCount, nodes, roundIndex, roundLabel: nodes[0]?.roundLabel ?? `Round ${roundIndex + 1}` };
    })
    .sort((left, right) => left.roundIndex - right.roundIndex);
  const rounds = seasonCompleted ? resolvedRounds : topologyRounds;
  if (!rounds.length) return null;
  const partition = data.partitions.find((entry) => entry.key === partitionKey);
  const champion = partition?.champion ?? null;
  const palette = themes[theme];
  const displayedRounds = roundOrder === "descending" ? [...rounds].reverse() : rounds;

  return (
    <section className={`mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10 ${compact ? "pb-8" : "pb-10"}`} id={sectionId}>
      <div className={`bg-white ${compact ? "rounded-xl border shadow-sm shadow-slate-900/10" : "border-y shadow-xl shadow-slate-900/10"} ${palette.accent}`}>
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
        <div className={`grid bg-slate-100/80 ${compact ? "gap-2 p-2.5 sm:p-3" : "gap-4 p-4 sm:p-6"}`}>
          {displayedRounds.map((round) => (
            <details className="overflow-hidden rounded-lg border border-slate-200 bg-white" key={round.roundIndex} open={openAllRounds || round.current}>
              <summary className={`cursor-pointer list-none hover:bg-[#fffaf0] ${compact ? "px-3 py-2.5" : "px-4 py-3"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-black text-[#061426]">{localizedRoundLabel(round.roundLabel, localized)}</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-black ${round.completed ? "bg-emerald-50 text-emerald-700" : round.current ? "bg-[#fff4dc] text-[#8a6418]" : "bg-slate-100 text-slate-600"}`}>
                    {round.completed ? `จบแล้ว ${round.finishedCount}/${round.nodes.length} คู่` : round.current ? "กำลังแข่งขัน" : "รอผลรอบก่อน"}
                  </span>
                </div>
              </summary>
              <div className={`grid gap-2 border-t border-slate-100 ${compact ? "p-2.5" : "p-3"}`}>
                {round.nodes.map((node) => <PublicKnockoutMatchCard compact={compact} key={node.id} node={node} />)}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function CouncilDivisionBracket({ data, localized, partitionKey, seasonCompleted, theme, title }: {
  data: PublicCupV2Data;
  localized: boolean;
  partitionKey: "division_1" | "division_2";
  seasonCompleted: boolean;
  theme: Extract<BracketTheme, "division_1" | "division_2">;
  title: string;
}) {
  const rounds = groupPublicCupV2Rounds(data.nodes, partitionKey);
  const partition = data.partitions.find((entry) => entry.key === partitionKey);
  const champion = partition?.champion ?? null;
  const palette = themes[theme];
  const waitingMessage = partition?.status === "reviewed"
    ? "ยังไม่มีโปรแกรมรอบน็อกเอาต์"
    : "รอจัดสายการแข่งขัน";

  return (
    <section className="min-w-0" id={partitionKey === "division_1" ? "knockout-division-1" : "knockout-division-2"}>
      <div className={`overflow-hidden rounded-xl border bg-white shadow-sm shadow-slate-900/10 ${palette.accent}`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
          <div>
            <p className={`flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] ${palette.eyebrow}`}><GitBranch aria-hidden="true" className="size-4 shrink-0" />คัพสภาทนายความ</p>
            <h2 className="mt-1 text-2xl font-black text-[#061426]">{title}</h2>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-black ${seasonCompleted ? "bg-emerald-50 text-emerald-700" : palette.badge}`}>{seasonCompleted ? "จบการแข่งขัน" : partitionStatusLabel(partition?.status ?? "draft")}</span>
        </div>
        {seasonCompleted && champion ? (
          <div className={`border-b border-slate-200 px-4 py-3 sm:px-5 ${palette.champion}`}>
            <p className={`text-xs font-black ${palette.eyebrow}`}>แชมป์ {title}</p>
            <div className="mt-2 flex min-w-0 items-center gap-3">
              <TeamLogo className="!size-10" initials={teamInitials(champion, "?")} logoUrl={champion.logoUrl ?? ""} teamName={champion.name} />
              <p className="min-w-0 text-wrap text-xl font-black text-[#061426]">{champion.name}</p>
            </div>
          </div>
        ) : null}
        {rounds.length ? <div className="grid gap-2.5 bg-slate-100/80 p-2.5 sm:p-3">
          {rounds.map((round) => (
            <details className="group overflow-hidden rounded-md border border-slate-200 bg-white" key={round.roundIndex} open>
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-[#fffaf0]">
                <div className="flex min-w-0 items-center gap-2">
                  <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
                  <h3 className="min-w-0 text-base font-black text-[#061426]">{localizedRoundLabel(round.roundLabel, localized)}</h3>
                </div>
                <span className="text-xs font-bold text-slate-500">{seasonCompleted || round.completed ? `จบแล้ว ${round.finishedCount}/${round.nodes.length} คู่` : round.current ? "กำลังแข่งขัน" : "รอผลรอบก่อน"}</span>
              </summary>
              <div className="grid gap-2 border-t border-slate-100 bg-[#fffdf8] p-3">
                {round.nodes.map((node) => <PublicKnockoutMatchCard chronicle compact key={node.id} node={node} placeholder={!seasonCompleted && !node.linkedMatch} sourceLabels={{ away: publicCupV2SourcePresentation(node.awaySource, data.nodes), home: publicCupV2SourcePresentation(node.homeSource, data.nodes) }} />)}
              </div>
            </details>
          ))}
        </div> : <div className="bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-600 sm:px-5">{waitingMessage}</div>}
      </div>
    </section>
  );
}

export function PublicCouncilCupBrackets({ compact = false, data, localized = false, seasonCompleted, showOverview = true }: { compact?: boolean; data: PublicCupV2Data; localized?: boolean; seasonCompleted: boolean; showOverview?: boolean }) {
  const division1 = data.partitions.find((partition) => partition.key === "division_1");
  const division2 = data.partitions.find((partition) => partition.key === "division_2");
  const hasDivision1 = Boolean(division1) || data.nodes.some((node) => node.partitionKey === "division_1");
  const hasDivision2 = Boolean(division2) || data.nodes.some((node) => node.partitionKey === "division_2");
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
      <div className={`mx-auto grid w-full max-w-7xl gap-4 px-4 ${compact ? "pb-8" : "pb-10"} sm:px-6 xl:grid-cols-2 xl:gap-5 lg:px-10`}>
        {hasDivision1 ? <CouncilDivisionBracket data={data} localized={localized} partitionKey="division_1" seasonCompleted={seasonCompleted} theme="division_1" title="Division 1" /> : null}
        {hasDivision2 ? <CouncilDivisionBracket data={data} localized={localized} partitionKey="division_2" seasonCompleted={seasonCompleted} theme="division_2" title="Division 2" /> : null}
      </div>
    </>
  );
}

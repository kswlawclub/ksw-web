"use client";

import { type CSSProperties, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { TeamLogo } from "@/components/team-logo";

type Row = Record<string, unknown>;

type LeagueTableProps = {
  standings: Row[];
  finishedMatches: Row[];
  previousSnapshot: Row[];
  seasonCompleted?: boolean;
};

type FormItem = {
  id: string;
  awayTeamName: string;
  homeTeamName: string;
  matchDate: string;
  result: string;
  role: "home" | "away";
  scoreText: string;
  venue: string;
};

type ActiveFormPopover = {
  id: string;
  item: FormItem;
  left: number;
  top: number;
};

const statColumns = ["P", "W", "D", "L", "GF", "GA", "GD", "FORM", "PTS"];

function text(row: Row | undefined, keys: string[], fallback = "") {
  if (!row) {
    return fallback;
  }

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number") {
      return String(value);
    }
  }

  return fallback;
}

function number(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }

  return 0;
}

function isKswRow(row: Row) {
  return row.is_ksw === true || text(row, ["team_name", "name", "team"]).toLowerCase().includes("ksw");
}

function teamInitials(row: Row) {
  const shortName = text(row, ["short_name"], "");
  if (shortName) {
    return shortName.slice(0, 3).toUpperCase();
  }

  return text(row, ["team_name", "name", "team"], "FC")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function formatBangkokDateTime(value: unknown) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function sortStandings(rows: Row[]) {
  return [...rows].sort((a, b) => {
    const pointsDiff = number(b, ["points", "pts"]) - number(a, ["points", "pts"]);
    if (pointsDiff) return pointsDiff;

    const goalDiff = number(b, ["goal_difference", "gd"]) - number(a, ["goal_difference", "gd"]);
    if (goalDiff) return goalDiff;

    const goalsForDiff = number(b, ["goals_for", "gf"]) - number(a, ["goals_for", "gf"]);
    if (goalsForDiff) return goalsForDiff;

    return text(a, ["team_name", "name", "team"]).localeCompare(text(b, ["team_name", "name", "team"]));
  });
}

function matchTime(match: Row) {
  const value = text(match, ["match_date", "date", "kickoff_at"], "");
  const time = value ? new Date(value).getTime() : Number.NaN;

  return Number.isNaN(time) ? 0 : time;
}

function bangkokDateKey(value: unknown) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).format(date);
}

function latestFinishedMatchDateKey(matches: Row[]) {
  const latestMatch = [...matches]
    .filter((match) => bangkokDateKey(text(match, ["match_date", "date", "kickoff_at"], "")))
    .sort((a, b) => matchTime(b) - matchTime(a))[0];

  return latestMatch ? bangkokDateKey(text(latestMatch, ["match_date", "date", "kickoff_at"], "")) : "";
}

function standingsBeforeLatestMatchDay(standings: Row[], matches: Row[]) {
  const latestDateKey = latestFinishedMatchDateKey(matches);
  const previousRows = new Map<string, Row>();

  standings.forEach((row) => {
    const teamId = text(row, ["team_id", "id"], "");

    if (!teamId) {
      return;
    }

    previousRows.set(teamId, {
      ...row,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goals_for: 0,
      goals_against: 0,
      goal_difference: 0,
      points: 0,
    });
  });

  matches
    .filter((match) => {
      const matchDate = text(match, ["match_date", "date", "kickoff_at"], "");
      return !latestDateKey || bangkokDateKey(matchDate) !== latestDateKey;
    })
    .forEach((match) => {
      const homeTeamId = text(match, ["home_team_id"], "");
      const awayTeamId = text(match, ["away_team_id"], "");
      const homeRow = previousRows.get(homeTeamId);
      const awayRow = previousRows.get(awayTeamId);

      if (!homeRow || !awayRow) {
        return;
      }

      const homeScore = number(match, ["home_score"]);
      const awayScore = number(match, ["away_score"]);
      const homeWon = homeScore > awayScore;
      const awayWon = awayScore > homeScore;
      const drawn = homeScore === awayScore;

      homeRow.played = number(homeRow, ["played"]) + 1;
      homeRow.won = number(homeRow, ["won"]) + (homeWon ? 1 : 0);
      homeRow.drawn = number(homeRow, ["drawn"]) + (drawn ? 1 : 0);
      homeRow.lost = number(homeRow, ["lost"]) + (awayWon ? 1 : 0);
      homeRow.goals_for = number(homeRow, ["goals_for"]) + homeScore;
      homeRow.goals_against = number(homeRow, ["goals_against"]) + awayScore;
      homeRow.goal_difference = number(homeRow, ["goals_for"]) - number(homeRow, ["goals_against"]);
      homeRow.points = number(homeRow, ["won"]) * 3 + number(homeRow, ["drawn"]);

      awayRow.played = number(awayRow, ["played"]) + 1;
      awayRow.won = number(awayRow, ["won"]) + (awayWon ? 1 : 0);
      awayRow.drawn = number(awayRow, ["drawn"]) + (drawn ? 1 : 0);
      awayRow.lost = number(awayRow, ["lost"]) + (homeWon ? 1 : 0);
      awayRow.goals_for = number(awayRow, ["goals_for"]) + awayScore;
      awayRow.goals_against = number(awayRow, ["goals_against"]) + homeScore;
      awayRow.goal_difference = number(awayRow, ["goals_for"]) - number(awayRow, ["goals_against"]);
      awayRow.points = number(awayRow, ["won"]) * 3 + number(awayRow, ["drawn"]);
    });

  return sortStandings(Array.from(previousRows.values()));
}

function latestForm(teamId: string, matches: Row[]) {
  return [...matches]
    .filter((match) => text(match, ["home_team_id"], "") === teamId || text(match, ["away_team_id"], "") === teamId)
    .sort((a, b) => matchTime(b) - matchTime(a))
    .slice(0, 5)
    .map((match) => {
      const homeTeamId = text(match, ["home_team_id"], "");
      const awayTeamId = text(match, ["away_team_id"], "");
      const homeScore = number(match, ["home_score"]);
      const awayScore = number(match, ["away_score"]);
      const teamScore = homeTeamId === teamId ? homeScore : awayScore;
      const opponentScore = homeTeamId === teamId ? awayScore : homeScore;
      const role = homeTeamId === teamId ? "home" : "away";
      const result = teamScore > opponentScore ? "W" : teamScore < opponentScore ? "L" : "D";

      return {
        id: text(match, ["id", "match_id"], `${homeTeamId}-${awayTeamId}-${matchTime(match)}`),
        awayTeamName: text(match, ["away_team_name", "away_name", "away_team"], "Away team unavailable"),
        homeTeamName: text(match, ["home_team_name", "home_name", "home_team"], "Home team unavailable"),
        matchDate: text(match, ["match_date", "date", "kickoff_at"], ""),
        result,
        role,
        scoreText: `${teamScore}\u2013${opponentScore}`,
        venue: text(match, ["venue"], ""),
      } satisfies FormItem;
    });
}

function formLabel(result: string) {
  if (result === "W") return "ชนะ";
  if (result === "L") return "แพ้";
  return "เสมอ";
}

function formPopoverPosition(rect: DOMRect) {
  const width = 260;
  const margin = 8;

  return {
    left: Math.min(Math.max(rect.left + rect.width / 2 - width / 2, margin), window.innerWidth - width - margin),
    top: Math.max(Math.min(rect.bottom + 10, window.innerHeight - 158), margin),
  };
}

function FormIcon({
  isLatest,
  item,
  onClose,
  onOpen,
  open,
}: {
  isLatest: boolean;
  item: FormItem;
  onClose: () => void;
  onOpen: (item: FormItem, rect: DOMRect) => void;
  open: boolean;
}) {
  const label = formLabel(item.result);
  const tone =
    item.result === "W"
      ? "bg-emerald-500"
      : item.result === "L"
        ? "bg-red-500"
        : "bg-slate-500";
  const ariaLabel = `${label} ${item.scoreText}, ${item.homeTeamName} vs ${item.awayTeamName}`;

  function handleOpen(event: MouseEvent<HTMLButtonElement>) {
    onOpen(item, event.currentTarget.getBoundingClientRect());
  }

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();

    if (open) {
      onClose();
      return;
    }

    handleOpen(event);
  }

  function handleMouseEnter(event: MouseEvent<HTMLButtonElement>) {
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      handleOpen(event);
    }
  }

  function handleMouseLeave() {
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      onClose();
    }
  }

  return (
    <button
      aria-expanded={open}
      aria-label={ariaLabel}
      className={`inline-flex size-[13px] items-center justify-center rounded-full text-white shadow-sm outline-none transition-transform focus-visible:ring-2 focus-visible:ring-[#f4d58a] focus-visible:ring-offset-1 focus-visible:ring-offset-[#061426] sm:size-5 ${
        isLatest ? "ring-2 ring-white/75 ring-offset-1 ring-offset-[#061426]" : ""
      } ${tone}`}
      data-form-trigger="true"
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      type="button"
    >
      {item.result === "W" ? (
        <svg aria-hidden="true" className="size-2.5 sm:size-3.5" fill="none" viewBox="0 0 16 16">
          <path d="M3.2 8.2 6.5 11.5 12.8 4.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
        </svg>
      ) : item.result === "L" ? (
        <svg aria-hidden="true" className="size-2.5 sm:size-3.5" fill="none" viewBox="0 0 16 16">
          <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
        </svg>
      ) : (
        <svg aria-hidden="true" className="h-2.5 w-2.5 sm:h-3.5 sm:w-3.5" fill="none" viewBox="0 0 16 16">
          <path d="M4 8h8" stroke="currentColor" strokeLinecap="round" strokeWidth="2.6" />
        </svg>
      )}
    </button>
  );
}

function FormPopover({ active }: { active: ActiveFormPopover }) {
  return (
    <div
      className="fixed z-[80] w-[260px] rounded-xl border border-[#d8ad45]/30 bg-[#061426] p-3 text-left text-xs text-slate-200 shadow-2xl shadow-black/30"
      data-form-popover="true"
      role="dialog"
      style={{ left: active.left, top: active.top }}
    >
      <span className="absolute -top-1.5 left-1/2 size-3 -translate-x-1/2 rotate-45 border-l border-t border-[#d8ad45]/30 bg-[#061426]" />
      <p className="text-sm font-black text-white">
        {formLabel(active.item.result)} {active.item.scoreText}
      </p>
      <p className="mt-1 font-bold text-[#f4d58a]">
        {active.item.homeTeamName} vs {active.item.awayTeamName}
      </p>
      <p className="mt-1 text-slate-300">{formatBangkokDateTime(active.item.matchDate)}</p>
      <p className="mt-1 text-slate-400">
        ทีมนี้เป็น{active.item.role === "home" ? "เจ้าบ้าน" : "ทีมเยือน"}
      </p>
      {active.item.venue ? (
        <p className="mt-1 text-slate-400">สนาม: {active.item.venue}</p>
      ) : null}
    </div>
  );
}

function movementClass(movement: number | null) {
  if (movement === null) return "text-slate-400";
  if (movement > 0) return "text-emerald-200";
  if (movement < 0) return "text-red-200";
  return "text-slate-400";
}

function MovementBadge({
  animate,
  movement,
  rowIndex,
}: {
  animate: boolean;
  movement: number | null;
  rowIndex: number;
}) {
  const direction = movement === null ? "new" : movement > 0 ? "up" : movement < 0 ? "down" : "same";
  const delay = `${Math.min(rowIndex * 45, 420)}ms`;

  if (movement === null) {
    return (
      <span
        className="move-indicator inline-flex items-center justify-center text-[8px] font-black leading-none text-slate-400 sm:text-[10px]"
        data-animate={animate ? "true" : "false"}
        data-direction={direction}
        style={{ "--move-delay": delay } as CSSProperties}
      >
        NEW
      </span>
    );
  }

  if (movement === 0) {
    return (
      <span
        aria-label="อันดับไม่เปลี่ยน"
        className="move-indicator inline-flex items-center justify-center text-[#f4d58a]"
        data-animate={animate ? "true" : "false"}
        data-direction={direction}
        style={{ "--move-delay": delay } as CSSProperties}
        title="อันดับไม่เปลี่ยน"
      >
        <span className="h-1 w-3 rounded-full bg-current sm:h-1.5 sm:w-5" />
      </span>
    );
  }

  const isUp = movement > 0;

  return (
    <span
      aria-label={`${isUp ? "อันดับขึ้น" : "อันดับลง"} ${Math.abs(movement)} อันดับ`}
      className={`move-indicator inline-flex items-center justify-center gap-0.5 text-[9px] font-black leading-none sm:gap-1 sm:text-xs ${
        isUp ? "text-emerald-400" : "text-red-400"
      }`}
      data-animate={animate ? "true" : "false"}
      data-direction={direction}
      style={{ "--move-delay": delay } as CSSProperties}
      title={`${isUp ? "อันดับขึ้น" : "อันดับลง"} ${Math.abs(movement)} อันดับ`}
    >
      <svg aria-hidden="true" className="h-3.5 w-2.5 sm:h-5 sm:w-3.5" fill="currentColor" viewBox="0 0 12 20">
        {isUp ? (
          <path d="M6 .9 11.3 7H8.2v12.1H3.8V7H.7L6 .9Z" />
        ) : (
          <path d="M6 19.1.7 13h3.1V.9h4.4V13h3.1L6 19.1Z" />
        )}
      </svg>
      <span>{Math.abs(movement)}</span>
    </span>
  );
}

function goalDifferenceClass(value: number) {
  if (value > 0) return "text-emerald-200";
  if (value < 0) return "text-red-200";
  return "text-slate-300";
}

function goalDifferenceText(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function joinedNames(rows: Row[]) {
  return rows.map((row) => text(row, ["team_name", "name", "team"], "Unknown team")).join(", ");
}

function kswBattleText(rows: Row[]) {
  const kswIndex = rows.findIndex(isKswRow);

  if (kswIndex < 0) {
    return "";
  }

  const ksw = rows[kswIndex];
  const above = rows[kswIndex - 1];
  const below = rows[kswIndex + 1];
  const kswPoints = number(ksw, ["points", "pts"]);
  const kswGoalDifference = number(ksw, ["goal_difference", "gd"]);

  if (above) {
    const abovePoints = number(above, ["points", "pts"]);
    const aboveName = text(above, ["team_name", "name", "team"], "the team above");

    if (kswPoints === abovePoints) {
      const aboveGoalDifference = number(above, ["goal_difference", "gd"]);

      if (kswGoalDifference < aboveGoalDifference) {
        return `KSW L.C. มีคะแนนเท่ากับ ${aboveName} และตามหลังด้วยผลต่างประตู`;
      }

      return `KSW L.C. มีคะแนนเท่ากับ ${aboveName}`;
    }

    return `KSW L.C. ตาม ${aboveName} อยู่ ${abovePoints - kswPoints} คะแนน`;
  }

  if (below) {
    const belowPoints = number(below, ["points", "pts"]);
    const belowName = text(below, ["team_name", "name", "team"], "the team below");
    return `KSW L.C. นำ ${belowName} อยู่ ${kswPoints - belowPoints} คะแนน`;
  }

  return "KSW L.C. เป็นทีมเดียวในตารางคะแนนปัจจุบัน";
}

export function LeagueTable({
  standings,
  finishedMatches,
  previousSnapshot,
  seasonCompleted = false,
}: LeagueTableProps) {
  const [activeFormPopover, setActiveFormPopover] = useState<ActiveFormPopover | null>(null);
  const [animateRows, setAnimateRows] = useState(false);
  const animationStarted = useRef(false);
  const sortedStandings = useMemo(() => sortStandings(standings), [standings]);
  const previousStandings = useMemo(
    () => standingsBeforeLatestMatchDay(standings, finishedMatches),
    [finishedMatches, standings],
  );
  const previousByTeam = useMemo(
    () => new Map(previousStandings.map((row, index) => [text(row, ["team_id"], ""), index + 1])),
    [previousStandings],
  );
  const hasSnapshot = previousSnapshot.length > 0;
  const latestSnapshotCreatedAt = previousSnapshot
    .map((row) => text(row, ["created_at"], ""))
    .filter(Boolean)
    .sort()
    .at(-1);
  const latestSnapshotMatchday = Math.max(...previousSnapshot.map((row) => number(row, ["matchday"])), 0);
  const movements = sortedStandings.map((row, index) => {
    const currentPosition = index + 1;
    const previousPosition = previousByTeam.get(text(row, ["team_id"], "")) ?? null;
    const movement = previousPosition ? previousPosition - currentPosition : null;

    return { row, currentPosition, previousPosition, movement };
  });
  const climberAmount = Math.max(...movements.map((item) => item.movement ?? 0), 0);
  const dropAmount = Math.max(...movements.map((item) => (item.movement ?? 0) < 0 ? Math.abs(item.movement ?? 0) : 0), 0);
  const climbers = climberAmount > 0 ? movements.filter((item) => item.movement === climberAmount).map((item) => item.row) : [];
  const droppers = dropAmount > 0 ? movements.filter((item) => item.movement === -dropAmount).map((item) => item.row) : [];
  const highestGoalsFor = Math.max(...sortedStandings.map((row) => number(row, ["goals_for", "gf"])), 0);
  const lowestGoalsAgainst = Math.min(...sortedStandings.map((row) => number(row, ["goals_against", "ga"])));
  const highestScoringTeams = sortedStandings.filter((row) => number(row, ["goals_for", "gf"]) === highestGoalsFor);
  const bestDefenceTeams = Number.isFinite(lowestGoalsAgainst)
    ? sortedStandings.filter((row) => number(row, ["goals_against", "ga"]) === lowestGoalsAgainst)
    : [];
  const battleText = kswBattleText(sortedStandings);
  const kswRow = sortedStandings.find(isKswRow);
  const kswPlayed = kswRow ? number(kswRow, ["played", "p"]) : 0;

  useEffect(() => {
    if (animationStarted.current) {
      return;
    }

    animationStarted.current = true;
    const animationFrame = requestAnimationFrame(() => setAnimateRows(true));

    return () => cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => {
    if (!activeFormPopover) {
      return;
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest("[data-form-popover]") || target.closest("[data-form-trigger]")) {
        return;
      }

      setActiveFormPopover(null);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveFormPopover(null);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeFormPopover]);

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-[#d8ad45]/25 bg-[linear-gradient(135deg,#061426,#0b2745_58%,#071b31)] shadow-2xl shadow-[#061426]/25">
      <div className="grid gap-4 border-b border-[#d8ad45]/20 px-4 py-5 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#d8ad45]">
            KSW League
          </p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">
            {seasonCompleted ? "Final League Table" : "League Table"}
          </h2>
          <p className="mt-1 text-sm font-semibold text-slate-300">
            Thai Lawyers League • Season 6
          </p>
          <div className="mt-3 space-y-1 text-xs font-bold leading-5 text-slate-400">
            <p>
              {seasonCompleted
                ? kswPlayed > 0
                  ? `Final standings after ${kswPlayed} matches`
                  : "Final standings"
                : latestSnapshotMatchday > 0
                  ? `Updated after Matchday ${latestSnapshotMatchday}`
                  : "Standings Updated"}
            </p>
            {latestSnapshotCreatedAt ? <p>Last updated: {formatBangkokDateTime(latestSnapshotCreatedAt)}</p> : null}
          </div>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-[#f4d58a]/35 bg-[#d8ad45]/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-[#f4d58a] shadow-lg shadow-[#d8ad45]/10">
          <span className={`size-2 rounded-full bg-[#f4d58a] ${seasonCompleted ? "" : "ksw-live-dot"}`} />
          {seasonCompleted ? "SEASON COMPLETE" : "LIVE"}
        </span>
      </div>

      {hasSnapshot ? (
        <div className="grid gap-3 border-b border-[#d8ad45]/15 px-4 py-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.05] p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-200">Biggest Climber</p>
            <p className="mt-1 text-sm font-black text-white">{climbers.length ? joinedNames(climbers) : "—"}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.05] p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-red-200">Biggest Drop</p>
            <p className="mt-1 text-sm font-black text-white">{droppers.length ? joinedNames(droppers) : "—"}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.05] p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#f4d58a]">Highest Scoring Team</p>
            <p className="mt-1 text-sm font-black text-white">{highestScoringTeams.length ? joinedNames(highestScoringTeams) : "—"}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.05] p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-300">Best Defence</p>
            <p className="mt-1 text-sm font-black text-white">{bestDefenceTeams.length ? joinedNames(bestDefenceTeams) : "—"}</p>
          </div>
        </div>
      ) : null}

      {battleText ? (
        <div className="border-b border-[#d8ad45]/15 px-4 py-3 sm:px-6">
          <p className="rounded-xl border border-[#d8ad45]/25 bg-[#d8ad45]/10 px-4 py-3 text-sm font-bold leading-6 text-[#f4d58a]">
            {battleText}
          </p>
        </div>
      ) : null}

      <div className="overflow-hidden lg:overflow-x-auto">
        <table className="w-full table-fixed text-left text-[10px] sm:text-sm lg:min-w-[820px]">
          <thead className="bg-[#061426]/80 text-[8px] uppercase tracking-[0.08em] text-slate-400 sm:text-xs sm:tracking-wider">
            <tr>
              <th className="w-7 px-1 py-2 sm:w-14 sm:px-3 sm:py-3">Pos</th>
              <th className="w-9 px-0.5 py-2 text-center sm:w-14 sm:px-2 sm:py-3">Move</th>
              <th className="px-1 py-2 sm:px-3 sm:py-3">Team</th>
              {statColumns.map((column) => (
                <th
                  key={column}
                  className={`px-0.5 py-2 text-right sm:px-2 sm:py-3 ${
                    column === "FORM" ? "w-[76px] text-center sm:w-32" : "w-6 sm:w-12"
                  } ${column === "GF" || column === "GA" ? "hidden md:table-cell" : ""}`}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {movements.length ? (
              movements.map(({ row, currentPosition, previousPosition, movement }, index) => {
                const teamName = text(row, ["team_name", "name", "team"]);
                const teamId = text(row, ["team_id", "id"], "");
                const form = latestForm(teamId, finishedMatches);
                const goalDifference = number(row, ["goal_difference", "gd"]);

                return (
                  <tr
                    className={`league-rank-row cursor-pointer border-l-4 transition-colors hover:bg-white/[0.09] ${
                      isKswRow(row)
                        ? "border-l-[#d8ad45] bg-gradient-to-r from-[#d8ad45]/18 via-white/[0.06] to-transparent shadow-[inset_0_0_22px_rgba(216,173,69,0.12)]"
                        : index < 3
                          ? "border-l-[#f4d58a]/50 bg-white/[0.045]"
                          : "border-l-transparent"
                    }`}
                    key={teamId || teamName || String(index)}
                  >
                    <td
                      className={`px-1 py-2 font-bold sm:px-3 sm:py-3 ${
                        index < 3 ? "text-[#f4d58a]" : "text-slate-300"
                      }`}
                    >
                      {currentPosition}
                    </td>
                    <td className={`px-0.5 py-2 text-center font-black sm:px-2 sm:py-3 ${movementClass(movement)}`}>
                      <MovementBadge animate={animateRows} movement={movement} rowIndex={index} />
                    </td>
                    <td className="min-w-0 px-1 py-2 text-white sm:px-3 sm:py-3">
                      <div className="flex min-w-0 items-center gap-1 sm:gap-2">
                        <TeamLogo
                          className="size-5 sm:size-7 md:size-8"
                          initials={teamInitials(row)}
                          logoUrl={text(row, ["logo_url"], "")}
                          teamName={teamName}
                        />
                        <span className="min-w-0 truncate text-[10px] font-bold leading-4 sm:text-sm sm:leading-5">
                          {teamName}
                        </span>
                      </div>
                    </td>
                    <td className="px-0.5 py-2 text-right text-slate-100 sm:px-2 sm:py-3">{number(row, ["played", "p"])}</td>
                    <td className="px-0.5 py-2 text-right text-slate-100 sm:px-2 sm:py-3">{number(row, ["won", "w"])}</td>
                    <td className="px-0.5 py-2 text-right text-slate-100 sm:px-2 sm:py-3">{number(row, ["drawn", "draws", "d"])}</td>
                    <td className="px-0.5 py-2 text-right text-slate-100 sm:px-2 sm:py-3">{number(row, ["lost", "l"])}</td>
                    <td className="hidden px-2 py-3 text-right text-slate-100 md:table-cell">{number(row, ["goals_for", "gf"])}</td>
                    <td className="hidden px-2 py-3 text-right text-slate-100 md:table-cell">{number(row, ["goals_against", "ga"])}</td>
                    <td className={`px-0.5 py-2 text-right font-black sm:px-2 sm:py-3 ${goalDifferenceClass(goalDifference)}`}>
                      {goalDifferenceText(goalDifference)}
                    </td>
                    <td className="px-0.5 py-2 sm:px-2 sm:py-3">
                      <div className="flex justify-center gap-0.5 sm:gap-1">
                        {form.length ? (
                          form.map((item, formIndex) => (
                            <FormIcon
                              isLatest={formIndex === 0}
                              item={item}
                              key={`${teamId}-${item.id}-${formIndex}`}
                              onClose={() => setActiveFormPopover(null)}
                              onOpen={(formItem, rect) =>
                                setActiveFormPopover({
                                  id: `${teamId}-${formItem.id}-${formIndex}`,
                                  item: formItem,
                                  ...formPopoverPosition(rect),
                                })
                              }
                              open={activeFormPopover?.id === `${teamId}-${item.id}-${formIndex}`}
                            />
                          ))
                        ) : (
                          <span className="text-xs font-bold text-slate-500">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-0.5 py-2 text-right font-black text-white sm:px-2 sm:py-3">
                      {number(row, ["points", "pts"])}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="px-4 py-8 text-center text-slate-400" colSpan={11}>
                  No league table rows available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {activeFormPopover ? <FormPopover active={activeFormPopover} /> : null}
      <div className="border-t border-[#d8ad45]/15 px-4 py-3 text-right sm:px-6">
        <p className="text-xs font-semibold leading-5 text-slate-400">
          ข้อมูลการแข่งขันอ้างอิงจากฝ่ายจัดการแข่งขัน Thai Lawyers League Season 6
        </p>
      </div>
      <style jsx>{`
        .move-indicator[data-animate="true"] {
          animation: kswMoveFade 540ms cubic-bezier(0.22, 1, 0.36, 1) both;
          animation-delay: var(--move-delay);
          will-change: transform, opacity;
        }

        .move-indicator[data-animate="true"][data-direction="up"] {
          animation-name: kswMoveUp;
        }

        .move-indicator[data-animate="true"][data-direction="down"] {
          animation-name: kswMoveDown;
        }

        @keyframes kswMoveUp {
          from {
            opacity: 0;
            transform: translateY(7px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes kswMoveDown {
          from {
            opacity: 0;
            transform: translateY(-7px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes kswMoveFade {
          from {
            opacity: 0;
            transform: translateY(2px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .move-indicator[data-animate="true"] {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

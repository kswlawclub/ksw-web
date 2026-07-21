"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { TeamLogo } from "@/components/team-logo";

type Row = Record<string, unknown>;

type LeagueTableProps = {
  standings: Row[];
  finishedMatches: Row[];
  previousSnapshot: Row[];
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
      const homeScore = number(match, ["home_score"]);
      const awayScore = number(match, ["away_score"]);
      const teamScore = homeTeamId === teamId ? homeScore : awayScore;
      const opponentScore = homeTeamId === teamId ? awayScore : homeScore;

      if (teamScore > opponentScore) return "W";
      if (teamScore < opponentScore) return "L";
      return "D";
    });
}

function formClass(result: string) {
  if (result === "W") return "bg-emerald-400/16 text-emerald-200 ring-emerald-300/25";
  if (result === "L") return "bg-red-400/14 text-red-200 ring-red-300/25";
  return "bg-slate-200/12 text-slate-200 ring-white/15";
}

function movementLabel(movement: number | null) {
  if (movement === null) return "NEW";
  if (movement > 0) return `↑ ${movement}`;
  if (movement < 0) return `↓ ${Math.abs(movement)}`;
  return "—";
}

function movementClass(movement: number | null) {
  if (movement === null) return "text-slate-400";
  if (movement > 0) return "text-emerald-200";
  if (movement < 0) return "text-red-200";
  return "text-slate-400";
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

export function LeagueTable({ standings, finishedMatches, previousSnapshot }: LeagueTableProps) {
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

  useEffect(() => {
    if (!hasSnapshot || animationStarted.current) {
      return;
    }

    animationStarted.current = true;
    const animationFrame = requestAnimationFrame(() => setAnimateRows(true));

    return () => cancelAnimationFrame(animationFrame);
  }, [hasSnapshot]);

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-[#d8ad45]/25 bg-[linear-gradient(135deg,#061426,#0b2745_58%,#071b31)] shadow-2xl shadow-[#061426]/25">
      <div className="grid gap-4 border-b border-[#d8ad45]/20 px-4 py-5 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#d8ad45]">
            KSW League
          </p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">
            League Table
          </h2>
          <p className="mt-1 text-sm font-semibold text-slate-300">
            Thai Lawyers League • Season 6
          </p>
          <div className="mt-3 space-y-1 text-xs font-bold leading-5 text-slate-400">
            <p>{latestSnapshotMatchday > 0 ? `Updated after Matchday ${latestSnapshotMatchday}` : "Standings Updated"}</p>
            {latestSnapshotCreatedAt ? <p>Last updated: {formatBangkokDateTime(latestSnapshotCreatedAt)}</p> : null}
          </div>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-[#f4d58a]/35 bg-[#d8ad45]/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-[#f4d58a] shadow-lg shadow-[#d8ad45]/10">
          <span className="ksw-live-dot size-2 rounded-full bg-[#f4d58a]" />
          LIVE
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

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] table-fixed text-left text-xs sm:text-sm">
          <thead className="bg-[#061426]/80 text-[10px] uppercase tracking-wider text-slate-400 sm:text-xs">
            <tr>
              <th className="w-14 px-3 py-3">Pos</th>
              <th className="w-14 px-2 py-3 text-center">Move</th>
              <th className="px-3 py-3">Team</th>
              {statColumns.map((column) => (
                <th
                  key={column}
                  className={`px-2 py-3 text-right ${
                    column === "FORM" ? "w-32 text-center" : "w-12"
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
                const rowOffset = previousPosition ? (previousPosition - currentPosition) * 54 : 0;
                const movementTone = movement === null ? "rgba(148,163,184,0.22)" : movement > 0
                  ? "rgba(74,222,128,0.22)"
                  : movement < 0
                    ? "rgba(248,113,113,0.2)"
                    : "rgba(148,163,184,0.12)";

                return (
                  <tr
                    className={`league-rank-row cursor-pointer border-l-4 transition-colors hover:bg-white/[0.09] ${
                      isKswRow(row)
                        ? "border-l-[#d8ad45] bg-gradient-to-r from-[#d8ad45]/18 via-white/[0.06] to-transparent shadow-[inset_0_0_22px_rgba(216,173,69,0.12)]"
                        : index < 3
                          ? "border-l-[#f4d58a]/50 bg-white/[0.045]"
                          : "border-l-transparent"
                    }`}
                    data-animate={animateRows && hasSnapshot && previousPosition && movement !== 0 ? "true" : "false"}
                    key={teamId || teamName || String(index)}
                    style={
                      {
                        "--rank-offset": `${rowOffset}px`,
                        "--rank-glow": movementTone,
                      } as CSSProperties
                    }
                  >
                    <td
                      className={`px-3 py-3 font-bold ${
                        index < 3 ? "text-[#f4d58a]" : "text-slate-300"
                      }`}
                    >
                      {currentPosition}
                    </td>
                    <td className={`px-2 py-3 text-center text-xs font-black ${movementClass(movement)}`}>
                      {movementLabel(movement)}
                    </td>
                    <td className="min-w-0 px-3 py-3 text-white">
                      <div className="flex min-w-0 items-center gap-2">
                        <TeamLogo
                          className="size-7 md:size-8"
                          initials={teamInitials(row)}
                          logoUrl={text(row, ["logo_url"], "")}
                          teamName={teamName}
                        />
                        <span className="min-w-0 truncate font-bold leading-5">
                          {teamName}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right">{number(row, ["played", "p"])}</td>
                    <td className="px-2 py-3 text-right">{number(row, ["won", "w"])}</td>
                    <td className="px-2 py-3 text-right">{number(row, ["drawn", "draws", "d"])}</td>
                    <td className="px-2 py-3 text-right">{number(row, ["lost", "l"])}</td>
                    <td className="hidden px-2 py-3 text-right md:table-cell">{number(row, ["goals_for", "gf"])}</td>
                    <td className="hidden px-2 py-3 text-right md:table-cell">{number(row, ["goals_against", "ga"])}</td>
                    <td className={`px-2 py-3 text-right font-black ${goalDifferenceClass(goalDifference)}`}>
                      {goalDifferenceText(goalDifference)}
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex justify-center gap-1">
                        {form.length ? (
                          form.map((result, formIndex) => (
                            <span
                              className={`inline-flex size-6 items-center justify-center rounded-full text-[10px] font-black ring-1 ${formClass(result)}`}
                              key={`${teamId}-${result}-${formIndex}`}
                            >
                              {result}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs font-bold text-slate-500">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right font-black text-white">
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
      <div className="border-t border-[#d8ad45]/15 px-4 py-3 text-right sm:px-6">
        <p className="text-xs font-semibold leading-5 text-slate-400">
          ข้อมูลการแข่งขันอ้างอิงจากฝ่ายจัดการแข่งขัน Thai Lawyers League Season 6
        </p>
      </div>
      <style jsx>{`
        .league-rank-row[data-animate="true"] {
          animation:
            kswRankSlide 760ms cubic-bezier(0.22, 1, 0.36, 1),
            kswRankGlow 1800ms ease-out;
          will-change: transform, box-shadow;
        }

        @keyframes kswRankSlide {
          from {
            transform: translateY(var(--rank-offset));
          }
          to {
            transform: translateY(0);
          }
        }

        @keyframes kswRankGlow {
          0%,
          62% {
            box-shadow: inset 0 0 28px var(--rank-glow);
          }
          100% {
            box-shadow: inset 0 0 0 transparent;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .league-rank-row[data-animate="true"] {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

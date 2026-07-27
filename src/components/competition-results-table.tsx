"use client";

import { useMemo, useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import { matchTime, Row, text } from "@/lib/competition-data";

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "long",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).format(date);
}

function bangkokDateKey(value: unknown) {
  if (typeof value !== "string" || !value) return "date-unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).format(date);
}

function teamInitials(row: Row) {
  const shortName = text(row, ["short_name"], "");
  if (shortName) return shortName.slice(0, 3).toUpperCase();

  return text(row, ["team_name", "name", "team"], "FC")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function scoreLabel(match: Row) {
  const homeScore = match.home_score;
  const awayScore = match.away_score;
  const hasScore = typeof homeScore === "number" && typeof awayScore === "number";
  return hasScore ? `${homeScore} - ${awayScore}` : "VS";
}

function isKswResultMatch(match: Row) {
  return match.home_team_is_ksw === true || match.away_team_is_ksw === true;
}

function kswResultBadge(match: Row) {
  const homeScore = match.home_score;
  const awayScore = match.away_score;
  const hasScore = typeof homeScore === "number" && typeof awayScore === "number";
  const homeIsKsw = match.home_team_is_ksw === true;
  const awayIsKsw = match.away_team_is_ksw === true;

  if (!hasScore || (!homeIsKsw && !awayIsKsw)) return null;
  if (homeScore === awayScore) return { label: "D", className: "border-slate-300 bg-slate-100 text-slate-700" };

  const kswWon = homeIsKsw ? homeScore > awayScore : awayScore > homeScore;
  return kswWon
    ? { label: "W", className: "border-emerald-500/30 bg-emerald-50 text-emerald-700" }
    : { label: "L", className: "border-[#9b1c1f]/30 bg-[#9b1c1f]/10 text-[#9b1c1f]" };
}

function resultGroups(matches: Row[]) {
  return matches.reduce<Array<{ key: string; date: unknown; matches: Row[] }>>((groups, match) => {
    const matchDate = match.match_date ?? match.date ?? match.kickoff_at;
    const key = bangkokDateKey(matchDate);
    const existingGroup = groups.find((group) => group.key === key);
    if (existingGroup) {
      existingGroup.matches.push(match);
    } else {
      groups.push({ key, date: matchDate, matches: [match] });
    }
    return groups;
  }, []);
}

function TeamCell({ align = "left", logoKey, match, nameKey, shortKey }: {
  align?: "left" | "right";
  logoKey: string;
  match: Row;
  nameKey: string;
  shortKey: string;
}) {
  const teamName = text(match, [nameKey], "Team unavailable");
  const shortName = text(match, [shortKey], teamInitials({ team_name: teamName }));
  const logoUrl = text(match, [logoKey], "");

  return (
    <div className={`flex min-w-0 items-center gap-2 ${align === "right" ? "justify-end text-right" : ""}`}>
      {align === "right" ? (
        <>
          <span className="min-w-0 text-wrap text-sm font-black leading-5 text-[#061426] lg:text-[15px]">{teamName}</span>
          <TeamLogo className="!size-7" initials={shortName} logoUrl={logoUrl} teamName={teamName} />
        </>
      ) : (
        <>
          <TeamLogo className="!size-7" initials={shortName} logoUrl={logoUrl} teamName={teamName} />
          <span className="min-w-0 text-wrap text-sm font-black leading-5 text-[#061426] lg:text-[15px]">{teamName}</span>
        </>
      )}
    </div>
  );
}

function ResultRow({ match }: { match: Row }) {
  const matchDate = match.match_date ?? match.date ?? match.kickoff_at;
  const venue = text(match, ["venue"], "");
  const badge = kswResultBadge(match);
  const kswMatch = isKswResultMatch(match);

  return (
    <tr className={`transition-colors hover:bg-[#fff8e8] ${kswMatch ? "border-l-4 border-l-[#d8ad45] bg-[#fff9ea]" : ""}`}>
      <td className="px-4 py-3 text-xs font-bold text-slate-500">{formatDate(matchDate) || "Date TBC"}</td>
      <td className="px-4 py-3">
        <TeamCell logoKey="home_team_logo_url" match={match} nameKey="home_team_name" shortKey="home_team_short_name" />
      </td>
      <td className="px-4 py-3 text-center">
        <div className="inline-flex items-center gap-2">
          {badge ? (
            <span className={`inline-flex size-7 items-center justify-center rounded-full border text-xs font-black ${badge.className}`}>
              {badge.label}
            </span>
          ) : null}
          <span className="inline-flex min-w-20 items-center justify-center rounded-full border border-[#d8ad45]/40 bg-[#061426] px-4 py-2 text-sm font-black text-white shadow-sm shadow-slate-900/10">
            {scoreLabel(match)}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <TeamCell align="right" logoKey="away_team_logo_url" match={match} nameKey="away_team_name" shortKey="away_team_short_name" />
      </td>
      <td className="px-4 py-3 text-sm font-semibold text-slate-600">{venue || "-"}</td>
    </tr>
  );
}

function MobileResultRow({ match }: { match: Row }) {
  const matchDate = match.match_date ?? match.date ?? match.kickoff_at;
  const venue = text(match, ["venue"], "");
  const badge = kswResultBadge(match);
  const kswMatch = isKswResultMatch(match);

  return (
    <article className={`rounded-xl border bg-white p-3 shadow-sm ${kswMatch ? "border-[#d8ad45]/55 bg-[#fff9ea]" : "border-slate-200"}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
          {formatDate(matchDate) || "Date TBC"}
        </span>
        {badge ? (
          <span className={`inline-flex size-7 items-center justify-center rounded-full border text-xs font-black ${badge.className}`}>
            {badge.label}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] items-center gap-2">
        <TeamCell logoKey="home_team_logo_url" match={match} nameKey="home_team_name" shortKey="home_team_short_name" />
        <span className="inline-flex items-center justify-center rounded-full border border-[#d8ad45]/40 bg-[#061426] px-3 py-2 text-sm font-black text-white">
          {scoreLabel(match)}
        </span>
        <TeamCell align="right" logoKey="away_team_logo_url" match={match} nameKey="away_team_name" shortKey="away_team_short_name" />
      </div>
      {venue ? <p className="mt-3 text-xs font-bold text-slate-500">Field {venue}</p> : null}
    </article>
  );
}

export function CompetitionResultsTable({ isLeague, matches }: { isLeague: boolean; matches: Row[] }) {
  const groups = useMemo(
    () =>
      resultGroups([...matches].sort((a, b) => matchTime(b) - matchTime(a))).map((group) => ({
        ...group,
        matches: [...group.matches].sort((a, b) => matchTime(b) - matchTime(a)),
      })),
    [matches],
  );
  const [openGroups, setOpenGroups] = useState(() => new Set(groups[0] ? [groups[0].key] : []));

  function toggleGroup(key: string) {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10" id="all-results">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
        <div className="border-b border-slate-200 px-4 py-5 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-black">{isLeague ? "All Match Results" : "Competition Results"}</h2>
              <p className="mt-1 text-sm font-semibold text-slate-600">
                Complete results from every match in this competition.
              </p>
            </div>
            <span className="w-fit rounded-full border border-[#d8ad45]/35 bg-[#fff4dc] px-3 py-1.5 text-xs font-black text-[#061426]">
              {matches.length} Matches
            </span>
          </div>
        </div>

        <div className="grid gap-4 bg-slate-100 px-4 py-5 sm:px-6">
          {groups.map((group) => {
            const open = openGroups.has(group.key);
            return (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white" key={group.key}>
                <button
                  aria-expanded={open}
                  className="flex w-full items-center justify-between gap-4 bg-[#061426] px-4 py-3 text-left text-white transition-colors hover:bg-[#0a223d]"
                  onClick={() => toggleGroup(group.key)}
                  type="button"
                >
                  <span>
                    <span className="block text-xs font-black uppercase tracking-[0.18em] text-[#f4d58a]">Results</span>
                    <span className="mt-1 block text-sm font-black">{formatDate(group.date) || "Date TBC"}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-black">
                      {group.matches.length} Matches
                    </span>
                    <span className={`text-lg font-black transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true">
                      ˅
                    </span>
                  </span>
                </button>

                {open ? (
                  <div>
                    <div className="hidden lg:block">
                      <table className="w-full border-collapse text-left">
                        <thead>
                          <tr className="bg-[#09213b] text-xs font-black uppercase tracking-[0.14em] text-[#f4d58a]">
                            <th className="px-4 py-3">Date</th>
                            <th className="px-4 py-3">Home Team</th>
                            <th className="px-4 py-3 text-center">Score</th>
                            <th className="px-4 py-3 text-right">Away Team</th>
                            <th className="px-4 py-3">Venue</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {group.matches.map((match) => (
                            <ResultRow key={text(match, ["id"])} match={match} />
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="grid gap-3 p-3 lg:hidden">
                      {group.matches.map((match) => (
                        <MobileResultRow key={text(match, ["id"])} match={match} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

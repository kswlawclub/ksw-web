import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LeagueTable } from "@/components/league-table";
import { TeamLogo } from "@/components/team-logo";
import { getSupabase, getSupabaseConfig } from "@/lib/supabase";

type Row = Record<string, unknown>;

const seasonSlug = "thai-lawyers-league-season-6";
const leagueColumns = "id, name, season, competition_type, season_status, is_active, created_at";
const standingsColumns =
  "team_id, league_id, team_name, short_name, logo_url, is_ksw, played, won, drawn, lost, goals_for, goals_against, goal_difference, points";
const matchColumns =
  "id, league_id, match_date, home_team_id, away_team_id, home_score, away_score, venue, status, match_type";
const snapshotColumns =
  "snapshot_id, league_id, team_id, position, played, won, drawn, lost, goals_for, goals_against, goal_difference, points, matchday, created_at";
const teamColumns = "id, league_id, name, short_name, logo_url, is_ksw, is_active";
const sponsorColumns = "id, name, logo_url, website_url, tier, sort_order, is_active";

export const metadata: Metadata = {
  title: "Thai Lawyers League Season 6 Results & Final Table | KSW L.C.",
  description:
    "Season archive for Thai Lawyers League Season 6, including final standings, KSW results, match history, participating teams, and full season results.",
};

function text(row: Row | undefined, keys: string[], fallback = "") {
  if (!row) return fallback;

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }

  return fallback;
}

function number(row: Row | undefined, keys: string[]) {
  if (!row) return 0;

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }

  return 0;
}

function formatMatchTime(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    hour12: false,
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function formatMatchDateLong(value: unknown) {
  if (typeof value !== "string" || !value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "long",
    timeZone: "Asia/Bangkok",
    weekday: "long",
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

function matchTime(match: Row) {
  const value = text(match, ["match_date", "date", "kickoff_at"], "");
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function isKswRow(row: Row | undefined) {
  return row?.is_ksw === true || text(row, ["team_name", "name", "team"]).toLowerCase().includes("ksw");
}

function isKswMatch(match: Row) {
  return (
    text(match, ["home_team_name"], "").toLowerCase().includes("ksw") ||
    text(match, ["away_team_name"], "").toLowerCase().includes("ksw") ||
    text(match, ["home_team_short_name"], "").toLowerCase().includes("ksw") ||
    text(match, ["away_team_short_name"], "").toLowerCase().includes("ksw")
  );
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

function latestStandingSnapshotRows(rows: Row[]) {
  const latestSnapshotId = text(rows[0], ["snapshot_id"], "");
  if (latestSnapshotId) return rows.filter((row) => text(row, ["snapshot_id"], "") === latestSnapshotId);

  const latestCreatedAt = text(rows[0], ["created_at"], "");
  return latestCreatedAt ? rows.filter((row) => text(row, ["created_at"], "") === latestCreatedAt) : [];
}

function teamById(teams: Row[]) {
  return new Map(
    teams.map((team) => [
      text(team, ["id"], ""),
      {
        name: text(team, ["name", "short_name"], "Team unavailable"),
        shortName: text(team, ["short_name"], ""),
        logoUrl: text(team, ["logo_url"], ""),
      },
    ]),
  );
}

function withMatchTeams(matches: Row[], teams: Row[]): Row[] {
  const teamsById = teamById(teams);

  return matches.map((match) => {
    const homeTeam = teamsById.get(text(match, ["home_team_id"], ""));
    const awayTeam = teamsById.get(text(match, ["away_team_id"], ""));
    const homeScore = match.home_score;
    const awayScore = match.away_score;
    const hasScore = typeof homeScore === "number" && typeof awayScore === "number";

    return {
      ...match,
      away_team_logo_url: awayTeam?.logoUrl ?? "",
      away_team_name: awayTeam?.name ?? "Away team unavailable",
      away_team_short_name: awayTeam?.shortName ?? "",
      home_team_logo_url: homeTeam?.logoUrl ?? "",
      home_team_name: homeTeam?.name ?? "Home team unavailable",
      home_team_short_name: homeTeam?.shortName ?? "",
      score: hasScore ? `${homeScore} - ${awayScore}` : "VS",
    };
  });
}

function sponsorTierGroup(sponsor: Row | undefined) {
  const tier = text(sponsor, ["tier"], "").toLowerCase();
  if (tier === "main") return "main";
  if (["official", "partner", "matchday"].includes(tier)) return "official";
  return "supporter";
}

function sponsorSortOrder(sponsor: Row) {
  const value = sponsor.sort_order;
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  return Number.MAX_SAFE_INTEGER;
}

function sponsorTierPriority(sponsor: Row) {
  const group = sponsorTierGroup(sponsor);
  if (group === "main") return 0;
  if (group === "official") return 1;
  return 2;
}

function sortSponsorsForWall(sponsors: Row[]) {
  return sponsors
    .filter((sponsor) => sponsor.is_active !== false)
    .sort((a, b) => {
      const tierDiff = sponsorTierPriority(a) - sponsorTierPriority(b);
      if (tierDiff) return tierDiff;

      const orderDiff = sponsorSortOrder(a) - sponsorSortOrder(b);
      if (orderDiff) return orderDiff;

      return text(a, ["name"], "").localeCompare(text(b, ["name"], ""));
    });
}

function groupSponsorsByTier(sponsors: Row[]) {
  const sortedSponsors = sortSponsorsForWall(sponsors);

  return {
    main: sortedSponsors.filter((sponsor) => sponsorTierGroup(sponsor) === "main"),
    official: sortedSponsors.filter((sponsor) => sponsorTierGroup(sponsor) === "official"),
    supporter: sortedSponsors.filter((sponsor) => sponsorTierGroup(sponsor) === "supporter"),
  };
}

function sponsorSlots(sponsors: Row[], minimumSlots: number) {
  const numericSlots = sponsors
    .map(sponsorSortOrder)
    .filter((slot) => Number.isInteger(slot) && slot > 0 && slot < Number.MAX_SAFE_INTEGER);
  const totalSlots = Math.max(minimumSlots, ...numericSlots, sponsors.length);
  const slots: Array<Row | undefined> = Array.from({ length: totalSlots }, () => undefined);
  const unslottedSponsors: Row[] = [];

  sponsors.forEach((sponsor) => {
    const slotNumber = sponsorSortOrder(sponsor);
    if (Number.isInteger(slotNumber) && slotNumber > 0 && slotNumber < Number.MAX_SAFE_INTEGER) {
      const slotIndex = slotNumber - 1;
      if (!slots[slotIndex]) {
        slots[slotIndex] = sponsor;
        return;
      }
    }

    unslottedSponsors.push(sponsor);
  });

  unslottedSponsors.forEach((sponsor) => {
    const emptySlotIndex = slots.findIndex((slot) => !slot);
    if (emptySlotIndex >= 0) {
      slots[emptySlotIndex] = sponsor;
    } else {
      slots.push(sponsor);
    }
  });

  return slots;
}

function seasonStatusLabel(status: string) {
  if (status === "completed") return "SEASON COMPLETE";
  if (status === "upcoming") return "UPCOMING";
  return "ACTIVE SEASON";
}

function resultOutcome(match: Row) {
  const homeScore = number(match, ["home_score"]);
  const awayScore = number(match, ["away_score"]);
  const homeName = text(match, ["home_team_name"], "");
  const awayName = text(match, ["away_team_name"], "");
  const homeShortName = text(match, ["home_team_short_name"], "");
  const awayShortName = text(match, ["away_team_short_name"], "");
  const homeIsKsw = homeName.toLowerCase().includes("ksw") || homeShortName.toLowerCase().includes("ksw");
  const awayIsKsw = awayName.toLowerCase().includes("ksw") || awayShortName.toLowerCase().includes("ksw");
  const isKswResult = homeIsKsw || awayIsKsw;
  const kswScore = homeIsKsw ? homeScore : awayScore;
  const opponentScore = homeIsKsw ? awayScore : homeScore;

  return {
    homeScore,
    awayScore,
    isKswResult,
    outcome: !isKswResult ? "" : kswScore > opponentScore ? "WIN" : kswScore < opponentScore ? "LOSS" : "DRAW",
  };
}

function ResultCard({ match }: { match: Row }) {
  const matchDate = match.match_date ?? match.date ?? match.kickoff_at;
  const matchTimeValue = formatMatchTime(matchDate);
  const homeName = text(match, ["home_team_name"], "Home team unavailable");
  const awayName = text(match, ["away_team_name"], "Away team unavailable");
  const homeShortName = text(match, ["home_team_short_name"], teamInitials({ team_name: homeName }));
  const awayShortName = text(match, ["away_team_short_name"], teamInitials({ team_name: awayName }));
  const venue = text(match, ["venue"], "");
  const { awayScore, homeScore, isKswResult, outcome } = resultOutcome(match);

  return (
    <article
      className={`group overflow-hidden rounded-xl border bg-white p-4 shadow-lg transition duration-300 lg:grid lg:grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)] lg:items-center lg:gap-5 lg:p-5 lg:hover:-translate-y-0.5 ${
        isKswResult ? "border-[#d8ad45] shadow-[#d8ad45]/20" : "border-white shadow-black/10 hover:shadow-black/20"
      }`}
    >
      <div className="mb-4 flex flex-wrap items-center justify-center gap-2 lg:hidden">
        {isKswResult ? (
          <span className="rounded-full border border-[#d8ad45]/45 bg-[#fff4dc] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#061426]">
            KSW Result
          </span>
        ) : null}
        <span className="rounded-full border border-emerald-700/20 bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-800">
          Full Time
        </span>
        {outcome ? (
          <span className="rounded-full bg-[#061426] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#f4d58a]">
            {outcome}
          </span>
        ) : null}
      </div>

      <div className="grid min-w-0 justify-items-center gap-2 text-center lg:flex lg:justify-start lg:text-left">
        <TeamLogo className="!size-12 transition-transform duration-300 group-hover:scale-105 lg:!size-16" initials={homeShortName} logoUrl={text(match, ["home_team_logo_url"], "")} teamName={homeName} />
        <p className="min-w-0 text-wrap text-base font-black leading-5 text-[#061426] lg:text-lg lg:leading-6">
          <span className="lg:hidden">{homeShortName}</span>
          <span className="hidden lg:inline">{homeName}</span>
        </p>
      </div>

      <div className="my-4 grid justify-items-center gap-2 lg:my-0">
        <div className="rounded-2xl border border-[#d8ad45]/45 bg-[#061426] px-5 py-3 text-3xl font-black tracking-tight text-white shadow-xl shadow-[#061426]/20 sm:text-4xl">
          <span>{homeScore}</span>
          <span className="px-2 text-[#f4d58a]">-</span>
          <span>{awayScore}</span>
        </div>
        <div className="flex flex-wrap justify-center gap-2 text-xs font-black text-[#061426]">
          {matchTimeValue ? <span className="rounded-full bg-slate-100 px-3 py-1.5">Time {matchTimeValue}</span> : null}
          {venue ? <span className="rounded-full bg-[#fff4dc] px-3 py-1.5">Field {venue}</span> : null}
        </div>
      </div>

      <div className="grid min-w-0 justify-items-center gap-2 text-center lg:flex lg:justify-end lg:text-right">
        <p className="min-w-0 text-wrap text-base font-black leading-5 text-[#061426] lg:order-first lg:text-lg lg:leading-6">
          <span className="lg:hidden">{awayShortName}</span>
          <span className="hidden lg:inline">{awayName}</span>
        </p>
        <TeamLogo className="!size-12 transition-transform duration-300 group-hover:scale-105 lg:!size-16" initials={awayShortName} logoUrl={text(match, ["away_team_logo_url"], "")} teamName={awayName} />
      </div>

      <div className="mt-4 hidden flex-wrap items-center justify-center gap-2 lg:col-span-3 lg:flex">
        {isKswResult ? (
          <span className="rounded-full border border-[#d8ad45]/45 bg-[#fff4dc] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#061426]">
            KSW Result
          </span>
        ) : null}
        <span className="rounded-full border border-emerald-700/20 bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-800">
          Full Time
        </span>
        {outcome ? (
          <span className="rounded-full bg-[#061426] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#f4d58a]">
            {outcome}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function SponsorsSection({ sponsors }: { sponsors: Row[] }) {
  const sponsorGroups = groupSponsorsByTier(sponsors);
  const sponsorSections = [
    {
      key: "main",
      label: "Main Partner",
      items: sponsorSlots(sponsorGroups.main, 3),
      logoSlotSize: "h-24 w-full max-w-48 sm:h-28 sm:max-w-64 lg:h-32 lg:max-w-72",
      wrapperClass: "mx-auto grid w-full grid-cols-2 place-items-center gap-x-6 gap-y-4 lg:grid-cols-3",
    },
    {
      key: "official",
      label: "Official Partner",
      items: sponsorSlots(sponsorGroups.official, 6),
      logoSlotSize: "h-16 w-full max-w-32 sm:h-20 sm:max-w-40 lg:h-24 lg:max-w-44",
      wrapperClass: "mx-auto grid w-full grid-cols-2 place-items-center gap-x-6 gap-y-4 lg:grid-cols-3",
    },
    {
      key: "supporter",
      label: "Supporter",
      items: sponsorSlots(sponsorGroups.supporter, 9),
      logoSlotSize: "h-14 w-full max-w-28 sm:h-16 sm:max-w-32 lg:h-[72px] lg:max-w-36",
      wrapperClass: "mx-auto grid w-full grid-cols-2 place-items-center gap-x-5 gap-y-4 lg:grid-cols-3",
    },
  ];

  return (
    <section id="sponsors" className="bg-gradient-to-br from-[#071b31] via-[#0b2745] to-[#061426]">
      <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
        <div className="min-w-0 rounded-lg border border-[#d8ad45]/25 bg-white/[0.08] p-6 shadow-2xl shadow-black/30 backdrop-blur sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[#d8ad45]">KSW Partnership</p>
              <h2 className="mt-3 text-3xl font-black text-white">Partners & Supporters</h2>
	              <p className="mt-4 max-w-xl text-sm leading-7 text-slate-200">
	                สนับสนุน KSW L.C. คือการเป็นส่วนหนึ่งของชุมชนฟุตบอลนักกฎหมายที่เชื่อมโยงมิตรภาพ เครือข่ายวิชาชีพ และกิจกรรมการแข่งขันตลอดฤดูกาล
	              </p>
	              <div className="mt-6 grid gap-3">
	                {[
	                  ["Brand Visibility", "โลโก้ปรากฏบนเว็บไซต์ทางการและสื่อกิจกรรมของทีม"],
	                  ["Legal Community Network", "เข้าถึงกลุ่มนักกฎหมาย ผู้บริหาร และผู้ประกอบการ"],
	                  ["Matchday Presence", "เชื่อมแบรนด์เข้ากับกิจกรรมการแข่งขันและภาพลักษณ์ของสโมสร"],
	                ].map(([title, body]) => (
	                  <div className="rounded-lg border border-white/10 bg-white/[0.07] p-4 shadow-lg shadow-black/15" key={title}>
	                    <div className="mb-3 h-0.5 w-10 rounded-full bg-[#d8ad45]" />
	                    <h3 className="font-black text-white">{title}</h3>
	                    <p className="mt-1 text-sm leading-6 text-slate-300">{body}</p>
	                  </div>
	                ))}
	              </div>
	              <div className="mt-7">
	                <Link className="inline-flex items-center justify-center rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/20 transition-transform hover:scale-[1.02]" href="/partners">
	                  Become a KSW Partner
                </Link>
              </div>
            </div>
            <div className="rounded-[24px] border border-white/60 bg-[#fafafa] p-6 shadow-xl shadow-black/15 sm:p-8 lg:p-10">
              <div className="space-y-8">
                {sponsorSections.map((section) => (
                  <div key={section.key}>
                    <p className="mb-4 text-center text-[10px] font-black uppercase tracking-[0.24em] text-[#061426]/60">
                      {section.label}
                    </p>
                    <div className={section.wrapperClass}>
                      {section.items.map((sponsor, index) => {
                        const sponsorName = text(sponsor, ["name", "sponsor_name"], "YOUR LOGO");
                        const sponsorLogo = text(sponsor, ["logo_url"], "");
                        const sponsorWebsite = text(sponsor, ["website_url"], "");
                        const sponsorMark = (
                          <div className={`flex ${section.logoSlotSize} items-center justify-center text-center transition-transform duration-300 hover:scale-[1.04]`}>
                            {sponsorLogo ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img alt={`${sponsorName} logo`} className="ksw-sponsor-logo-fit" src={sponsorLogo} />
                            ) : (
                              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#061426]/30 sm:text-[10px]">
                                YOUR LOGO
                              </span>
                            )}
                          </div>
                        );

                        return sponsorWebsite ? (
                          <a aria-label={`Visit ${sponsorName} website`} className="cursor-pointer" href={sponsorWebsite} key={`${section.key}-${index}`} rel="noopener noreferrer" target="_blank">
                            {sponsorMark}
                          </a>
                        ) : (
                          <div key={`${section.key}-${index}`}>{sponsorMark}</div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

async function runSupabaseQuery<T>(source: string, query: PromiseLike<{ data: T[] | null; error: unknown }>) {
  try {
    const result = await query;
    if (result.error) console.error("Supabase season archive query failed", source, result.error);
    return result.data ?? [];
  } catch (error) {
    console.error("Supabase season archive query failed", source, error, getSupabaseConfig().diagnostics);
    return [];
  }
}

async function resolveLeague(slug: string) {
  if (slug !== seasonSlug) notFound();

  const supabase = getSupabase();
  if (!supabase) notFound();

  const byName = await runSupabaseQuery(
    "archive_league_by_name",
      supabase
      .from("leagues")
      .select(leagueColumns)
      .eq("name", "Thai Lawyers League Season 6")
      .eq("competition_type", "league")
      .order("created_at", { ascending: false })
      .limit(1),
  );
  if (byName[0]) return byName[0];

  const bySeason = await runSupabaseQuery(
    "archive_league_by_season",
    supabase
      .from("leagues")
      .select(leagueColumns)
      .eq("season", "Season 6")
      .eq("competition_type", "league")
      .order("created_at", { ascending: false })
      .limit(1),
  );
  if (bySeason[0]) return bySeason[0];

  notFound();
}

async function loadArchiveData(slug: string) {
  const supabase = getSupabase();
  if (!supabase) notFound();

  const league = await resolveLeague(slug);
  const leagueId = text(league, ["id"], "");
  if (!leagueId) notFound();

  const [standings, finishedMatches, snapshots, teams, sponsors] = await Promise.all([
    runSupabaseQuery(
      "archive_standings",
      supabase.from("league_standings_view").select(standingsColumns).eq("league_id", leagueId),
    ),
    runSupabaseQuery(
      "archive_finished_matches",
      supabase
        .from("matches")
        .select(matchColumns)
        .eq("league_id", leagueId)
        .eq("status", "finished")
        .order("match_date", { ascending: false }),
    ),
    runSupabaseQuery(
      "archive_snapshots",
      supabase
        .from("league_standings_snapshots")
        .select(snapshotColumns)
        .eq("league_id", leagueId)
        .order("created_at", { ascending: false })
        .limit(100),
    ),
    runSupabaseQuery(
      "archive_teams",
      supabase.from("teams").select(teamColumns).eq("league_id", leagueId).order("name", { ascending: true }),
    ),
    runSupabaseQuery(
      "archive_sponsors",
      supabase.from("sponsors").select(sponsorColumns).order("sort_order", { ascending: true, nullsFirst: false }),
    ),
  ]);

  const matches = withMatchTeams(finishedMatches, teams);
  return { league, matches, snapshots, sponsors, standings, teams };
}

export default async function SeasonArchivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { league, matches, snapshots, sponsors, standings, teams } = await loadArchiveData(slug);
  const seasonStatus = text(league, ["season_status"], "active").toLowerCase();
  const seasonCompleted = seasonStatus === "completed";
  const sortedStandings = sortStandings(standings);
  const kswIndex = sortedStandings.findIndex(isKswRow);
  const kswStanding = kswIndex >= 0 ? sortedStandings[kswIndex] : undefined;
  const kswMatchesNewest = matches.filter(isKswMatch).sort((a, b) => matchTime(b) - matchTime(a));
  const kswMatchesOldest = [...kswMatchesNewest].reverse();
  const resultGroups = matches.reduce<Array<{ key: string; date: unknown; matches: Row[] }>>((groups, match) => {
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
  const summaryStats = kswStanding
    ? [
        ["Final Position", `${kswIndex + 1} / ${sortedStandings.length}`],
        ["Total Teams", sortedStandings.length],
        ["Played", number(kswStanding, ["played", "p"])],
        ["Won", number(kswStanding, ["won", "w"])],
        ["Drawn", number(kswStanding, ["drawn", "draws", "d"])],
        ["Lost", number(kswStanding, ["lost", "l"])],
        ["Goals For", number(kswStanding, ["goals_for", "gf"])],
        ["Goals Against", number(kswStanding, ["goals_against", "ga"])],
        ["Goal Difference", number(kswStanding, ["goal_difference", "gd"])],
        ["Points", number(kswStanding, ["points", "pts"])],
      ]
    : [];

  return (
    <main className="min-h-screen overflow-x-hidden bg-slate-100 text-[#061426]">
      <section className="bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.2),transparent_34%),linear-gradient(135deg,#061426,#091f39)] text-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ad45]">Season Archive</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight sm:text-5xl">
            Thai Lawyers League Season 6
          </h1>
          <div className="mt-4 inline-flex rounded-full border border-[#d8ad45]/35 bg-[#d8ad45]/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-[#f4d58a]">
            {seasonStatusLabel(seasonStatus)}
          </div>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
            Final standings, KSW match history, participating teams, and full match results from Thai Lawyers League Season 6.
          </p>
	          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
	            {[
	              ["Season Summary", "#season-summary"],
	              ["Final League Table", "#final-table"],
	              ["KSW Match History", "#ksw-results"],
	              ["All Results", "#all-results"],
	              ["Participating Teams", "#participating-teams"],
	            ].map(([label, href]) => (
	              <Link className="inline-flex items-center justify-center rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/15 transition-transform hover:scale-[1.02]" href={href} key={href}>
	                {label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10" id="season-summary">
        <div className="rounded-2xl border border-[#d8ad45]/30 bg-white p-5 shadow-xl shadow-slate-900/10 sm:p-6">
          <h2 className="text-2xl font-black">KSW Season Summary</h2>
          {kswStanding ? (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {summaryStats.map(([label, value]) => (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center" key={label}>
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p>
                  <p className="mt-2 text-2xl font-black text-[#061426]">{value}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-xl bg-slate-100 px-4 py-6 text-slate-600">KSW standings data is not available for this season.</p>
          )}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10" id="ksw-results">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="border-b border-slate-200 px-4 py-5 sm:px-6">
            <h2 className="text-2xl font-black">KSW Match History</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">KSW results in chronological order.</p>
          </div>
          <div className="grid gap-3 bg-slate-100 px-4 py-5 sm:px-6">
            {kswMatchesOldest.length ? (
              kswMatchesOldest.map((match) => <ResultCard key={text(match, ["id"])} match={match} />)
            ) : (
              <p className="rounded-xl bg-white px-4 py-8 text-slate-600">No KSW match results available.</p>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10" id="final-table">
        <LeagueTable
          finishedMatches={matches}
          previousSnapshot={latestStandingSnapshotRows(snapshots)}
          seasonCompleted={seasonCompleted}
          standings={standings}
        />
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10" id="all-results">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="border-b border-slate-200 px-4 py-5 sm:px-6">
            <h2 className="text-2xl font-black">All Match Results</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">Every finished match from this season.</p>
          </div>
          <div className="grid gap-6 bg-slate-100 px-4 py-5 sm:px-6">
            {resultGroups.length ? (
              resultGroups.map((group) => (
                <div className="grid gap-3" key={group.key}>
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-[#9b1c1f]">Results</p>
                    <p className="text-sm font-bold text-slate-600">{formatMatchDateLong(group.date)}</p>
                  </div>
                  <div className="grid gap-3">
                    {group.matches.map((match) => <ResultCard key={text(match, ["id"])} match={match} />)}
                  </div>
                </div>
              ))
            ) : (
              <p className="rounded-xl bg-white px-4 py-8 text-slate-600">No finished results available.</p>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10" id="participating-teams">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10 sm:p-6">
          <h2 className="text-2xl font-black">Participating Teams</h2>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {teams.map((team) => (
              <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm" key={text(team, ["id"])}>
                <div className="flex min-w-0 items-center gap-3">
                  <TeamLogo className="size-8" initials={teamInitials(team)} logoUrl={text(team, ["logo_url"], "")} teamName={text(team, ["name"])} />
                  <p className="min-w-0 text-wrap text-sm font-black leading-5 text-[#061426]">{text(team, ["name"])}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <SponsorsSection sponsors={sponsors} />
    </main>
  );
}

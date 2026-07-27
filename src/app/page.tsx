import Link from "next/link";
import { LiveCountdown } from "@/components/live-countdown";
import { TeamLogo } from "@/components/team-logo";
import { getSupabase, getSupabaseConfig } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, unknown>;

const teamColumns = "id, name, short_name, logo_url, is_ksw";
const standingsColumns =
  "team_id, league_id, team_name, short_name, logo_url, is_ksw, played, won, drawn, lost, goals_for, goals_against, goal_difference, points";
const matchColumns =
  "id, league_id, match_date, home_team_id, away_team_id, home_score, away_score, venue, status, match_type";
const leagueColumns = "id, name, season, competition_type, season_status, is_active, created_at";
const sponsorColumns =
  "id, name, logo_url, website_url, tier, sort_order, is_active";
const seasonArchiveHref = "/seasons/thai-lawyers-league-season-6";

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

function formatMatchTime(value: unknown) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function formatMatchDateLong(value: unknown) {
  if (typeof value !== "string" || !value) {
    return "Date unavailable";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function bangkokDateKey(value: unknown) {
  if (typeof value !== "string" || !value) {
    return "date-unavailable";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function countdownText(value: unknown, now = new Date()) {
  if (typeof value !== "string" || !value) {
    return "TBC";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "TBC";
  }

  const diff = date.getTime() - now.getTime();
  if (diff <= 0) {
    return "Kickoff now";
  }

  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function fixtureStatusLabel(match: Row, matchDate: unknown, now = new Date()) {
  const status = text(match, ["status"], "").toLowerCase();
  if (status === "live") {
    return "LIVE";
  }

  if (bangkokDateKey(matchDate) === bangkokDateKey(now.toISOString())) {
    return "TODAY";
  }

  return "UPCOMING";
}

function fixtureDateValue(match: Row) {
  return match.match_date ?? match.date ?? match.kickoff_at;
}

function isKswName(value: string) {
  return value.toLowerCase().includes("ksw");
}

function isKswFixture(match: Row) {
  return (
    isKswName(text(match, ["home_team_name"], "")) ||
    isKswName(text(match, ["away_team_name"], "")) ||
    isKswName(text(match, ["home_team_short_name"], "")) ||
    isKswName(text(match, ["away_team_short_name"], ""))
  );
}

function opponentForKsw(match: Row) {
  const homeName = text(match, ["home_team_name"], "Home team unavailable");
  const awayName = text(match, ["away_team_name"], "Away team unavailable");
  const homeShortName = text(match, ["home_team_short_name"], "");

  return isKswName(homeName) || isKswName(homeShortName) ? awayName : homeName;
}

function venueNumber(match: Row) {
  const venue = text(match, ["venue"], "");
  const matchValue = venue.match(/v\s*(\d+)/i);

  return matchValue ? Number(matchValue[1]) : Number.MAX_SAFE_INTEGER;
}

function formatVenue(value: string) {
  if (!value) {
    return "";
  }

  return value.trim().startsWith("สนาม") ? value.trim() : `สนาม ${value.trim()}`;
}

function FixtureMetaBadge({
  icon,
  label,
  tone,
}: {
  icon: string;
  label: string;
  tone: "navy" | "gold";
}) {
  const toneClass =
    tone === "gold"
      ? "border border-[#d8ad45]/45 bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] text-[#061426] shadow-lg shadow-[#d8ad45]/15"
      : "bg-[#061426] text-white";

  return (
    <span className={`fixtureMetaBadge ${toneClass}`}>
      <span aria-hidden="true" className="fixtureMetaBadge__icon">
        {icon}
      </span>
      {label}
    </span>
  );
}

function FixtureMetaBadgePair({ matchTime, venue }: { matchTime: string; venue: string }) {
  return (
    <div className="grid justify-items-center gap-6 lg:justify-items-start lg:gap-2 lg:text-left">
      <FixtureMetaBadge icon="🕒" label={matchTime || "TBC"} tone="navy" />
      {venue ? <FixtureMetaBadge icon="📍" label={formatVenue(venue)} tone="gold" /> : null}
    </div>
  );
}

function fixtureTimeValue(match: Row) {
  const dateValue = fixtureDateValue(match);
  const date = typeof dateValue === "string" ? new Date(dateValue) : null;

  return date && !Number.isNaN(date.getTime()) ? date.getTime() : Number.MAX_SAFE_INTEGER;
}

function sortUpcomingFixtures(fixtures: Row[]) {
  return [...fixtures].sort((a, b) => {
    const timeDiff = fixtureTimeValue(a) - fixtureTimeValue(b);
    if (timeDiff) return timeDiff;

    const venueDiff = venueNumber(a) - venueNumber(b);
    if (venueDiff) return venueDiff;

    return text(a, ["home_team_name"], "").localeCompare(text(b, ["home_team_name"], ""));
  });
}

function isString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
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

function sponsorTierGroup(sponsor: Row | undefined) {
  const tier = text(sponsor, ["tier"], "").toLowerCase();

  if (tier === "main") {
    return "main";
  }

  if (["official", "partner", "matchday"].includes(tier)) {
    return "official";
  }

  return "supporter";
}

function sponsorTierPriority(sponsor: Row) {
  const group = sponsorTierGroup(sponsor);

  if (group === "main") return 0;
  if (group === "official") return 1;
  return 2;
}

function sponsorSortOrder(sponsor: Row) {
  const value = sponsor.sort_order;

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
    return Number(value);
  }

  return Number.MAX_SAFE_INTEGER;
}

function isActiveSponsor(sponsor: Row) {
  return sponsor.is_active !== false;
}

function sortSponsorsForWall(sponsors: Row[]) {
  return sponsors
    .filter(isActiveSponsor)
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
    const homeTeamId = text(match, ["home_team_id"], "");
    const awayTeamId = text(match, ["away_team_id"], "");
    const homeTeam = teamsById.get(homeTeamId);
    const awayTeam = teamsById.get(awayTeamId);
    const homeScore = match.home_score;
    const awayScore = match.away_score;
    const hasScore = typeof homeScore === "number" && typeof awayScore === "number";

    return {
      ...match,
      home_team_name: homeTeam?.name ?? "Home team unavailable",
      home_team_short_name: homeTeam?.shortName ?? "",
      home_team_logo_url: homeTeam?.logoUrl ?? "",
      away_team_name: awayTeam?.name ?? "Away team unavailable",
      away_team_short_name: awayTeam?.shortName ?? "",
      away_team_logo_url: awayTeam?.logoUrl ?? "",
      score: hasScore ? `${homeScore} - ${awayScore}` : "VS",
    } satisfies Row;
  });
}

function supabaseEnvDiagnostics() {
  return getSupabaseConfig().diagnostics;
}

function errorName(error: unknown) {
  if (error instanceof Error) {
    return error.name;
  }

  if (error && typeof error === "object" && "name" in error) {
    const name = error.name;
    if (typeof name === "string") {
      return name;
    }
  }

  return "SupabaseError";
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = error.message;
    if (typeof message === "string") {
      return message;
    }
  }

  return String(error);
}

function errorCauseMessage(error: unknown) {
  if (!error || typeof error !== "object" || !("cause" in error)) {
    return undefined;
  }

  const cause = error.cause;
  if (cause instanceof Error) {
    return cause.message;
  }
  if (cause && typeof cause === "object" && "message" in cause) {
    const message = cause.message;
    return typeof message === "string" ? message : undefined;
  }
  if (typeof cause === "string") {
    return cause;
  }

  return undefined;
}

function logSupabaseError(source: string, error: unknown) {
  if (!error) {
    return;
  }

  console.error("Supabase homepage query failed", {
    source,
    errorName: errorName(error),
    errorMessage: errorMessage(error),
    errorCauseMessage: errorCauseMessage(error),
    ...supabaseEnvDiagnostics(),
  });
}

async function runSupabaseQuery<T>(
  source: string,
  query: PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  try {
    const result = await query;
    logSupabaseError(source, result.error);
    return result.data ?? [];
  } catch (error) {
    logSupabaseError(source, error);
    return [];
  }
}

async function loadHomeData() {
  const supabase = getSupabase();

  if (!supabase) {
    console.error("Supabase homepage client unavailable", {
      source: "supabase_client",
      ...supabaseEnvDiagnostics(),
    });

    return {
      configured: false,
      teams: [] as Row[],
      standings: [] as Row[],
      matches: [] as Row[],
      scheduledMatches: [] as Row[],
      sponsors: [] as Row[],
      currentLeague: undefined as Row | undefined,
    };
  }

  const leagueQuery = () =>
    supabase
      .from("leagues")
      .select(leagueColumns)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1);
  const leagueRows = await runSupabaseQuery(
    "current_league",
    supabase
      .from("leagues")
      .select(leagueColumns)
      .eq("is_active", true)
      .eq("competition_type", "league")
      .order("created_at", { ascending: false })
      .limit(1),
  );
  const currentLeagueRows = leagueRows.length
    ? leagueRows
    : await runSupabaseQuery("current_league_fallback", leagueQuery());
  const currentLeague = currentLeagueRows[0];
  const currentLeagueId = text(currentLeague, ["id"], "");

  const [teams, allTeams, standings, finishedMatches, scheduledMatches, sponsors] = await Promise.all([
    currentLeagueId
      ? runSupabaseQuery(
          "teams",
          supabase.from("teams").select(teamColumns).eq("league_id", currentLeagueId).eq("is_ksw", true),
        )
      : Promise.resolve([] as Row[]),
    currentLeagueId
      ? runSupabaseQuery(
          "teams_all",
          supabase.from("teams").select(teamColumns).eq("league_id", currentLeagueId),
        )
      : Promise.resolve([] as Row[]),
    currentLeagueId
      ? runSupabaseQuery(
          "league_standings_view",
          supabase
            .from("league_standings_view")
            .select(standingsColumns)
            .eq("league_id", currentLeagueId),
        )
      : Promise.resolve([] as Row[]),
    currentLeagueId
      ? runSupabaseQuery(
          "finished_matches",
          supabase
            .from("matches")
            .select(matchColumns)
            .eq("league_id", currentLeagueId)
            .eq("status", "finished")
            .order("match_date", { ascending: false })
        )
      : Promise.resolve([] as Row[]),
    currentLeagueId
      ? runSupabaseQuery(
          "scheduled_matches",
          supabase
            .from("matches")
            .select(matchColumns)
            .eq("league_id", currentLeagueId)
            .eq("status", "scheduled")
            .order("match_date", { ascending: true })
            .limit(16),
        )
      : Promise.resolve([] as Row[]),
    runSupabaseQuery(
	      "sponsors",
	      supabase
        .from("sponsors")
        .select(sponsorColumns)
        .order("sort_order", { ascending: true, nullsFirst: false }),
    ),
  ]);

  const teamRows = allTeams.length ? allTeams : teams;

  return {
    configured: true,
    teams,
    standings,
    matches: withMatchTeams(finishedMatches, teamRows),
    scheduledMatches: withMatchTeams(scheduledMatches, teamRows),
    sponsors,
    currentLeague,
  };
}

export default async function Home() {
  const { configured, teams, standings, matches, scheduledMatches, sponsors, currentLeague } = await loadHomeData();
  const club = teams[0];
  const logoUrl = club?.logo_url;
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
  const now = new Date();
  const sortedScheduledMatches = sortUpcomingFixtures(scheduledMatches);
  const upcomingKswMatches = sortedScheduledMatches.filter((match) => {
    const matchTime = fixtureTimeValue(match);
    return isKswFixture(match) && matchTime >= now.getTime();
  });
  const nextKswDateKey = upcomingKswMatches[0]
    ? bangkokDateKey(fixtureDateValue(upcomingKswMatches[0]))
    : "";
  const nextKswKickoffMatches = upcomingKswMatches.filter(
    (match) => bangkokDateKey(fixtureDateValue(match)) === nextKswDateKey,
  );
  const fixtureGroups = sortedScheduledMatches.reduce<Array<{ key: string; date: unknown; matches: Row[] }>>(
    (groups, match) => {
      const matchDate = fixtureDateValue(match);
      const key = bangkokDateKey(matchDate);
      const existingGroup = groups.find((group) => group.key === key);

      if (existingGroup) {
        existingGroup.matches.push(match);
      } else {
        groups.push({ key, date: matchDate, matches: [match] });
      }

      return groups;
    },
    [],
  );
	  const sortedStandings = [...standings].sort((a, b) => {
    const pointsDiff = number(b, ["points", "pts"]) - number(a, ["points", "pts"]);
    if (pointsDiff) return pointsDiff;

    const goalDiff = number(b, ["goal_difference", "gd"]) - number(a, ["goal_difference", "gd"]);
    if (goalDiff) return goalDiff;

    const goalsForDiff = number(b, ["goals_for", "gf"]) - number(a, ["goals_for", "gf"]);
    if (goalsForDiff) return goalsForDiff;

    return text(a, ["team_name", "name", "team"]).localeCompare(
      text(b, ["team_name", "name", "team"]),
    );
  });
  const seasonStatus = text(currentLeague, ["season_status"], "active").toLowerCase();
  const isSeasonCompleted = seasonStatus === "completed";
  const kswStandingIndex = sortedStandings.findIndex(
    (row) => row.is_ksw === true || text(row, ["team_name", "name", "team"]).toLowerCase().includes("ksw"),
  );
	  const kswStanding = kswStandingIndex >= 0 ? sortedStandings[kswStandingIndex] : undefined;
	  const finalPositionText = kswStanding
	    ? `${kswStandingIndex + 1} / ${sortedStandings.length}`
	    : isSeasonCompleted
	      ? "Season Complete"
	      : "Unavailable";
  const finalKswStats = kswStanding
    ? [
        ["Played", number(kswStanding, ["played", "p"])],
        ["Won", number(kswStanding, ["won", "w"])],
        ["Drawn", number(kswStanding, ["drawn", "draws", "d"])],
        ["Lost", number(kswStanding, ["lost", "l"])],
        ["Points", number(kswStanding, ["points", "pts"])],
      ]
    : [];
  const recentKswResults = matches
    .filter(
      (match) =>
        isKswFixture(match) &&
        typeof match.home_score === "number" &&
        typeof match.away_score === "number",
    )
    .slice(0, 5);
  const resultGroups = recentKswResults.reduce<Array<{ key: string; date: unknown; matches: Row[] }>>(
    (groups, match) => {
      const matchDate = match.match_date ?? match.date ?? match.kickoff_at;
      const key = bangkokDateKey(matchDate);
      const existingGroup = groups.find((group) => group.key === key);

      if (existingGroup) {
        existingGroup.matches.push(match);
      } else {
        groups.push({ key, date: matchDate, matches: [match] });
      }

      return groups;
    },
    [],
  );

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#061426] text-slate-100">
      <style>
        {`
          @keyframes kswFloat {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
          }
          @keyframes kswLivePulse {
            0%, 100% { opacity: 0.72; transform: scale(0.92); box-shadow: 0 0 0 0 rgba(244, 213, 138, 0.28); }
            50% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 6px rgba(244, 213, 138, 0); }
          }
          .ksw-float-logo {
            animation: kswFloat 7s ease-in-out infinite;
          }
          .ksw-live-dot {
            animation: kswLivePulse 2.4s ease-in-out infinite;
          }
        `}
      </style>
      <section className="relative overflow-hidden border-b border-[#d8ad45]/30">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.2),transparent_34%),linear-gradient(135deg,rgba(6,20,38,0.96),rgba(9,31,57,0.88))]" />
        <div className="relative mx-auto grid min-h-[540px] w-full max-w-7xl items-center gap-8 px-4 py-10 sm:px-6 sm:py-14 md:grid-cols-[1.12fr_0.88fr] lg:px-10">
          <div className="min-w-0">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.22em] text-[#d8ad45] sm:text-sm sm:tracking-[0.28em]">
              KHLONG SAM WA LAWYERS CLUB
            </p>
            <h1 className="max-w-4xl text-4xl font-black leading-[1.03] tracking-tight text-white sm:text-5xl md:text-7xl">
              KSW L.C.
            </h1>
            <p className="mt-4 max-w-2xl text-lg font-black uppercase leading-7 tracking-wide text-[#f4d58a] sm:text-2xl">
              WHERE LAWYERS PLAY BEYOND THE COURTROOM
            </p>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:mt-6 sm:text-lg sm:leading-8">
              ชุมชนฟุตบอลนักกฎหมายที่รวมการแข่งขัน มิตรภาพ และเครือข่ายวิชาชีพไว้ในสนามเดียวกัน
            </p>
            <div className="mt-5 inline-flex max-w-full items-center rounded-full border border-[#d8ad45]/35 bg-[#d8ad45]/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-[#f4d58a] shadow-lg shadow-[#d8ad45]/10 sm:text-xs">
              THAI LAWYERS LEAGUE • SEASON 6
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                className="inline-flex items-center justify-center rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/15 transition-transform hover:scale-[1.02]"
                href={isSeasonCompleted ? seasonArchiveHref : "/#next-fixtures"}
              >
                {isSeasonCompleted ? "View Season Archive" : "View Next Fixtures"}
              </Link>
              <Link
                className="inline-flex items-center justify-center rounded-md border border-[#d8ad45]/50 bg-white/[0.03] px-5 py-3 text-sm font-black text-[#f4d58a] backdrop-blur transition-colors hover:bg-[#d8ad45]/10"
                href="/partners"
              >
                Partner With KSW
              </Link>
            </div>
            {!configured ? (
              <p className="mt-6 inline-flex max-w-full rounded-md border border-[#d8ad45]/50 bg-[#d8ad45]/10 px-4 py-3 text-sm text-[#f4d58a] sm:mt-8">
                Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
                to load live club data.
              </p>
            ) : null}
          </div>

          <div className="ksw-float-logo relative mx-auto flex w-full max-w-[17rem] min-w-0 items-center justify-center sm:max-w-xs md:max-w-sm">
              <div className="absolute inset-0 -z-10 rounded-full bg-[#d8ad45]/20 blur-3xl" />
              <div className="absolute inset-x-6 inset-y-10 -z-10 rounded-full bg-[#f4d58a]/10 blur-2xl" />
              {isString(logoUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt="KSW L.C. logo"
                  className="max-h-[305px] w-full object-contain drop-shadow-[0_22px_48px_rgba(216,173,69,0.28)]"
                  src={logoUrl}
                />
              ) : (
                <div className="text-center">
                  <p className="text-6xl font-black text-[#d8ad45] drop-shadow-[0_18px_40px_rgba(216,173,69,0.22)] sm:text-8xl">KSW</p>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.24em] text-slate-300 sm:text-sm sm:tracking-[0.35em]">
                    Law Club
                  </p>
                </div>
              )}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden border-b border-slate-200 bg-[#f6f2ea] shadow-inner shadow-slate-900/5">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d8ad45]/55 to-transparent" />
        <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
        <div className="grid gap-8 rounded-lg border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-900/10 sm:p-7 md:grid-cols-[1.18fr_0.82fr]">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-[#9b1c1f]">
              ABOUT KSW
            </p>
            <h2 className="mt-3 max-w-5xl text-2xl font-black leading-snug text-[#061426] sm:text-3xl lg:text-4xl lg:whitespace-nowrap">
              ชมรมทนายความคลองสามวา
            </h2>
            <p className="mt-5 max-w-3xl text-base leading-8 text-slate-700">
              KSW L.C. คือพื้นที่ของนักกฎหมายที่รักฟุตบอล ใช้กีฬาเป็นสะพานเชื่อมมิตรภาพ
              เครือข่ายวิชาชีพ กิจกรรมเพื่อสังคม และการแข่งขันในรายการของวงการทนายความ
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-1">
            {[
              ["2019", "ก่อตั้งชมรม"],
              ["50+", "สมาชิกในเครือข่าย"],
              ["Football & Network", "กิจกรรมฟุตบอลและเครือข่ายวิชาชีพ"],
            ].map(([value, label]) => (
              <div
                key={label}
                className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-lg shadow-slate-900/5"
              >
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#d8ad45]">
                  KSW
                </p>
                <p
                  className={`mt-2 font-black text-[#061426] ${
                    value === "Football & Network" ? "text-xl sm:text-2xl" : "text-2xl"
                  }`}
                >
                  {value}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-600">{label}</p>
              </div>
            ))}
          </div>
        </div>
        </div>
      </section>

      <section id="gallery" className="bg-gradient-to-br from-[#071b31] via-[#0b2745] to-[#061426]">
        <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
          <div className="mb-7 max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-[#d8ad45]">
              KSW HIGHLIGHTS
            </p>
            <h2 className="mt-3 text-3xl font-black text-white sm:text-4xl">
              Life at KSW
            </h2>
            <p className="mt-3 text-base leading-7 text-slate-300">
              ภาพบรรยากาศการแข่งขัน มิตรภาพ และชีวิตของชมรมฟุตบอลนักกฎหมายคลองสามวา
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.35fr_0.85fr]">
            <article className="group relative min-h-[360px] overflow-hidden rounded-lg border border-[#d8ad45]/25 shadow-2xl shadow-black/30">
              <img
                alt="KSW matchday action"
                className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
                src="/images/ksw-highlights/highlight-action.jpg"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#061426]/92 via-[#061426]/25 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
                <div className="mb-4 h-0.5 w-14 rounded-full bg-[#d8ad45]" />
                <h3 className="text-2xl font-black text-white">Matchday Intensity</h3>
                <p className="mt-2 text-sm leading-6 text-slate-200">
                  จังหวะการแข่งขันที่สะท้อนหัวใจของทีม
                </p>
              </div>
            </article>
            <div className="grid gap-4">
              {[
                [
                  "/images/ksw-highlights/highlight-matchday.jpg",
                  "Sideline Energy",
                  "บรรยากาศข้างสนามและแรงสนับสนุนจากทีม",
                ],
                [
                  "/images/ksw-highlights/highlight-team-huddle.jpg",
                  "Team Spirit",
                  "รวมพลัง ก่อนลงสนาม",
                ],
                [
                  "/images/ksw-highlights/highlight-celebration.jpg",
                  "Beyond The Game",
                  "มิตรภาพที่เกิดขึ้นนอกเหนือจากการแข่งขัน",
                ],
              ].map(([image, title, caption]) => (
                <article
                  className="group relative min-h-[180px] overflow-hidden rounded-lg border border-white/10 shadow-xl shadow-black/20 transition-shadow hover:shadow-[#d8ad45]/15"
                  key={title}
                >
                  <img
                    alt={title}
                    className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
                    src={image}
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#061426]/90 via-[#061426]/40 to-transparent" />
                  <div className="absolute inset-y-0 left-0 flex max-w-[80%] flex-col justify-end p-4">
                    <div className="mb-3 h-0.5 w-10 rounded-full bg-[#d8ad45]" />
                    <h3 className="text-lg font-black text-white">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-200">{caption}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
          <div className="mt-7">
            <a
              className="inline-flex items-center justify-center rounded-md border border-[#d8ad45]/55 bg-white/[0.04] px-5 py-3 text-sm font-black text-[#f4d58a] shadow-lg shadow-black/15 transition-colors hover:bg-[#d8ad45]/10"
              href="/gallery"
            >
              View Gallery
            </a>
          </div>
        </div>
	      </section>

      {!isSeasonCompleted ? (
        <section className="bg-slate-100">
          <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
            <div id="next-fixtures" className="min-w-0 overflow-hidden rounded-2xl border border-[#d8ad45]/35 bg-[linear-gradient(135deg,#061426,#0b2745_58%,#071b31)] shadow-2xl shadow-[#061426]/25">
              <div className="grid gap-5 border-b border-[#d8ad45]/20 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-[#d8ad45]/35 bg-[#d8ad45]/10 text-[#f4d58a] shadow-lg shadow-[#d8ad45]/10">
                    <svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3.9 4.2 1.8 1.3-.7 2.1-2.1.5-1.6-1.4.1-2.2 2.5-.3Zm-7.8 0 2.5.3.1 2.2-1.6 1.4-2.1-.5-.7-2.1 1.8-1.3ZM5.3 15.3l-.8-2.3 1.5-1.7 2.2.4 1 1.9-1.1 1.9-2.8-.2Zm8.7 3.4h-4l-1.2-2.1 1.2-2.1h4l1.2 2.1-1.2 2.1Zm-2-5.8-2-1.5.8-2.4h2.4l.8 2.4-2 1.5Zm6.7 2.4-2.8.2-1.1-1.9 1-1.9 2.2-.4 1.5 1.7-.8 2.3Z" />
                    </svg>
                  </span>
                  <div>
                    <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
                      Next Fixtures
                    </h2>
                    <p className="mt-1 text-sm font-semibold text-slate-300">
                      Upcoming KSW match schedule.
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[32rem]">
                  {nextKswKickoffMatches.length ? (
                    nextKswKickoffMatches.map((match, index) => {
                      const matchDate = fixtureDateValue(match);
                      const venue = text(match, ["venue"], "");

                      return (
                        <div
                          className="rounded-xl border border-[#d8ad45]/35 bg-white/[0.08] p-4 text-left shadow-xl shadow-black/15 backdrop-blur"
                          key={text(match, ["id", "match_id"], `ksw-kickoff-${index}`)}
                        >
                          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#f4d58a]">
                            Next Kickoff
                          </p>
                          <LiveCountdown
                            className="mt-2 text-3xl font-black text-white"
                            targetDate={typeof matchDate === "string" ? matchDate : ""}
                          />
                          <p className="mt-1 text-sm font-bold text-slate-300">
                            {formatMatchDateLong(matchDate)} • {formatMatchTime(matchDate) || "TBC"}
                          </p>
                          <p className="mt-2 text-sm font-black text-white">
                            vs {opponentForKsw(match)}
                          </p>
                          {venue ? (
                            <p className="mt-2 inline-flex rounded-full border border-[#d8ad45]/35 bg-[#d8ad45]/15 px-3 py-1 text-xs font-black text-[#f4d58a]">
                              📍 {formatVenue(venue)}
                            </p>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-xl border border-[#d8ad45]/35 bg-white/[0.08] p-4 text-left shadow-xl shadow-black/15 backdrop-blur sm:col-span-2 lg:ml-auto lg:min-w-64">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#f4d58a]">
                        Next Kickoff
                      </p>
                      <p className="mt-2 text-3xl font-black text-white">TBC</p>
                      <p className="mt-1 text-sm font-bold text-slate-300">
                        KSW match schedule to be confirmed
                      </p>
                    </div>
                  )}
                </div>
              </div>
              <div className="grid gap-6 px-4 py-5 sm:px-6">
                {fixtureGroups.length ? (
                  fixtureGroups.map((group, groupIndex) => (
                    <div className="grid gap-3" key={group.key}>
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                        <p className="text-xs font-black uppercase tracking-[0.22em] text-[#f4d58a]">
                          Matchday {groupIndex + 1}
                        </p>
                        <p className="text-sm font-bold text-slate-300">
                          {formatMatchDateLong(group.date)}
                        </p>
                      </div>
                      <div className="grid gap-3">
                        {group.matches.map((fixture, index) => {
                          const matchDate = fixtureDateValue(fixture);
                          const matchTime = formatMatchTime(matchDate);
                          const homeName = text(fixture, ["home_team_name"], "Home team unavailable");
                          const awayName = text(fixture, ["away_team_name"], "Away team unavailable");
                          const homeShortName = text(
                            fixture,
                            ["home_team_short_name"],
                            teamInitials({ team_name: homeName }),
                          );
                          const awayShortName = text(
                            fixture,
                            ["away_team_short_name"],
                            teamInitials({ team_name: awayName }),
                          );
                          const venue = text(fixture, ["venue"], "");
                          const isKswMatch = isKswFixture(fixture);
                          const statusLabel = fixtureStatusLabel(fixture, matchDate, now);
                          const startsIn = countdownText(matchDate, now);
                          const fixtureKey = text(fixture, ["id", "match_id"], `${group.key}-${index}`);

                          return (
                            <div className="grid gap-3" key={fixtureKey}>
                              <article
                                className={`group overflow-hidden rounded-xl border bg-white p-4 shadow-lg lg:hidden ${
                                  isKswMatch
                                    ? "border-[#d8ad45] shadow-[#d8ad45]/20"
                                    : "border-white/80 shadow-black/10"
                                }`}
                              >
                                <div className="flex min-w-0 items-center justify-between gap-2">
                                  <span className="inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-full bg-[#061426] px-3 py-2 text-sm font-black leading-none text-white">
                                    <span aria-hidden="true">🕒</span>
                                    {matchTime || "TBC"}
                                  </span>
                                  {venue ? (
                                    <span className="inline-flex min-w-0 max-w-[58%] items-center gap-1.5 rounded-full border border-[#d8ad45]/45 bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-3 py-2 text-sm font-black leading-none text-[#061426]">
                                      <span aria-hidden="true" className="shrink-0">
                                        📍
                                      </span>
                                      <span className="truncate">{formatVenue(venue)}</span>
                                    </span>
                                  ) : null}
                                </div>

                                {isKswMatch ? (
                                  <div className="mt-3">
                                    <span className="rounded-full border border-[#d8ad45]/45 bg-[#fff4dc] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#061426]">
                                      Featured Match
                                    </span>
                                  </div>
                                ) : null}

                                <div className="mt-5 grid gap-3">
                                  <div className="flex min-w-0 items-center gap-3">
                                    <TeamLogo
                                      className="!size-12 shrink-0"
                                      initials={homeShortName}
                                      logoUrl={text(fixture, ["home_team_logo_url"], "")}
                                      teamName={homeName}
                                    />
                                    <p className="min-w-0 text-base font-black leading-5 text-[#061426]">
                                      {homeName}
                                    </p>
                                  </div>

                                  <div className="grid justify-items-center">
                                    <span className="rounded-lg border border-[#d8ad45]/45 bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] shadow-lg shadow-[#061426]/10">
                                      VS
                                    </span>
                                  </div>

                                  <div className="flex min-w-0 items-center gap-3">
                                    <TeamLogo
                                      className="!size-12 shrink-0"
                                      initials={awayShortName}
                                      logoUrl={text(fixture, ["away_team_logo_url"], "")}
                                      teamName={awayName}
                                    />
                                    <p className="min-w-0 text-base font-black leading-5 text-[#061426]">
                                      {awayName}
                                    </p>
                                  </div>
                                </div>

                                <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4">
                                  <span className="rounded-full border border-[#d8ad45]/45 bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#061426]">
                                    {statusLabel}
                                  </span>
                                  <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                                    Starts in {startsIn}
                                  </p>
                                </div>
                              </article>

                              <article
                                className={`group hidden overflow-hidden rounded-xl border bg-white p-4 shadow-lg transition duration-300 lg:grid lg:grid-cols-[150px_minmax(0,1fr)_150px] lg:items-center lg:gap-5 lg:p-5 lg:hover:-translate-y-0.5 ${
                                  isKswMatch
                                    ? "border-[#d8ad45] shadow-[#d8ad45]/25"
                                    : "border-white/80 shadow-black/10 hover:shadow-black/20"
                                }`}
                              >
                                <div className="mb-4 lg:mb-0">
                                  <FixtureMetaBadgePair matchTime={matchTime} venue={venue} />
                                </div>

                                <div className="hidden min-w-0 grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] items-center gap-5 lg:grid">
                                  <div className="flex min-w-0 items-center gap-4">
                                    <TeamLogo
                                      className="!size-[68px] transition-transform duration-300 group-hover:scale-105"
                                      initials={homeShortName}
                                      logoUrl={text(fixture, ["home_team_logo_url"], "")}
                                      teamName={homeName}
                                    />
                                    <p className="min-w-0 text-wrap text-lg font-black leading-6 text-[#061426]">
                                      {homeName}
                                    </p>
                                  </div>
                                  <div className="rounded-xl border border-[#d8ad45]/45 bg-[#061426] px-3 py-3 text-center text-base font-black text-[#f4d58a] shadow-lg shadow-[#061426]/15">
                                    VS
                                  </div>
                                  <div className="flex min-w-0 items-center justify-end gap-4 text-right">
                                    <p className="min-w-0 text-wrap text-lg font-black leading-6 text-[#061426]">
                                      {awayName}
                                    </p>
                                    <TeamLogo
                                      className="!size-[68px] transition-transform duration-300 group-hover:scale-105"
                                      initials={awayShortName}
                                      logoUrl={text(fixture, ["away_team_logo_url"], "")}
                                      teamName={awayName}
                                    />
                                  </div>
                                </div>

                                <div className="mt-4 grid justify-items-center gap-2 lg:mt-0 lg:justify-items-end lg:text-right">
                                  {isKswMatch ? (
                                    <span className="hidden rounded-full border border-[#d8ad45]/45 bg-[#fff4dc] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#061426] lg:inline-flex">
                                      Featured Match
                                    </span>
                                  ) : null}
                                  <span className="rounded-full border border-[#d8ad45]/45 bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#061426]">
                                    {statusLabel}
                                  </span>
                                  <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                                    Starts in {startsIn}
                                  </p>
                                </div>
                              </article>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="rounded-xl border border-white/10 bg-white/[0.08] px-4 py-8 text-slate-200 sm:px-5">
                    No scheduled fixtures available.
                  </p>
                )}
              </div>
              <div className="border-t border-[#d8ad45]/15 px-4 py-3 text-right sm:px-6">
                <p className="text-xs font-semibold leading-5 text-slate-400">
                  ข้อมูลการแข่งขันอ้างอิงจากฝ่ายจัดการแข่งขัน Thai Lawyers League Season 6
                </p>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section id="season-summary" className="bg-slate-100">
        <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
        <div className="min-w-0 overflow-hidden rounded-2xl border border-[#d8ad45]/35 bg-[linear-gradient(135deg,#061426,#0b2745_58%,#071b31)] shadow-2xl shadow-[#061426]/25">
          <div className="grid gap-5 border-b border-[#d8ad45]/20 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-[#d8ad45]/35 bg-[#d8ad45]/10 text-[#f4d58a] shadow-lg shadow-[#d8ad45]/10">
                <svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M7 4h10v2h3v4a5 5 0 0 1-4.05 4.9A6.01 6.01 0 0 1 13 17.92V20h3v2H8v-2h3v-2.08A6.01 6.01 0 0 1 8.05 14.9 5 5 0 0 1 4 10V6h3V4Zm10 4v4.8A3 3 0 0 0 18 10V8h-1ZM6 8v2a3 3 0 0 0 1 2.24V8H6Zm3-2v6a3 3 0 1 0 6 0V6H9Z" />
                </svg>
              </span>
              <div>
                <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
                  {isSeasonCompleted ? "Season Complete" : "KSW Season Summary"}
                </h2>
                <p className="mt-1 text-sm font-semibold text-slate-300">
                  {isSeasonCompleted
                    ? "Thai Lawyers League • Season 6 has concluded."
                    : "Current KSW league numbers from Thai Lawyers League Season 6."}
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-[#d8ad45]/35 bg-white/[0.08] p-4 text-left shadow-xl shadow-black/15 backdrop-blur lg:min-w-64">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#f4d58a]">
                {isSeasonCompleted ? "Final Position" : "Current Position"}
              </p>
              <p className="mt-2 text-3xl font-black text-white">{finalPositionText}</p>
              <p className="mt-1 text-sm font-bold text-slate-300">
                {isSeasonCompleted ? "KSW L.C. final league standing" : "KSW L.C. league standing"}
              </p>
            </div>
          </div>
          <div className="grid gap-5 px-4 py-5 sm:px-6">
            {kswStanding ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.08] p-4 shadow-xl shadow-black/15 sm:p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#f4d58a]">
                      {isSeasonCompleted ? "Final Numbers" : "Current Numbers"}
                    </p>
                    <h3 className="mt-2 text-xl font-black text-white">
                      {text(kswStanding, ["team_name", "name", "team"], "KSW L.C.")}
                    </h3>
                  </div>
                  <Link
                    className="inline-flex items-center justify-center rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/15 transition-transform hover:scale-[1.02]"
                    href={seasonArchiveHref}
                  >
                    View Season Archive
                  </Link>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {finalKswStats.map(([label, value]) => (
                    <div
                      className="rounded-lg border border-white/10 bg-[#061426]/55 px-3 py-3 text-center"
                      key={label}
                    >
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                        {label}
                      </p>
                      <p className="mt-1 text-2xl font-black text-white">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-white/10 bg-white/[0.08] px-4 py-8 text-slate-200 sm:px-5">
                KSW standing details are currently unavailable.
              </p>
            )}
            <div className="border-t border-[#d8ad45]/15 pt-4 text-right">
              <p className="text-xs font-semibold leading-5 text-slate-400">
                ข้อมูลการแข่งขันอ้างอิงจากฝ่ายจัดการแข่งขัน Thai Lawyers League Season 6
              </p>
            </div>
          </div>
        </div>
        </div>
      </section>

      <section className="bg-slate-100">
        <div className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10">
        <div id="ksw-recent-results" className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10">
          <div className="border-b border-slate-200 bg-gradient-to-r from-white via-slate-50 to-[#fff8e3] px-4 py-5 sm:px-6">
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
              <span className="mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-[#d8ad45]/35 bg-[#fff4dc] text-[#9b1c1f] shadow-lg shadow-[#d8ad45]/10">
                <svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M7 3h10v2h3v5a5 5 0 0 1-4.03 4.9A6.01 6.01 0 0 1 13 17.92V20h3v2H8v-2h3v-2.08A6.01 6.01 0 0 1 8.03 14.9 5 5 0 0 1 4 10V5h3V3Zm10 4v5.83A3 3 0 0 0 18 7h-1ZM6 7v3a3 3 0 0 0 1 2.24V7H6Zm3-2v7a3 3 0 1 0 6 0V5H9Z" />
                </svg>
              </span>
              <div>
                <h2 className="text-2xl font-black tracking-tight text-[#061426] sm:text-3xl">
                  KSW Recent Results
                </h2>
                <p className="mt-1 text-sm font-semibold text-slate-600">
                  {isSeasonCompleted
                    ? "The latest KSW match results from the completed Season 6 campaign."
                    : "The latest completed KSW league match results."}
                </p>
              </div>
              </div>
              <Link
                className="inline-flex items-center justify-center rounded-md bg-[#061426] px-4 py-2.5 text-sm font-black text-[#f4d58a] shadow-lg shadow-slate-900/10 transition-colors hover:bg-[#0b2745]"
                href={`${seasonArchiveHref}#ksw-results`}
              >
                View All Season Results
              </Link>
            </div>
          </div>
          <div className="grid gap-6 bg-slate-100 px-4 py-5 sm:px-6">
            {resultGroups.length ? (
              resultGroups.map((group, groupIndex) => (
                <div className="grid gap-3" key={group.key}>
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-[#9b1c1f]">
                      Results {groupIndex + 1}
                    </p>
                    <p className="text-sm font-bold text-slate-600">
                      {formatMatchDateLong(group.date)}
                    </p>
                  </div>
                  <div className="grid gap-3">
                    {group.matches.map((match, index) => {
                      const matchDate = match.match_date ?? match.date ?? match.kickoff_at;
                      const matchTime = formatMatchTime(matchDate);
                      const homeName = text(match, ["home_team_name"], "Home team unavailable");
                      const awayName = text(match, ["away_team_name"], "Away team unavailable");
                      const homeShortName = text(
                        match,
                        ["home_team_short_name"],
                        teamInitials({ team_name: homeName }),
                      );
                      const awayShortName = text(
                        match,
                        ["away_team_short_name"],
                        teamInitials({ team_name: awayName }),
                      );
                      const homeScore = number(match, ["home_score"]);
                      const awayScore = number(match, ["away_score"]);
                      const venue = text(match, ["venue"], "");
                      const homeIsKsw =
                        homeName.toLowerCase().includes("ksw") ||
                        homeShortName.toLowerCase().includes("ksw");
                      const awayIsKsw =
                        awayName.toLowerCase().includes("ksw") ||
                        awayShortName.toLowerCase().includes("ksw");
                      const isKswResult = homeIsKsw || awayIsKsw;
                      const kswScore = homeIsKsw ? homeScore : awayScore;
                      const opponentScore = homeIsKsw ? awayScore : homeScore;
                      const outcome =
                        !isKswResult
                          ? ""
                          : kswScore > opponentScore
                            ? "WIN"
                            : kswScore < opponentScore
                              ? "LOSS"
                              : "DRAW";

                      return (
                        <article
                          className={`group overflow-hidden rounded-xl border bg-white p-4 shadow-lg transition duration-300 lg:grid lg:grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)] lg:items-center lg:gap-5 lg:p-5 lg:hover:-translate-y-0.5 ${
                            isKswResult
                              ? "border-[#d8ad45] shadow-[#d8ad45]/20"
                              : "border-white shadow-black/10 hover:shadow-black/20"
                          }`}
                          key={text(match, ["id", "match_id"], `${group.key}-${index}`)}
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
                            <TeamLogo
                              className="!size-12 transition-transform duration-300 group-hover:scale-105 lg:!size-16"
                              initials={homeShortName}
                              logoUrl={text(match, ["home_team_logo_url"], "")}
                              teamName={homeName}
                            />
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
                              {matchTime ? (
                                <span className="rounded-full bg-slate-100 px-3 py-1.5">
                                  🕒 {matchTime}
                                </span>
                              ) : null}
                              {venue ? (
                                <span className="rounded-full bg-[#fff4dc] px-3 py-1.5">
                                  📍 สนาม {venue}
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div className="grid min-w-0 justify-items-center gap-2 text-center lg:flex lg:justify-end lg:text-right">
                            <p className="min-w-0 text-wrap text-base font-black leading-5 text-[#061426] lg:order-first lg:text-lg lg:leading-6">
                              <span className="lg:hidden">{awayShortName}</span>
                              <span className="hidden lg:inline">{awayName}</span>
                            </p>
                            <TeamLogo
                              className="!size-12 transition-transform duration-300 group-hover:scale-105 lg:!size-16"
                              initials={awayShortName}
                              logoUrl={text(match, ["away_team_logo_url"], "")}
                              teamName={awayName}
                            />
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
                    })}
                  </div>
                </div>
              ))
            ) : (
              <p className="rounded-xl bg-white px-4 py-8 text-slate-600 sm:px-5">
                No KSW results available.
              </p>
            )}
          </div>
          <div className="border-t border-slate-200 px-4 py-3 text-right sm:px-6">
            <p className="text-xs font-semibold leading-5 text-slate-500">
              ข้อมูลการแข่งขันอ้างอิงจากฝ่ายจัดการแข่งขัน Thai Lawyers League Season 6
            </p>
          </div>
        </div>
        </div>
      </section>

      <section id="sponsors" className="bg-gradient-to-br from-[#071b31] via-[#0b2745] to-[#061426]">
        <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
        <div className="min-w-0 rounded-lg border border-[#d8ad45]/25 bg-white/[0.08] p-6 shadow-2xl shadow-black/30 backdrop-blur sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
          <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#d8ad45]">
            KSW Partnership
          </p>
          <h2 className="mt-3 text-3xl font-black text-white">Partners & Supporters</h2>
          <p className="mt-4 max-w-xl text-sm leading-7 text-slate-200">
            สนับสนุน KSW L.C. คือการเป็นส่วนหนึ่งของชุมชนฟุตบอลนักกฎหมายที่เชื่อมโยงมิตรภาพ
            เครือข่ายวิชาชีพ และกิจกรรมการแข่งขันตลอดฤดูกาล
          </p>
          <div className="mt-6 grid gap-3">
            {[
              [
                "Brand Visibility",
                "โลโก้ปรากฏบนเว็บไซต์ทางการและสื่อกิจกรรมของทีม",
              ],
              [
                "Legal Community Network",
                "เข้าถึงกลุ่มนักกฎหมาย ผู้บริหาร และผู้ประกอบการ",
              ],
              [
                "Matchday Presence",
                "เชื่อมแบรนด์เข้ากับกิจกรรมการแข่งขันและภาพลักษณ์ของสโมสร",
              ],
            ].map(([title, body]) => (
              <div
                className="rounded-lg border border-white/10 bg-white/[0.07] p-4 shadow-lg shadow-black/15"
                key={title}
              >
                <div className="mb-3 h-0.5 w-10 rounded-full bg-[#d8ad45]" />
                <h3 className="font-black text-white">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-300">{body}</p>
              </div>
            ))}
          </div>
          <div className="mt-7">
            <a
              className="inline-flex items-center justify-center rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/20 transition-transform hover:scale-[1.02]"
              href="/partners"
            >
              Become a KSW Partner
            </a>
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
                      <div
                        className={`flex ${section.logoSlotSize} items-center justify-center text-center transition-transform duration-300 hover:scale-[1.04]`}
                      >
                        {isString(sponsorLogo) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={`${sponsorName} logo`}
                            className="ksw-sponsor-logo-fit"
                            src={sponsorLogo}
                          />
                        ) : (
                          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#061426]/30 sm:text-[10px]">
                            YOUR LOGO
                          </span>
                        )}
                      </div>
                    );

                    return isString(sponsorWebsite) ? (
                      <a
                        aria-label={`Visit ${sponsorName} website`}
                        className="cursor-pointer"
                        href={sponsorWebsite}
                        key={text(sponsor, ["id", "name"], `${section.key}-${index}`)}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {sponsorMark}
                      </a>
                    ) : (
                      <div key={text(sponsor, ["id", "name"], `${section.key}-${index}`)}>
                        {sponsorMark}
                      </div>
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
    </main>
  );
}

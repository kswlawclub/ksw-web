import { TeamLogo } from "@/components/team-logo";
import { getSupabase, getSupabaseConfig } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, unknown>;

const statColumns = ["P", "W", "D", "L", "GF", "GA", "GD", "PTS"];
const teamColumns = "id, name, short_name, logo_url, is_ksw";
const standingsColumns =
  "team_id, league_id, team_name, short_name, logo_url, is_ksw, played, won, drawn, lost, goals_for, goals_against, goal_difference, points";
const matchColumns =
  "id, league_id, match_date, home_team_id, away_team_id, home_score, away_score, venue, status, match_type";
const sponsorColumns =
  "id, name, logo_url, website_url, tier, sort_order, is_active";

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

function formatMatchDate(value: unknown) {
  if (typeof value !== "string" || !value) {
    return "Date unavailable";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(date);
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

function sortMatches(matches: Row[]) {
  return [...matches].sort((a, b) => {
    const dateA = new Date(text(a, ["match_date", "date", "kickoff_at"], "")).getTime();
    const dateB = new Date(text(b, ["match_date", "date", "kickoff_at"], "")).getTime();

    if (Number.isNaN(dateA) || Number.isNaN(dateB)) {
      return 0;
    }

    return dateB - dateA;
  });
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
    };
  }

  const [teams, allTeams, standings, finishedMatches, scheduledMatches, sponsors] = await Promise.all([
    runSupabaseQuery("teams", supabase.from("teams").select(teamColumns).eq("is_ksw", true)),
    runSupabaseQuery("teams_all", supabase.from("teams").select(teamColumns)),
    runSupabaseQuery(
      "league_standings_view",
      supabase.from("league_standings_view").select(standingsColumns),
    ),
    runSupabaseQuery(
      "finished_matches",
      supabase
        .from("matches")
        .select(matchColumns)
        .eq("status", "finished")
        .order("match_date", { ascending: false })
        .limit(16),
    ),
    runSupabaseQuery(
      "scheduled_matches",
      supabase
        .from("matches")
        .select(matchColumns)
        .eq("status", "scheduled")
        .order("match_date", { ascending: true })
        .limit(16),
    ),
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
  };
}

export default async function Home() {
  const { configured, teams, standings, matches, scheduledMatches, sponsors } = await loadHomeData();
  const club = teams[0];
  const logoUrl = club?.logo_url;
  const sponsorGroups = groupSponsorsByTier(sponsors);
  const sponsorSections = [
    {
      key: "main",
      label: "Main Partner",
      items: sponsorGroups.main.length ? sponsorGroups.main : [undefined],
      logoSlotSize: "h-24 w-48 sm:h-28 sm:w-64 lg:h-32 lg:w-72",
      wrapperClass: "flex flex-wrap justify-center gap-8",
    },
    {
      key: "official",
      label: "Official Partner",
      items: sponsorGroups.official.length ? sponsorGroups.official : [undefined],
      logoSlotSize: "h-16 w-32 sm:h-20 sm:w-40 lg:h-24 lg:w-48",
      wrapperClass: "grid grid-cols-2 items-center justify-items-center gap-7 sm:grid-cols-3 lg:grid-cols-4",
    },
    {
      key: "supporter",
      label: "Supporter",
      items: sponsorGroups.supporter.length ? sponsorGroups.supporter : [undefined],
      logoSlotSize: "h-12 w-24 sm:h-16 sm:w-32",
      wrapperClass: "grid grid-cols-2 items-center justify-items-center gap-6 sm:grid-cols-4 lg:grid-cols-5",
    },
  ];

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
  const leagueTeams = [...sortedStandings].sort((a, b) => {
    if (a.is_ksw === true) return -1;
    if (b.is_ksw === true) return 1;
    return text(a, ["team_name", "name", "team"]).localeCompare(
      text(b, ["team_name", "name", "team"]),
    );
  });
  const latestResults = matches
    .filter(
      (match) => typeof match.home_score === "number" && typeof match.away_score === "number",
    )
    .slice(0, 16);

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
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a
                className="inline-flex items-center justify-center rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/15 transition-transform hover:scale-[1.02]"
                href="/#league-center"
              >
                View League Table
              </a>
              <a
                className="inline-flex items-center justify-center rounded-md border border-[#d8ad45]/50 bg-white/[0.03] px-5 py-3 text-sm font-black text-[#f4d58a] backdrop-blur transition-colors hover:bg-[#d8ad45]/10"
                href="/partners"
              >
                Partner With KSW
              </a>
            </div>
            {!configured ? (
              <p className="mt-6 inline-flex max-w-full rounded-md border border-[#d8ad45]/50 bg-[#d8ad45]/10 px-4 py-3 text-sm text-[#f4d58a] sm:mt-8">
                Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
                to load live club data.
              </p>
            ) : null}
          </div>

          <div className="ksw-float-logo mx-auto flex w-full max-w-[17rem] min-w-0 items-center justify-center sm:max-w-xs md:max-w-sm">
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
              สโมสรฟุตบอลนักกฎหมายคลองสามวา
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
              ["13", "ทีมในลีกการแข่งขัน"],
            ].map(([value, label]) => (
              <div
                key={label}
                className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-lg shadow-slate-900/5"
              >
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#d8ad45]">
                  KSW
                </p>
                <p className="mt-2 text-2xl font-black text-[#061426]">{value}</p>
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

      <div id="league-center">
      <section className="bg-slate-100">
        <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
        <div id="latest-results" className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
            <h2 className="text-xl font-black text-[#061426]">Latest Results</h2>
          </div>
          <div className="divide-y divide-slate-200">
            {latestResults.length ? (
              latestResults.map((match, index) => (
                <div
                  className="grid min-w-0 gap-3 px-4 py-4 transition-colors hover:bg-slate-50 sm:px-5"
                  key={text(match, ["id", "match_id"], String(index))}
                >
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-[#9b1c1f]">
                    {formatMatchDate(match.match_date ?? match.date ?? match.kickoff_at)}
                  </p>
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_78px_minmax(0,1fr)] sm:gap-4">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <TeamLogo
                        initials={teamInitials({
                          short_name: text(match, ["home_team_short_name"], ""),
                          team_name: text(match, ["home_team_name"]),
                        })}
                        logoUrl={text(match, ["home_team_logo_url"], "")}
                        teamName={text(match, ["home_team_name"])}
                      />
                      <span className="min-w-0 text-wrap text-sm font-bold leading-5 text-[#061426] sm:text-base">
                        {text(match, ["home_team_name"])}
                      </span>
                    </div>
                    <div className="rounded-md border border-[#d8ad45]/45 bg-[#fff8e3] px-2 py-2 text-center text-sm font-black text-[#061426] shadow-sm sm:text-base">
                      {text(match, ["score"], "VS")}
                    </div>
                    <div className="flex min-w-0 items-center justify-end gap-2.5 text-right">
                      <span className="min-w-0 text-wrap text-sm font-bold leading-5 text-[#061426] sm:text-base">
                        {text(match, ["away_team_name"])}
                      </span>
                      <TeamLogo
                        initials={teamInitials({
                          short_name: text(match, ["away_team_short_name"], ""),
                          team_name: text(match, ["away_team_name"]),
                        })}
                        logoUrl={text(match, ["away_team_logo_url"], "")}
                        teamName={text(match, ["away_team_name"])}
                      />
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="px-4 py-8 text-slate-600 sm:px-5">No finished results available.</p>
            )}
          </div>
        </div>
        <div id="next-fixtures" className="mt-6 min-w-0 rounded-lg border border-dashed border-[#d8ad45]/60 bg-gradient-to-br from-[#fff4dc] via-[#fff9eb] to-white shadow-xl shadow-[#d8ad45]/10">
          <div className="border-b border-dashed border-[#d8ad45]/40 px-4 py-4 sm:px-5">
            <h2 className="text-xl font-black text-[#061426]">Next Fixtures</h2>
            <p className="mt-1 text-sm text-slate-600">
              Upcoming KSW match schedule.
            </p>
          </div>
          <div className="divide-y divide-dashed divide-[#d8ad45]/30">
            {scheduledMatches.length ? (
              scheduledMatches.map((fixture, index) => {
                const matchDate = fixture.match_date ?? fixture.date ?? fixture.kickoff_at;
                const matchTime = formatMatchTime(matchDate);
                const homeName = text(fixture, ["home_team_name"], "Home team unavailable");
                const awayName = text(fixture, ["away_team_name"], "Away team unavailable");

                return (
                  <div
                    className="grid min-w-0 gap-3 px-4 py-4 transition-colors hover:bg-[#fff8e3]/50 sm:px-5"
                    key={text(fixture, ["id", "match_id"], String(index))}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-[#9b1c1f]">
                        {formatMatchDate(matchDate)}
                        {matchTime ? ` · ${matchTime}` : ""}
                      </p>
                      <span className="rounded-full border border-[#d8ad45]/45 bg-[#fff8e3] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-[#061426]">
                        {text(fixture, ["status"], "scheduled")}
                      </span>
                    </div>
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_78px_minmax(0,1fr)] sm:gap-4">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <TeamLogo
                          initials={teamInitials({
                            short_name: text(fixture, ["home_team_short_name"], ""),
                            team_name: homeName,
                          })}
                          logoUrl={text(fixture, ["home_team_logo_url"], "")}
                          teamName={homeName}
                        />
                        <span className="min-w-0 truncate text-sm font-bold leading-5 text-[#061426] sm:hidden">
                          {text(
                            fixture,
                            ["home_team_short_name"],
                            teamInitials({ team_name: homeName }),
                          )}
                        </span>
                        <span className="hidden min-w-0 text-wrap text-base font-bold leading-5 text-[#061426] sm:inline">
                          {homeName}
                        </span>
                      </div>
                      <div className="grid gap-1 text-center">
                        {text(fixture, ["venue"], "") ? (
                          <span className="text-sm font-black text-black sm:text-base">
                            สนาม {text(fixture, ["venue"], "")}
                          </span>
                        ) : null}
                        <div className="rounded-md border border-[#d8ad45]/45 bg-white px-2 py-2 text-center text-sm font-black text-[#9b1c1f] shadow-sm sm:text-base">
                          VS
                        </div>
                      </div>
                      <div className="flex min-w-0 items-center justify-end gap-2.5 text-right">
                        <span className="hidden min-w-0 text-wrap text-base font-bold leading-5 text-[#061426] sm:inline">
                          {awayName}
                        </span>
                        <span className="min-w-0 truncate text-sm font-bold leading-5 text-[#061426] sm:hidden">
                          {text(
                            fixture,
                            ["away_team_short_name"],
                            teamInitials({ team_name: awayName }),
                          )}
                        </span>
                        <TeamLogo
                          initials={teamInitials({
                            short_name: text(fixture, ["away_team_short_name"], ""),
                            team_name: awayName,
                          })}
                          logoUrl={text(fixture, ["away_team_logo_url"], "")}
                          teamName={awayName}
                        />
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="px-4 py-8 text-slate-600 sm:px-5">
                No scheduled fixtures available.
              </p>
            )}
          </div>
        </div>
        </div>
      </section>

      <section id="league-table" className="mx-auto w-full max-w-7xl px-4 pb-8 sm:px-6 lg:px-10">
        <div className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.05]">
          <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-5">
            <div>
              <h2 className="text-xl font-black text-white">League Table</h2>
              <p className="mt-1 text-xs font-semibold text-slate-400">
                Thai Lawyers League Season 6
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#f4d58a]/35 bg-[#d8ad45]/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-[#f4d58a] shadow-lg shadow-[#d8ad45]/10">
              <span className="ksw-live-dot size-2 rounded-full bg-[#f4d58a]" />
              LIVE
            </span>
          </div>
          <div className="overflow-hidden">
            <table className="w-full table-fixed text-left text-xs sm:text-sm">
              <thead className="bg-[#081b31] text-[10px] uppercase tracking-wider text-slate-400 sm:text-xs">
                <tr>
                  <th className="w-8 px-1 py-3 sm:w-14 sm:px-4">Pos</th>
                  <th className="px-1 py-3 sm:px-4">Team</th>
                  {statColumns.map((column) => (
                    <th
                      key={column}
                      className={`w-7 px-1 py-3 text-right sm:w-11 sm:px-3 ${
                        column === "GF" || column === "GA" ? "hidden md:table-cell" : ""
                      }`}
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {sortedStandings.length ? (
                  sortedStandings.map((row, index) => (
                    <tr
                      className={`cursor-pointer transition-colors hover:bg-white/[0.08] ${
                        index < 4
                          ? "bg-gradient-to-r from-[#d8ad45]/12 via-white/[0.045] to-transparent shadow-[inset_3px_0_0_rgba(216,173,69,0.65)]"
                          : ""
                      }`}
                      key={text(row, ["id", "team_id", "team_name", "name"], String(index))}
                    >
                      <td
                        className={`px-1 py-3 font-bold sm:px-4 ${
                          index < 4 ? "text-[#f4d58a]" : "text-slate-300"
                        }`}
                      >
                        {index + 1}
                      </td>
                      <td className="min-w-0 px-1 py-3 text-white sm:px-4">
                        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                          <TeamLogo
                            className="size-[22px] sm:size-7 md:size-8"
                            initials={teamInitials(row)}
                            logoUrl={text(row, ["logo_url"], "")}
                            teamName={text(row, ["team_name", "name", "team"])}
                          />
                          <span className="min-w-0 truncate font-bold leading-5 sm:hidden">
                            {text(row, ["short_name"], teamInitials(row))}
                          </span>
                          <span className="hidden min-w-0 truncate font-bold leading-5 sm:inline">
                            {text(row, ["team_name", "name", "team"])}
                          </span>
                        </div>
                      </td>
                      <td className="px-1 py-3 text-right sm:px-3">{number(row, ["played", "p"])}</td>
                      <td className="px-1 py-3 text-right sm:px-3">{number(row, ["won", "w"])}</td>
                      <td className="px-1 py-3 text-right sm:px-3">{number(row, ["drawn", "draws", "d"])}</td>
                      <td className="px-1 py-3 text-right sm:px-3">{number(row, ["lost", "l"])}</td>
                      <td className="hidden px-1 py-3 text-right md:table-cell sm:px-3">{number(row, ["goals_for", "gf"])}</td>
                      <td className="hidden px-1 py-3 text-right md:table-cell sm:px-3">{number(row, ["goals_against", "ga"])}</td>
                      <td className="px-1 py-3 text-right sm:px-3">{number(row, ["goal_difference", "gd"])}</td>
                      <td className="px-1 py-3 text-right font-black text-white sm:px-3">
                        {number(row, ["points", "pts"])}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-400" colSpan={10}>
                      No league table rows available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="bg-[#e9eef4]">
        <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-black text-[#061426]">League Teams</h2>
              <p className="mt-1 text-sm text-slate-600">13 clubs across the legal football community.</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {leagueTeams.map((team, index) => (
              <div
                className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm transition-all duration-300 hover:scale-[1.03] hover:border-[#d8ad45]/60 hover:bg-white hover:shadow-xl hover:shadow-slate-900/10"
                key={text(team, ["team_id", "id", "team_name"], String(index))}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <TeamLogo
                    className="size-7 sm:size-8 md:size-9"
                    initials={teamInitials(team)}
                    logoUrl={text(team, ["logo_url"], "")}
                    teamName={text(team, ["team_name", "name", "team"])}
                  />
                  <p className="min-w-0 text-wrap text-sm font-black leading-5 text-[#061426]">
                    {text(team, ["team_name", "name", "team"])}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
        </div>
      </section>
      </div>

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

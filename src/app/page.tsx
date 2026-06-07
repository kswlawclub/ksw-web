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

function text(row: Row | undefined, keys: string[], fallback = "TBC") {
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
    return "Date TBC";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
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

function initialsFromName(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
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
        name: text(team, ["name", "short_name"], "Team TBC"),
        shortName: text(team, ["short_name"], ""),
        logoUrl: text(team, ["logo_url"], ""),
      },
    ]),
  );
}

function withMatchTeams(matches: Row[], teams: Row[]) {
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
      home_team_name: homeTeam?.name ?? "Home team TBC",
      home_team_short_name: homeTeam?.shortName ?? "",
      home_team_logo_url: homeTeam?.logoUrl ?? "",
      away_team_name: awayTeam?.name ?? "Away team TBC",
      away_team_short_name: awayTeam?.shortName ?? "",
      away_team_logo_url: awayTeam?.logoUrl ?? "",
      score: hasScore ? `${homeScore} - ${awayScore}` : "VS",
    };
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
      sponsors: [] as Row[],
    };
  }

  const [teams, allTeams, standings, matches, sponsors] = await Promise.all([
    runSupabaseQuery("teams", supabase.from("teams").select(teamColumns).eq("is_ksw", true)),
    runSupabaseQuery("teams_all", supabase.from("teams").select(teamColumns)),
    runSupabaseQuery(
      "league_standings_view",
      supabase.from("league_standings_view").select(standingsColumns),
    ),
    runSupabaseQuery("matches", supabase.from("matches").select(matchColumns)),
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
    matches: sortMatches(withMatchTeams(matches, teamRows)),
    sponsors,
  };
}

export default async function Home() {
  const { configured, teams, standings, matches, sponsors } = await loadHomeData();
  const club = teams[0];
  const logoUrl = club?.logo_url;

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

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#061426] text-slate-100">
      <section className="relative overflow-hidden border-b border-[#d8ad45]/30">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.2),transparent_34%),linear-gradient(135deg,rgba(6,20,38,0.96),rgba(9,31,57,0.88))]" />
        <div className="relative mx-auto grid min-h-[540px] w-full max-w-7xl items-center gap-8 px-4 py-12 sm:px-6 sm:py-16 md:grid-cols-[1.08fr_0.92fr] lg:px-10">
          <div className="min-w-0">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.22em] text-[#d8ad45] sm:text-sm sm:tracking-[0.28em]">
              Khlong Sam Wa Lawyers Club
            </p>
            <h1 className="max-w-4xl text-4xl font-black leading-[1.03] tracking-tight text-white sm:text-5xl md:text-7xl">
              KSW L.C.
            </h1>
            <p className="mt-4 max-w-2xl text-xl font-bold leading-7 text-[#f4d58a] sm:text-2xl">
              Khlong Sam Wa Lawyers Club
            </p>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:mt-6 sm:text-lg sm:leading-8">
              ชมรมทนายความคลองสามวา พื้นที่รวมตัวของนักกฎหมายที่รักฟุตบอล
              มิตรภาพ และการแข่งขัน
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <a
                className="inline-flex items-center justify-center rounded-md bg-[#d8ad45] px-5 py-3 text-sm font-black text-[#061426] transition-colors hover:bg-[#f4d58a]"
                href="#league-table"
              >
                View League Table
              </a>
              <a
                className="inline-flex items-center justify-center rounded-md border border-[#d8ad45]/50 px-5 py-3 text-sm font-black text-[#f4d58a] transition-colors hover:bg-[#d8ad45]/10"
                href="#sponsors"
              >
                Become a Sponsor
              </a>
            </div>
            {!configured ? (
              <p className="mt-6 inline-flex max-w-full rounded-md border border-[#d8ad45]/50 bg-[#d8ad45]/10 px-4 py-3 text-sm text-[#f4d58a] sm:mt-8">
                Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
                to load live club data.
              </p>
            ) : null}
          </div>

          <div className="mx-auto w-full max-w-sm min-w-0 rounded-lg border border-[#d8ad45]/25 bg-white/[0.08] p-3 shadow-2xl shadow-black/30 sm:p-5 md:max-w-md">
            <div className="flex aspect-[1.08] items-center justify-center rounded-md border border-[#d8ad45]/40 bg-gradient-to-br from-[#071b31] to-[#123153] p-5">
              {isString(logoUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt="KSW L.C. logo"
                  className="max-h-64 w-full object-contain"
                  src={logoUrl}
                />
              ) : (
                <div className="text-center">
                  <p className="text-6xl font-black text-[#d8ad45] sm:text-8xl">KSW</p>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.24em] text-slate-300 sm:text-sm sm:tracking-[0.35em]">
                    Law Club
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-8 sm:grid-cols-2 sm:px-6 md:grid-cols-4 lg:px-10">
        {[
          ["Founded", "2019"],
          ["Home", "Bangkok"],
          ["Members", "50+"],
          ["League", "Thai Lawyers League Season 6"],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg border border-[#d8ad45]/20 bg-gradient-to-br from-[#0c2744] to-[#123153] p-5 shadow-lg shadow-black/15"
          >
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#d8ad45]">
              {label}
            </p>
            <p className="mt-3 text-lg font-black text-white">{value}</p>
          </div>
        ))}
      </section>

      <section className="bg-slate-100">
        <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
        <div className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
            <h2 className="text-xl font-black text-[#061426]">Latest Result / Fixtures</h2>
          </div>
          <div className="divide-y divide-slate-200">
            {matches.length ? (
              matches.slice(0, 8).map((match, index) => (
                <div
                  className="grid min-w-0 gap-3 px-4 py-4 transition-colors hover:bg-slate-50 sm:px-5"
                  key={text(match, ["id", "match_id"], String(index))}
                >
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#d8ad45]">
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
                    <div className="rounded-md border border-[#d8ad45]/30 bg-[#d8ad45]/10 px-2 py-2 text-center text-sm font-black text-[#f4d58a] sm:text-base">
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
              <p className="px-4 py-8 text-slate-600 sm:px-5">No fixtures or results available.</p>
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
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#d8ad45]">
              Live
            </span>
          </div>
          <div className="overflow-x-auto overscroll-x-contain [scrollbar-color:#d8ad45_#081b31]">
            <table className="w-full min-w-[560px] text-left text-sm sm:min-w-[680px]">
              <thead className="bg-[#081b31] text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-3 py-3 sm:px-4">Pos</th>
                  <th className="px-3 py-3 sm:px-4">Team</th>
                  {statColumns.map((column) => (
                    <th
                      key={column}
                      className={`px-2 py-3 text-right sm:px-3 ${
                        column === "GF" || column === "GA" ? "hidden sm:table-cell" : ""
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
                      className="cursor-pointer transition-colors hover:bg-white/[0.08]"
                      key={text(row, ["id", "team_id", "team_name", "name"], String(index))}
                    >
                      <td
                        className={`px-3 py-3 font-bold sm:px-4 ${
                          index < 3 ? "text-[#f4d58a]" : "text-slate-300"
                        }`}
                      >
                        {index + 1}
                      </td>
                      <td className="max-w-[250px] px-3 py-3 text-white sm:max-w-none sm:px-4">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <TeamLogo
                            initials={teamInitials(row)}
                            logoUrl={text(row, ["logo_url"], "")}
                            teamName={text(row, ["team_name", "name", "team"])}
                          />
                          <span className="min-w-0 truncate font-bold leading-5">
                            {text(row, ["team_name", "name", "team"])}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-right sm:px-3">{number(row, ["played", "p"])}</td>
                      <td className="px-2 py-3 text-right sm:px-3">{number(row, ["won", "w"])}</td>
                      <td className="px-2 py-3 text-right sm:px-3">{number(row, ["drawn", "draws", "d"])}</td>
                      <td className="px-2 py-3 text-right sm:px-3">{number(row, ["lost", "l"])}</td>
                      <td className="hidden px-2 py-3 text-right sm:table-cell sm:px-3">{number(row, ["goals_for", "gf"])}</td>
                      <td className="hidden px-2 py-3 text-right sm:table-cell sm:px-3">{number(row, ["goals_against", "ga"])}</td>
                      <td className="px-2 py-3 text-right sm:px-3">{number(row, ["goal_difference", "gd"])}</td>
                      <td className="px-2 py-3 text-right font-black text-white sm:px-3">
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
                className={`min-w-0 rounded-lg border p-4 ${
                  team.is_ksw === true
                    ? "border-[#d8ad45]/60 bg-[#fff7df] sm:col-span-2"
                    : "border-slate-200 bg-slate-50"
                }`}
                key={text(team, ["team_id", "id", "team_name"], String(index))}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <TeamLogo
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

      <section id="sponsors" className="bg-gradient-to-br from-[#071b31] via-[#0b2745] to-[#061426]">
        <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
        <div className="min-w-0 rounded-lg border border-[#d8ad45]/25 bg-white/[0.07] p-6 shadow-2xl shadow-black/30">
          <h2 className="text-2xl font-black text-white">Partners & Supporters</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#f4d58a]">
            พื้นที่สนับสนุนแบรนด์ที่ต้องการเติบโตไปกับชุมชนฟุตบอลนักกฎหมาย
          </p>
          <div className="mt-7 grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, index) => {
              const sponsor = sponsors[index];
              const sponsorName = text(sponsor, ["name", "sponsor_name"], "SPONSOR");
              const sponsorLogo = text(sponsor, ["logo_url"], "");

              return (
                <div
                  className="flex aspect-square items-center justify-center rounded-full border border-[#d8ad45]/30 bg-white p-3 text-center shadow-lg shadow-black/20"
                  key={text(sponsor, ["id", "name"], String(index))}
                >
                  {isString(sponsorLogo) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={`${sponsorName} logo`}
                      className="max-h-full max-w-full object-contain"
                      src={sponsorLogo}
                    />
                  ) : (
                    <span className="text-[10px] font-black uppercase tracking-wide text-[#061426] sm:text-xs">
                      {sponsor ? initialsFromName(sponsorName) || "SPONSOR" : "SPONSOR"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-8">
            <a
              className="inline-flex items-center justify-center rounded-md bg-[#d8ad45] px-5 py-3 text-sm font-black text-[#061426] transition-colors hover:bg-[#f4d58a]"
              href="mailto:partners@kswlc.com"
            >
              Become a KSW Partner
            </a>
          </div>
        </div>
        </div>
      </section>
    </main>
  );
}

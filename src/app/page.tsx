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

function teamNameById(teams: Row[]) {
  return new Map(
    teams.map((team) => [
      text(team, ["id"], ""),
      text(team, ["name", "short_name"], "Team TBC"),
    ]),
  );
}

function withMatchTeams(matches: Row[], teams: Row[]) {
  const names = teamNameById(teams);

  return matches.map((match) => {
    const homeTeamId = text(match, ["home_team_id"], "");
    const awayTeamId = text(match, ["away_team_id"], "");
    const homeScore = match.home_score;
    const awayScore = match.away_score;
    const hasScore = typeof homeScore === "number" && typeof awayScore === "number";

    return {
      ...match,
      home_team_name: names.get(homeTeamId) ?? "Home team TBC",
      away_team_name: names.get(awayTeamId) ?? "Away team TBC",
      score: hasScore ? `${homeScore} - ${awayScore}` : text(match, ["status"], "Fixture"),
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

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#061426] text-slate-100">
      <section className="relative overflow-hidden border-b border-[#d8ad45]/30">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.2),transparent_34%),linear-gradient(135deg,rgba(6,20,38,0.96),rgba(9,31,57,0.88))]" />
        <div className="relative mx-auto grid min-h-[480px] w-full max-w-7xl items-center gap-8 px-4 py-12 sm:px-6 sm:py-16 md:min-h-[560px] md:grid-cols-[1.1fr_0.9fr] lg:px-10">
          <div className="min-w-0">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.22em] text-[#d8ad45] sm:text-sm sm:tracking-[0.28em]">
              KSW L.C.
            </p>
            <h1 className="max-w-4xl text-4xl font-black leading-[1.03] tracking-tight text-white sm:text-5xl md:text-7xl">
              KSW L.C.
            </h1>
            <p className="mt-4 max-w-2xl text-xl font-bold leading-7 text-[#f4d58a] sm:text-2xl">
              Khlong Sam Wa Lawyers Club
            </p>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:mt-6 sm:text-lg sm:leading-8">
              Football community of legal professionals.
            </p>
            {!configured ? (
              <p className="mt-6 inline-flex max-w-full rounded-md border border-[#d8ad45]/50 bg-[#d8ad45]/10 px-4 py-3 text-sm text-[#f4d58a] sm:mt-8">
                Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
                to load live club data.
              </p>
            ) : null}
          </div>

          <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.06] p-4 shadow-2xl shadow-black/30 sm:p-6">
            <div className="flex aspect-square items-center justify-center rounded-md border border-[#d8ad45]/40 bg-[#071b31]">
              {isString(logoUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt="KSW L.C. logo"
                  className="h-full max-h-72 w-full object-contain p-6"
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

      <section className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-8 sm:px-6 sm:py-10 md:grid-cols-3 lg:px-10">
        <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.05] p-5 sm:p-6 md:col-span-1">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#d8ad45] sm:text-sm sm:tracking-[0.22em]">
            Club
          </p>
          <h2 className="mt-3 break-words text-2xl font-black text-white sm:text-3xl">
            {text(club, ["name", "team_name", "club_name"], "KSW L.C.")}
          </h2>
          <dl className="mt-6 space-y-4 text-sm text-slate-300">
            <div>
              <dt className="font-bold text-slate-500">Home</dt>
              <dd>{text(club, ["home_ground", "stadium", "venue"], "Bangkok")}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-500">Founded</dt>
              <dd>{text(club, ["founded", "founded_year"], "Club data pending")}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-500">Identity</dt>
              <dd>{text(club, ["nickname", "description"], "Navy and gold")}</dd>
            </div>
          </dl>
        </div>

        <div className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.05] md:col-span-2">
          <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-4 sm:px-5">
            <h2 className="text-xl font-black text-white">League Table</h2>
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#d8ad45]">
              Live
            </span>
          </div>
          <div className="overflow-x-auto overscroll-x-contain [scrollbar-color:#d8ad45_#081b31]">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-[#081b31] text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3">Pos</th>
                  <th className="px-4 py-3">Team</th>
                  {statColumns.map((column) => (
                    <th key={column} className="px-3 py-3 text-right">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {sortedStandings.length ? (
                  sortedStandings.map((row, index) => (
                    <tr
                      className={`cursor-pointer border-l-4 transition-colors hover:bg-white/[0.08] ${
                        row.is_ksw === true
                          ? "border-l-[#d8ad45] bg-[#d8ad45]/10"
                          : "border-l-transparent"
                      }`}
                      key={text(row, ["id", "team_id", "team_name", "name"], String(index))}
                    >
                      <td className="px-4 py-4 font-bold text-[#d8ad45]">
                        {index + 1}
                      </td>
                      <td className="px-4 py-4 text-white">
                        <div className="flex min-w-0 items-center gap-3">
                          <TeamLogo
                            initials={teamInitials(row)}
                            logoUrl={text(row, ["logo_url"], "")}
                            teamName={text(row, ["team_name", "name", "team"])}
                          />
                          <span
                            className={`min-w-0 truncate ${
                              row.is_ksw === true ? "font-black" : "font-bold"
                            }`}
                          >
                            {text(row, ["team_name", "name", "team"])}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-4 text-right">{number(row, ["played", "p"])}</td>
                      <td className="px-3 py-4 text-right">{number(row, ["won", "w"])}</td>
                      <td className="px-3 py-4 text-right">{number(row, ["drawn", "draws", "d"])}</td>
                      <td className="px-3 py-4 text-right">{number(row, ["lost", "l"])}</td>
                      <td className="px-3 py-4 text-right">{number(row, ["goals_for", "gf"])}</td>
                      <td className="px-3 py-4 text-right">{number(row, ["goals_against", "ga"])}</td>
                      <td className="px-3 py-4 text-right">{number(row, ["goal_difference", "gd"])}</td>
                      <td className="px-3 py-4 text-right font-black text-white">
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

      <section className="mx-auto grid w-full max-w-7xl gap-5 px-4 pb-10 sm:px-6 sm:pb-12 md:grid-cols-[1.4fr_0.6fr] lg:px-10">
        <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.05]">
          <div className="border-b border-white/10 px-4 py-4 sm:px-5">
            <h2 className="text-xl font-black text-white">Fixtures / Results</h2>
          </div>
          <div className="divide-y divide-white/10">
            {matches.length ? (
              matches.slice(0, 8).map((match, index) => (
                <div
                  className="grid min-w-0 gap-3 px-4 py-4 sm:grid-cols-[120px_1fr_auto] sm:items-center sm:px-5"
                  key={text(match, ["id", "match_id"], String(index))}
                >
                  <p className="text-sm font-bold text-[#d8ad45]">
                    {formatMatchDate(match.match_date ?? match.date ?? match.kickoff_at)}
                  </p>
                  <p className="min-w-0 break-words font-bold text-white">
                    {text(match, ["home_team", "home_team_name", "opponent"], "KSW L.C.")}{" "}
                    <span className="text-slate-500">vs</span>{" "}
                    {text(match, ["away_team", "away_team_name"], "Opponent TBC")}
                  </p>
                  <p className="justify-self-start rounded-md bg-[#d8ad45]/10 px-3 py-2 text-center text-sm font-black text-[#f4d58a] sm:justify-self-auto">
                    {text(match, ["score", "result", "status"], "Fixture")}
                  </p>
                </div>
              ))
            ) : (
              <p className="px-4 py-8 text-slate-400 sm:px-5">No fixtures or results available.</p>
            )}
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.05] p-5">
          <h2 className="text-xl font-black text-white">Sponsors</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 md:grid-cols-1">
            {sponsors.length ? (
              sponsors.map((sponsor, index) => (
                <div
                  className="min-w-0 rounded-md border border-[#d8ad45]/20 bg-[#081b31] p-4"
                  key={text(sponsor, ["id", "name"], String(index))}
                >
                  <p className="break-words font-black text-white">
                    {text(sponsor, ["name", "sponsor_name"])}
                  </p>
                  <p className="mt-1 break-words text-sm text-slate-400">
                    {text(sponsor, ["tier", "category", "description"], "Club partner")}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-slate-400">No sponsors available.</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

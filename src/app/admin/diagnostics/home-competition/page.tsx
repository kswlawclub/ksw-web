import Link from "next/link";
import { loadCompetitionParticipants } from "@/lib/competition-participants";
import { requireAdminSession } from "@/lib/admin-server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, unknown>;

type QueryError = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

type QueryResult<T> = {
  data: T[];
  error: QueryError | null;
};

type MappingRow = Row & {
  awayFound: boolean;
  awayIsKsw: boolean;
  awayName: string;
  exclusionReason: string;
  homeFound: boolean;
  homeIsKsw: boolean;
  homeName: string;
  isKswFixture: boolean;
};

const leagueColumns =
  "id, name, season, slug, competition_type, season_status, is_active, is_published, is_featured, display_order, start_date, end_date, created_at";
const matchColumns =
  "id, league_id, match_date, home_team_id, away_team_id, home_score, away_score, venue, status, match_type";
const junctionColumns = "id, competition_id, team_id, is_active, display_order, created_at";

function text(row: Row | undefined, keys: string[], fallback = "") {
  if (!row) return fallback;

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }

  return fallback;
}

function boolLabel(value: unknown) {
  return value === true ? "true" : value === false ? "false" : "-";
}

function valueLabel(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return boolLabel(value);
  return String(value);
}

function numberValue(row: Row, key: string) {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  return 0;
}

function competitionStatusPriority(status: string) {
  if (status === "active") return 0;
  if (status === "upcoming") return 1;
  if (status === "completed") return 2;
  return 3;
}

function dateSortValue(row: Row) {
  const value = text(row, ["start_date", "end_date", "created_at"], "");
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function displayOrderValue(row: Row) {
  return numberValue(row, "display_order");
}

function createdAtValue(row: Row) {
  const value = text(row, ["created_at"], "");
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function selectCurrentCompetition(rows: Row[]) {
  return [...rows]
    .filter((row) => row.is_published === true)
    .sort((a, b) => {
      const statusDiff =
        competitionStatusPriority(text(a, ["season_status"], "active").toLowerCase()) -
        competitionStatusPriority(text(b, ["season_status"], "active").toLowerCase());
      if (statusDiff) return statusDiff;

      const featuredDiff = Number(b.is_featured === true) - Number(a.is_featured === true);
      if (featuredDiff) return featuredDiff;

      const displayOrderDiff = displayOrderValue(a) - displayOrderValue(b);
      if (displayOrderDiff) return displayOrderDiff;

      const dateDiff = dateSortValue(b) - dateSortValue(a);
      if (dateDiff) return dateDiff;

      return createdAtValue(b) - createdAtValue(a);
    })[0];
}

function fixtureTimeValue(match: Row) {
  const value = text(match, ["match_date", "date", "kickoff_at"], "");
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function isKswFixture(match: Row) {
  return match.home_team_is_ksw === true || match.away_team_is_ksw === true;
}

function teamById(teams: Row[]) {
  return new Map(
    teams.map((team) => [
      text(team, ["id"], ""),
      {
        isActive: team.is_active !== false,
        isKsw: team.is_ksw === true,
        name: text(team, ["name", "short_name"], "Team unavailable"),
        participantIsActive: team.participant_is_active !== false,
        shortName: text(team, ["short_name"], ""),
      },
    ]),
  );
}

function mapMatch(match: Row, teams: Row[]): MappingRow {
  const teamsById = teamById(teams);
  const homeTeamId = text(match, ["home_team_id"], "");
  const awayTeamId = text(match, ["away_team_id"], "");
  const homeTeam = teamsById.get(homeTeamId);
  const awayTeam = teamsById.get(awayTeamId);
  const status = text(match, ["status"], "");
  const mapped = {
    ...match,
    away_team_is_ksw: awayTeam?.isKsw === true,
    home_team_is_ksw: homeTeam?.isKsw === true,
  };
  const mappedIsKsw = isKswFixture(mapped);
  const reasons: string[] = [];

  if (!homeTeamId) reasons.push("invalid/missing home team id");
  if (!awayTeamId) reasons.push("invalid/missing away team id");
  if (homeTeamId && !homeTeam) reasons.push("home team not found in participants");
  if (awayTeamId && !awayTeam) reasons.push("away team not found in participants");
  if (homeTeam && homeTeam.participantIsActive === false) reasons.push("home participant inactive");
  if (awayTeam && awayTeam.participantIsActive === false) reasons.push("away participant inactive");
  if (homeTeam && awayTeam && !mappedIsKsw) reasons.push("neither team has is_ksw=true");
  if (status !== "scheduled" && status !== "finished") reasons.push("status not scheduled/finished");

  return {
    ...mapped,
    awayFound: Boolean(awayTeam),
    awayIsKsw: awayTeam?.isKsw === true,
    awayName: awayTeam?.name ?? "Away team unavailable",
    exclusionReason: reasons.length ? reasons.join("; ") : "included as KSW fixture",
    homeFound: Boolean(homeTeam),
    homeIsKsw: homeTeam?.isKsw === true,
    homeName: homeTeam?.name ?? "Home team unavailable",
    isKswFixture: mappedIsKsw,
  };
}

function safeError(error: unknown): QueryError {
  const queryError = error as QueryError | null;

  return {
    code: queryError?.code,
    details: queryError?.details,
    hint: queryError?.hint,
    message: queryError?.message ?? String(error),
  };
}

async function runQuery<T>(
  query: PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<QueryResult<T>> {
  try {
    const result = await query;
    return {
      data: result.data ?? [],
      error: result.error ? safeError(result.error) : null,
    };
  } catch (error) {
    return {
      data: [],
      error: safeError(error),
    };
  }
}

function Card({ label, value, tone = "neutral" }: { label: string; tone?: "bad" | "good" | "neutral"; value: string | number }) {
  const toneClass =
    tone === "bad"
      ? "border-red-200 bg-red-50 text-red-800"
      : tone === "good"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-slate-200 bg-white text-[#061426]";

  return (
    <div className={`rounded-lg border px-4 py-3 shadow-sm ${toneClass}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.16em] opacity-70">{label}</p>
      <p className="mt-1 break-words text-2xl font-black">{value}</p>
    </div>
  );
}

function ErrorPanel({ errors }: { errors: Array<[string, QueryError | null]> }) {
  const visibleErrors = errors.filter(([, error]) => Boolean(error));

  if (!visibleErrors.length) return null;

  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-900">
      <h2 className="text-xl font-black">Query Errors</h2>
      <div className="mt-4 grid gap-3">
        {visibleErrors.map(([source, error]) => (
          <div className="rounded-md border border-red-200 bg-white p-3" key={source}>
            <p className="font-black">{source}</p>
            <p className="mt-1 text-sm">Code: {error?.code || "-"}</p>
            <p className="text-sm">Message: {error?.message || "-"}</p>
            {error?.details ? <p className="text-sm">Details: {error.details}</p> : null}
            {error?.hint ? <p className="text-sm">Hint: {error.hint}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function KeyValueTable({ rows }: { rows: Array<[string, unknown]> }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr className="border-b border-slate-100 last:border-b-0" key={label}>
              <th className="w-56 bg-slate-50 px-4 py-3 font-black text-slate-600">{label}</th>
              <td className="break-all px-4 py-3 font-semibold text-[#061426]">{valueLabel(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function HomeCompetitionDiagnosticPage() {
  await requireAdminSession();

  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-10 text-[#061426] sm:px-6 lg:px-10">
        <section className="mx-auto max-w-5xl rounded-lg border border-red-200 bg-red-50 p-6 text-red-900">
          <h1 className="text-2xl font-black">Home Competition Diagnostic</h1>
          <p className="mt-3 font-semibold">Supabase admin client is not configured.</p>
        </section>
      </main>
    );
  }

  const competitionsResult = await runQuery<Row>(
    supabase.from("leagues").select(leagueColumns).eq("is_published", true).order("created_at", { ascending: false }),
  );
  const currentCompetition = selectCurrentCompetition(competitionsResult.data);
  const currentCompetitionId = text(currentCompetition, ["id"], "");

  const [junctionResult, matchesResult] = await Promise.all([
    currentCompetitionId
      ? runQuery<Row>(
          supabase
            .from("competition_teams")
            .select(junctionColumns)
            .eq("competition_id", currentCompetitionId)
            .order("display_order", { ascending: true }),
        )
      : Promise.resolve({ data: [] as Row[], error: null }),
    currentCompetitionId
      ? runQuery<Row>(
          supabase
            .from("matches")
            .select(matchColumns)
            .eq("league_id", currentCompetitionId)
            .order("match_date", { ascending: true }),
        )
      : Promise.resolve({ data: [] as Row[], error: null }),
  ]);
  const participants = currentCompetitionId
    ? await loadCompetitionParticipants(supabase, currentCompetitionId, {
        includeInactiveParticipants: false,
        includeLegacyFallback: false,
      })
    : [];
  const participantRows = participants as Row[];
  const duplicateTeamIds = Array.from(
    participantRows
      .map((participant) => text(participant, ["id"], ""))
      .filter(Boolean)
      .reduce((counts, teamId) => counts.set(teamId, (counts.get(teamId) ?? 0) + 1), new Map<string, number>())
      .entries(),
  )
    .filter(([, count]) => count > 1)
    .map(([teamId]) => teamId);
  const kswParticipants = participantRows.filter((participant) => participant.is_ksw === true);
  const rawScheduledMatches = matchesResult.data.filter((match) => text(match, ["status"], "") === "scheduled");
  const rawFinishedMatches = matchesResult.data.filter((match) => text(match, ["status"], "") === "finished");
  const mappedMatches = matchesResult.data.map((match) => mapMatch(match, participantRows));
  const mappedScheduledMatches = mappedMatches.filter((match) => text(match, ["status"], "") === "scheduled");
  const mappedFinishedMatches = mappedMatches.filter((match) => text(match, ["status"], "") === "finished");
  const scheduledKswMatches = mappedScheduledMatches.filter((match) => match.isKswFixture);
  const finishedKswMatches = mappedFinishedMatches.filter((match) => match.isKswFixture);
  const now = new Date().getTime();
  const upcomingKswMatches = [...scheduledKswMatches]
    .filter((match) => fixtureTimeValue(match) >= now)
    .sort((a, b) => fixtureTimeValue(a) - fixtureTimeValue(b));
  const recentResultIds = [...finishedKswMatches]
    .sort((a, b) => fixtureTimeValue(b) - fixtureTimeValue(a))
    .slice(0, 5)
    .map((match) => text(match, ["id"], ""));
  const nextFixtureId = upcomingKswMatches[0] ? text(upcomingKswMatches[0], ["id"], "") : "";
  const warningCount =
    (currentCompetitionId ? 0 : 1) +
    (participantRows.length ? 0 : 1) +
    (kswParticipants.length ? 0 : 1) +
    mappedMatches.filter((match) => !match.isKswFixture).length;

  return (
    <main className="min-h-screen overflow-x-hidden bg-slate-100 px-4 py-10 text-[#061426] sm:px-6 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-6">
        <section className="rounded-xl bg-[#061426] p-6 text-white shadow-xl shadow-slate-900/20">
          <Link className="text-sm font-bold text-[#f4d58a] hover:text-white" href="/admin">
            Back to Admin
          </Link>
          <p className="mt-6 text-xs font-black uppercase tracking-[0.22em] text-[#d8ad45]">
            Admin-only Production Diagnostic
          </p>
          <h1 className="mt-3 text-3xl font-black">Home Competition KSW Match Mapping</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
            This page uses the same current competition selection order as Home, then reads participants from
            competition_teams only and maps matches by canonical team id.
          </p>
        </section>

        <ErrorPanel
          errors={[
            ["current_competitions", competitionsResult.error],
            ["competition_teams", junctionResult.error],
            ["matches", matchesResult.error],
          ]}
        />

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Warnings" tone={warningCount ? "bad" : "good"} value={warningCount} />
          <Card label="Participants" tone={participantRows.length ? "good" : "bad"} value={participantRows.length} />
          <Card label="KSW Participants" tone={kswParticipants.length ? "good" : "bad"} value={kswParticipants.length} />
          <Card label="Total KSW Matches" tone={scheduledKswMatches.length + finishedKswMatches.length ? "good" : "bad"} value={scheduledKswMatches.length + finishedKswMatches.length} />
        </section>

        <section className="grid gap-4">
          <h2 className="text-2xl font-black">Current Competition Selected by Home Logic</h2>
          <KeyValueTable
            rows={[
              ["competition id", currentCompetitionId],
              ["name", text(currentCompetition, ["name"], "")],
              ["slug", text(currentCompetition, ["slug"], "")],
              ["season_status", text(currentCompetition, ["season_status"], "")],
              ["is_published", currentCompetition?.is_published],
              ["is_featured", currentCompetition?.is_featured],
              ["display_order", currentCompetition?.display_order],
              ["start_date", currentCompetition?.start_date],
              ["end_date", currentCompetition?.end_date],
            ]}
          />
        </section>

        <section className="grid gap-4">
          <h2 className="text-2xl font-black">Home Array Simulation</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card label="Raw Scheduled" value={rawScheduledMatches.length} />
            <Card label="Raw Finished" value={rawFinishedMatches.length} />
            <Card label="Mapped Scheduled" value={mappedScheduledMatches.length} />
            <Card label="Mapped Finished" value={mappedFinishedMatches.length} />
            <Card label="Scheduled KSW" tone={scheduledKswMatches.length ? "good" : "bad"} value={scheduledKswMatches.length} />
            <Card label="Finished KSW" tone={finishedKswMatches.length ? "good" : "bad"} value={finishedKswMatches.length} />
            <Card label="Next Fixture ID" value={nextFixtureId || "-"} />
            <Card label="Recent Result IDs" value={recentResultIds.join(", ") || "-"} />
          </div>
        </section>

        <section className="grid gap-4">
          <h2 className="text-2xl font-black">Participant Diagnostic</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card label="Active Participant Count" value={participantRows.length} />
            <Card label="KSW Team IDs" value={kswParticipants.map((team) => text(team, ["id"], "")).join(", ") || "-"} />
            <Card label="Duplicate Team IDs" tone={duplicateTeamIds.length ? "bad" : "good"} value={duplicateTeamIds.join(", ") || "No"} />
            <Card label="Junction-only" tone="good" value="Yes" />
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-[#061426] text-white">
                <tr>
                  {["canonical team id", "team name", "short_name", "is_ksw", "canonical is_active", "participant_is_active", "display_order", "participant_source", "logo_url"].map((header) => (
                    <th className="px-3 py-2 font-black" key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {participantRows.map((participant) => (
                  <tr className="border-b border-slate-100 last:border-b-0" key={text(participant, ["id"], "")}>
                    <td className="px-3 py-2 font-mono">{text(participant, ["id"], "")}</td>
                    <td className="px-3 py-2 font-bold">{text(participant, ["name"], "")}</td>
                    <td className="px-3 py-2">{text(participant, ["short_name"], "") || "-"}</td>
                    <td className="px-3 py-2">{boolLabel(participant.is_ksw)}</td>
                    <td className="px-3 py-2">{boolLabel(participant.is_active)}</td>
                    <td className="px-3 py-2">{boolLabel(participant.participant_is_active)}</td>
                    <td className="px-3 py-2">{valueLabel(participant.display_order)}</td>
                    <td className="px-3 py-2">{text(participant, ["participant_source"], "")}</td>
                    <td className="px-3 py-2">{text(participant, ["logo_url"], "") ? "has logo" : "no logo"}</td>
                  </tr>
                ))}
                {!participantRows.length ? (
                  <tr>
                    <td className="px-3 py-4 text-center font-bold text-slate-500" colSpan={9}>No active participants returned.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-4">
          <h2 className="text-2xl font-black">Raw Junction Diagnostic</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-[#061426] text-white">
                <tr>
                  {["competition_teams.id", "competition_id", "team_id", "is_active", "display_order", "created_at"].map((header) => (
                    <th className="px-3 py-2 font-black" key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {junctionResult.data.map((row) => (
                  <tr className="border-b border-slate-100 last:border-b-0" key={text(row, ["id", "team_id"], "")}>
                    <td className="px-3 py-2 font-mono">{text(row, ["id"], "")}</td>
                    <td className="px-3 py-2 font-mono">{text(row, ["competition_id"], "")}</td>
                    <td className="px-3 py-2 font-mono">{text(row, ["team_id"], "")}</td>
                    <td className="px-3 py-2">{boolLabel(row.is_active)}</td>
                    <td className="px-3 py-2">{valueLabel(row.display_order)}</td>
                    <td className="px-3 py-2">{valueLabel(row.created_at)}</td>
                  </tr>
                ))}
                {!junctionResult.data.length ? (
                  <tr>
                    <td className="px-3 py-4 text-center font-bold text-slate-500" colSpan={6}>No junction rows found.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-4">
          <h2 className="text-2xl font-black">Match Mapping Diagnostic</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-[#061426] text-white">
                <tr>
                  {[
                    "match id",
                    "league_id",
                    "home_team_id",
                    "away_team_id",
                    "status",
                    "match_date",
                    "kickoff_time",
                    "score",
                    "home found",
                    "home name",
                    "home is_ksw",
                    "away found",
                    "away name",
                    "away is_ksw",
                    "isKswFixture",
                    "exclusion reason",
                  ].map((header) => (
                    <th className="px-3 py-2 font-black" key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mappedMatches.map((match) => (
                  <tr className={match.isKswFixture ? "border-b border-emerald-100 bg-emerald-50/45" : "border-b border-red-100 bg-red-50/45"} key={text(match, ["id"], "")}>
                    <td className="px-3 py-2 font-mono">{text(match, ["id"], "")}</td>
                    <td className="px-3 py-2 font-mono">{text(match, ["league_id"], "")}</td>
                    <td className="px-3 py-2 font-mono">{text(match, ["home_team_id"], "")}</td>
                    <td className="px-3 py-2 font-mono">{text(match, ["away_team_id"], "")}</td>
                    <td className="px-3 py-2">{text(match, ["status"], "")}</td>
                    <td className="px-3 py-2">{text(match, ["match_date"], "")}</td>
                    <td className="px-3 py-2">{text(match, ["kickoff_time"], "") || "-"}</td>
                    <td className="px-3 py-2">{valueLabel(match.home_score)} - {valueLabel(match.away_score)}</td>
                    <td className="px-3 py-2">{boolLabel(match.homeFound)}</td>
                    <td className="px-3 py-2">{match.homeName}</td>
                    <td className="px-3 py-2">{boolLabel(match.homeIsKsw)}</td>
                    <td className="px-3 py-2">{boolLabel(match.awayFound)}</td>
                    <td className="px-3 py-2">{match.awayName}</td>
                    <td className="px-3 py-2">{boolLabel(match.awayIsKsw)}</td>
                    <td className="px-3 py-2 font-black">{boolLabel(match.isKswFixture)}</td>
                    <td className="px-3 py-2 font-semibold">{match.exclusionReason}</td>
                  </tr>
                ))}
                {!mappedMatches.length ? (
                  <tr>
                    <td className="px-3 py-4 text-center font-bold text-slate-500" colSpan={16}>No matches found for the current competition.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

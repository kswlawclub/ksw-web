import Link from "next/link";
import { requireAdminSession } from "@/lib/admin-server-auth";
import {
  homeFixtureTimeValue,
  homeText,
  loadHomeCompetitionData,
  type HomeCompetitionError,
  type HomeMappedMatch,
  type HomeRow,
} from "@/lib/home-competition-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function boolLabel(value: unknown) {
  return value === true ? "true" : value === false ? "false" : "-";
}

function valueLabel(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return boolLabel(value);
  return String(value);
}

function duplicateIds(rows: HomeRow[]) {
  return Array.from(
    rows
      .map((row) => homeText(row, ["id"], ""))
      .filter(Boolean)
      .reduce((counts, id) => counts.set(id, (counts.get(id) ?? 0) + 1), new Map<string, number>())
      .entries(),
  )
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
}

function Card({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  tone?: "bad" | "good" | "neutral";
  value: string | number;
}) {
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

function ErrorPanel({ errors }: { errors: HomeCompetitionError[] }) {
  if (!errors.length) return null;

  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-900">
      <h2 className="text-xl font-black">Query Errors</h2>
      <div className="mt-4 grid gap-3">
        {errors.map((error) => (
          <div className="rounded-md border border-red-200 bg-white p-3" key={`${error.source}-${error.code ?? error.message}`}>
            <p className="font-black">{error.source}</p>
            <p className="mt-1 text-sm">Code: {error.code || "-"}</p>
            <p className="text-sm">Message: {error.message || "-"}</p>
            {error.details ? <p className="text-sm">Details: {error.details}</p> : null}
            {error.hint ? <p className="text-sm">Hint: {error.hint}</p> : null}
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

function statusIs(row: HomeRow, status: string) {
  return homeText(row, ["status"], "") === status;
}

export default async function HomeCompetitionDiagnosticPage() {
  await requireAdminSession();

  const data = await loadHomeCompetitionData();
  const currentCompetitionId = homeText(data.currentCompetition, ["id"], "");
  const duplicateTeamIds = duplicateIds(data.allParticipants);
  const rawScheduledMatches = data.rawMatches.filter((match) => statusIs(match, "scheduled"));
  const rawFinishedMatches = data.rawMatches.filter((match) => statusIs(match, "finished"));
  const mappedScheduledMatches = data.allMappedMatches.filter((match) => statusIs(match, "scheduled"));
  const mappedFinishedMatches = data.allMappedMatches.filter((match) => statusIs(match, "finished"));
  const recentResultIds = data.recentKswResults.map((match) => homeText(match, ["id"], ""));
  const nextFixtureId = data.nextKswFixture ? homeText(data.nextKswFixture, ["id"], "") : "";
  const warningCount =
    (currentCompetitionId ? 0 : 1) +
    (data.allParticipants.length ? 0 : 1) +
    (data.kswParticipants.length ? 0 : 1) +
    data.allMappedMatches.filter((match) => !match.isKswFixture).length;

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
            This page now reads from the same server-side Home data loader used by the public Home page.
            Participants come from competition_teams only, then matches are mapped by canonical team id.
          </p>
        </section>

        <ErrorPanel errors={data.errors} />

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Warnings" tone={warningCount ? "bad" : "good"} value={warningCount} />
          <Card label="Participants" tone={data.allParticipants.length ? "good" : "bad"} value={data.allParticipants.length} />
          <Card label="KSW Participants" tone={data.kswParticipants.length ? "good" : "bad"} value={data.kswParticipants.length} />
          <Card
            label="Total KSW Matches"
            tone={data.summary.totalKswMatches ? "good" : "bad"}
            value={data.summary.totalKswMatches}
          />
        </section>

        <section className="grid gap-4">
          <h2 className="text-2xl font-black">Current Competition Selected by Home Logic</h2>
          <KeyValueTable
            rows={[
              ["competition id", currentCompetitionId],
              ["name", homeText(data.currentCompetition, ["name"], "")],
              ["slug", homeText(data.currentCompetition, ["slug"], "")],
              ["season_status", homeText(data.currentCompetition, ["season_status"], "")],
              ["is_published", data.currentCompetition?.is_published],
              ["is_featured", data.currentCompetition?.is_featured],
              ["display_order", data.currentCompetition?.display_order],
              ["start_date", data.currentCompetition?.start_date],
              ["end_date", data.currentCompetition?.end_date],
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
            <Card label="Scheduled KSW" tone={data.scheduledKswMatches.length ? "good" : "bad"} value={data.scheduledKswMatches.length} />
            <Card label="Finished KSW" tone={data.finishedKswMatches.length ? "good" : "bad"} value={data.finishedKswMatches.length} />
            <Card label="Next Fixture ID" value={nextFixtureId || "-"} />
            <Card label="Recent Result IDs" value={recentResultIds.join(", ") || "-"} />
          </div>
        </section>

        <section className="grid gap-4">
          <h2 className="text-2xl font-black">Participant Diagnostic</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card label="Active Participant Count" value={data.allParticipants.length} />
            <Card label="KSW Team IDs" value={data.kswParticipants.map((team) => homeText(team, ["id"], "")).join(", ") || "-"} />
            <Card label="Duplicate Team IDs" tone={duplicateTeamIds.length ? "bad" : "good"} value={duplicateTeamIds.join(", ") || "No"} />
            <Card label="Junction-only" tone="good" value="Yes" />
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-[#061426] text-white">
                <tr>
                  {[
                    "canonical team id",
                    "team name",
                    "short_name",
                    "is_ksw",
                    "canonical is_active",
                    "participant_is_active",
                    "display_order",
                    "participant_source",
                    "logo_url",
                  ].map((header) => (
                    <th className="px-3 py-2 font-black" key={header}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.allParticipants.map((participant) => (
                  <tr className="border-b border-slate-100 last:border-b-0" key={homeText(participant, ["id"], "")}>
                    <td className="px-3 py-2 font-mono">{homeText(participant, ["id"], "")}</td>
                    <td className="px-3 py-2 font-bold">{homeText(participant, ["name"], "")}</td>
                    <td className="px-3 py-2">{homeText(participant, ["short_name"], "") || "-"}</td>
                    <td className="px-3 py-2">{boolLabel(participant.is_ksw)}</td>
                    <td className="px-3 py-2">{boolLabel(participant.is_active)}</td>
                    <td className="px-3 py-2">{boolLabel(participant.participant_is_active)}</td>
                    <td className="px-3 py-2">{valueLabel(participant.display_order)}</td>
                    <td className="px-3 py-2">{homeText(participant, ["participant_source"], "")}</td>
                    <td className="px-3 py-2">{homeText(participant, ["logo_url"], "") ? "has logo" : "no logo"}</td>
                  </tr>
                ))}
                {!data.allParticipants.length ? (
                  <tr>
                    <td className="px-3 py-4 text-center font-bold text-slate-500" colSpan={9}>
                      No active participants returned.
                    </td>
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
                  {["competition_teams.id", "competition_id", "team_id", "is_active", "display_order", "created_at"].map(
                    (header) => (
                      <th className="px-3 py-2 font-black" key={header}>
                        {header}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {data.rawJunctionRows.map((row) => (
                  <tr className="border-b border-slate-100 last:border-b-0" key={homeText(row, ["id", "team_id"], "")}>
                    <td className="px-3 py-2 font-mono">{homeText(row, ["id"], "")}</td>
                    <td className="px-3 py-2 font-mono">{homeText(row, ["competition_id"], "")}</td>
                    <td className="px-3 py-2 font-mono">{homeText(row, ["team_id"], "")}</td>
                    <td className="px-3 py-2">{boolLabel(row.is_active)}</td>
                    <td className="px-3 py-2">{valueLabel(row.display_order)}</td>
                    <td className="px-3 py-2">{valueLabel(row.created_at)}</td>
                  </tr>
                ))}
                {!data.rawJunctionRows.length ? (
                  <tr>
                    <td className="px-3 py-4 text-center font-bold text-slate-500" colSpan={6}>
                      No junction rows found.
                    </td>
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
                    <th className="px-3 py-2 font-black" key={header}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.allMappedMatches.map((match: HomeMappedMatch) => (
                  <tr
                    className={
                      match.isKswFixture
                        ? "border-b border-emerald-100 bg-emerald-50/45"
                        : "border-b border-red-100 bg-red-50/45"
                    }
                    key={homeText(match, ["id"], "")}
                  >
                    <td className="px-3 py-2 font-mono">{homeText(match, ["id"], "")}</td>
                    <td className="px-3 py-2 font-mono">{homeText(match, ["league_id"], "")}</td>
                    <td className="px-3 py-2 font-mono">{homeText(match, ["home_team_id"], "")}</td>
                    <td className="px-3 py-2 font-mono">{homeText(match, ["away_team_id"], "")}</td>
                    <td className="px-3 py-2">{homeText(match, ["status"], "")}</td>
                    <td className="px-3 py-2">{homeText(match, ["match_date"], "")}</td>
                    <td className="px-3 py-2">{homeText(match, ["kickoff_time"], "") || "-"}</td>
                    <td className="px-3 py-2">
                      {valueLabel(match.home_score)} - {valueLabel(match.away_score)}
                    </td>
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
                {!data.allMappedMatches.length ? (
                  <tr>
                    <td className="px-3 py-4 text-center font-bold text-slate-500" colSpan={16}>
                      No matches found for the current competition.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-4">
          <h2 className="text-2xl font-black">Shared Loader Output</h2>
          <KeyValueTable
            rows={[
              ["configured", data.configured],
              ["raw competitions", data.rawPublishedCompetitions.length],
              ["raw matches", data.rawMatches.length],
              ["standings rows", data.standings.length],
              ["sponsor rows", data.sponsors.length],
              ["summary total", data.summary.totalKswMatches],
              ["summary upcoming", data.summary.upcomingCount],
              ["summary finished", data.summary.finishedCount],
              ["summary won", data.summary.wonCount],
              ["summary drawn", data.summary.drawnCount],
              ["summary lost", data.summary.lostCount],
              ["next fixture time", data.nextKswFixture ? homeFixtureTimeValue(data.nextKswFixture) : ""],
            ]}
          />
        </section>
      </div>
    </main>
  );
}

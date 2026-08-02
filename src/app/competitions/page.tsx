import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { loadPublishedCompetitions, Row, text } from "@/lib/competition-data";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  getCompetitionTypeEnglishLabel,
  isCupCompetition,
  isFriendlyCompetition,
  isLeagueCompetition,
  isSmallTournamentCompetition,
  normalizeCompetitionType,
  type CompetitionType,
} from "@/lib/competition-format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "KSW Chronicle | KSW L.C.",
  description:
    "League seasons, Lawyer's Cup records, special matches, club stories, and history from KSW L.C.",
};

const statusPriority: Record<string, number> = {
  active: 0,
  upcoming: 1,
  completed: 2,
};

function typeLabel(type: CompetitionType) {
  return getCompetitionTypeEnglishLabel(type);
}

function dateLabel(competition: Row) {
  const startDate = text(competition, ["start_date"], "");
  const endDate = text(competition, ["end_date"], "");

  if (startDate && endDate && startDate !== endDate) return `${startDate} - ${endDate}`;
  return startDate || endDate;
}

function sortDateValue(competition: Row) {
  const value = text(competition, ["start_date", "end_date"], "");
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function createdAtValue(competition: Row) {
  const value = text(competition, ["created_at"], "");
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function displayOrderValue(competition: Row) {
  const value = competition.display_order;

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
    return Number(value);
  }

  return 0;
}

function sortCompetitions(rows: Row[]) {
  return [...rows].sort((a, b) => {
    const statusDiff =
      (statusPriority[text(a, ["season_status"], "active")] ?? 3) -
      (statusPriority[text(b, ["season_status"], "active")] ?? 3);
    if (statusDiff) return statusDiff;

    const featuredDiff = Number(b.is_featured === true) - Number(a.is_featured === true);
    if (featuredDiff) return featuredDiff;

    const displayOrderDiff = displayOrderValue(a) - displayOrderValue(b);
    if (displayOrderDiff) return displayOrderDiff;

    const dateDiff = sortDateValue(b) - sortDateValue(a);
    if (dateDiff) return dateDiff;

    return createdAtValue(b) - createdAtValue(a);
  });
}

async function withCompletedCupChampions(competitions: Row[]) {
  const completedCupIds = competitions
    .filter((competition) => normalizeCompetitionType(competition.competition_type) === "cup" && text(competition, ["season_status"], "") === "completed")
    .map((competition) => text(competition, ["id"], ""))
    .filter(Boolean);
  const admin = getSupabaseAdmin();
  if (!admin || completedCupIds.length === 0) return competitions;

  const partitionsResult = await admin
    .from("competition_knockout_partitions")
    .select("competition_id, partition_key, champion_team_id")
    .in("competition_id", completedCupIds)
    .in("partition_key", ["division_1", "division_2"]);
  if (partitionsResult.error) {
    console.error("completed council cup champion lookup failed", partitionsResult.error);
  }

  const nodesResult = await admin
    .from("competition_bracket_nodes")
    .select("competition_id, round_index, linked_match_id")
    .in("competition_id", completedCupIds)
    .not("linked_match_id", "is", null);
  if (nodesResult.error) {
    console.error("completed cup champion node lookup failed", nodesResult.error);
    return competitions;
  }

  const finalNodeByCompetition = new Map<string, Record<string, unknown>>();
  ((nodesResult.data ?? []) as Record<string, unknown>[]).forEach((node) => {
    const competitionId = text(node, ["competition_id"], "");
    const current = finalNodeByCompetition.get(competitionId);
    if (!current || Number(node.round_index ?? -1) > Number(current.round_index ?? -1)) finalNodeByCompetition.set(competitionId, node);
  });
  const finalMatchIds = Array.from(finalNodeByCompetition.values()).map((node) => text(node, ["linked_match_id"], "")).filter(Boolean);
  const matchesResult = finalMatchIds.length
    ? await admin.from("matches").select("id, winner_team_id").in("id", finalMatchIds)
    : { data: [] as Record<string, unknown>[], error: null };
  if (matchesResult.error) {
    console.error("completed cup champion match lookup failed", matchesResult.error);
  }
  const winnerByMatchId = new Map(((matchesResult.data ?? []) as Record<string, unknown>[]).map((match) => [text(match, ["id"], ""), text(match, ["winner_team_id"], "")]));
  const partitionChampionIds = ((partitionsResult.data ?? []) as Record<string, unknown>[])
    .map((partition) => text(partition, ["champion_team_id"], ""))
    .filter(Boolean);
  const winnerIds = Array.from(new Set([...winnerByMatchId.values(), ...partitionChampionIds].filter(Boolean)));
  if (!winnerIds.length) return competitions;

  const teamsResult = await admin.from("teams").select("id, name").in("id", winnerIds);
  if (teamsResult.error) {
    console.error("completed cup champion team lookup failed", teamsResult.error);
    return competitions;
  }
  const teamNames = new Map(((teamsResult.data ?? []) as Record<string, unknown>[]).map((team) => [text(team, ["id"], ""), text(team, ["name"], "")]));
  const divisionChampions = new Map<string, { division_1?: string; division_2?: string }>();
  ((partitionsResult.data ?? []) as Record<string, unknown>[]).forEach((partition) => {
    const competitionId = text(partition, ["competition_id"], "");
    const partitionKey = text(partition, ["partition_key"], "");
    const championName = teamNames.get(text(partition, ["champion_team_id"], ""));
    if (!competitionId || !championName || (partitionKey !== "division_1" && partitionKey !== "division_2")) return;
    divisionChampions.set(competitionId, { ...divisionChampions.get(competitionId), [partitionKey]: championName });
  });

  return competitions.map((competition) => {
    const competitionId = text(competition, ["id"], "");
    const finalNode = finalNodeByCompetition.get(competitionId);
    const winnerId = finalNode ? winnerByMatchId.get(text(finalNode, ["linked_match_id"], "")) : "";
    const champions = divisionChampions.get(competitionId);
    if (champions?.division_1 && champions.division_2) return { ...competition, champion_division_1: champions.division_1, champion_division_2: champions.division_2 };
    return winnerId && teamNames.get(winnerId) ? { ...competition, champion_name: teamNames.get(winnerId) } : competition;
  });
}

function CompetitionCard({ competition }: { competition: Row }) {
  const slug = text(competition, ["slug"], "");
  const coverImageUrl = text(competition, ["cover_image_url"], "");
  const competitionType = normalizeCompetitionType(text(competition, ["competition_type"], ""));
  const description = text(
    competition,
    ["short_description"],
    slug ? "Open this competition archive for fixtures, results, teams, and partners." : "Archive details are being prepared.",
  );
  const metadata = [
    text(competition, ["season"], ""),
    text(competition, ["edition_number"], "") ? `Edition ${text(competition, ["edition_number"], "")}` : "",
    dateLabel(competition),
    text(competition, ["location"], ""),
  ].filter(Boolean);
  const completed = text(competition, ["season_status"], "active") === "completed";
  const champion = text(competition, ["champion_name"], "");
  const division1Champion = text(competition, ["champion_division_1"], "");
  const division2Champion = text(competition, ["champion_division_2"], "");

  const cardContent = (
    <>
      <div className="relative aspect-[16/9] overflow-hidden bg-[radial-gradient(circle_at_top,rgba(216,173,69,0.2),transparent_35%),linear-gradient(135deg,#071b31,#061426)]">
        {coverImageUrl ? (
          <Image
            alt=""
            className="object-cover opacity-85 transition-transform duration-500 group-hover:scale-105"
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            src={coverImageUrl}
            unoptimized
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-[#061426]/88 via-[#061426]/20 to-transparent" />
        <div className="absolute bottom-4 left-4 flex flex-wrap gap-2">
          <span className="rounded-full border border-[#d8ad45]/35 bg-[#d8ad45]/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#f4d58a]">
            {typeLabel(competitionType)}
          </span>
          <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white">
            {completed ? "Completed / จบการแข่งขัน" : text(competition, ["season_status"], "active")}
          </span>
        </div>
      </div>
      <div className="grid gap-4 p-5">
        <div>
          <h2 className="text-xl font-black leading-tight text-[#061426]">{text(competition, ["name"], "Competition")}</h2>
          {metadata.length ? (
            <p className="mt-2 text-sm font-bold text-slate-500">{metadata.join(" • ")}</p>
          ) : null}
          <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
          {completed && division1Champion && division2Champion ? <div className="mt-3 text-sm font-black text-[#8a6418]"><p>2 Champions</p><p>Division 1: {division1Champion}</p><p>Division 2: {division2Champion}</p></div> : null}
          {completed && champion ? <p className="mt-3 text-sm font-black text-[#8a6418]">แชมป์: {champion}</p> : null}
        </div>
        {slug ? (
          <span className="inline-flex items-center justify-center rounded-md bg-[#061426] px-4 py-2.5 text-sm font-black text-[#f4d58a] shadow-lg shadow-slate-900/10 transition-colors group-hover:bg-[#0b2745]">
            {completed ? "ดูผลการแข่งขัน" : "View Archive"}
          </span>
        ) : (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-center text-sm font-black text-slate-500">
            Archive details are being prepared.
          </p>
        )}
      </div>
    </>
  );

  if (slug) {
    return (
      <Link
        className="group block min-w-0 overflow-hidden rounded-2xl border border-[#d8ad45]/25 bg-white shadow-xl shadow-slate-900/10 transition-transform hover:-translate-y-0.5"
        href={`/competitions/${slug}`}
      >
        {cardContent}
      </Link>
    );
  }

  return (
    <article className="group min-w-0 overflow-hidden rounded-2xl border border-[#d8ad45]/25 bg-white shadow-xl shadow-slate-900/10">
      {cardContent}
    </article>
  );
}

function CompetitionSection({ items, showAccent = true, title }: { items: Row[]; showAccent?: boolean; title: string }) {
  if (!items.length) return null;

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          {showAccent ? <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" /> : null}
          <h2 className="text-2xl font-black text-[#061426]">{title}</h2>
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {items.map((competition) => (
          <CompetitionCard competition={competition} key={text(competition, ["id", "slug", "name"])} />
        ))}
      </div>
    </section>
  );
}

export default async function CompetitionsPage() {
  const competitions = sortCompetitions(await withCompletedCupChampions(await loadPublishedCompetitions()));
  const completedCups = competitions.filter((competition) =>
    isCupCompetition(normalizeCompetitionType(text(competition, ["competition_type"], "")))
    && text(competition, ["season_status"], "active") === "completed",
  );
  const currentOrFeatured = competitions.filter((competition) => {
    const status = text(competition, ["season_status"], "active");
    return status !== "completed" && (competition.is_featured === true || status === "active" || status === "upcoming" || status === "in_progress");
  });
  const featuredIds = new Set(currentOrFeatured.map((competition) => text(competition, ["id"], "")).filter(Boolean));
  const completedCupIds = new Set(completedCups.map((competition) => text(competition, ["id"], "")).filter(Boolean));
  const categoryCompetitions = competitions.filter((competition) => !featuredIds.has(text(competition, ["id"], "")) && !completedCupIds.has(text(competition, ["id"], "")));
  const leagues = categoryCompetitions.filter((competition) =>
    isLeagueCompetition(normalizeCompetitionType(text(competition, ["competition_type"], ""))),
  );
  const cups = categoryCompetitions.filter((competition) =>
    isCupCompetition(normalizeCompetitionType(text(competition, ["competition_type"], ""))),
  );
  const smallTournaments = categoryCompetitions.filter((competition) =>
    isSmallTournamentCompetition(normalizeCompetitionType(text(competition, ["competition_type"], ""))),
  );
  const specialMatches = categoryCompetitions.filter(
    (competition) => isFriendlyCompetition(normalizeCompetitionType(text(competition, ["competition_type"], ""))),
  );

  return (
    <main className="min-h-screen overflow-x-hidden bg-slate-100 text-[#061426]">
      <section className="bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.2),transparent_34%),linear-gradient(135deg,#061426,#091f39)] text-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-10">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ad45]">KSW Digital Club Chronicle</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight sm:text-6xl">
            KSW Chronicle
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
            Competitions, special matches, stories, and memories from the history of KSW L.C.
          </p>
        </div>
      </section>

      {competitions.length ? (
        <>
          <CompetitionSection items={currentOrFeatured} showAccent={false} title="Current / Featured" />
          <CompetitionSection items={completedCups} title="Cup Archives / Completed Competitions" />
          <CompetitionSection items={leagues} title="League Seasons" />
          <CompetitionSection items={cups} title="Cups" />
          <CompetitionSection items={smallTournaments} title="Small Tournaments" />
          <CompetitionSection items={specialMatches} title="Special Matches" />
        </>
      ) : (
        <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center shadow-xl shadow-slate-900/10">
            <h2 className="text-2xl font-black">Competition archive is being prepared.</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Published competitions will appear here after the competition metadata migration is applied and records are configured.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}

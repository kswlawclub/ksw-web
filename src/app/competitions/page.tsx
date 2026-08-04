import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { loadChronicleGroups } from "@/lib/chronicle-loader";
import type { ChronicleGroup, ChronicleViewModel } from "@/lib/chronicle-view-model";
import { loadPublishedCompetitions, Row, text } from "@/lib/competition-data";
import { calculateStandardLeagueStandings } from "@/lib/league-template/standings";
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
  const councilCompetitionIds = new Set<string>();
  ((partitionsResult.data ?? []) as Record<string, unknown>[]).forEach((partition) => {
    const competitionId = text(partition, ["competition_id"], "");
    const partitionKey = text(partition, ["partition_key"], "");
    if (competitionId && (partitionKey === "division_1" || partitionKey === "division_2")) councilCompetitionIds.add(competitionId);
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
    if (councilCompetitionIds.has(competitionId)) return competition;
    return winnerId && teamNames.get(winnerId) ? { ...competition, champion_name: teamNames.get(winnerId) } : competition;
  });
}

async function withCompletedStandardLeagueArchiveData(competitions: Row[]) {
  const completedLeagueIds = competitions
    .filter((competition) => isLeagueCompetition(normalizeCompetitionType(text(competition, ["competition_type"], ""))) && text(competition, ["season_status"], "") === "completed")
    .map((competition) => text(competition, ["id"], ""))
    .filter(Boolean);
  const admin = getSupabaseAdmin();
  if (!admin || !completedLeagueIds.length) return competitions;

  const configsResult = await admin
    .from("competition_league_configs")
    .select("competition_id, template_key, fixture_version, win_points, draw_points, loss_points, champion_team_id")
    .in("competition_id", completedLeagueIds)
    .eq("template_key", "standard_league");
  if (configsResult.error) {
    console.error("completed standard league config lookup failed", configsResult.error);
    return competitions;
  }

  const configs = (configsResult.data ?? []) as Record<string, unknown>[];
  const configByCompetition = new Map(configs.map((config) => [text(config, ["competition_id"], ""), config]));
  const standardLeagueIds = Array.from(configByCompetition.keys()).filter(Boolean);
  if (!standardLeagueIds.length) return competitions;

  const [participantsResult, matchesResult] = await Promise.all([
    admin.from("competition_teams").select("competition_id, team_id").in("competition_id", standardLeagueIds).eq("is_active", true),
    admin.from("matches").select("league_id, league_fixture_version, home_team_id, away_team_id, home_score, away_score, status").in("league_id", standardLeagueIds),
  ]);
  if (participantsResult.error || matchesResult.error) {
    console.error("completed standard league archive lookup failed", participantsResult.error ?? matchesResult.error);
    return competitions;
  }

  const participantRows = (participantsResult.data ?? []) as Record<string, unknown>[];
  const participantIds = Array.from(new Set(participantRows.map((row) => text(row, ["team_id"], "")).filter(Boolean)));
  const teamsResult = participantIds.length ? await admin.from("teams").select("id, name").in("id", participantIds) : { data: [], error: null };
  if (teamsResult.error) {
    console.error("completed standard league archive team lookup failed", teamsResult.error);
    return competitions;
  }
  const teamNames = new Map(((teamsResult.data ?? []) as Record<string, unknown>[]).map((team) => [text(team, ["id"], ""), text(team, ["name"], "")]));
  const participantsByCompetition = new Map<string, { id: string; name: string }[]>();
  participantRows.forEach((participant) => {
    const competitionId = text(participant, ["competition_id"], "");
    const teamId = text(participant, ["team_id"], "");
    const name = teamNames.get(teamId);
    if (!competitionId || !teamId || !name) return;
    participantsByCompetition.set(competitionId, [...(participantsByCompetition.get(competitionId) ?? []), { id: teamId, name }]);
  });
  const matchesByCompetition = new Map<string, Record<string, unknown>[]>();
  ((matchesResult.data ?? []) as Record<string, unknown>[]).forEach((match) => {
    const competitionId = text(match, ["league_id"], "");
    if (!competitionId) return;
    matchesByCompetition.set(competitionId, [...(matchesByCompetition.get(competitionId) ?? []), match]);
  });

  return competitions.map((competition) => {
    const competitionId = text(competition, ["id"], "");
    const config = configByCompetition.get(competitionId);
    if (!config) return competition;
    const fixtureVersion = Number(config.fixture_version ?? 0);
    const leagueMatches = (matchesByCompetition.get(competitionId) ?? []).filter((match) => Number(match.league_fixture_version ?? 0) === fixtureVersion);
    const standings = calculateStandardLeagueStandings({
      config: {
        drawPoints: Number(config.draw_points ?? 1),
        lossPoints: Number(config.loss_points ?? 0),
        winPoints: Number(config.win_points ?? 3),
      },
      matches: leagueMatches.map((match) => ({
        awayScore: typeof match.away_score === "number" ? match.away_score : null,
        awayTeamId: text(match, ["away_team_id"], ""),
        fixtureKey: null,
        homeScore: typeof match.home_score === "number" ? match.home_score : null,
        homeTeamId: text(match, ["home_team_id"], ""),
        status: text(match, ["status"], ""),
      })),
      teams: participantsByCompetition.get(competitionId) ?? [],
    }).rows;
    const championId = text(config, ["champion_team_id"], "");
    return {
      ...competition,
      standard_champion_name: teamNames.get(championId) ?? "",
      standard_fixture_count: leagueMatches.length,
      standard_participant_count: (participantsByCompetition.get(competitionId) ?? []).length,
      standard_runner_up_name: standings.find((row) => row.teamId !== championId)?.teamName ?? "",
    };
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
  const standardChampion = text(competition, ["standard_champion_name"], "");
  const standardRunnerUp = text(competition, ["standard_runner_up_name"], "");
  const standardTeamCount = text(competition, ["standard_participant_count"], "");
  const standardFixtureCount = text(competition, ["standard_fixture_count"], "");

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
          {completed && competitionType === "league" && standardChampion ? <div className="mt-3 text-sm font-black text-[#8a6418]"><p>แชมป์: {standardChampion}</p>{standardRunnerUp ? <p className="mt-1 text-slate-600">รองแชมป์: {standardRunnerUp}</p> : null}</div> : null}
          {completed && competitionType === "league" && (standardTeamCount || standardFixtureCount) ? <p className="mt-2 text-xs font-bold text-slate-500">{standardTeamCount ? `${standardTeamCount} ทีม` : ""}{standardTeamCount && standardFixtureCount ? " · " : ""}{standardFixtureCount ? `${standardFixtureCount} นัด` : ""}</p> : null}
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

function CompetitionSection({ compact = false, items, showAccent = true, title }: { compact?: boolean; items: Row[]; showAccent?: boolean; title: string }) {
  if (!items.length) return null;

  return (
    <section className={`mx-auto w-full max-w-7xl px-4 ${compact ? "pb-8 pt-10" : "pb-10"} sm:px-6 lg:px-10`}>
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

function ChronicleCard({ entry }: { entry: ChronicleViewModel }) {
  const accent = entry.templateKey === "council_two_division"
    ? "border-emerald-800/20"
    : entry.templateKey === "ksw_standard"
      ? "border-[#d8ad45]/40"
      : entry.templateKey === "standard_league"
        ? "border-[#0b2745]/20"
        : "border-slate-200";
  const typeAccent = entry.templateKey === "council_two_division"
    ? "bg-emerald-950/85 text-emerald-100"
    : entry.templateKey === "ksw_standard"
      ? "bg-[#8a6418]/90 text-[#fff4d1]"
      : "bg-[#061426]/90 text-white";
  const metadata = [
    entry.seasonLabel ?? entry.yearLabel,
    entry.location,
    entry.teamCount ? `${entry.teamCount} ทีม` : null,
    entry.matchCount ? `${entry.completedMatchCount}/${entry.matchCount} นัด` : null,
  ].filter(Boolean);
  const content = (
    <>
      <div className="relative min-h-48 overflow-hidden bg-[#061426] sm:min-h-full">
        {entry.coverImageUrl ? (
          <Image
            alt=""
            className="object-cover opacity-85 transition-transform duration-500 group-hover:scale-[1.03]"
            fill
            sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 33vw"
            src={entry.coverImageUrl}
            unoptimized
          />
        ) : null}
        <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(6,20,38,0.12),rgba(6,20,38,0.88))]" />
        <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-3">
          <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${typeAccent}`}>
            {entry.typeLabel}
          </span>
          <span className="text-xs font-black text-[#f4d58a]">{entry.yearLabel}</span>
        </div>
      </div>
      <div className="flex min-w-0 flex-col p-5">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-black text-slate-500">
          <span>Completed / จบการแข่งขัน</span>
          {entry.warning ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">ผลสรุปกำลังจัดเตรียม</span> : null}
        </div>
        <h3 className="mt-3 text-2xl font-black leading-tight text-[#061426]">{entry.name}</h3>
        {metadata.length ? <p className="mt-2 text-sm font-bold text-slate-500">{metadata.join(" • ")}</p> : null}
        {entry.excerpt ? <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{entry.excerpt}</p> : null}
        {entry.templateKey === "council_two_division" ? (
          <div className="mt-5 grid gap-2 border-l-2 border-emerald-800/35 pl-3 text-sm">
            <p className="font-black text-[#061426]">Champion Division 1 <span className="font-bold text-emerald-800">{entry.councilChampions?.division1 ?? "รอผลสรุป"}</span></p>
            <p className="font-black text-[#061426]">Champion Division 2 <span className="font-bold text-emerald-800">{entry.councilChampions?.division2 ?? "รอผลสรุป"}</span></p>
          </div>
        ) : entry.champion ? (
          <div className="mt-5 border-l-2 border-[#d8ad45] pl-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#8a6418]">Champion</p>
            <p className="mt-1 text-lg font-black text-[#061426]">{entry.champion}</p>
            {entry.runnerUp || entry.thirdPlace ? <p className="mt-1 text-xs font-bold text-slate-500">{[entry.runnerUp ? `รองแชมป์ ${entry.runnerUp}` : null, entry.thirdPlace ? `อันดับ 3 ${entry.thirdPlace}` : null].filter(Boolean).join(" · ")}</p> : null}
          </div>
        ) : null}
        {entry.finalResult ? <p className="mt-4 text-sm font-bold text-slate-600">รอบชิงชนะเลิศ: {entry.finalResult}</p> : null}
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm font-black text-[#061426]">
        <span>{entry.warning ? "ดูรายละเอียดการแข่งขัน" : "ดูบันทึกการแข่งขัน"}</span>
        <span aria-hidden="true" className="text-[#8a6418] transition-transform group-hover:translate-x-1">→</span>
        </div>
      </div>
    </>
  );

  const className = `group grid min-w-0 overflow-hidden rounded-xl border bg-white transition-colors ${accent} hover:bg-[#fffdf7] sm:grid-cols-[minmax(10rem,0.72fr)_minmax(0,1.28fr)]`;
  if (!entry.slug) return <article className={className}>{content}</article>;
  return <Link className={className} href={`/competitions/${entry.slug}`}>{content}</Link>;
}

function ChronicleSection({ groups }: { groups: ChronicleGroup[] }) {
  if (!groups.length) {
    return (
      <section className="mx-auto w-full max-w-7xl px-4 pb-14 sm:px-6 lg:px-10">
        <div className="border-t border-[#d8ad45]/35 pt-8 text-center text-sm font-bold text-slate-500">
          ยังไม่มีรายการแข่งขันที่บันทึกไว้ใน KSW Chronicle
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-10">
      <div className="mb-10 max-w-2xl border-l-2 border-[#d8ad45] pl-5">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-[#8a6418]">การแข่งขันที่จบแล้ว</p>
        <h2 className="mt-2 text-3xl font-black tracking-tight text-[#061426] sm:text-4xl">พงศาวดารการแข่งขัน KSW</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">บันทึกฤดูกาล ผลการแข่งขัน และทีมแชมป์จากการแข่งขันของชมรม</p>
      </div>
      <div className="grid gap-12">
        {groups.map((group) => (
          <div className="grid gap-5" key={group.yearLabel}>
            <div className="flex items-center gap-4">
              <div className={`h-px flex-1 ${group.year === null ? "bg-slate-200" : "bg-[#d8ad45]/45"}`} />
              <div className="shrink-0 text-right">
                <p className={`text-2xl font-black sm:text-3xl ${group.year === null ? "text-slate-500" : "text-[#061426]"}`}>{group.yearLabel}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">{group.entries.length} {group.entries.length === 1 ? "รายการ" : "รายการแข่งขัน"}</p>
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {group.entries.map((entry) => <ChronicleCard entry={entry} key={entry.competitionId} />)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function CompetitionsPage() {
  const [publishedCompetitions, chronicleGroups] = await Promise.all([
    loadPublishedCompetitions(),
    loadChronicleGroups(),
  ]);
  const competitions = sortCompetitions(await withCompletedStandardLeagueArchiveData(await withCompletedCupChampions(publishedCompetitions)));
  const currentOrFeatured = competitions.filter((competition) => {
    const status = text(competition, ["season_status"], "active");
    return status !== "completed" && (competition.is_featured === true || status === "active" || status === "upcoming" || status === "in_progress");
  });
  const featuredIds = new Set(currentOrFeatured.map((competition) => text(competition, ["id"], "")).filter(Boolean));
  const chronicleCompetitionIds = new Set(chronicleGroups.flatMap((group) => group.entries.map((entry) => entry.competitionId)));
  const categoryCompetitions = competitions.filter((competition) => !featuredIds.has(text(competition, ["id"], "")) && !chronicleCompetitionIds.has(text(competition, ["id"], "")));
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
    <main className="min-h-screen overflow-x-hidden bg-[#f7f5f0] text-[#061426]">
      <section className="border-b border-[#d8ad45]/20 bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.2),transparent_34%),linear-gradient(135deg,#061426,#091f39)] text-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-10">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ad45]">KSW Digital Club Chronicle</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight sm:text-6xl">
            พงศาวดารการแข่งขัน KSW
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
            บันทึกรายการแข่งขันที่จบแล้วของชมรม ทั้งฤดูกาล ฟุตบอลถ้วย และช่วงเวลาสำคัญของ KSW L.C.
          </p>
        </div>
      </section>

      {competitions.length || chronicleGroups.length ? (
        <>
          <CompetitionSection compact items={currentOrFeatured} showAccent={false} title="กำลังดำเนินการแข่งขัน" />
          <CompetitionSection items={leagues} title="League Seasons" />
          <CompetitionSection items={cups} title="Cups" />
          <CompetitionSection items={smallTournaments} title="Small Tournaments" />
          <CompetitionSection items={specialMatches} title="Special Matches" />
          <ChronicleSection groups={chronicleGroups} />
        </>
      ) : (
        <ChronicleSection groups={chronicleGroups} />
      )}
    </main>
  );
}

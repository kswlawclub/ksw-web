import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { Activity, Archive, ArrowRight, BookOpen, CalendarDays, CircleDot, ExternalLink, Map as MapIcon, MapPin, Radio, TableProperties, Trophy, Users } from "lucide-react";
import { loadChronicleGroups } from "@/lib/chronicle-loader";
import type { ChronicleGroup, ChronicleViewModel } from "@/lib/chronicle-view-model";
import { loadPublishedCompetitions, Row, text } from "@/lib/competition-data";
import { calculateStandardLeagueStandings } from "@/lib/league-template/standings";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getExplicitVenueMapsUrl } from "@/lib/venue-maps";
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

function statusPresentation(status: string) {
  if (status === "completed") return { label: "จบการแข่งขัน", tone: "border-white/20 bg-white/10 text-white" };
  if (status === "upcoming") return { label: "กำลังจะเริ่ม", tone: "border-[#d8ad45]/40 bg-[#d8ad45]/15 text-[#f4d58a]" };
  return { label: "กำลังแข่งขัน", tone: "border-emerald-200/30 bg-emerald-400/15 text-emerald-100" };
}

function dateLabel(competition: Row) {
  const startDate = text(competition, ["start_date"], "");
  const endDate = text(competition, ["end_date"], "");

  if (startDate && endDate && startDate !== endDate) return `${startDate} - ${endDate}`;
  return startDate || endDate;
}

function VenueMapsAction({ mapsUrl, venueName }: { mapsUrl: string; venueName: string }) {
  return (
    <a
      aria-label={`เปิด Google Maps สำหรับ ${venueName}`}
      className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md border border-[#d8ad45]/45 bg-[#061426] px-3 py-2 text-sm font-black text-[#f4d58a] transition-colors hover:bg-[#0b2745] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a6418]"
      href={mapsUrl}
      rel="noopener noreferrer"
      target="_blank"
    >
      <MapIcon aria-hidden="true" className="size-4 shrink-0" />
      <span>เปิด Google Maps</span>
      <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
    </a>
  );
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

function CompetitionVisual({ competition, className = "" }: { competition: Row; className?: string }) {
  const coverImageUrl = text(competition, ["cover_image_url"], "");
  const competitionType = normalizeCompetitionType(text(competition, ["competition_type"], ""));
  const status = text(competition, ["season_status"], "active").toLowerCase();
  const statusDetails = statusPresentation(status);

  return (
    <div className={`relative overflow-hidden bg-[#061426] ${className}`}>
      {coverImageUrl ? (
        <Image
          alt=""
          className="object-cover object-center opacity-90 transition-transform duration-300 group-hover:scale-[1.02]"
          fill
          sizes="(max-width: 767px) 100vw, (max-width: 1279px) 55vw, 39vw"
          src={coverImageUrl}
          unoptimized
        />
      ) : (
        <div className="absolute inset-0 z-10 flex flex-col justify-between p-5 text-[#f4d58a]">
          <div className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em]"><Trophy aria-hidden="true" className="size-4 shrink-0" />KSW L.C.</div>
          <div className="max-w-xs"><p className="text-lg font-black leading-tight text-white">{typeLabel(competitionType)}</p><p className="mt-1 text-xs font-bold text-slate-300">{text(competition, ["season"], "การแข่งขันของ KSW")}{text(competition, ["edition_number"], "") ? ` · Edition ${text(competition, ["edition_number"], "")}` : ""}</p></div>
        </div>
      )}
      <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(6,20,38,0.08),rgba(6,20,38,0.84))]" />
      <div className="absolute bottom-4 left-4 z-20 flex flex-wrap gap-2">
        <span className="rounded-full border border-[#d8ad45]/35 bg-[#061426]/70 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#f4d58a]">{typeLabel(competitionType)}</span>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-black tracking-[0.1em] ${statusDetails.tone}`}><CircleDot aria-hidden="true" className="size-3 shrink-0" />{statusDetails.label}</span>
      </div>
    </div>
  );
}

function CompetitionCard({ competition, horizontal = false, showVenueMaps = false }: { competition: Row; horizontal?: boolean; showVenueMaps?: boolean }) {
  const slug = text(competition, ["slug"], "");
  const competitionType = normalizeCompetitionType(text(competition, ["competition_type"], ""));
  const description = text(
    competition,
    ["short_description"],
    slug ? "กำลังจัดเตรียมรายละเอียดการแข่งขัน" : "กำลังจัดเตรียมรายละเอียดการแข่งขัน",
  );
  const venueName = text(competition, ["location"], "");
  const mapsUrl = getExplicitVenueMapsUrl({ mapsUrl: text(competition, ["location_maps_url"], ""), venueName });
  const metadata = [
    text(competition, ["season"], ""),
    text(competition, ["edition_number"], "") ? `Edition ${text(competition, ["edition_number"], "")}` : "",
    dateLabel(competition),
    showVenueMaps ? "" : venueName,
  ].filter(Boolean);
  const completed = text(competition, ["season_status"], "active").toLowerCase() === "completed";
  const champion = text(competition, ["champion_name"], "");
  const division1Champion = text(competition, ["champion_division_1"], "");
  const division2Champion = text(competition, ["champion_division_2"], "");
  const standardChampion = text(competition, ["standard_champion_name"], "");
  const standardRunnerUp = text(competition, ["standard_runner_up_name"], "");
  const standardTeamCount = text(competition, ["standard_participant_count"], "");
  const standardFixtureCount = text(competition, ["standard_fixture_count"], "");

  const cardContent = (
    <>
      <CompetitionVisual className={horizontal ? "aspect-[16/10] lg:aspect-auto" : "aspect-[16/9]"} competition={competition} />
      <div className="flex min-w-0 flex-1 flex-col p-5 sm:p-6">
        <div>
          <h2 className="break-words text-xl font-black leading-tight text-[#061426]">{text(competition, ["name"], "Competition")}</h2>
          {metadata.length ? <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-slate-500"><CalendarDays aria-hidden="true" className="size-3.5 shrink-0 text-[#8a6418]" />{metadata.join(" • ")}</p> : null}
          {showVenueMaps && venueName ? <div className="mt-3 grid gap-2"><p className="flex min-w-0 items-start gap-2 text-sm font-bold text-slate-600"><MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#8a6418]" /><span className="break-words">{venueName}</span></p>{mapsUrl ? <VenueMapsAction mapsUrl={mapsUrl} venueName={venueName} /> : null}</div> : null}
          <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
          {completed && division1Champion && division2Champion ? <div className="mt-4 grid gap-2 border-l-2 border-emerald-800/45 pl-3 text-sm"><p className="font-black text-emerald-900">แชมป์ Division 1: <span className="font-bold">{division1Champion}</span></p><p className="font-black text-emerald-900">แชมป์ Division 2: <span className="font-bold">{division2Champion}</span></p></div> : null}
          {completed && champion ? <p className="mt-4 flex items-center gap-2 text-sm font-black text-[#8a6418]"><Trophy aria-hidden="true" className="size-4 shrink-0" />แชมป์: {champion}</p> : null}
          {completed && competitionType === "league" && standardChampion ? <div className="mt-4 border-l-2 border-[#d8ad45] pl-3 text-sm font-black text-[#8a6418]"><p className="flex items-center gap-2"><Trophy aria-hidden="true" className="size-4 shrink-0" />แชมป์: {standardChampion}</p>{standardRunnerUp ? <p className="mt-1 text-slate-600">รองแชมป์: {standardRunnerUp}</p> : null}</div> : null}
          {completed && competitionType === "league" && (standardTeamCount || standardFixtureCount) ? <p className="mt-2 text-xs font-bold text-slate-500">{standardTeamCount ? `${standardTeamCount} ทีม` : ""}{standardTeamCount && standardFixtureCount ? " · " : ""}{standardFixtureCount ? `${standardFixtureCount} นัด` : ""}</p> : null}
        </div>
        {slug ? (
          showVenueMaps ? <Link className="mt-5 inline-flex min-h-11 w-fit items-center gap-3 border-t border-slate-100 pt-4 text-sm font-black text-[#061426] hover:text-[#8a6418] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a6418]" href={`/competitions/${slug}`}><span>{completed ? "ดูผลการแข่งขัน" : "ดูรายละเอียดการแข่งขัน"}</span><ArrowRight aria-hidden="true" className="size-4 shrink-0 text-[#8a6418] transition-transform group-hover:translate-x-1" /></Link> : <span className="mt-5 inline-flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm font-black text-[#061426]"><span>{completed ? "ดูผลการแข่งขัน" : "ดูรายละเอียดการแข่งขัน"}</span><ArrowRight aria-hidden="true" className="size-4 shrink-0 text-[#8a6418] transition-transform group-hover:translate-x-1" /></span>
        ) : (
          <p className="mt-5 border-t border-slate-100 pt-4 text-sm font-black text-slate-500">
            กำลังจัดเตรียมรายละเอียดการแข่งขัน
          </p>
        )}
      </div>
    </>
  );

  if (slug && !showVenueMaps) {
    return (
      <Link
        className={`group min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5 transition-all hover:border-[#d8ad45]/55 hover:shadow-md hover:shadow-slate-900/10 ${horizontal ? "grid lg:grid-cols-[22rem_minmax(0,1fr)]" : "flex flex-col"}`}
        href={`/competitions/${slug}`}
      >
        {cardContent}
      </Link>
    );
  }

  return (
    <article className={`group min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5 ${horizontal ? "grid lg:grid-cols-[22rem_minmax(0,1fr)]" : "flex flex-col"}`}>
      {cardContent}
    </article>
  );
}

function CurrentCompetitionFeature({ items }: { items: Row[] }) {
  if (!items.length) return null;
  const [featured, ...secondary] = items;
  const slug = text(featured, ["slug"], "");
  const venueName = text(featured, ["location"], "");
  const mapsUrl = getExplicitVenueMapsUrl({ mapsUrl: text(featured, ["location_maps_url"], ""), venueName });
  const description = text(featured, ["short_description"], "กำลังจัดเตรียมรายละเอียดการแข่งขัน");
  const metadata = [
    { icon: CalendarDays, value: [text(featured, ["season"], ""), dateLabel(featured)].filter(Boolean).join(" · ") },
    { icon: MapPin, value: text(featured, ["location"], "") },
    { icon: Users, value: text(featured, ["standard_participant_count"], "") ? `${text(featured, ["standard_participant_count"], "")} ทีม` : "" },
  ].filter((item) => item.value);

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-12 pt-8 sm:px-6 sm:pt-10 lg:px-10" aria-labelledby="current-competitions-heading">
      <div className="mb-4 flex items-center gap-2"><Radio aria-hidden="true" className="size-5 shrink-0 text-emerald-800" /><h2 className="text-2xl font-black text-[#061426]" id="current-competitions-heading">กำลังดำเนินการแข่งขัน</h2></div>
      <article className="group grid min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/10 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <CompetitionVisual className="aspect-[16/10] lg:aspect-auto" competition={featured} />
        <div className="flex min-w-0 flex-col p-5 sm:p-6">
          <h3 className="break-words text-3xl font-black leading-tight text-[#061426]">{text(featured, ["name"], "Competition")}</h3>
          {metadata.length ? <div className="mt-4 grid gap-2 text-sm font-bold text-slate-600">{metadata.map(({ icon: Icon, value }) => <p className="flex min-w-0 items-start gap-2" key={value}><Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#8a6418]" /><span className="break-words">{value}</span></p>)}</div> : null}
          {venueName && mapsUrl ? <div className="mt-3"><VenueMapsAction mapsUrl={mapsUrl} venueName={venueName} /></div> : null}
          <p className="mt-5 text-sm leading-6 text-slate-700">{description}</p>
          {slug ? <Link className="mt-6 inline-flex min-h-11 w-fit items-center gap-2 border-t border-slate-200 pt-4 text-sm font-black text-[#061426] hover:text-[#8a6418]" href={`/competitions/${slug}`}><span>ดูรายละเอียดการแข่งขัน</span><ArrowRight aria-hidden="true" className="size-4 shrink-0 text-[#8a6418] transition-transform group-hover:translate-x-1" /></Link> : <p className="mt-6 border-t border-slate-200 pt-4 text-sm font-black text-slate-500">กำลังจัดเตรียมรายละเอียดการแข่งขัน</p>}
        </div>
      </article>
      {secondary.length ? <div className="mt-4 grid gap-4">{secondary.map((competition) => <CompetitionCard competition={competition} horizontal key={text(competition, ["id", "slug", "name"])} showVenueMaps />)}</div> : null}
    </section>
  );
}

function CompetitionSection({ items, title }: { items: Row[]; title: string }) {
  if (!items.length) return null;
  return <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10"><div className="mb-4 flex items-center gap-2"><Activity aria-hidden="true" className="size-5 shrink-0 text-[#8a6418]" /><h2 className="text-2xl font-black text-[#061426]">{title}</h2></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map((competition) => <CompetitionCard competition={competition} key={text(competition, ["id", "slug", "name"])} />)}</div></section>;
}

function ChronicleCard({ entry }: { entry: ChronicleViewModel }) {
  const SummaryIcon = entry.templateKey === "standard_league" ? TableProperties : Trophy;
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
      <div className="relative aspect-[16/10] overflow-hidden bg-[#061426] lg:aspect-auto">
        {entry.coverImageUrl ? (
          <Image
            alt=""
            className="object-cover object-center opacity-85 transition-transform duration-300 group-hover:scale-[1.02]"
            fill
            sizes="(max-width: 639px) 100vw, (max-width: 1279px) 50vw, 39vw"
            src={entry.coverImageUrl}
            unoptimized
          />
        ) : <div className="absolute inset-0 z-10 flex flex-col justify-between p-5"><div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-[#f4d58a]"><BookOpen aria-hidden="true" className="size-4 shrink-0" />KSW L.C.</div><div className="max-w-[13rem]"><p className="text-lg font-black leading-tight text-white">{entry.typeLabel}</p><p className="mt-1 text-xs font-bold text-slate-300">{entry.seasonLabel ?? entry.yearLabel}</p></div></div>}
        <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(6,20,38,0.12),rgba(6,20,38,0.88))]" />
        <div className="absolute inset-x-4 bottom-4 z-20 flex items-end justify-between gap-3">
          <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${typeAccent}`}>
            {entry.typeLabel}
          </span>
          <span className="text-xs font-black text-[#f4d58a]">{entry.yearLabel}</span>
        </div>
      </div>
      <div className="flex min-w-0 flex-col p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-black text-slate-500">
          <span className="inline-flex items-center gap-1.5"><Archive aria-hidden="true" className="size-3.5 shrink-0 text-[#8a6418]" />จบการแข่งขัน</span>
          {entry.warning ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">ผลสรุปกำลังจัดเตรียม</span> : null}
        </div>
        <h3 className="mt-3 break-words text-2xl font-black leading-tight text-[#061426]">{entry.name}</h3>
        {metadata.length ? <p className="mt-2 text-sm font-bold text-slate-500">{metadata.join(" • ")}</p> : null}
        {entry.excerpt ? <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{entry.excerpt}</p> : null}
        {entry.templateKey === "council_two_division" ? (
          <div className="mt-5 grid gap-2 border-l-2 border-emerald-800/35 pl-3 text-sm">
            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-800"><Trophy aria-hidden="true" className="size-3.5 shrink-0" />แชมป์การแข่งขัน</p>
            <p className="font-black text-[#061426]">แชมป์ Division 1 <span className="font-bold text-emerald-800">{entry.councilChampions?.division1 ?? "รอผลสรุป"}</span></p>
            <p className="font-black text-[#061426]">แชมป์ Division 2 <span className="font-bold text-emerald-800">{entry.councilChampions?.division2 ?? "รอผลสรุป"}</span></p>
          </div>
        ) : entry.champion ? (
          <div className="mt-5 border-l-2 border-[#d8ad45] pl-3">
            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#8a6418]"><SummaryIcon aria-hidden="true" className="size-3.5 shrink-0" />แชมป์</p>
            <p className="mt-1 text-lg font-black text-[#061426]">{entry.champion}</p>
            {entry.runnerUp || entry.thirdPlace ? <p className="mt-1 text-xs font-bold text-slate-500">{[entry.runnerUp ? `รองแชมป์ ${entry.runnerUp}` : null, entry.thirdPlace ? `อันดับ 3 ${entry.thirdPlace}` : null].filter(Boolean).join(" · ")}</p> : null}
          </div>
        ) : null}
        {entry.finalResult ? <p className="mt-4 text-sm font-bold text-slate-600">รอบชิงชนะเลิศ: {entry.finalResult}</p> : null}
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm font-black text-[#061426]">
        <span>{entry.warning ? "ดูรายละเอียดการแข่งขัน" : "ดูบันทึกการแข่งขัน"}</span>
        <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-[#8a6418] transition-transform group-hover:translate-x-1" />
        </div>
      </div>
    </>
  );

  const className = `group grid min-w-0 overflow-hidden rounded-2xl border bg-white shadow-sm shadow-slate-900/5 transition-all ${accent} hover:border-[#d8ad45]/55 hover:bg-[#fffdf7] hover:shadow-md hover:shadow-slate-900/10 lg:grid-cols-[22rem_minmax(0,1fr)]`;
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
    <section className="mx-auto w-full max-w-7xl px-4 pb-16 pt-8 sm:px-6 lg:px-10">
      <div className="mb-8 max-w-2xl">
        <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
        <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-[#8a6418]"><Archive aria-hidden="true" className="size-4 shrink-0" />บันทึกที่ผ่านมา</p>
        <h2 className="mt-2 text-3xl font-black tracking-tight text-[#061426] sm:text-4xl">บันทึกการแข่งขันที่ผ่านมา</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">ฤดูกาล ผลการแข่งขัน และเรื่องราวสำคัญจากรายการของชมรม</p>
      </div>
      <div className="grid gap-9">
        {groups.map((group) => (
          <div className="grid gap-4" key={group.yearLabel}>
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0 shrink-0">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
                <p className={`text-2xl font-black sm:text-3xl ${group.year === null ? "text-slate-500" : "text-[#061426]"}`}>{group.yearLabel}</p>
                <p className="text-xs font-bold text-slate-500">{group.entries.length} {group.entries.length === 1 ? "รายการ" : "รายการแข่งขัน"}</p>
              </div>
              </div>
              <div className={`h-px min-w-0 flex-1 ${group.year === null ? "bg-slate-200" : "bg-[#d8ad45]/45"}`} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {group.entries.map((entry) => <div className={group.entries.length === 1 ? "lg:col-span-2" : ""} key={entry.competitionId}><ChronicleCard entry={entry} /></div>)}
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
      <section className="border-b border-[#d8ad45]/25 bg-[#061426] text-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-11 sm:px-6 sm:py-12 lg:px-10">
          <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] text-[#d8ad45]"><BookOpen aria-hidden="true" className="size-4 shrink-0" />KSW Digital Club Chronicle</p>
          <div className="mt-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
          <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
            บันทึกการแข่งขันของ KSW
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
            รวบรวมฤดูกาล ผลการแข่งขัน และช่วงเวลาสำคัญของชมรม
          </p>
        </div>
      </section>

      {competitions.length || chronicleGroups.length ? (
        <>
          <CurrentCompetitionFeature items={currentOrFeatured} />
          <CompetitionSection items={leagues} title="ฤดูกาลลีก" />
          <CompetitionSection items={cups} title="ฟุตบอลถ้วย" />
          <CompetitionSection items={smallTournaments} title="รายการแข่งขัน" />
          <CompetitionSection items={specialMatches} title="แมตช์พิเศษ" />
          <ChronicleSection groups={chronicleGroups} />
        </>
      ) : (
        <ChronicleSection groups={chronicleGroups} />
      )}
    </main>
  );
}

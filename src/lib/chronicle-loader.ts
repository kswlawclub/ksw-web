import "server-only";

import { text, type Row } from "@/lib/competition-data";
import { calculateStandardLeagueStandings } from "@/lib/league-template/standings";
import { loadPublicCupV2Data } from "@/lib/public-cup-v2-loader";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  groupChronicleEntries,
  isChronicleCompetition,
  mapChronicleViewModel,
  type ChronicleGroup,
  type ChronicleTemplateKey,
  type ChronicleViewModel,
} from "@/lib/chronicle-view-model";

type ChronicleConfigRow = Row & {
  champion_team_id?: unknown;
  draw_points?: unknown;
  fixture_version?: unknown;
  loss_points?: unknown;
  template_key?: unknown;
  win_points?: unknown;
};

function numberValue(row: Row | undefined, key: string) {
  const value = row?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function nullableText(row: Row | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function isCompletedMatch(status: string) {
  return status === "finished" || status === "completed";
}

function formatFinalResult(input: {
  awayName: string | null;
  awayPenalty: number | null;
  awayScore: number | null;
  homeName: string | null;
  homePenalty: number | null;
  homeScore: number | null;
}) {
  if (!input.homeName || !input.awayName || input.homeScore === null || input.awayScore === null) return null;
  const score = `${input.homeName} ${input.homeScore}-${input.awayScore} ${input.awayName}`;
  if (input.homePenalty === null || input.awayPenalty === null) return score;
  return `${score} (จุดโทษ ${input.homePenalty}-${input.awayPenalty})`;
}

function finalResultFromCupV2(data: NonNullable<Awaited<ReturnType<typeof loadPublicCupV2Data>>>, partitionKey: string) {
  const finalNode = data.nodes
    .filter((node) => node.partitionKey === partitionKey && node.linkedMatch)
    .sort((left, right) => right.roundIndex - left.roundIndex || right.matchOrder - left.matchOrder)[0];
  const match = finalNode?.linkedMatch;
  if (!match) return null;
  return formatFinalResult({
    awayName: match.awayTeam?.name ?? null,
    awayPenalty: match.awayPenaltyScore,
    awayScore: match.awayScore,
    homeName: match.homeTeam?.name ?? null,
    homePenalty: match.homePenaltyScore,
    homeScore: match.homeScore,
  });
}

function templateFor(competition: Row, config: ChronicleConfigRow | undefined): ChronicleTemplateKey {
  if (text(config, ["template_key"], "") === "standard_league") return "standard_league";
  return text(competition, ["competition_type"], "") === "cup" ? "generic" : "generic";
}

function publicMetadata(competition: Row) {
  return {
    competitionId: text(competition, ["id"], ""),
    coverImageUrl: nullableText(competition, "cover_image_url"),
    createdAt: nullableText(competition, "created_at"),
    displayOrder: typeof competition.display_order === "number" ? competition.display_order : null,
    endDate: nullableText(competition, "end_date"),
    excerpt: nullableText(competition, "short_description") ?? nullableText(competition, "description"),
    location: nullableText(competition, "location"),
    name: text(competition, ["name"], "Competition"),
    seasonLabel: nullableText(competition, "season"),
    slug: text(competition, ["slug"], ""),
    startDate: nullableText(competition, "start_date"),
    type: competition.competition_type,
  };
}

export async function loadChronicleGroups(): Promise<ChronicleGroup[]> {
  const admin = getSupabaseAdmin();
  if (!admin) return [];

  const competitionsResult = await admin
    .from("leagues")
    .select("id, name, season, slug, short_description, description, cover_image_url, start_date, end_date, location, display_order, competition_type, season_status, is_published, created_at")
    .eq("is_published", true)
    .eq("season_status", "completed");
  if (competitionsResult.error) {
    console.error("chronicle competition query failed", competitionsResult.error);
    return [];
  }

  const competitions = ((competitionsResult.data ?? []) as Row[]).filter((competition) =>
    isChronicleCompetition({
      isPublished: competition.is_published === true,
      seasonStatus: text(competition, ["season_status"], ""),
    }),
  );
  const competitionIds = competitions.map((competition) => text(competition, ["id"], "")).filter(Boolean);
  if (!competitionIds.length) return [];

  const [participantsResult, matchesResult, configsResult] = await Promise.all([
    admin.from("competition_teams").select("competition_id, team_id").in("competition_id", competitionIds).eq("is_active", true),
    admin.from("matches").select("id, league_id, league_fixture_version, home_team_id, away_team_id, home_score, away_score, status").in("league_id", competitionIds),
    admin.from("competition_league_configs").select("competition_id, template_key, fixture_version, win_points, draw_points, loss_points, champion_team_id").in("competition_id", competitionIds),
  ]);
  const firstError = participantsResult.error ?? matchesResult.error ?? configsResult.error;
  if (firstError) {
    console.error("chronicle supporting data query failed", firstError);
    return [];
  }

  const participantRows = (participantsResult.data ?? []) as Row[];
  const matches = (matchesResult.data ?? []) as Row[];
  const configs = (configsResult.data ?? []) as ChronicleConfigRow[];
  const configByCompetition = new Map(configs.map((config) => [text(config, ["competition_id"], ""), config]));
  const participantsByCompetition = new Map<string, string[]>();
  participantRows.forEach((participant) => {
    const competitionId = text(participant, ["competition_id"], "");
    const teamId = text(participant, ["team_id"], "");
    if (competitionId && teamId) participantsByCompetition.set(competitionId, [...(participantsByCompetition.get(competitionId) ?? []), teamId]);
  });
  const matchesByCompetition = new Map<string, Row[]>();
  matches.forEach((match) => {
    const competitionId = text(match, ["league_id"], "");
    if (competitionId) matchesByCompetition.set(competitionId, [...(matchesByCompetition.get(competitionId) ?? []), match]);
  });

  const participantTeamIds = Array.from(new Set(participantRows.map((participant) => text(participant, ["team_id"], "")).filter(Boolean)));
  const teamsResult = participantTeamIds.length
    ? await admin.from("teams").select("id, name").in("id", participantTeamIds)
    : { data: [] as Row[], error: null };
  if (teamsResult.error) {
    console.error("chronicle team query failed", teamsResult.error);
    return [];
  }
  const teamNames = new Map(((teamsResult.data ?? []) as Row[]).map((team) => [text(team, ["id"], ""), text(team, ["name"], "")]));

  const viewModels = await Promise.all(competitions.map(async (competition): Promise<ChronicleViewModel> => {
    const metadata = publicMetadata(competition);
    const competitionId = metadata.competitionId;
    const config = configByCompetition.get(competitionId);
    const templateKey = templateFor(competition, config);
    const competitionMatches = matchesByCompetition.get(competitionId) ?? [];
    const teamIds = participantsByCompetition.get(competitionId) ?? [];

    if (templateKey === "standard_league" && config) {
      const fixtureVersion = numberValue(config, "fixture_version");
      const fixtureMatches = competitionMatches.filter((match) => numberValue(match, "league_fixture_version") === fixtureVersion);
      const standings = calculateStandardLeagueStandings({
        config: {
          drawPoints: numberValue(config, "draw_points"),
          lossPoints: numberValue(config, "loss_points"),
          winPoints: numberValue(config, "win_points") || 3,
        },
        matches: fixtureMatches.map((match) => ({
          awayScore: typeof match.away_score === "number" ? match.away_score : null,
          awayTeamId: text(match, ["away_team_id"], ""),
          fixtureKey: null,
          homeScore: typeof match.home_score === "number" ? match.home_score : null,
          homeTeamId: text(match, ["home_team_id"], ""),
          status: text(match, ["status"], ""),
        })),
        teams: teamIds.map((id) => ({ id, name: teamNames.get(id) ?? "ทีมไม่ทราบชื่อ" })),
      }).rows;
      const championId = text(config, ["champion_team_id"], "");
      const runnerUp = standings.find((standing) => standing.teamId !== championId)?.teamName ?? null;
      const thirdPlace = standings.filter((standing) => standing.teamId !== championId)[1]?.teamName ?? null;
      return mapChronicleViewModel({
        ...metadata,
        champion: teamNames.get(championId) ?? null,
        completedMatchCount: fixtureMatches.filter((match) => isCompletedMatch(text(match, ["status"], ""))).length,
        matchCount: fixtureMatches.length,
        runnerUp,
        teamCount: teamIds.length,
        templateKey,
        thirdPlace,
      });
    }

    const cupV2 = await loadPublicCupV2Data(competition);
    if (cupV2?.templateKey === "ksw_standard") {
      return mapChronicleViewModel({
        ...metadata,
        champion: cupV2.champions.main?.name ?? null,
        completedMatchCount: cupV2.linkedMatches.filter((match) => isCompletedMatch(match.status)).length,
        finalResult: finalResultFromCupV2(cupV2, "main"),
        matchCount: cupV2.linkedMatches.length,
        teamCount: cupV2.teams.length,
        templateKey: "ksw_standard",
      });
    }

    if (cupV2?.templateKey === "council_two_division") {
      return mapChronicleViewModel({
        ...metadata,
        completedMatchCount: cupV2.linkedMatches.filter((match) => isCompletedMatch(match.status)).length,
        councilChampions: {
          division1: cupV2.champions.division1?.name ?? null,
          division2: cupV2.champions.division2?.name ?? null,
        },
        matchCount: cupV2.linkedMatches.length,
        teamCount: cupV2.teams.length,
        templateKey: "council_two_division",
      });
    }

    return mapChronicleViewModel({
      ...metadata,
      completedMatchCount: competitionMatches.filter((match) => isCompletedMatch(text(match, ["status"], ""))).length,
      matchCount: competitionMatches.length,
      teamCount: teamIds.length,
      templateKey: "generic",
    });
  }));

  return groupChronicleEntries(viewModels);
}

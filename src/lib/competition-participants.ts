import { getSupabase } from "@/lib/supabase";

export type ParticipantSource = "junction" | "legacy" | "junction+legacy";

type Row = Record<string, unknown>;

export type CompetitionParticipant = Row & {
  id: string;
  league_id: string | null;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  is_ksw: boolean;
  is_active: boolean;
  participant_is_active: boolean;
  display_order: number;
  participant_source: ParticipantSource;
};

type SupabaseClient = NonNullable<ReturnType<typeof getSupabase>>;

type LoadOptions = {
  includeInactiveParticipants?: boolean;
};

const teamSelect = "id, league_id, name, short_name, logo_url, is_ksw, is_active";

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value : "";
}

function nullableText(row: Row | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value : null;
}

function booleanValue(row: Row | undefined, key: string, fallback = false) {
  const value = row?.[key];
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(row: Row | undefined, key: string, fallback = 0) {
  const value = row?.[key];
  return typeof value === "number" ? value : fallback;
}

function nestedTeam(row: Row): Row | undefined {
  const value = row.team ?? row.teams;

  if (Array.isArray(value)) {
    return value[0] as Row | undefined;
  }

  if (value && typeof value === "object") {
    return value as Row;
  }

  return undefined;
}

function fromTeamRow(
  team: Row,
  source: ParticipantSource,
  participant?: Row,
): CompetitionParticipant | undefined {
  const id = text(team, "id");
  const name = text(team, "name");

  if (!id || !name) {
    return undefined;
  }

  return {
    id,
    league_id: nullableText(team, "league_id"),
    name,
    short_name: nullableText(team, "short_name"),
    logo_url: nullableText(team, "logo_url"),
    is_ksw: booleanValue(team, "is_ksw"),
    is_active: booleanValue(team, "is_active", true),
    participant_is_active: participant ? booleanValue(participant, "is_active", true) : true,
    display_order: participant ? numberValue(participant, "display_order") : 0,
    participant_source: source,
  };
}

function byDisplayOrderAndName(a: CompetitionParticipant, b: CompetitionParticipant) {
  const orderDiff = a.display_order - b.display_order;
  if (orderDiff) return orderDiff;

  return a.name.localeCompare(b.name);
}

function mergeParticipants(
  junctionParticipants: CompetitionParticipant[],
  legacyParticipants: CompetitionParticipant[],
) {
  const byId = new Map<string, CompetitionParticipant>();

  for (const participant of junctionParticipants) {
    byId.set(participant.id, participant);
  }

  for (const participant of legacyParticipants) {
    const existing = byId.get(participant.id);

    if (existing) {
      byId.set(participant.id, {
        ...existing,
        participant_source: "junction+legacy",
      });
    } else {
      byId.set(participant.id, participant);
    }
  }

  return Array.from(byId.values()).sort(byDisplayOrderAndName);
}

export async function loadCompetitionParticipants(
  supabase: SupabaseClient,
  competitionId: string,
  options: LoadOptions = {},
) {
  if (!competitionId) {
    return [] as CompetitionParticipant[];
  }

  let junctionParticipants: CompetitionParticipant[] = [];
  let legacyParticipants: CompetitionParticipant[] = [];

  try {
    let junctionQuery = supabase
      .from("competition_teams")
      .select(`id, competition_id, team_id, is_active, display_order, team:teams(${teamSelect})`)
      .eq("competition_id", competitionId);

    if (!options.includeInactiveParticipants) {
      junctionQuery = junctionQuery.eq("is_active", true);
    }

    const junctionResult = await junctionQuery;

    if (junctionResult.error) {
      console.warn("competition participants junction query failed", junctionResult.error);
    } else {
      junctionParticipants = ((junctionResult.data ?? []) as Row[])
        .map((row) => {
          const team = nestedTeam(row);
          return team ? fromTeamRow(team, "junction", row) : undefined;
        })
        .filter((participant): participant is CompetitionParticipant => Boolean(participant));
    }
  } catch (error) {
    console.warn("competition participants junction query failed", error);
  }

  try {
    const legacyResult = await supabase
      .from("teams")
      .select(teamSelect)
      .eq("league_id", competitionId);

    if (legacyResult.error) {
      console.warn("competition participants legacy query failed", legacyResult.error);
    } else {
      legacyParticipants = ((legacyResult.data ?? []) as Row[])
        .map((team) => fromTeamRow(team, "legacy"))
        .filter((participant): participant is CompetitionParticipant => Boolean(participant));
    }
  } catch (error) {
    console.warn("competition participants legacy query failed", error);
  }

  return mergeParticipants(junctionParticipants, legacyParticipants);
}

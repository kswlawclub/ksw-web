import { getSupabase } from "@/lib/supabase";

export type ParticipantSource = "junction" | "legacy" | "junction+legacy";

type Row = Record<string, unknown>;

export type CompetitionParticipant = Row & {
  id: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  created_at: string | null;
  is_ksw: boolean;
  is_active: boolean;
  participant_is_active: boolean;
  display_order: number;
  participant_source: ParticipantSource;
};

type SupabaseClient = NonNullable<ReturnType<typeof getSupabase>>;

type LoadOptions = {
  includeLegacyFallback?: boolean;
  includeInactiveParticipants?: boolean;
};

type SupabaseReadError = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

const teamSelect = "id, name, short_name, logo_url, is_ksw, is_active, created_at";

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
    name,
    short_name: nullableText(team, "short_name"),
    logo_url: nullableText(team, "logo_url"),
    created_at: nullableText(team, "created_at"),
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
  junctionTeamIds = new Set<string>(),
) {
  const byId = new Map<string, CompetitionParticipant>();

  for (const participant of junctionParticipants) {
    byId.set(participant.id, participant);
  }

  for (const participant of legacyParticipants) {
    if (junctionTeamIds.has(participant.id) && !byId.has(participant.id)) {
      continue;
    }

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

function logSupabaseReadError(source: string, error: unknown, context?: Record<string, unknown>) {
  const supabaseError = error as SupabaseReadError | null;

  console.error(source, {
    code: supabaseError?.code,
    details: supabaseError?.details,
    hint: supabaseError?.hint,
    message: supabaseError?.message,
    ...context,
  });
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
  let junctionTeamIds = new Set<string>();

  try {
    const junctionResult = await supabase
      .from("competition_teams")
      .select("team_id, is_active, display_order")
      .eq("competition_id", competitionId);

    if (junctionResult.error) {
      logSupabaseReadError("loadCompetitionParticipants junction query failed", junctionResult.error, {
        competitionId,
      });
    } else {
      const junctionRows = (junctionResult.data ?? []) as Row[];
      junctionTeamIds = new Set(
        junctionRows.map((row) => text(row, "team_id")).filter(Boolean),
      );
      const activeJunctionRows = options.includeInactiveParticipants
        ? junctionRows
        : junctionRows.filter((row) => booleanValue(row, "is_active", true));
      const activeTeamIds = activeJunctionRows.map((row) => text(row, "team_id")).filter(Boolean);

      if (activeTeamIds.length > 0) {
        const teamsResult = await supabase
          .from("teams")
          .select(teamSelect)
          .in("id", activeTeamIds);

        if (teamsResult.error) {
          logSupabaseReadError("loadCompetitionParticipants junction team query failed", teamsResult.error, {
            competitionId,
            teamCount: activeTeamIds.length,
          });
        } else {
          const teamsById = new Map(
            ((teamsResult.data ?? []) as Row[]).map((team) => [text(team, "id"), team]),
          );

          junctionParticipants = activeJunctionRows
            .map((row) => {
              const team = teamsById.get(text(row, "team_id"));

              if (!team) {
                console.error("loadCompetitionParticipants junction team missing", {
                  competitionId,
                  teamId: text(row, "team_id"),
                });
                return undefined;
              }

              return fromTeamRow(team, "junction", row);
            })
            .filter((participant): participant is CompetitionParticipant => Boolean(participant));
        }
      }
    }
  } catch (error) {
    logSupabaseReadError("loadCompetitionParticipants junction query failed", error, {
      competitionId,
    });
  }

  if (options.includeLegacyFallback !== false) {
    try {
      const legacyResult = await supabase
        .from("teams")
        .select(teamSelect)
        .eq("league_id", competitionId);

      if (legacyResult.error) {
        logSupabaseReadError("loadCompetitionParticipants legacy query failed", legacyResult.error, {
          competitionId,
        });
      } else {
        legacyParticipants = ((legacyResult.data ?? []) as Row[])
          .map((team) => fromTeamRow(team, "legacy"))
          .filter((participant): participant is CompetitionParticipant => Boolean(participant));
      }
    } catch (error) {
      logSupabaseReadError("loadCompetitionParticipants legacy query failed", error, {
        competitionId,
      });
    }
  }

  return mergeParticipants(junctionParticipants, legacyParticipants, junctionTeamIds);
}

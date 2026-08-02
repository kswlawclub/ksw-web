import type {
  StandardLeagueRescheduleConflict,
  StandardLeagueRescheduleHistory,
  StandardLeagueRescheduledMatch,
} from "./types.ts";

type Row = Record<string, unknown>;

export type StandardLeagueRescheduleInput = {
  competitionId: string;
  matchId: string;
  targetMatchweek: number;
  reason: string;
  acknowledgeConflict: boolean;
};

type ParsedRescheduleRpcResult =
  | { kind: "success"; newEffectiveMatchweek: number; originalMatchweek: number; previousEffectiveMatchweek: number; history: StandardLeagueRescheduleHistory }
  | { kind: "conflict"; conflicts: StandardLeagueRescheduleConflict[] }
  | { kind: "error"; error: string };

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function nullableInteger(row: Row, key: string) {
  const value = row[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function requiredString(row: Row, key: string) {
  return nullableString(row, key) ?? "";
}

function requiredInteger(row: Row, key: string) {
  return nullableInteger(row, key) ?? 0;
}

export function validateStandardLeagueRescheduleInput(input: StandardLeagueRescheduleInput) {
  if (!input.competitionId.trim() || !input.matchId.trim()) return "ไม่พบข้อมูลรายการแข่งขันหรือคู่แข่งขัน";
  if (!Number.isInteger(input.targetMatchweek) || input.targetMatchweek < 1 || input.targetMatchweek > 99) {
    return "Matchweek ปลายทางต้องเป็นจำนวนเต็มระหว่าง 1 ถึง 99";
  }
  if (!input.reason.trim()) return "กรุณาระบุเหตุผลการเลื่อนการแข่งขัน";
  return "";
}

export function mapStandardLeagueRescheduleHistory(value: unknown): StandardLeagueRescheduleHistory | null {
  if (!isRow(value)) return null;
  const id = requiredString(value, "id");
  const matchId = requiredString(value, "match_id");
  const originalMatchweek = requiredInteger(value, "original_matchweek");
  const fromMatchweek = requiredInteger(value, "from_scheduled_matchweek");
  const toMatchweek = requiredInteger(value, "to_scheduled_matchweek");
  const reason = requiredString(value, "reason");
  const changedAt = requiredString(value, "changed_at");
  if (!id || !matchId || !originalMatchweek || !fromMatchweek || !toMatchweek || !reason || !changedAt) return null;
  return {
    changedAt,
    changedBy: nullableString(value, "changed_by"),
    changedByLabel: nullableString(value, "changed_by_label"),
    fromMatchweek,
    id,
    matchId,
    originalMatchweek,
    reason,
    toMatchweek,
  };
}

export function parseStandardLeagueRescheduleRpcResult(value: unknown): ParsedRescheduleRpcResult {
  if (!isRow(value)) return { error: "RPC คืนผลลัพธ์ไม่ถูกต้อง", kind: "error" };
  if (value.success === true) {
    const history = mapStandardLeagueRescheduleHistory(value.history);
    const originalMatchweek = requiredInteger(value, "original_matchweek");
    const previousEffectiveMatchweek = requiredInteger(value, "previous_effective_matchweek");
    const newEffectiveMatchweek = requiredInteger(value, "new_effective_matchweek");
    if (!history || !originalMatchweek || !previousEffectiveMatchweek || !newEffectiveMatchweek) {
      return { error: "RPC คืนข้อมูลการเลื่อนการแข่งขันไม่ครบ", kind: "error" };
    }
    return { history, kind: "success", newEffectiveMatchweek, originalMatchweek, previousEffectiveMatchweek };
  }
  if (value.code === "team_conflict") {
    const conflicts = Array.isArray(value.conflicts)
      ? value.conflicts.flatMap((item) => {
          if (!isRow(item)) return [];
          const matchId = requiredString(item, "match_id");
          return matchId ? [{ awayTeamId: nullableString(item, "away_team_id"), homeTeamId: nullableString(item, "home_team_id"), matchId }] : [];
        })
      : [];
    return { conflicts, kind: "conflict" };
  }
  if (value.code === "no_change") return { error: "Matchweek ปลายทางเป็น Matchweek เดิมของคู่นี้", kind: "error" };
  return { error: "ไม่สามารถเลื่อนการแข่งขันได้", kind: "error" };
}

export function mapStandardLeagueRescheduledMatch(value: unknown): StandardLeagueRescheduledMatch | null {
  if (!isRow(value)) return null;
  const id = requiredString(value, "id");
  const homeTeamId = requiredString(value, "home_team_id");
  const awayTeamId = requiredString(value, "away_team_id");
  const status = requiredString(value, "status");
  if (!id || !homeTeamId || !awayTeamId || !status) return null;
  const matchweek = nullableInteger(value, "matchweek");
  const scheduledMatchweek = nullableInteger(value, "scheduled_matchweek");
  return {
    away_score: nullableInteger(value, "away_score"),
    away_team_id: awayTeamId,
    competition_stage: nullableString(value, "competition_stage"),
    effectiveMatchweek: scheduledMatchweek ?? matchweek,
    fixture_source: nullableString(value, "fixture_source"),
    group_id: nullableString(value, "group_id"),
    home_score: nullableInteger(value, "home_score"),
    home_team_id: homeTeamId,
    id,
    league_fixture_key: nullableString(value, "league_fixture_key"),
    league_fixture_version: nullableInteger(value, "league_fixture_version"),
    league_id: nullableString(value, "league_id"),
    league_leg: nullableInteger(value, "league_leg"),
    match_date: nullableString(value, "match_date"),
    matchweek,
    originalMatchweek: matchweek,
    rescheduleReason: nullableString(value, "reschedule_reason"),
    rescheduledAt: nullableString(value, "rescheduled_at"),
    rescheduledBy: nullableString(value, "rescheduled_by"),
    scheduledMatchweek,
    status,
    venue: nullableString(value, "venue"),
  };
}

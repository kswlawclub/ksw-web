import assert from "node:assert/strict";
import test from "node:test";
import {
  mapStandardLeagueRescheduleHistory,
  mapStandardLeagueRescheduledMatch,
  parseStandardLeagueRescheduleRpcResult,
  validateStandardLeagueRescheduleInput,
} from "./reschedule-action-contract.ts";

test("rejects invalid reschedule input", () => {
  assert.match(validateStandardLeagueRescheduleInput({ acknowledgeConflict: false, competitionId: "competition", matchId: "match", reason: "เหตุผล", targetMatchweek: 1.5 }), /จำนวนเต็ม/);
  assert.match(validateStandardLeagueRescheduleInput({ acknowledgeConflict: false, competitionId: "competition", matchId: "match", reason: "", targetMatchweek: 2 }), /เหตุผล/);
  assert.match(validateStandardLeagueRescheduleInput({ acknowledgeConflict: false, competitionId: "competition", matchId: "match", reason: "เหตุผล", targetMatchweek: 100 }), /1 ถึง 99/);
});

test("maps effective matchweek and reschedule history", () => {
  const match = mapStandardLeagueRescheduledMatch({ away_team_id: "away", home_team_id: "home", id: "match", matchweek: 1, reschedule_reason: "Weather", rescheduled_at: "2026-08-02T00:00:00Z", rescheduled_by: "admin", scheduled_matchweek: 2, status: "scheduled" });
  const history = mapStandardLeagueRescheduleHistory({ changed_at: "2026-08-02T00:00:00Z", changed_by: "admin", changed_by_label: "Administrator session", from_scheduled_matchweek: 1, id: "history", match_id: "match", original_matchweek: 1, reason: "Weather", to_scheduled_matchweek: 2 });
  assert.equal(match?.effectiveMatchweek, 2);
  assert.equal(match?.originalMatchweek, 1);
  assert.equal(history?.toMatchweek, 2);
  assert.equal(history?.changedByLabel, "Administrator session");
});

test("keeps RPC success, conflict, and failure separate", () => {
  const success = parseStandardLeagueRescheduleRpcResult({
    history: { changed_at: "2026-08-02T00:00:00Z", from_scheduled_matchweek: 1, id: "history", match_id: "match", original_matchweek: 1, reason: "Weather", to_scheduled_matchweek: 2 },
    new_effective_matchweek: 2,
    original_matchweek: 1,
    previous_effective_matchweek: 1,
    success: true,
  });
  const conflict = parseStandardLeagueRescheduleRpcResult({ code: "team_conflict", conflicts: [{ away_team_id: "away", home_team_id: "home", match_id: "other" }], success: false });
  const failure = parseStandardLeagueRescheduleRpcResult({ code: "no_change", success: false });
  assert.equal(success.kind, "success");
  assert.equal(conflict.kind, "conflict");
  assert.equal(failure.kind, "error");
});

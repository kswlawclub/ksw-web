export const STANDARD_LEAGUE_TEMPLATE_KEY = "standard_league" as const;

export type LeagueTemplateKey = typeof STANDARD_LEAGUE_TEMPLATE_KEY;
export type LeagueFixtureStatus = "confirmed" | "draft";
export type LeagueMatchweekStatus = "completed" | "confirmed" | "draft" | "unconfigured";
export type LeagueStandingsPolicyKey = "legacy_season6" | "standard_league_v1";
export type LeagueTieBreakSupport = "deferred" | "supported" | "technical_fallback";

export type StandardLeagueConfig = {
  championAt: string | null;
  championConfirmedBy: string | null;
  championConfirmedByLabel: string | null;
  championResolutionReason: string | null;
  championTeamId: string | null;
  competitionId: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  confirmedByLabel: string | null;
  drawPoints: number;
  fixtureStatus: LeagueFixtureStatus;
  fixtureVersion: number;
  legs: 1 | 2;
  lossPoints: number;
  standingsPolicyKey: LeagueStandingsPolicyKey;
  templateKey: LeagueTemplateKey;
  winPoints: number;
};

export type StandardLeagueMatchweek = {
  confirmedAt: string | null;
  confirmedBy: string | null;
  matchweek: number;
  status: LeagueMatchweekStatus;
  updatedAt: string | null;
};

export type StandardLeagueScheduledMatch = {
  effectiveMatchweek: number;
  originalMatchweek: number;
  rescheduleReason: string | null;
  rescheduledAt: string | null;
  rescheduledBy: string | null;
  rescheduledByLabel: string | null;
  scheduledMatchweek: number | null;
};

export type StandardLeagueRescheduleHistory = {
  changedAt: string;
  changedBy: string | null;
  changedByLabel: string | null;
  fromMatchweek: number;
  id: string;
  matchId: string;
  originalMatchweek: number;
  reason: string;
  toMatchweek: number;
};

export type StandardLeagueRescheduledMatch = {
  away_score: number | null;
  away_team_id: string;
  competition_stage: string | null;
  effectiveMatchweek: number | null;
  fixture_source: string | null;
  group_id: string | null;
  home_score: number | null;
  home_team_id: string;
  id: string;
  league_fixture_key: string | null;
  league_fixture_version: number | null;
  league_id: string | null;
  league_leg: number | null;
  match_date: string | null;
  matchweek: number | null;
  originalMatchweek: number | null;
  rescheduleReason: string | null;
  rescheduledAt: string | null;
  rescheduledBy: string | null;
  scheduledMatchweek: number | null;
  status: string;
  venue: string | null;
};

export type StandardLeagueRescheduleConflict = {
  awayTeamId: string | null;
  homeTeamId: string | null;
  matchId: string;
};

export type StandardLeagueRescheduleActionResult =
  | {
      history: StandardLeagueRescheduleHistory;
      newEffectiveMatchweek: number;
      originalMatchweek: number;
      previousEffectiveMatchweek: number;
      sourceMatchweekState: StandardLeagueMatchweek | null;
      success: true;
      targetMatchweekState: StandardLeagueMatchweek | null;
      updatedMatch: StandardLeagueRescheduledMatch;
    }
  | {
      conflict: true;
      conflicts: StandardLeagueRescheduleConflict[];
      error: string;
      success: false;
    }
  | {
      conflict?: false;
      error: string;
      success: false;
    };

export type LeagueEntrant = {
  id: string;
  name: string;
};

export type LeagueFixtureDraft = {
  awayTeamId: string;
  fixtureKey: string;
  homeTeamId: string;
  leg: 1 | 2;
  matchweek: number;
  order: number;
  roundNumber: number;
};

export type LeagueFixtureRound = {
  fixtures: LeagueFixtureDraft[];
  idleTeamId: string | null;
  leg: 1 | 2;
  matchweek: number;
  roundNumber: number;
};

export type LeagueFixturePlan = {
  fixtures: LeagueFixtureDraft[];
  rounds: LeagueFixtureRound[];
  summary: {
    fixtureCount: number;
    idleRoundCount: number;
    roundCount: number;
    roundsPerLeg: number;
    teamCount: number;
  };
};

export type LeagueTieBreakRule = {
  key: "admin_decision" | "fair_play" | "goal_difference" | "goals_for" | "head_to_head" | "points" | "team_name" | "wins";
  label: string;
  support: LeagueTieBreakSupport;
};

export type LeagueStandingsPolicy = {
  key: LeagueStandingsPolicyKey;
  label: string;
  rules: LeagueTieBreakRule[];
  version: number;
};

export type LeagueStandingCandidate = {
  goalDifference: number;
  goalsFor: number;
  points: number;
  teamId: string;
  wins: number;
};

export type LeagueChampionResolution =
  | { reason: string; status: "pending" }
  | { championTeamId: string; status: "champion" }
  | { candidateTeamIds: string[]; reason: string; status: "needs_admin_resolution" }
  | { reason: string; status: "invalid_fixture_set" };

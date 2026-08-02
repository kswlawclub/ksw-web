import { STANDARD_LEAGUE_TEMPLATE_KEY, type LeagueTemplateKey } from "./types";

export type LeagueTemplateDefinition = {
  hasKnockout: false;
  key: LeagueTemplateKey;
  label: string;
  supportedLegs: readonly [1];
  summary: "cumulative_standings";
  title: string;
};

export const standardLeagueTemplate: LeagueTemplateDefinition = {
  hasKnockout: false,
  key: STANDARD_LEAGUE_TEMPLATE_KEY,
  label: "ลีกมาตรฐาน",
  supportedLegs: [1],
  summary: "cumulative_standings",
  title: "Standard League",
};

export const leagueTemplateRegistry = {
  [STANDARD_LEAGUE_TEMPLATE_KEY]: standardLeagueTemplate,
} as const;

export function getLeagueTemplate(key: string | null | undefined) {
  return key === STANDARD_LEAGUE_TEMPLATE_KEY ? standardLeagueTemplate : null;
}

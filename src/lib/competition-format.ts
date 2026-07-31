export const COMPETITION_TYPES = ["league", "cup", "friendly", "tournament"] as const;

export type CompetitionType = (typeof COMPETITION_TYPES)[number];

const competitionTypeSet = new Set<string>(COMPETITION_TYPES);

export function isCompetitionType(value: unknown): value is CompetitionType {
  return typeof value === "string" && competitionTypeSet.has(value);
}

export function normalizeCompetitionType(value: unknown): CompetitionType {
  return isCompetitionType(value) ? value : "tournament";
}

export function getCompetitionTypeLabel(type: CompetitionType) {
  if (type === "league") return "ลีก";
  if (type === "cup") return "ฟุตบอลถ้วย";
  if (type === "friendly") return "อุ่นเครื่อง / รายการพิเศษ";
  return "ทัวร์นาเมนต์ขนาดเล็ก";
}

export function getCompetitionTypeEnglishLabel(type: CompetitionType) {
  if (type === "league") return "League";
  if (type === "cup") return "Cup";
  if (type === "friendly") return "Special Match";
  return "Small Tournament";
}

export function isLeagueCompetition(type: CompetitionType) {
  return type === "league";
}

export function isCupCompetition(type: CompetitionType) {
  return type === "cup";
}

export function isFriendlyCompetition(type: CompetitionType) {
  return type === "friendly";
}

export function isSmallTournamentCompetition(type: CompetitionType) {
  return type === "tournament";
}

export function supportsLeagueStandings(type: CompetitionType) {
  return type === "league";
}

export function supportsCupGroups(type: CompetitionType) {
  return type === "cup";
}

export function supportsKnockout(type: CompetitionType) {
  return type === "cup";
}

export type ChronicleTemplateKey = "standard_league" | "ksw_standard" | "council_two_division" | "generic";

export type ChronicleCouncilChampions = {
  division1: string | null;
  division2: string | null;
};

export type ChronicleViewModel = {
  champion: string | null;
  competitionId: string;
  completedMatchCount: number;
  councilChampions: ChronicleCouncilChampions | null;
  coverImageUrl: string | null;
  displayOrder: number | null;
  excerpt: string | null;
  finalResult: string | null;
  location: string | null;
  matchCount: number;
  name: string;
  runnerUp: string | null;
  seasonLabel: string | null;
  slug: string;
  sortDate: string | null;
  teamCount: number;
  templateKey: ChronicleTemplateKey;
  thirdPlace: string | null;
  typeLabel: string;
  warning: string | null;
  year: number | null;
  yearLabel: string;
};

export type ChronicleGroup = {
  entries: ChronicleViewModel[];
  year: number | null;
  yearLabel: string;
};

export type ChronicleSource = {
  champion?: string | null;
  competitionId: string;
  completedMatchCount: number;
  councilChampions?: ChronicleCouncilChampions | null;
  coverImageUrl?: string | null;
  createdAt?: string | null;
  displayOrder?: number | null;
  endDate?: string | null;
  excerpt?: string | null;
  finalResult?: string | null;
  location?: string | null;
  matchCount: number;
  name: string;
  runnerUp?: string | null;
  seasonLabel?: string | null;
  slug: string;
  startDate?: string | null;
  teamCount: number;
  templateKey: ChronicleTemplateKey;
  thirdPlace?: string | null;
  type: unknown;
};

export function isChronicleCompetition(input: { isPublished: boolean; seasonStatus: string }) {
  return input.isPublished && input.seasonStatus === "completed";
}

function validDate(value: string | null | undefined) {
  if (!value || Number.isNaN(new Date(value).getTime())) return null;
  return value;
}

function thaiYearLabel(year: number | null) {
  if (year === null) return "ไม่ระบุฤดูกาล";
  const formatter = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
    timeZone: "UTC",
    year: "numeric",
  });
  const buddhistYear = formatter.formatToParts(new Date(Date.UTC(year, 0, 1)))
    .find((part) => part.type === "year")?.value ?? String(year + 543);
  return `พ.ศ. ${buddhistYear}`;
}

function typeLabel(value: unknown) {
  if (value === "league") return "ลีก";
  if (value === "cup") return "ฟุตบอลถ้วย";
  if (value === "friendly") return "อุ่นเครื่อง / รายการพิเศษ";
  return "ทัวร์นาเมนต์ขนาดเล็ก";
}

function warningFor(source: ChronicleSource) {
  if (source.templateKey === "standard_league" || source.templateKey === "ksw_standard") {
    return source.champion ? null : "ผลสรุปกำลังจัดเตรียม";
  }

  if (source.templateKey === "council_two_division") {
    return source.councilChampions?.division1 && source.councilChampions.division2
      ? null
      : "ผลสรุปกำลังจัดเตรียม";
  }

  return null;
}

export function chronicleSortDate(source: Pick<ChronicleSource, "createdAt" | "endDate" | "startDate">) {
  return validDate(source.endDate) ?? validDate(source.startDate) ?? validDate(source.createdAt);
}

export function chronicleYear(source: Pick<ChronicleSource, "createdAt" | "endDate" | "startDate">) {
  const sortDate = chronicleSortDate(source);
  return sortDate ? new Date(sortDate).getUTCFullYear() : null;
}

export function mapChronicleViewModel(source: ChronicleSource): ChronicleViewModel {
  const sortDate = chronicleSortDate(source);
  const year = chronicleYear(source);

  return {
    champion: source.champion ?? null,
    competitionId: source.competitionId,
    completedMatchCount: source.completedMatchCount,
    councilChampions: source.councilChampions ?? null,
    coverImageUrl: source.coverImageUrl ?? null,
    displayOrder: source.displayOrder ?? null,
    excerpt: source.excerpt ?? null,
    finalResult: source.finalResult ?? null,
    location: source.location ?? null,
    matchCount: source.matchCount,
    name: source.name,
    runnerUp: source.runnerUp ?? null,
    seasonLabel: source.seasonLabel ?? null,
    slug: source.slug,
    sortDate,
    teamCount: source.teamCount,
    templateKey: source.templateKey,
    thirdPlace: source.thirdPlace ?? null,
    typeLabel: typeLabel(source.type),
    warning: warningFor(source),
    year,
    yearLabel: thaiYearLabel(year),
  };
}

function sortDateValue(value: string | null) {
  return value ? new Date(value).getTime() : Number.NEGATIVE_INFINITY;
}

function displayOrderValue(value: number | null) {
  return value ?? Number.MAX_SAFE_INTEGER;
}

export function groupChronicleEntries(entries: ChronicleViewModel[]): ChronicleGroup[] {
  const byYear = new Map<number | null, ChronicleViewModel[]>();
  entries.forEach((entry) => {
    byYear.set(entry.year, [...(byYear.get(entry.year) ?? []), entry]);
  });

  return Array.from(byYear.entries())
    .sort(([left], [right]) => {
      if (left === null) return 1;
      if (right === null) return -1;
      return right - left;
    })
    .map(([year, groupedEntries]) => ({
      entries: [...groupedEntries].sort((left, right) => {
        const displayOrderDiff = displayOrderValue(left.displayOrder) - displayOrderValue(right.displayOrder);
        if (displayOrderDiff) return displayOrderDiff;

        const dateDiff = sortDateValue(right.sortDate) - sortDateValue(left.sortDate);
        if (dateDiff) return dateDiff;

        return left.name.localeCompare(right.name, "th");
      }),
      year,
      yearLabel: thaiYearLabel(year),
    }));
}

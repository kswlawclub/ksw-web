import { TeamLogo } from "@/components/team-logo";
import { homeText, type HomeMappedMatch, type HomeRow } from "@/lib/home-competition-data";

export function homeNumber(row: HomeRow, key: string) {
  const value = row[key];
  return typeof value === "number" ? value : typeof value === "string" && value ? Number(value) || 0 : 0;
}

export function homeDate(value: unknown, includeTime = true) {
  if (typeof value !== "string" || !value) return "รอกำหนด";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "รอกำหนด";
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    timeZone: "Asia/Bangkok",
  }).format(date);
}

export function matchPhase(match: HomeMappedMatch) {
  const division = homeText(match, ["partition_label"], "");
  const round = homeText(match, ["round_label"], "");
  const matchweek = homeText(match, ["effective_matchweek"], "");
  return [division, round || (matchweek ? `Matchweek ${matchweek}` : "")].filter(Boolean).join(" · ") || "โปรแกรมการแข่งขัน";
}

function initials(name: string, shortName: string) {
  return (shortName || name)
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

export function HomeMatchRow({ match, result = false }: { match: HomeMappedMatch; result?: boolean }) {
  const homeName = homeText(match, ["home_team_name"], "รอทีมเหย้า");
  const awayName = homeText(match, ["away_team_name"], "รอทีมเยือน");
  const homeScore = homeText(match, ["home_score"], "-");
  const awayScore = homeText(match, ["away_score"], "-");
  const penaltyHome = homeText(match, ["penalty_home_score"], "");
  const penaltyAway = homeText(match, ["penalty_away_score"], "");

  return (
    <article className="min-w-0 border-b border-slate-200/80 py-4 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-500">
        <span>{matchPhase(match)}</span>
        <span>{homeDate(match.match_date)}</span>
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <TeamLogo initials={initials(homeName, homeText(match, ["home_team_short_name"], ""))} logoUrl={homeText(match, ["home_team_logo_url"], "")} teamName={homeName} />
          <span className="min-w-0 truncate text-sm font-black text-[#061426]">{homeName}</span>
        </div>
        <div className="min-w-12 rounded-md bg-[#061426] px-2 py-1.5 text-center text-sm font-black text-[#f4d58a]">
          {result ? `${homeScore} - ${awayScore}` : "VS"}
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2 text-right">
          <span className="min-w-0 truncate text-sm font-black text-[#061426]">{awayName}</span>
          <TeamLogo initials={initials(awayName, homeText(match, ["away_team_short_name"], ""))} logoUrl={homeText(match, ["away_team_logo_url"], "")} teamName={awayName} />
        </div>
      </div>
      {result && penaltyHome && penaltyAway ? <p className="mt-2 text-center text-xs font-bold text-[#8a641c]">จุดโทษ {penaltyHome} - {penaltyAway}</p> : null}
      {!result && homeText(match, ["venue"], "") ? <p className="mt-2 text-xs text-slate-500">สนาม {homeText(match, ["venue"], "")}</p> : null}
    </article>
  );
}

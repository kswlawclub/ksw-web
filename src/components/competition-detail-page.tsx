import Image from "next/image";
import Link from "next/link";
import { CompetitionResultsTable } from "@/components/competition-results-table";
import { LeagueTable } from "@/components/league-table";
import { TeamLogo } from "@/components/team-logo";
import {
  calculateCupGroupStandings,
  type CupGroupStanding,
} from "@/lib/cup-group-standings";
import {
  matchTime,
  number,
  Row,
  sortStandings,
  text,
} from "@/lib/competition-data";
import {
  getCompetitionTypeEnglishLabel,
  isCupCompetition,
  isFriendlyCompetition,
  isLeagueCompetition,
  isSmallTournamentCompetition,
  normalizeCompetitionType,
  supportsLeagueStandings,
  type CompetitionType,
} from "@/lib/competition-format";

type CompetitionDetailData = {
  competition: Row;
  cupGroups?: Row[];
  cupGroupTeams?: Row[];
  matches: Row[];
  scheduledMatches: Row[];
  snapshots: Row[];
  sponsors: Row[];
  standings: Row[];
  teams: Row[];
};

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "long",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    hourCycle: "h23",
    minute: "2-digit",
    month: "long",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).format(date);
}

function typeLabel(type: CompetitionType) {
  return getCompetitionTypeEnglishLabel(type);
}

function statusLabel(status: string, type: CompetitionType) {
  if (status === "completed") return type === "league" ? "SEASON COMPLETE" : "COMPLETED";
  if (status === "upcoming") return "UPCOMING";
  return type === "league" ? "ACTIVE SEASON" : "ACTIVE";
}

function teamInitials(row: Row) {
  const shortName = text(row, ["short_name"], "");
  if (shortName) return shortName.slice(0, 3).toUpperCase();

  return text(row, ["team_name", "name", "team"], "FC")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function isKswRow(row: Row | undefined) {
  return row?.is_ksw === true || text(row, ["team_name", "name", "team"]).toLowerCase().includes("ksw");
}

function isKswMatch(match: Row) {
  return (
    text(match, ["home_team_name"], "").toLowerCase().includes("ksw") ||
    text(match, ["away_team_name"], "").toLowerCase().includes("ksw") ||
    text(match, ["home_team_short_name"], "").toLowerCase().includes("ksw") ||
    text(match, ["away_team_short_name"], "").toLowerCase().includes("ksw")
  );
}

function isKswMatchByFlag(match: Row) {
  return match.home_team_is_ksw === true || match.away_team_is_ksw === true;
}

function matchScoreLabel(match: Row) {
  const homeScore = match.home_score;
  const awayScore = match.away_score;
  const hasScore = typeof homeScore === "number" && typeof awayScore === "number";
  return hasScore ? `${homeScore} - ${awayScore}` : "VS";
}

function kswBadgeFromMatch(match: Row) {
  const homeScore = match.home_score;
  const awayScore = match.away_score;
  const hasScore = typeof homeScore === "number" && typeof awayScore === "number";
  const homeIsKsw = match.home_team_is_ksw === true;
  const awayIsKsw = match.away_team_is_ksw === true;

  if (!hasScore || (!homeIsKsw && !awayIsKsw)) return null;
  if (homeScore === awayScore) return { label: "D", className: "border-slate-300 bg-slate-100 text-slate-700" };

  const kswWon = homeIsKsw ? homeScore > awayScore : awayScore > homeScore;
  return kswWon
    ? { label: "W", className: "border-emerald-500/30 bg-emerald-50 text-emerald-700" }
    : { label: "L", className: "border-[#9b1c1f]/30 bg-[#9b1c1f]/10 text-[#9b1c1f]" };
}

function latestStandingSnapshotRows(rows: Row[]) {
  const latestSnapshotId = text(rows[0], ["snapshot_id"], "");
  if (latestSnapshotId) return rows.filter((row) => text(row, ["snapshot_id"], "") === latestSnapshotId);

  const latestCreatedAt = text(rows[0], ["created_at"], "");
  return latestCreatedAt ? rows.filter((row) => text(row, ["created_at"], "") === latestCreatedAt) : [];
}

function dateRange(competition: Row) {
  const startDate = formatDate(text(competition, ["start_date"], ""));
  const endDate = formatDate(text(competition, ["end_date"], ""));

  if (startDate && endDate && startDate !== endDate) return `${startDate} - ${endDate}`;
  return startDate || endDate;
}

function editionLabel(competition: Row) {
  const edition = number(competition, ["edition_number"]);
  if (!edition) return "";

  const suffix =
    edition % 100 >= 11 && edition % 100 <= 13
      ? "th"
      : edition % 10 === 1
        ? "st"
        : edition % 10 === 2
          ? "nd"
          : edition % 10 === 3
            ? "rd"
            : "th";

  return `${edition}${suffix} Edition`;
}

function sponsorTierGroup(sponsor: Row | undefined) {
  const tier = text(sponsor, ["tier"], "").toLowerCase();
  if (tier === "main") return "main";
  if (["official", "partner", "matchday"].includes(tier)) return "official";
  return "supporter";
}

function sponsorSortOrder(sponsor: Row) {
  const value = sponsor.sort_order;
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  return Number.MAX_SAFE_INTEGER;
}

function sponsorTierPriority(sponsor: Row) {
  const group = sponsorTierGroup(sponsor);
  if (group === "main") return 0;
  if (group === "official") return 1;
  return 2;
}

function sortSponsorsForWall(sponsors: Row[]) {
  return sponsors
    .filter((sponsor) => sponsor.is_active !== false)
    .sort((a, b) => {
      const tierDiff = sponsorTierPriority(a) - sponsorTierPriority(b);
      if (tierDiff) return tierDiff;

      const orderDiff = sponsorSortOrder(a) - sponsorSortOrder(b);
      if (orderDiff) return orderDiff;

      return text(a, ["name"], "").localeCompare(text(b, ["name"], ""));
    });
}

function groupSponsorsByTier(sponsors: Row[]) {
  const sortedSponsors = sortSponsorsForWall(sponsors);

  return {
    main: sortedSponsors.filter((sponsor) => sponsorTierGroup(sponsor) === "main"),
    official: sortedSponsors.filter((sponsor) => sponsorTierGroup(sponsor) === "official"),
    supporter: sortedSponsors.filter((sponsor) => sponsorTierGroup(sponsor) === "supporter"),
  };
}

function sponsorSlots(sponsors: Row[], minimumSlots: number) {
  const numericSlots = sponsors
    .map(sponsorSortOrder)
    .filter((slot) => Number.isInteger(slot) && slot > 0 && slot < Number.MAX_SAFE_INTEGER);
  const totalSlots = Math.max(minimumSlots, ...numericSlots, sponsors.length);
  const slots: Array<Row | undefined> = Array.from({ length: totalSlots }, () => undefined);
  const unslottedSponsors: Row[] = [];

  sponsors.forEach((sponsor) => {
    const slotNumber = sponsorSortOrder(sponsor);
    if (Number.isInteger(slotNumber) && slotNumber > 0 && slotNumber < Number.MAX_SAFE_INTEGER) {
      const slotIndex = slotNumber - 1;
      if (!slots[slotIndex]) {
        slots[slotIndex] = sponsor;
        return;
      }
    }
    unslottedSponsors.push(sponsor);
  });

  unslottedSponsors.forEach((sponsor) => {
    const emptySlotIndex = slots.findIndex((slot) => !slot);
    if (emptySlotIndex >= 0) {
      slots[emptySlotIndex] = sponsor;
    } else {
      slots.push(sponsor);
    }
  });

  return slots;
}

function ResultCard({ match }: { match: Row }) {
  const matchDate = match.match_date ?? match.date ?? match.kickoff_at;
  const homeName = text(match, ["home_team_name"], "Home team unavailable");
  const awayName = text(match, ["away_team_name"], "Away team unavailable");
  const homeShortName = text(match, ["home_team_short_name"], teamInitials({ team_name: homeName }));
  const awayShortName = text(match, ["away_team_short_name"], teamInitials({ team_name: awayName }));
  const homeScore = match.home_score;
  const awayScore = match.away_score;
  const hasScore = typeof homeScore === "number" && typeof awayScore === "number";
  const venue = text(match, ["venue"], "");
  const kswResult = isKswMatch(match);

  return (
    <article
      className={`group overflow-hidden rounded-xl border bg-white p-4 shadow-lg transition duration-300 lg:grid lg:grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)] lg:items-center lg:gap-5 lg:p-5 lg:hover:-translate-y-0.5 ${
        kswResult ? "border-[#d8ad45] shadow-[#d8ad45]/20" : "border-white shadow-black/10 hover:shadow-black/20"
      }`}
    >
      <div className="grid min-w-0 justify-items-center gap-2 text-center lg:flex lg:justify-start lg:text-left">
        <TeamLogo className="!size-12 transition-transform duration-300 group-hover:scale-105 lg:!size-16" initials={homeShortName} logoUrl={text(match, ["home_team_logo_url"], "")} teamName={homeName} />
        <p className="min-w-0 text-wrap text-base font-black leading-5 text-[#061426] lg:text-lg lg:leading-6">
          <span className="lg:hidden">{homeShortName}</span>
          <span className="hidden lg:inline">{homeName}</span>
        </p>
      </div>

      <div className="my-4 grid justify-items-center gap-2 lg:my-0">
        <div className="rounded-2xl border border-[#d8ad45]/45 bg-[#061426] px-5 py-3 text-3xl font-black tracking-tight text-white shadow-xl shadow-[#061426]/20 sm:text-4xl">
          {hasScore ? (
            <>
              <span>{homeScore}</span>
              <span className="px-2 text-[#f4d58a]">-</span>
              <span>{awayScore}</span>
            </>
          ) : (
            <span>VS</span>
          )}
        </div>
        <div className="flex flex-wrap justify-center gap-2 text-xs font-black text-[#061426]">
          <span className="rounded-full bg-slate-100 px-3 py-1.5">{formatDateTime(matchDate) || "Date TBC"}</span>
          {venue ? <span className="rounded-full bg-[#fff4dc] px-3 py-1.5">Field {venue}</span> : null}
        </div>
      </div>

      <div className="grid min-w-0 justify-items-center gap-2 text-center lg:flex lg:justify-end lg:text-right">
        <p className="min-w-0 text-wrap text-base font-black leading-5 text-[#061426] lg:order-first lg:text-lg lg:leading-6">
          <span className="lg:hidden">{awayShortName}</span>
          <span className="hidden lg:inline">{awayName}</span>
        </p>
        <TeamLogo className="!size-12 transition-transform duration-300 group-hover:scale-105 lg:!size-16" initials={awayShortName} logoUrl={text(match, ["away_team_logo_url"], "")} teamName={awayName} />
      </div>
    </article>
  );
}

function SponsorsSection({ sponsors }: { sponsors: Row[] }) {
  const sponsorGroups = groupSponsorsByTier(sponsors);
  const sponsorSections = [
    ["Main Partner", sponsorSlots(sponsorGroups.main, 3), "h-24 w-full max-w-48 sm:h-28 sm:max-w-64 lg:h-32 lg:max-w-72"],
    ["Official Partner", sponsorSlots(sponsorGroups.official, 6), "h-16 w-full max-w-32 sm:h-20 sm:max-w-40 lg:h-24 lg:max-w-44"],
    ["Supporter", sponsorSlots(sponsorGroups.supporter, 9), "h-14 w-full max-w-28 sm:h-16 sm:max-w-32 lg:h-[72px] lg:max-w-36"],
  ] as const;

  if (!sponsors.some((sponsor) => sponsor.is_active !== false)) return null;

  return (
    <section id="partners" className="bg-gradient-to-br from-[#071b31] via-[#0b2745] to-[#061426]">
      <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
        <div className="rounded-lg border border-[#d8ad45]/25 bg-white/[0.08] p-6 shadow-2xl shadow-black/30 backdrop-blur sm:p-8">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#d8ad45]">KSW Partnership</p>
          <h2 className="mt-3 text-3xl font-black text-white">Partners & Supporters</h2>
          <div className="mt-8 space-y-8 rounded-[24px] border border-white/60 bg-[#fafafa] p-6 shadow-xl shadow-black/15 sm:p-8">
            {sponsorSections.map(([label, items, logoSlotSize]) => (
              <div key={label}>
                <p className="mb-4 text-center text-[10px] font-black uppercase tracking-[0.24em] text-[#061426]/60">
                  {label}
                </p>
                <div className="mx-auto grid w-full grid-cols-2 place-items-center gap-x-6 gap-y-4 lg:grid-cols-3">
                  {items.map((sponsor, index) => {
                    const sponsorName = text(sponsor, ["name", "sponsor_name"], "YOUR LOGO");
                    const sponsorLogo = text(sponsor, ["logo_url"], "");
                    const sponsorWebsite = text(sponsor, ["website_url"], "");
                    const sponsorMark = (
                      <div className={`flex ${logoSlotSize} items-center justify-center text-center transition-transform duration-300 hover:scale-[1.04]`}>
                        {sponsorLogo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img alt={`${sponsorName} logo`} className="max-h-full max-w-full object-contain" src={sponsorLogo} />
                        ) : (
                          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#061426]/30 sm:text-[10px]">
                            YOUR LOGO
                          </span>
                        )}
                      </div>
                    );

                    return sponsorWebsite ? (
                      <a href={sponsorWebsite} key={`${label}-${index}`} rel="noopener noreferrer" target="_blank">
                        {sponsorMark}
                      </a>
                    ) : (
                      <div key={`${label}-${index}`}>{sponsorMark}</div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroCover({ competition }: { competition: Row }) {
  const coverImageUrl = text(competition, ["cover_image_url"], "");

  return (
    <div className="relative min-h-[260px] overflow-hidden rounded-2xl border border-[#d8ad45]/30 bg-[radial-gradient(circle_at_top,rgba(216,173,69,0.22),transparent_36%),linear-gradient(135deg,#071b31,#061426)] shadow-2xl shadow-black/25">
      {coverImageUrl ? (
        <Image
          alt=""
          className="object-cover opacity-80"
          fill
          sizes="(max-width: 768px) 100vw, 44vw"
          src={coverImageUrl}
          unoptimized
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-[#061426]/90 via-[#061426]/30 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-5">
        <div className="mb-3 h-0.5 w-14 rounded-full bg-[#d8ad45]" />
        <p className="text-sm font-black uppercase tracking-[0.22em] text-[#f4d58a]">KSW Digital Club Chronicle</p>
      </div>
    </div>
  );
}

function TournamentOverview({
  competition,
  competitionType,
  matches,
  scheduledMatches,
  teams,
}: {
  competition: Row;
  competitionType: CompetitionType;
  matches: Row[];
  scheduledMatches: Row[];
  teams: Row[];
}) {
  const description = text(competition, ["description"], "");
  const stats = [
    ["Edition", editionLabel(competition)],
    ["Dates", dateRange(competition)],
    ["Location", text(competition, ["location"], "")],
    ["Teams", teams.length ? String(teams.length) : ""],
    ["Matches", String(matches.length + scheduledMatches.length)],
    ["Status", statusLabel(text(competition, ["season_status"], "active"), competitionType)],
  ].filter(([, value]) => value);

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10" id="overview">
      <div className="rounded-2xl border border-[#d8ad45]/30 bg-white p-5 shadow-xl shadow-slate-900/10 sm:p-6">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-[#9b1c1f]">Competition Overview</p>
        <h2 className="mt-3 text-2xl font-black text-[#061426]">About the Competition</h2>
        {description ? (
          <p className="mt-4 max-w-4xl whitespace-pre-line text-sm leading-7 text-slate-700 sm:text-base">
            {description}
          </p>
        ) : null}
        {stats.length ? (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {stats.map(([label, value]) => (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4" key={label}>
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p>
                <p className="mt-2 text-lg font-black text-[#061426]">{value}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TournamentJourneyCard({ match }: { match: Row }) {
  const matchDate = match.match_date ?? match.date ?? match.kickoff_at;
  const homeName = text(match, ["home_team_name"], "Home team unavailable");
  const awayName = text(match, ["away_team_name"], "Away team unavailable");
  const homeShortName = text(match, ["home_team_short_name"], teamInitials({ team_name: homeName }));
  const awayShortName = text(match, ["away_team_short_name"], teamInitials({ team_name: awayName }));
  const badge = kswBadgeFromMatch(match);
  const venue = text(match, ["venue"], "");
  const status = text(match, ["status"], "");

  return (
    <article className="rounded-xl border border-[#d8ad45]/30 bg-white p-4 shadow-lg shadow-slate-900/5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
          {formatDateTime(matchDate) || "Date TBC"}
        </p>
        <div className="flex items-center gap-2">
          {badge ? (
            <span className={`inline-flex size-7 items-center justify-center rounded-full border text-xs font-black ${badge.className}`}>
              {badge.label}
            </span>
          ) : null}
          {status ? (
            <span className="rounded-full border border-[#d8ad45]/35 bg-[#fff4dc] px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[#061426]">
              {status}
            </span>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_82px_minmax(0,1fr)] items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <TeamLogo className="!size-8" initials={homeShortName} logoUrl={text(match, ["home_team_logo_url"], "")} teamName={homeName} />
          <p className="min-w-0 text-wrap text-sm font-black leading-5 text-[#061426]">{homeName}</p>
        </div>
        <span className="inline-flex items-center justify-center rounded-full border border-[#d8ad45]/40 bg-[#061426] px-3 py-2 text-sm font-black text-white">
          {matchScoreLabel(match)}
        </span>
        <div className="flex min-w-0 items-center justify-end gap-2 text-right">
          <p className="min-w-0 text-wrap text-sm font-black leading-5 text-[#061426]">{awayName}</p>
          <TeamLogo className="!size-8" initials={awayShortName} logoUrl={text(match, ["away_team_logo_url"], "")} teamName={awayName} />
        </div>
      </div>
      {venue ? <p className="mt-3 text-xs font-bold text-slate-500">Field {venue}</p> : null}
    </article>
  );
}

function TournamentJourney({ matches }: { matches: Row[] }) {
  if (!matches.length) return null;

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10" id="ksw-journey">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
        <div className="border-b border-slate-200 px-4 py-5 sm:px-6">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#9b1c1f]">KSW Match Journey</p>
          <h2 className="mt-2 text-2xl font-black">KSW Match Journey</h2>
        </div>
        <div className="grid gap-3 bg-slate-100 px-4 py-5 sm:px-6">
          {matches.map((match) => (
            <TournamentJourneyCard key={text(match, ["id"])} match={match} />
          ))}
        </div>
      </div>
    </section>
  );
}

function UpcomingFixtures({ matches, title = "Upcoming Fixtures" }: { matches: Row[]; title?: string }) {
  if (!matches.length) return null;

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10" id="fixtures">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
        <div className="border-b border-slate-200 px-4 py-5 sm:px-6">
          <h2 className="text-2xl font-black">{title}</h2>
          <p className="mt-1 text-sm font-semibold text-slate-600">
            Scheduled matches for this competition.
          </p>
        </div>
        <div className="grid gap-3 bg-slate-100 px-4 py-5 sm:px-6">
          {matches.map((match) => <ResultCard key={text(match, ["id"])} match={match} />)}
        </div>
      </div>
    </section>
  );
}

function TournamentTeams({ teams }: { teams: Row[] }) {
  if (!teams.length) return null;

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10" id="participating-teams">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10 sm:p-6">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-[#9b1c1f]">Participating Teams</p>
        <h2 className="mt-2 text-2xl font-black">Teams in This Competition</h2>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => {
            const teamName = text(team, ["name"], "Team unavailable");
            const shortName = text(team, ["short_name"], "");
            return (
              <div
                className={`min-w-0 rounded-lg border p-4 shadow-sm ${
                  team.is_ksw === true ? "border-[#d8ad45]/60 bg-[#fff9ea]" : "border-slate-200 bg-slate-50"
                }`}
                key={text(team, ["id"])}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <TeamLogo className="size-10" initials={teamInitials(team)} logoUrl={text(team, ["logo_url"], "")} teamName={teamName} />
                  <div className="min-w-0">
                    <p className="min-w-0 text-wrap text-sm font-black leading-5 text-[#061426]">{teamName}</p>
                    {shortName ? <p className="mt-1 text-xs font-bold text-slate-500">{shortName}</p> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function PublicCupGroupStandings({ standings }: { standings: CupGroupStanding[] }) {
  const visibleStandings = standings.filter((group) => group.team_count > 0);

  if (!visibleStandings.length) {
    return (
      <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10" id="group-standings">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10 sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#9b1c1f]">Group Standings</p>
          <h2 className="mt-2 text-2xl font-black">Group Standings</h2>
          <p className="mt-4 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
            ยังไม่มีทีมในรอบแบ่งกลุ่ม
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10" id="group-standings">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
        <div className="border-b border-slate-200 px-4 py-5 sm:px-6">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#9b1c1f]">Group Standings</p>
          <h2 className="mt-2 text-2xl font-black">Group Standings</h2>
          <p className="mt-1 text-sm font-semibold text-slate-600">
            Tables are calculated from finished group-stage matches only.
          </p>
        </div>
        <div className="grid gap-3 bg-slate-100 px-4 py-5 sm:px-6">
          {visibleStandings.map((group, index) => (
            <details
              className="overflow-hidden rounded-xl border border-slate-200 bg-white"
              key={group.group_id}
              open={index === 0 || !group.is_complete}
            >
              <summary className="cursor-pointer list-none px-4 py-4 hover:bg-[#fffaf0]">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="break-words text-lg font-black text-[#061426]">{group.group_label}</h3>
                    <p className="mt-1 text-xs font-bold text-slate-500">
                      {group.is_complete ? "แข่งครบแล้ว" : "สถานะชั่วคราว"} · {group.finished_matches}/{group.total_required_matches} results
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      <span className="block text-[9px] font-black uppercase tracking-[0.1em] text-slate-500">Teams</span>
                      <span className="font-black">{group.team_count}</span>
                    </span>
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      <span className="block text-[9px] font-black uppercase tracking-[0.1em] text-slate-500">Qualify</span>
                      <span className="font-black">{group.qualifiers_count}</span>
                    </span>
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      <span className="block text-[9px] font-black uppercase tracking-[0.1em] text-slate-500">Played</span>
                      <span className="font-black">{group.finished_matches}</span>
                    </span>
                  </div>
                </div>
              </summary>
              <div className="overflow-x-auto border-t border-slate-100">
                <table className="w-full min-w-[660px] border-separate border-spacing-0 text-left text-xs">
                  <thead className="bg-[#061426] text-white">
                    <tr>
                      {["#", "Team", "P", "W", "D", "L", "GF", "GA", "GD", "Pts", "Status"].map((label) => (
                        <th className="px-3 py-2 font-black" key={label}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => (
                      <tr className={row.qualifies ? "bg-[#fff7e6]" : "bg-white"} key={row.team_id}>
                        <td className="border-b border-slate-100 px-3 py-2 font-black">{row.position}</td>
                        <td className="min-w-48 border-b border-slate-100 px-3 py-2 font-black">
                          <span className="break-words">{row.team_name}</span>
                          {row.tie_unresolved ? (
                            <span className="mt-1 block text-[10px] font-bold text-[#8a6418]">อันดับยังเสมอกัน</span>
                          ) : null}
                        </td>
                        {[row.played, row.won, row.drawn, row.lost, row.goals_for, row.goals_against, row.goal_difference, row.points].map((value, valueIndex) => (
                          <td className="border-b border-slate-100 px-3 py-2 font-bold" key={valueIndex}>{value}</td>
                        ))}
                        <td className="border-b border-slate-100 px-3 py-2">
                          {row.qualifies ? (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">
                              ผ่านเข้ารอบ
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function TournamentLegacy({ competition }: { competition: Row }) {
  const copy =
    text(competition, ["short_description"], "") ||
    text(competition, ["description"], "") ||
    "This competition is preserved as part of the KSW Chronicle.";

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10">
      <div className="rounded-2xl border border-[#d8ad45]/25 bg-[#061426] p-5 text-white shadow-xl shadow-slate-900/20 sm:p-6">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-[#d8ad45]">Competition Legacy</p>
        <h2 className="mt-2 text-2xl font-black">A Chapter in KSW History</h2>
        <p className="mt-4 max-w-3xl whitespace-pre-line text-sm leading-7 text-slate-300">{copy}</p>
      </div>
    </section>
  );
}

export function CompetitionDetailPage({ data }: { data: CompetitionDetailData }) {
  const { competition, cupGroups = [], cupGroupTeams = [], matches, scheduledMatches, snapshots, sponsors, standings, teams } = data;
  const competitionType = normalizeCompetitionType(text(competition, ["competition_type"], ""));
  const seasonStatus = text(competition, ["season_status"], "active").toLowerCase();
  const isLeague = isLeagueCompetition(competitionType);
  const isFriendly = isFriendlyCompetition(competitionType);
  const isCup = isCupCompetition(competitionType);
  const isSmallTournament = isSmallTournamentCompetition(competitionType);
  const isTournamentArchive = isCup || isSmallTournament;
  const showLeagueStandings = supportsLeagueStandings(competitionType);
  const sortedStandings = sortStandings(standings);
  const kswIndex = sortedStandings.findIndex(isKswRow);
  const kswStanding = kswIndex >= 0 ? sortedStandings[kswIndex] : undefined;
  const kswMatchesNewest = matches.filter(isKswMatch).sort((a, b) => matchTime(b) - matchTime(a));
  const kswMatchesOldest = [...kswMatchesNewest].reverse();
  const allFixtures = [...scheduledMatches, ...matches].sort((a, b) => matchTime(a) - matchTime(b));
  const kswTournamentJourney = allFixtures.filter(isKswMatchByFlag).sort((a, b) => matchTime(a) - matchTime(b));
  const cupGroupStandings = isCup
    ? calculateCupGroupStandings({
        groups: cupGroups,
        matches: [...matches, ...scheduledMatches],
        teams: cupGroupTeams,
      })
    : [];
  const summaryStats = kswStanding
    ? [
        [seasonStatus === "completed" ? "Final Position" : "Current Position", `${kswIndex + 1} / ${sortedStandings.length}`],
        ["Played", number(kswStanding, ["played", "p"])],
        ["Won", number(kswStanding, ["won", "w"])],
        ["Drawn", number(kswStanding, ["drawn", "draws", "d"])],
        ["Lost", number(kswStanding, ["lost", "l"])],
        ["Points", number(kswStanding, ["points", "pts"])],
      ]
    : [];
  const metadata = [
    text(competition, ["season"], ""),
    text(competition, ["edition_number"], "") ? `Edition ${text(competition, ["edition_number"], "")}` : "",
    dateRange(competition),
    text(competition, ["location"], ""),
  ].filter(Boolean);

  if (isTournamentArchive) {
    const tournamentMetadata = [
      editionLabel(competition),
      text(competition, ["season"], ""),
      dateRange(competition),
      text(competition, ["location"], ""),
    ].filter(Boolean);
    const tournamentCtas = [
      ["Overview", "#overview", true],
      ["Fixtures", "#fixtures", scheduledMatches.length > 0],
      ["KSW Journey", "#ksw-journey", kswTournamentJourney.length > 0],
      ["Group Standings", "#group-standings", isCup && cupGroupStandings.length > 0],
      [isCup ? "Cup Results" : "Tournament Results", "#tournament-results", matches.length > 0],
      ["Participating Teams", "#participating-teams", teams.length > 0],
      ["Partners", "#partners", sponsors.some((sponsor) => sponsor.is_active !== false)],
    ] as const;

    return (
      <main className="min-h-screen overflow-x-hidden bg-slate-100 text-[#061426]">
        <section className="bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.2),transparent_34%),linear-gradient(135deg,#061426,#091f39)] text-white">
          <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)] lg:px-10">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ad45]">
                {typeLabel(competitionType)}
              </p>
              <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight sm:text-5xl">
                {text(competition, ["name"], "Competition")}
              </h1>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-[#d8ad45]/35 bg-[#d8ad45]/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-[#f4d58a]">
                  {statusLabel(seasonStatus, competitionType)}
                </span>
                {tournamentMetadata.map((item) => (
                  <span className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-bold text-slate-200" key={item}>
                    {item}
                  </span>
                ))}
              </div>
              {text(competition, ["short_description"], "") ? (
                <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
                  {text(competition, ["short_description"], "")}
                </p>
              ) : null}
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                {tournamentCtas
                  .filter(([, , visible]) => visible)
                  .map(([label, href]) => (
                    <Link
                      className={`inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-black transition-colors ${
                        href === "#overview"
                          ? "bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] text-[#061426] shadow-lg shadow-[#d8ad45]/15 hover:scale-[1.02]"
                          : "border border-[#d8ad45]/50 bg-white/[0.03] text-[#f4d58a] backdrop-blur hover:bg-[#d8ad45]/10"
                      }`}
                      href={href}
                      key={href}
                    >
                      {label}
                    </Link>
                  ))}
              </div>
            </div>
            <HeroCover competition={competition} />
          </div>
        </section>

        <TournamentOverview
          competition={competition}
          competitionType={competitionType}
          matches={matches}
          scheduledMatches={scheduledMatches}
          teams={teams}
        />
        <UpcomingFixtures matches={scheduledMatches} />
        <TournamentJourney matches={kswTournamentJourney} />
        {isCup ? <PublicCupGroupStandings standings={cupGroupStandings} /> : null}
        {matches.length ? (
          <CompetitionResultsTable
            isLeague={false}
            matches={matches}
            sectionId="tournament-results"
            subtitle="Complete results from every match in this competition."
            title={isCup ? "Cup Results" : "Tournament Results"}
          />
        ) : null}
        <TournamentTeams teams={teams} />
        {seasonStatus === "completed" ? <TournamentLegacy competition={competition} /> : null}
        <SponsorsSection sponsors={sponsors} />
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-slate-100 text-[#061426]">
      <section className="bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.2),transparent_34%),linear-gradient(135deg,#061426,#091f39)] text-white">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)] lg:px-10">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ad45]">
              {typeLabel(competitionType)}
            </p>
            <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight sm:text-5xl">
              {text(competition, ["name"], "Competition")}
            </h1>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-[#d8ad45]/35 bg-[#d8ad45]/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-[#f4d58a]">
                {statusLabel(seasonStatus, competitionType)}
              </span>
              {metadata.map((item) => (
                <span className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-bold text-slate-200" key={item}>
                  {item}
                </span>
              ))}
            </div>
            {text(competition, ["short_description"], "") ? (
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
                {text(competition, ["short_description"], "")}
              </p>
            ) : null}
            {text(competition, ["description"], "") ? (
              <p className="mt-4 max-w-3xl whitespace-pre-line text-sm leading-7 text-slate-300">
                {text(competition, ["description"], "")}
              </p>
            ) : null}
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {showLeagueStandings && kswStanding ? (
                <Link className="inline-flex items-center justify-center rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/15 transition-transform hover:scale-[1.02]" href="#season-summary">
                  Season Summary
                </Link>
              ) : null}
              {showLeagueStandings && sortedStandings.length ? (
                <Link className="inline-flex items-center justify-center rounded-md border border-[#d8ad45]/50 bg-white/[0.03] px-5 py-3 text-sm font-black text-[#f4d58a] backdrop-blur transition-colors hover:bg-[#d8ad45]/10" href="#table">
                  League Table
                </Link>
              ) : null}
              {teams.length ? (
                <Link className="inline-flex items-center justify-center rounded-md border border-[#d8ad45]/50 bg-white/[0.03] px-5 py-3 text-sm font-black text-[#f4d58a] backdrop-blur transition-colors hover:bg-[#d8ad45]/10" href="#participating-teams">
                  Participating Teams
                </Link>
              ) : null}
            </div>
          </div>
          <HeroCover competition={competition} />
        </div>
      </section>

      {showLeagueStandings && kswStanding ? (
        <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10" id="season-summary">
          <div className="rounded-2xl border border-[#d8ad45]/30 bg-white p-5 shadow-xl shadow-slate-900/10 sm:p-6">
            <h2 className="text-2xl font-black">KSW Season Summary</h2>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {summaryStats.map(([label, value]) => (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center" key={label}>
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p>
                  <p className="mt-2 text-2xl font-black text-[#061426]">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {kswMatchesNewest.length ? (
        <section className={`mx-auto w-full max-w-7xl px-4 ${showLeagueStandings && kswStanding ? "pb-10" : "py-10"} sm:px-6 lg:px-10`} id="ksw-results">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
            <div className="border-b border-slate-200 px-4 py-5 sm:px-6">
              <h2 className="text-2xl font-black">KSW Match Results</h2>
              <p className="mt-1 text-sm font-semibold text-slate-600">KSW results from this competition.</p>
            </div>
            <div className="grid gap-3 bg-slate-100 px-4 py-5 sm:px-6">
              {kswMatchesOldest.map((match) => <ResultCard key={text(match, ["id"])} match={match} />)}
            </div>
          </div>
        </section>
      ) : null}

      {showLeagueStandings && sortedStandings.length ? (
        <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10" id="table">
          <LeagueTable
            competitionName={text(competition, ["name"], "Competition")}
            finishedMatches={matches}
            previousSnapshot={latestStandingSnapshotRows(snapshots)}
            seasonCompleted={seasonStatus === "completed"}
            seasonName={text(competition, ["season"], "")}
            sourceLabel={text(competition, ["name"], "this competition")}
            standings={standings}
          />
        </section>
      ) : null}

      {isFriendly && allFixtures.length ? (
        <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10" id="match">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
            <div className="border-b border-slate-200 px-4 py-5 sm:px-6">
              <h2 className="text-2xl font-black">Match</h2>
            </div>
            <div className="grid gap-3 bg-slate-100 px-4 py-5 sm:px-6">
              {allFixtures.map((match) => <ResultCard key={text(match, ["id"])} match={match} />)}
            </div>
          </div>
        </section>
      ) : null}

      {!isFriendly && matches.length ? (
        <CompetitionResultsTable isLeague={isLeague} matches={matches} />
      ) : null}

      {teams.length ? (
        <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10" id="participating-teams">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10 sm:p-6">
            <h2 className="text-2xl font-black">Participating Teams</h2>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {teams.map((team) => (
                <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm" key={text(team, ["id"])}>
                  <div className="flex min-w-0 items-center gap-3">
                    <TeamLogo className="size-8" initials={teamInitials(team)} logoUrl={text(team, ["logo_url"], "")} teamName={text(team, ["name"])} />
                    <p className="min-w-0 text-wrap text-sm font-black leading-5 text-[#061426]">{text(team, ["name"])}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <SponsorsSection sponsors={sponsors} />
    </main>
  );
}

import Link from "next/link";
import { AnalyticsPageView } from "@/components/analytics-page-view";
import { AnalyticsSponsorLink } from "@/components/analytics-sponsor-link";
import { LiveCountdown } from "@/components/live-countdown";
import { TeamLogo } from "@/components/team-logo";
import {
  homeKswOutcome,
  loadHomeCompetitionData,
  type HomeRow,
} from "@/lib/home-competition-data";
import {
  getCompetitionTypeEnglishLabel,
  isCupCompetition,
  isLeagueCompetition as isLeagueCompetitionType,
  normalizeCompetitionType,
  type CompetitionType,
} from "@/lib/competition-format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = HomeRow;

function text(row: Row | undefined, keys: string[], fallback = "") {
  if (!row) {
    return fallback;
  }

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number") {
      return String(value);
    }
  }

  return fallback;
}

function number(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }

  return 0;
}

function formatMatchTime(value: unknown) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function formatMatchDateLong(value: unknown) {
  if (typeof value !== "string" || !value) {
    return "Date unavailable";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function bangkokDateKey(value: unknown) {
  if (typeof value !== "string" || !value) {
    return "date-unavailable";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function countdownText(value: unknown, now = new Date()) {
  if (typeof value !== "string" || !value) {
    return "TBC";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "TBC";
  }

  const diff = date.getTime() - now.getTime();
  if (diff <= 0) {
    return "Kickoff now";
  }

  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function fixtureStatusLabel(match: Row, matchDate: unknown, now = new Date()) {
  const status = text(match, ["status"], "").toLowerCase();
  if (status === "live") {
    return "LIVE";
  }

  if (bangkokDateKey(matchDate) === bangkokDateKey(now.toISOString())) {
    return "TODAY";
  }

  return "UPCOMING";
}

function fixtureDateValue(match: Row) {
  return match.match_date ?? match.date ?? match.kickoff_at;
}

function matchCompetitionContext(match: Row) {
  const competitionName = text(match, ["competition_name"], "การแข่งขัน");
  const roundLabel = text(match, ["round_label"], "");
  const matchweek = text(match, ["effective_matchweek"], "");
  const partition = text(match, ["partition_label"], "");
  const phase = [partition, roundLabel || (matchweek ? `Matchweek ${matchweek}` : "")].filter(Boolean).join(" · ");
  return phase ? `${competitionName} · ${phase}` : competitionName;
}

function formatVenue(value: string) {
  if (!value) {
    return "";
  }

  return value.trim().startsWith("สนาม") ? value.trim() : `สนาม ${value.trim()}`;
}

function FixtureMetaBadge({
  icon,
  label,
  tone,
}: {
  icon: string;
  label: string;
  tone: "navy" | "gold";
}) {
  const toneClass =
    tone === "gold"
      ? "border border-[#d8ad45]/45 bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] text-[#061426] shadow-lg shadow-[#d8ad45]/15"
      : "bg-[#061426] text-white";

  return (
    <span className={`fixtureMetaBadge ${toneClass}`}>
      <span aria-hidden="true" className="fixtureMetaBadge__icon">
        {icon}
      </span>
      {label}
    </span>
  );
}

function FixtureMetaBadgePair({ matchTime, venue }: { matchTime: string; venue: string }) {
  return (
    <div className="grid justify-items-center gap-6 lg:justify-items-start lg:gap-2 lg:text-left">
      <FixtureMetaBadge icon="🕒" label={matchTime || "TBC"} tone="navy" />
      {venue ? <FixtureMetaBadge icon="📍" label={formatVenue(venue)} tone="gold" /> : null}
    </div>
  );
}

function isString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function competitionTypeLabel(type: CompetitionType) {
  return getCompetitionTypeEnglishLabel(type);
}

function competitionStatusLabel(status: string) {
  if (status === "completed") return "Completed";
  if (status === "upcoming") return "Upcoming";
  return "Active";
}

function startsInLabel(days: number | undefined) {
  if (typeof days !== "number") return "Date TBC";
  if (days <= 0) return "Starts today";
  if (days === 1) return "Starts in 1 day";
  return `Starts in ${days} days`;
}

function teamInitials(row: Row) {
  const shortName = text(row, ["short_name"], "");
  if (shortName) {
    return shortName.slice(0, 3).toUpperCase();
  }

  return text(row, ["team_name", "name", "team"], "FC")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function sponsorTierGroup(sponsor: Row | undefined) {
  const tier = text(sponsor, ["tier"], "").toLowerCase();

  if (tier === "main") {
    return "main";
  }

  if (["official", "partner", "matchday"].includes(tier)) {
    return "official";
  }

  return "supporter";
}

function sponsorTierPriority(sponsor: Row) {
  const group = sponsorTierGroup(sponsor);

  if (group === "main") return 0;
  if (group === "official") return 1;
  return 2;
}

function sponsorSortOrder(sponsor: Row) {
  const value = sponsor.sort_order;

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
    return Number(value);
  }

  return Number.MAX_SAFE_INTEGER;
}

function isActiveSponsor(sponsor: Row) {
  return sponsor.is_active !== false;
}

function sortSponsorsForWall(sponsors: Row[]) {
  return sponsors
    .filter(isActiveSponsor)
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

export default async function Home() {
  const homeCompetitionData = await loadHomeCompetitionData();
  const {
    allMappedMatches,
    allParticipants,
    allRecentResults,
    allScheduledMatches,
    configured,
    currentCompetition,
    errors: homeDataErrors,
    isNextCompetitionComingSoon,
    isPrimaryCompetitionComingSoon,
    kswParticipants: teams,
    latestChampions,
    nextCompetition,
    nextCompetitionStartsInDays,
    nextKswFixture,
    primaryCompetitionStartsInDays,
    sponsors,
    standings,
    summary: competitionSummary,
  } = homeCompetitionData;
  const club = teams[0];
  const logoUrl = isString(club?.logo_url) ? String(club?.logo_url) : "/team-logos/ksw-lc.png";
  const sponsorGroups = groupSponsorsByTier(sponsors);
  const sponsorSections = [
    {
      key: "main",
      label: "Main Partner",
      items: sponsorSlots(sponsorGroups.main, 3),
      logoSlotSize: "h-24 w-full max-w-48 sm:h-28 sm:max-w-64 lg:h-32 lg:max-w-72",
      wrapperClass: "mx-auto grid w-full grid-cols-2 place-items-center gap-x-6 gap-y-4 lg:grid-cols-3",
    },
    {
      key: "official",
      label: "Official Partner",
      items: sponsorSlots(sponsorGroups.official, 6),
      logoSlotSize: "h-16 w-full max-w-32 sm:h-20 sm:max-w-40 lg:h-24 lg:max-w-44",
      wrapperClass: "mx-auto grid w-full grid-cols-2 place-items-center gap-x-6 gap-y-4 lg:grid-cols-3",
    },
    {
      key: "supporter",
      label: "Supporter",
      items: sponsorSlots(sponsorGroups.supporter, 9),
      logoSlotSize: "h-14 w-full max-w-28 sm:h-16 sm:max-w-32 lg:h-[72px] lg:max-w-36",
      wrapperClass: "mx-auto grid w-full grid-cols-2 place-items-center gap-x-5 gap-y-4 lg:grid-cols-3",
    },
  ];
  const now = new Date();
  const competitionStatus = text(currentCompetition, ["season_status"], "active").toLowerCase();
  const competitionType = normalizeCompetitionType(text(currentCompetition, ["competition_type"], ""));
  const competitionName = text(currentCompetition, ["name"], "KSW Chronicle");
  const competitionSlug = text(currentCompetition, ["slug"], "");
  const competitionHref = competitionSlug ? `/competitions/${competitionSlug}` : "/competitions";
  const competitionAnchorHref = competitionSlug ? competitionHref : "/competitions";
  const hasCompetitionLink = Boolean(competitionSlug);
  const nextCompetitionName = text(nextCompetition, ["name"], "");
  const nextCompetitionSlug = text(nextCompetition, ["slug"], "");
  const nextCompetitionHref = nextCompetitionSlug ? `/competitions/${nextCompetitionSlug}` : "/competitions";
  const shouldShowNextCompetitionCard = isNextCompetitionComingSoon && Boolean(nextCompetition);
  const isCompetitionCompleted = competitionStatus === "completed";
  const isLeagueCompetition = isLeagueCompetitionType(competitionType);
  const isCupCompetitionSummary = isCupCompetition(competitionType);
  const currentCompetitionId = text(currentCompetition, ["id"], "");
  const featuredMatches = allMappedMatches.filter((match) => text(match, ["competition_id"], "") === currentCompetitionId);
  const featuredPhaseMatch = featuredMatches.find((match) => !["finished", "completed"].includes(text(match, ["status"], "").toLowerCase())) ?? featuredMatches[0];
  const featuredPhase = featuredPhaseMatch ? matchCompetitionContext(featuredPhaseMatch).replace(`${competitionName} · `, "") : "กำลังเตรียมโปรแกรม";
  const featuredCouncil = new Set(featuredMatches.map((match) => text(match, ["partition_label"], "")).filter(Boolean)).size === 2;
  const sortedScheduledMatches = allScheduledMatches;
  const nearestFixture = sortedScheduledMatches[0];
  const nearestFixtureDate = nearestFixture ? fixtureDateValue(nearestFixture) : "";
  const featuredChampions = latestChampions.filter((champion) => champion.competitionId === currentCompetitionId);
  const featuredStatus = isCompetitionCompleted && featuredChampions.length
    ? featuredChampions.map((champion) => `${champion.label}: ${champion.teamName}`).join(" · ")
    : featuredCouncil
      ? "2 Divisions"
      : featuredPhase;
  const fixtureGroups = sortedScheduledMatches.reduce<Array<{ key: string; date: unknown; matches: Row[] }>>(
    (groups, match) => {
      const matchDate = fixtureDateValue(match);
      const key = bangkokDateKey(matchDate);
      const existingGroup = groups.find((group) => group.key === key);

      if (existingGroup) {
        existingGroup.matches.push(match);
      } else {
        groups.push({ key, date: matchDate, matches: [match] });
      }

      return groups;
    },
    [],
  );
  const sortedStandings = [...standings].sort((a, b) => {
    const pointsDiff = number(b, ["points", "pts"]) - number(a, ["points", "pts"]);
    if (pointsDiff) return pointsDiff;

    const goalDiff = number(b, ["goal_difference", "gd"]) - number(a, ["goal_difference", "gd"]);
    if (goalDiff) return goalDiff;

    const goalsForDiff = number(b, ["goals_for", "gf"]) - number(a, ["goals_for", "gf"]);
    if (goalsForDiff) return goalsForDiff;

    return text(a, ["team_name", "name", "team"]).localeCompare(
      text(b, ["team_name", "name", "team"]),
    );
  });
  const kswStandingIndex = sortedStandings.findIndex((row) => row.is_ksw === true);
  const kswStanding = kswStandingIndex >= 0 ? sortedStandings[kswStandingIndex] : undefined;
  const finalPositionText = kswStanding ? `${kswStandingIndex + 1} / ${sortedStandings.length}` : "";
  const finalKswStats = kswStanding
    ? [
        ["Played", number(kswStanding, ["played", "p"])],
        ["Won", number(kswStanding, ["won", "w"])],
        ["Drawn", number(kswStanding, ["drawn", "draws", "d"])],
        ["Lost", number(kswStanding, ["lost", "l"])],
        ["Points", number(kswStanding, ["points", "pts"])],
      ]
    : [];
  const competitionSummaryStats = isLeagueCompetition
    ? finalKswStats
    : [
        ["KSW Matches", competitionSummary.totalKswMatches],
        ["Finished", competitionSummary.finishedCount],
        ["Upcoming", competitionSummary.upcomingCount],
        ["Won", competitionSummary.wonCount],
        ["Drawn", competitionSummary.drawnCount],
        ["Lost", competitionSummary.lostCount],
      ];
  const summaryTitle = isLeagueCompetition
    ? "KSW Season Summary"
    : isCupCompetitionSummary
      ? "KSW Cup Summary"
      : "KSW Match Summary";
  const summarySubtitle = isLeagueCompetition
    ? kswStanding
      ? `${competitionName} ${isCompetitionCompleted ? "has concluded." : "league numbers are tracking live."}`
      : `KSW standings are not available for ${competitionName}.`
    : `KSW match numbers from ${competitionName}.`;
  const resultsCtaLabel = isLeagueCompetition
    ? "View All Season Results"
    : isCupCompetitionSummary
      ? "View Cup Results"
      : "View Match Archive";
  const heroPrimaryHref = !isCompetitionCompleted && nextKswFixture ? "/#next-fixtures" : competitionAnchorHref;
  const heroPrimaryLabel = !isCompetitionCompleted && nextKswFixture
    ? "View Next Fixtures"
    : hasCompetitionLink
      ? "View Competition"
      : "Open KSW Chronicle";
  const resultGroups = allRecentResults.reduce<Array<{ key: string; date: unknown; matches: Row[] }>>(
    (groups, match) => {
      const matchDate = match.match_date ?? match.date ?? match.kickoff_at;
      const key = bangkokDateKey(matchDate);
      const existingGroup = groups.find((group) => group.key === key);

      if (existingGroup) {
        existingGroup.matches.push(match);
      } else {
        groups.push({ key, date: matchDate, matches: [match] });
      }

      return groups;
    },
    [],
  );

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#061426] text-slate-100">
      <AnalyticsPageView />
      <style>
        {`
          @keyframes kswFloat {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
          }
          @keyframes kswLivePulse {
            0%, 100% { opacity: 0.72; transform: scale(0.92); box-shadow: 0 0 0 0 rgba(244, 213, 138, 0.28); }
            50% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 6px rgba(244, 213, 138, 0); }
          }
          .ksw-float-logo {
            animation: kswFloat 7s ease-in-out infinite;
          }
          .ksw-live-dot {
            animation: kswLivePulse 2.4s ease-in-out infinite;
          }
        `}
      </style>
      <section className="relative overflow-hidden border-b border-[#d8ad45]/30">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.2),transparent_34%),linear-gradient(135deg,rgba(6,20,38,0.96),rgba(9,31,57,0.88))]" />
        <div className="relative mx-auto grid min-h-[540px] w-full max-w-7xl items-center gap-8 px-4 py-10 sm:px-6 sm:py-14 md:grid-cols-[1.12fr_0.88fr] lg:px-10">
          <div className="min-w-0">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.22em] text-[#d8ad45] sm:text-sm sm:tracking-[0.28em]">
              KHLONG SAM WA LAWYERS CLUB
            </p>
            <h1 className="max-w-4xl text-4xl font-black leading-[1.03] tracking-tight text-white sm:text-5xl md:text-7xl">
              KSW L.C.
            </h1>
            <p className="mt-4 max-w-2xl text-lg font-black uppercase leading-7 tracking-wide text-[#f4d58a] sm:text-2xl">
              WHERE LAWYERS PLAY BEYOND THE COURTROOM
            </p>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:mt-6 sm:text-lg sm:leading-8">
              ชุมชนฟุตบอลนักกฎหมายที่รวมการแข่งขัน มิตรภาพ และเครือข่ายวิชาชีพไว้ในสนามเดียวกัน
            </p>
            <div className="mt-5 inline-flex max-w-full items-center rounded-full border border-[#d8ad45]/35 bg-[#d8ad45]/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-[#f4d58a] shadow-lg shadow-[#d8ad45]/10 sm:text-xs">
              {competitionTypeLabel(competitionType)} • {competitionStatusLabel(competitionStatus)}
              {isPrimaryCompetitionComingSoon ? " • COMING SOON" : ""}
            </div>
            {isPrimaryCompetitionComingSoon ? (
              <p className="mt-2 text-xs font-black uppercase tracking-[0.16em] text-slate-300">
                {startsInLabel(primaryCompetitionStartsInDays)}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-bold text-slate-300">
              <span className="min-w-0">{competitionName}</span>
              {hasCompetitionLink ? (
                <Link className="text-[#f4d58a] underline-offset-4 hover:underline" href={competitionHref}>
                  View Competition
                </Link>
              ) : null}
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-300">
              {allParticipants.length} ทีม · {featuredCouncil ? "2 Divisions" : featuredPhase}
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                className="inline-flex items-center justify-center rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/15 transition-transform hover:scale-[1.02]"
                href={heroPrimaryHref}
              >
                {heroPrimaryLabel}
              </Link>
              <Link
                className="inline-flex items-center justify-center rounded-md border border-[#d8ad45]/50 bg-white/[0.03] px-5 py-3 text-sm font-black text-[#f4d58a] backdrop-blur transition-colors hover:bg-[#d8ad45]/10"
                href="/partners"
              >
                Partner With KSW
              </Link>
            </div>
            {!configured ? (
              <p className="mt-6 inline-flex max-w-full rounded-md border border-[#d8ad45]/50 bg-[#d8ad45]/10 px-4 py-3 text-sm text-[#f4d58a] sm:mt-8">
                Live competition data could not be fully loaded
                {homeDataErrors.length
                  ? ` (${homeDataErrors.map((error) => error.source).join(", ")})`
                  : ""}
                .
              </p>
            ) : null}
          </div>

          <div className="ksw-float-logo relative mx-auto flex w-full max-w-[17rem] min-w-0 items-center justify-center sm:max-w-xs md:max-w-sm">
              <div className="absolute inset-0 -z-10 rounded-full bg-[#d8ad45]/20 blur-3xl" />
              <div className="absolute inset-x-6 inset-y-10 -z-10 rounded-full bg-[#f4d58a]/10 blur-2xl" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="KSW L.C. logo"
                className="max-h-[305px] w-full object-contain drop-shadow-[0_22px_48px_rgba(216,173,69,0.28)]"
                src={logoUrl}
              />
          </div>
        </div>
      </section>

      {currentCompetition ? (
        <section className="bg-slate-100">
          <div className="mx-auto w-full max-w-7xl px-4 pt-8 sm:px-6 lg:px-10">
            <div className="overflow-hidden rounded-xl border border-[#d8ad45]/40 bg-white shadow-xl shadow-slate-900/10">
              <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#061426] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#f4d58a]">Featured Competition</span>
                    <span className="rounded-full border border-[#d8ad45]/45 bg-[#fff8e3] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#061426]">
                      {competitionStatusLabel(competitionStatus)}
                    </span>
                    {featuredCouncil ? <span className="rounded-full border border-emerald-800/20 bg-emerald-50 px-3 py-1 text-[10px] font-black text-emerald-900">2 Divisions{isCompetitionCompleted && featuredChampions.length === 2 ? " · 2 Champions" : ""}</span> : null}
                  </div>
                  <h2 className="mt-3 break-words text-2xl font-black text-[#061426] sm:text-3xl">{competitionName}</h2>
                  <p className="mt-2 text-sm font-bold text-slate-600">{competitionTypeLabel(competitionType)} · {allParticipants.length} ทีม · {featuredStatus}</p>
                </div>
                <Link className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#061426] px-5 py-3 text-sm font-black text-[#f4d58a] shadow-lg shadow-slate-900/10 transition-colors hover:bg-[#0b2745]" href={competitionHref}>
                  ดูรายการแข่งขัน
                </Link>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="relative overflow-hidden border-b border-slate-200 bg-[#f6f2ea] shadow-inner shadow-slate-900/5">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d8ad45]/55 to-transparent" />
        <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
        <div className="grid gap-8 rounded-lg border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-900/10 sm:p-7 md:grid-cols-[1.18fr_0.82fr]">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-[#9b1c1f]">
              ABOUT KSW
            </p>
            <h2 className="mt-3 max-w-5xl text-2xl font-black leading-snug text-[#061426] sm:text-3xl lg:text-4xl lg:whitespace-nowrap">
              ชมรมทนายความคลองสามวา
            </h2>
            <p className="mt-5 max-w-3xl text-base leading-8 text-slate-700">
              KSW L.C. คือพื้นที่ของนักกฎหมายที่รักฟุตบอล ใช้กีฬาเป็นสะพานเชื่อมมิตรภาพ
              เครือข่ายวิชาชีพ กิจกรรมเพื่อสังคม และการแข่งขันในรายการของวงการทนายความ
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-1">
            {[
              ["2019", "ก่อตั้งชมรม"],
              ["50+", "สมาชิกในเครือข่าย"],
              ["Football & Network", "กิจกรรมฟุตบอลและเครือข่ายวิชาชีพ"],
            ].map(([value, label]) => (
              <div
                key={label}
                className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-lg shadow-slate-900/5"
              >
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#d8ad45]">
                  KSW
                </p>
                <p
                  className={`mt-2 font-black text-[#061426] ${
                    value === "Football & Network" ? "text-xl sm:text-2xl" : "text-2xl"
                  }`}
                >
                  {value}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-600">{label}</p>
              </div>
            ))}
          </div>
        </div>
        </div>
      </section>

      <section id="gallery" className="bg-gradient-to-br from-[#071b31] via-[#0b2745] to-[#061426]">
        <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
          <div className="mb-7 max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-[#d8ad45]">
              KSW HIGHLIGHTS
            </p>
            <h2 className="mt-3 text-3xl font-black text-white sm:text-4xl">
              Life at KSW
            </h2>
            <p className="mt-3 text-base leading-7 text-slate-300">
              ภาพบรรยากาศการแข่งขัน มิตรภาพ และชีวิตของชมรมฟุตบอลนักกฎหมายคลองสามวา
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.35fr_0.85fr]">
            <article className="group relative min-h-[360px] overflow-hidden rounded-lg border border-[#d8ad45]/25 shadow-2xl shadow-black/30">
              <img
                alt="KSW matchday action"
                className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
                src="/images/ksw-highlights/highlight-action.jpg"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#061426]/92 via-[#061426]/25 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
                <div className="mb-4 h-0.5 w-14 rounded-full bg-[#d8ad45]" />
                <h3 className="text-2xl font-black text-white">Matchday Intensity</h3>
                <p className="mt-2 text-sm leading-6 text-slate-200">
                  จังหวะการแข่งขันที่สะท้อนหัวใจของทีม
                </p>
              </div>
            </article>
            <div className="grid gap-4">
              {[
                [
                  "/images/ksw-highlights/highlight-matchday.jpg",
                  "Sideline Energy",
                  "บรรยากาศข้างสนามและแรงสนับสนุนจากทีม",
                ],
                [
                  "/images/ksw-highlights/highlight-team-huddle.jpg",
                  "Team Spirit",
                  "รวมพลัง ก่อนลงสนาม",
                ],
                [
                  "/images/ksw-highlights/highlight-celebration.jpg",
                  "Beyond The Game",
                  "มิตรภาพที่เกิดขึ้นนอกเหนือจากการแข่งขัน",
                ],
              ].map(([image, title, caption]) => (
                <article
                  className="group relative min-h-[180px] overflow-hidden rounded-lg border border-white/10 shadow-xl shadow-black/20 transition-shadow hover:shadow-[#d8ad45]/15"
                  key={title}
                >
                  <img
                    alt={title}
                    className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
                    src={image}
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#061426]/90 via-[#061426]/40 to-transparent" />
                  <div className="absolute inset-y-0 left-0 flex max-w-[80%] flex-col justify-end p-4">
                    <div className="mb-3 h-0.5 w-10 rounded-full bg-[#d8ad45]" />
                    <h3 className="text-lg font-black text-white">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-200">{caption}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
          <div className="mt-7">
            <a
              className="inline-flex items-center justify-center rounded-md border border-[#d8ad45]/55 bg-white/[0.04] px-5 py-3 text-sm font-black text-[#f4d58a] shadow-lg shadow-black/15 transition-colors hover:bg-[#d8ad45]/10"
              href="/gallery"
            >
              View Gallery
            </a>
          </div>
        </div>
	      </section>

      {sortedScheduledMatches.length ? (
        <section className="bg-slate-100">
          <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
            <div id="next-fixtures" className="min-w-0 overflow-hidden rounded-2xl border border-[#d8ad45]/35 bg-[linear-gradient(135deg,#061426,#0b2745_58%,#071b31)] shadow-2xl shadow-[#061426]/25">
              <div className="grid gap-5 border-b border-[#d8ad45]/20 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-[#d8ad45]/35 bg-[#d8ad45]/10 text-[#f4d58a] shadow-lg shadow-[#d8ad45]/10">
                    <svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3.9 4.2 1.8 1.3-.7 2.1-2.1.5-1.6-1.4.1-2.2 2.5-.3Zm-7.8 0 2.5.3.1 2.2-1.6 1.4-2.1-.5-.7-2.1 1.8-1.3ZM5.3 15.3l-.8-2.3 1.5-1.7 2.2.4 1 1.9-1.1 1.9-2.8-.2Zm8.7 3.4h-4l-1.2-2.1 1.2-2.1h4l1.2 2.1-1.2 2.1Zm-2-5.8-2-1.5.8-2.4h2.4l.8 2.4-2 1.5Zm6.7 2.4-2.8.2-1.1-1.9 1-1.9 2.2-.4 1.5 1.7-.8 2.3Z" />
                    </svg>
                  </span>
                  <div>
                    <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
                      Next Fixtures
                    </h2>
                      <p className="mt-1 text-sm font-semibold text-slate-300">
                      โปรแกรมการแข่งขันจากรายการที่เผยแพร่แล้ว
                    </p>
                  </div>
                </div>
                <div className="min-w-0 rounded-xl border border-[#d8ad45]/35 bg-white/[0.08] p-4 text-left shadow-xl shadow-black/15 backdrop-blur lg:min-w-[20rem]">
                  {nearestFixture ? (
                    <>
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#f4d58a]">นัดที่ใกล้ที่สุด</p>
                      <p className="mt-2 truncate text-sm font-black text-white">{matchCompetitionContext(nearestFixture)}</p>
                      <LiveCountdown className="mt-2 text-3xl font-black text-white" targetDate={typeof nearestFixtureDate === "string" ? nearestFixtureDate : ""} />
                      <p className="mt-1 text-sm font-bold text-slate-300">{formatMatchDateLong(nearestFixtureDate)} · {formatMatchTime(nearestFixtureDate)}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#f4d58a]">Next Fixtures</p>
                      <p className="mt-2 text-sm font-bold text-slate-200">ยังไม่มีโปรแกรมที่กำหนดวันเวลา</p>
                    </>
                  )}
                </div>
              </div>
              <div className="grid gap-6 px-4 py-5 sm:px-6">
                {fixtureGroups.length ? (
                  fixtureGroups.map((group, groupIndex) => (
                    <div className="grid gap-3" key={group.key}>
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                        <p className="text-xs font-black uppercase tracking-[0.22em] text-[#f4d58a]">
                          Fixtures {groupIndex + 1}
                        </p>
                        <p className="text-sm font-bold text-slate-300">
                          {formatMatchDateLong(group.date)}
                        </p>
                      </div>
                      <div className="grid gap-3">
                        {group.matches.map((fixture, index) => {
                          const matchDate = fixtureDateValue(fixture);
                          const matchTime = formatMatchTime(matchDate);
                          const homeName = text(fixture, ["home_team_name"], "Home team unavailable");
                          const awayName = text(fixture, ["away_team_name"], "Away team unavailable");
                          const homeShortName = text(
                            fixture,
                            ["home_team_short_name"],
                            teamInitials({ team_name: homeName }),
                          );
                          const awayShortName = text(
                            fixture,
                            ["away_team_short_name"],
                            teamInitials({ team_name: awayName }),
                          );
                          const venue = text(fixture, ["venue"], "");
                          const isKswMatch = fixture.isKswFixture;
                          const statusLabel = fixtureStatusLabel(fixture, matchDate, now);
                          const startsIn = countdownText(matchDate, now);
                          const fixtureKey = text(fixture, ["id", "match_id"], `${group.key}-${index}`);
                          const context = matchCompetitionContext(fixture);

                          return (
                            <div className="grid gap-3" key={fixtureKey}>
                              <article
                                className={`group overflow-hidden rounded-xl border bg-white p-4 shadow-lg lg:hidden ${
                                  isKswMatch
                                    ? "border-[#d8ad45] shadow-[#d8ad45]/20"
                                    : "border-white/80 shadow-black/10"
                                }`}
                              >
                                <div className="flex min-w-0 items-center justify-between gap-2">
                                  <span className="inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-full bg-[#061426] px-3 py-2 text-sm font-black leading-none text-white">
                                    <span aria-hidden="true">🕒</span>
                                    {matchTime || "TBC"}
                                  </span>
                                  {venue ? (
                                    <span className="inline-flex min-w-0 max-w-[58%] items-center gap-1.5 rounded-full border border-[#d8ad45]/45 bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-3 py-2 text-sm font-black leading-none text-[#061426]">
                                      <span aria-hidden="true" className="shrink-0">
                                        📍
                                      </span>
                                      <span className="truncate">{formatVenue(venue)}</span>
                                    </span>
                                  ) : null}
                                </div>

                                <p className="mt-3 text-xs font-bold text-slate-500">{context}</p>

                                {isKswMatch ? (
                                  <div className="mt-3">
                                    <span className="rounded-full border border-[#d8ad45]/45 bg-[#fff4dc] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#061426]">
                                      KSW MATCH
                                    </span>
                                  </div>
                                ) : null}

                                <div className="mt-5 grid gap-3">
                                  <div className="flex min-w-0 items-center gap-3">
                                    <TeamLogo
                                      className="!size-12 shrink-0"
                                      initials={homeShortName}
                                      logoUrl={text(fixture, ["home_team_logo_url"], "")}
                                      teamName={homeName}
                                    />
                                    <p className="min-w-0 text-base font-black leading-5 text-[#061426]">
                                      {homeName}
                                    </p>
                                  </div>

                                  <div className="grid justify-items-center">
                                    <span className="rounded-lg border border-[#d8ad45]/45 bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] shadow-lg shadow-[#061426]/10">
                                      VS
                                    </span>
                                  </div>

                                  <div className="flex min-w-0 items-center gap-3">
                                    <TeamLogo
                                      className="!size-12 shrink-0"
                                      initials={awayShortName}
                                      logoUrl={text(fixture, ["away_team_logo_url"], "")}
                                      teamName={awayName}
                                    />
                                    <p className="min-w-0 text-base font-black leading-5 text-[#061426]">
                                      {awayName}
                                    </p>
                                  </div>
                                </div>

                                <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4">
                                  <span className="rounded-full border border-[#d8ad45]/45 bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#061426]">
                                    {statusLabel}
                                  </span>
                                  <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                                    Starts in {startsIn}
                                  </p>
                                </div>
                              </article>

                              <article
                                className={`group hidden overflow-hidden rounded-xl border bg-white p-4 shadow-lg transition duration-300 lg:grid lg:grid-cols-[150px_minmax(0,1fr)_150px] lg:items-center lg:gap-5 lg:p-5 lg:hover:-translate-y-0.5 ${
                                  isKswMatch
                                    ? "border-[#d8ad45] shadow-[#d8ad45]/25"
                                    : "border-white/80 shadow-black/10 hover:shadow-black/20"
                                }`}
                              >
                                <p className="mb-3 text-xs font-bold text-slate-500 lg:col-span-3">{context}</p>
                                <div className="mb-4 lg:mb-0">
                                  <FixtureMetaBadgePair matchTime={matchTime} venue={venue} />
                                </div>

                                <div className="hidden min-w-0 grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] items-center gap-5 lg:grid">
                                  <div className="flex min-w-0 items-center gap-4">
                                    <TeamLogo
                                      className="!size-[68px] transition-transform duration-300 group-hover:scale-105"
                                      initials={homeShortName}
                                      logoUrl={text(fixture, ["home_team_logo_url"], "")}
                                      teamName={homeName}
                                    />
                                    <p className="min-w-0 text-wrap text-lg font-black leading-6 text-[#061426]">
                                      {homeName}
                                    </p>
                                  </div>
                                  <div className="rounded-xl border border-[#d8ad45]/45 bg-[#061426] px-3 py-3 text-center text-base font-black text-[#f4d58a] shadow-lg shadow-[#061426]/15">
                                    VS
                                  </div>
                                  <div className="flex min-w-0 items-center justify-end gap-4 text-right">
                                    <p className="min-w-0 text-wrap text-lg font-black leading-6 text-[#061426]">
                                      {awayName}
                                    </p>
                                    <TeamLogo
                                      className="!size-[68px] transition-transform duration-300 group-hover:scale-105"
                                      initials={awayShortName}
                                      logoUrl={text(fixture, ["away_team_logo_url"], "")}
                                      teamName={awayName}
                                    />
                                  </div>
                                </div>

                                <div className="mt-4 grid justify-items-center gap-2 lg:mt-0 lg:justify-items-end lg:text-right">
                                  {isKswMatch ? (
                                    <span className="hidden rounded-full border border-[#d8ad45]/45 bg-[#fff4dc] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#061426] lg:inline-flex">
                                      KSW MATCH
                                    </span>
                                  ) : null}
                                  <span className="rounded-full border border-[#d8ad45]/45 bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#061426]">
                                    {statusLabel}
                                  </span>
                                  <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                                    Starts in {startsIn}
                                  </p>
                                </div>
                              </article>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="rounded-xl border border-white/10 bg-white/[0.08] px-4 py-4 text-sm font-semibold text-slate-200 sm:px-5">
                    No upcoming fixtures in {competitionName}.
                  </p>
                )}
              </div>
              <div className="border-t border-[#d8ad45]/15 px-4 py-3 text-right sm:px-6">
                <p className="text-xs font-semibold leading-5 text-slate-400">
                  ข้อมูลการแข่งขันจากรายการที่เผยแพร่แล้ว
                </p>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section id="season-summary" className="bg-slate-100">
        <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
        <div className="min-w-0 overflow-hidden rounded-2xl border border-[#d8ad45]/35 bg-[linear-gradient(135deg,#061426,#0b2745_58%,#071b31)] shadow-2xl shadow-[#061426]/25">
          <div className={`grid gap-5 border-b border-[#d8ad45]/20 px-4 py-5 sm:px-6 lg:items-center ${
            isLeagueCompetition && kswStanding ? "lg:grid-cols-[minmax(0,1fr)_auto]" : ""
          }`}>
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-[#d8ad45]/35 bg-[#d8ad45]/10 text-[#f4d58a] shadow-lg shadow-[#d8ad45]/10">
                <svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M7 4h10v2h3v4a5 5 0 0 1-4.05 4.9A6.01 6.01 0 0 1 13 17.92V20h3v2H8v-2h3v-2.08A6.01 6.01 0 0 1 8.05 14.9 5 5 0 0 1 4 10V6h3V4Zm10 4v4.8A3 3 0 0 0 18 10V8h-1ZM6 8v2a3 3 0 0 0 1 2.24V8H6Zm3-2v6a3 3 0 1 0 6 0V6H9Z" />
                </svg>
              </span>
              <div>
                <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
                  {summaryTitle}
                </h2>
                <p className="mt-1 text-sm font-semibold text-slate-300">
                  {summarySubtitle}
                </p>
              </div>
            </div>
            {isLeagueCompetition && kswStanding ? (
              <div className="rounded-xl border border-[#d8ad45]/35 bg-white/[0.08] p-4 text-left shadow-xl shadow-black/15 backdrop-blur lg:min-w-64">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#f4d58a]">
                  {isCompetitionCompleted ? "Final Position" : "Current Position"}
                </p>
                <p className="mt-2 text-3xl font-black text-white">{finalPositionText}</p>
                <p className="mt-1 text-sm font-bold text-slate-300">
                  {isCompetitionCompleted ? "KSW L.C. final league standing" : "KSW L.C. league standing"}
                </p>
              </div>
            ) : null}
          </div>
          <div className="grid gap-5 px-4 py-5 sm:px-6">
            {competitionSummaryStats.length ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.08] p-4 shadow-xl shadow-black/15 sm:p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#f4d58a]">
                      {isCompetitionCompleted ? "Final Numbers" : "Current Numbers"}
                    </p>
                    <h3 className="mt-2 text-xl font-black text-white">
                      {isLeagueCompetition && kswStanding
                        ? text(kswStanding, ["team_name", "name", "team"], "KSW L.C.")
                        : "KSW L.C."}
                    </h3>
                  </div>
                  {hasCompetitionLink ? (
                    <Link
                      className="inline-flex items-center justify-center rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/15 transition-transform hover:scale-[1.02]"
                      href={competitionHref}
                    >
                      View Competition
                    </Link>
                  ) : null}
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {competitionSummaryStats.map(([label, value]) => (
                    <div
                      className="rounded-lg border border-white/10 bg-[#061426]/55 px-3 py-3 text-center"
                      key={label}
                    >
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                        {label}
                      </p>
                      <p className="mt-1 text-2xl font-black text-white">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-white/10 bg-white/[0.08] px-4 py-4 text-sm font-semibold text-slate-200 sm:px-5">
                KSW summary details are currently unavailable for {competitionName}.
              </p>
            )}
            <div className="border-t border-[#d8ad45]/15 pt-4 text-right">
              <p className="text-xs font-semibold leading-5 text-slate-400">
                ข้อมูลการแข่งขันอ้างอิงจาก {competitionName}
              </p>
            </div>
          </div>
        </div>
        </div>
      </section>

      {shouldShowNextCompetitionCard ? (
        <section className="bg-slate-100">
          <div className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10">
            <div className="grid gap-4 rounded-2xl border border-[#d8ad45]/30 bg-white p-5 shadow-xl shadow-slate-900/10 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[#d8ad45]/45 bg-[#fff4dc] px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#061426]">
                    NEXT COMPETITION
                  </span>
                  <span className="rounded-full bg-[#061426] px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#f4d58a]">
                    COMING SOON
                  </span>
                </div>
                <h2 className="mt-3 break-words text-2xl font-black text-[#061426] sm:text-3xl">
                  {nextCompetitionName || "Upcoming competition"}
                </h2>
                <p className="mt-2 text-sm font-bold text-slate-600">
                  {formatMatchDateLong(nextCompetition?.start_date)} • {startsInLabel(nextCompetitionStartsInDays)}
                </p>
              </div>
              <Link
                className="inline-flex items-center justify-center rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/15 transition-transform hover:scale-[1.02]"
                href={nextCompetitionHref}
              >
                View Competition
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      <section className="bg-slate-100">
        <div className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10">
        <div id="ksw-recent-results" className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10">
          <div className="border-b border-slate-200 bg-gradient-to-r from-white via-slate-50 to-[#fff8e3] px-4 py-5 sm:px-6">
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
              <span className="mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-[#d8ad45]/35 bg-[#fff4dc] text-[#9b1c1f] shadow-lg shadow-[#d8ad45]/10">
                <svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M7 3h10v2h3v5a5 5 0 0 1-4.03 4.9A6.01 6.01 0 0 1 13 17.92V20h3v2H8v-2h3v-2.08A6.01 6.01 0 0 1 8.03 14.9 5 5 0 0 1 4 10V5h3V3Zm10 4v5.83A3 3 0 0 0 18 7h-1ZM6 7v3a3 3 0 0 0 1 2.24V7H6Zm3-2v7a3 3 0 1 0 6 0V5H9Z" />
                </svg>
              </span>
              <div>
                <h2 className="text-2xl font-black tracking-tight text-[#061426] sm:text-3xl">
                  Recent Results
                </h2>
                <p className="mt-1 text-sm font-semibold text-slate-600">
                  ผลการแข่งขันล่าสุดจากรายการที่เผยแพร่แล้ว
                </p>
              </div>
              </div>
              {hasCompetitionLink ? (
                <Link
                  className="inline-flex items-center justify-center rounded-md bg-[#061426] px-4 py-2.5 text-sm font-black text-[#f4d58a] shadow-lg shadow-slate-900/10 transition-colors hover:bg-[#0b2745]"
                  href={competitionHref}
                >
                  {resultsCtaLabel}
                </Link>
              ) : null}
            </div>
          </div>
          <div className="grid gap-6 bg-slate-100 px-4 py-5 sm:px-6">
            {resultGroups.length ? (
              resultGroups.map((group, groupIndex) => (
                <div className="grid gap-3" key={group.key}>
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-[#9b1c1f]">
                      Results {groupIndex + 1}
                    </p>
                    <p className="text-sm font-bold text-slate-600">
                      {formatMatchDateLong(group.date)}
                    </p>
                  </div>
                  <div className="grid gap-3">
                    {group.matches.map((match, index) => {
                      const matchDate = match.match_date ?? match.date ?? match.kickoff_at;
                      const matchTime = formatMatchTime(matchDate);
                      const homeName = text(match, ["home_team_name"], "Home team unavailable");
                      const awayName = text(match, ["away_team_name"], "Away team unavailable");
                      const homeShortName = text(
                        match,
                        ["home_team_short_name"],
                        teamInitials({ team_name: homeName }),
                      );
                      const awayShortName = text(
                        match,
                        ["away_team_short_name"],
                        teamInitials({ team_name: awayName }),
                      );
                      const homeScore = match.home_score;
                      const awayScore = match.away_score;
                      const hasScore = typeof homeScore === "number" && typeof awayScore === "number";
                      const venue = text(match, ["venue"], "");
                      const homeIsKsw = match.home_team_is_ksw === true;
                      const awayIsKsw = match.away_team_is_ksw === true;
                      const isKswResult = homeIsKsw || awayIsKsw;
                      const outcome = homeKswOutcome(match);
                      const context = matchCompetitionContext(match);
                      const homePenalty = match.penalty_home_score;
                      const awayPenalty = match.penalty_away_score;
                      const hasPenalty = typeof homePenalty === "number" && typeof awayPenalty === "number";

                      return (
                        <article
                          className={`group overflow-hidden rounded-xl border bg-white p-4 shadow-lg transition duration-300 lg:grid lg:grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)] lg:items-center lg:gap-5 lg:p-5 lg:hover:-translate-y-0.5 ${
                            isKswResult
                              ? "border-[#d8ad45] shadow-[#d8ad45]/20"
                              : "border-white shadow-black/10 hover:shadow-black/20"
                          }`}
                          key={text(match, ["id", "match_id"], `${group.key}-${index}`)}
                        >
                          <p className="mb-3 text-center text-xs font-bold text-slate-500 lg:col-span-3">{context}</p>
                          <div className="mb-4 flex flex-wrap items-center justify-center gap-2 lg:hidden">
                            {isKswResult ? (
                              <span className="rounded-full border border-[#d8ad45]/45 bg-[#fff4dc] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#061426]">
                                KSW MATCH
                              </span>
                            ) : null}
                            <span className="rounded-full border border-emerald-700/20 bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-800">
                              Full Time
                            </span>
                            {outcome ? (
                              <span className="rounded-full bg-[#061426] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#f4d58a]">
                                {outcome}
                              </span>
                            ) : null}
                          </div>

                          <div className="grid min-w-0 justify-items-center gap-2 text-center lg:flex lg:justify-start lg:text-left">
                            <TeamLogo
                              className="!size-12 transition-transform duration-300 group-hover:scale-105 lg:!size-16"
                              initials={homeShortName}
                              logoUrl={text(match, ["home_team_logo_url"], "")}
                              teamName={homeName}
                            />
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
                                <span className="text-xl text-[#f4d58a] sm:text-2xl">Score TBC</span>
                              )}
                            </div>
                            {hasPenalty ? (
                              <p className="text-xs font-black text-[#9b1c1f]">จุดโทษ {homePenalty}-{awayPenalty}</p>
                            ) : null}
                            <div className="flex flex-wrap justify-center gap-2 text-xs font-black text-[#061426]">
                              {matchTime ? (
                                <span className="rounded-full bg-slate-100 px-3 py-1.5">
                                  🕒 {matchTime}
                                </span>
                              ) : null}
                              {venue ? (
                                <span className="rounded-full bg-[#fff4dc] px-3 py-1.5">
                                  📍 สนาม {venue}
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div className="grid min-w-0 justify-items-center gap-2 text-center lg:flex lg:justify-end lg:text-right">
                            <p className="min-w-0 text-wrap text-base font-black leading-5 text-[#061426] lg:order-first lg:text-lg lg:leading-6">
                              <span className="lg:hidden">{awayShortName}</span>
                              <span className="hidden lg:inline">{awayName}</span>
                            </p>
                            <TeamLogo
                              className="!size-12 transition-transform duration-300 group-hover:scale-105 lg:!size-16"
                              initials={awayShortName}
                              logoUrl={text(match, ["away_team_logo_url"], "")}
                              teamName={awayName}
                            />
                          </div>

                          <div className="mt-4 hidden flex-wrap items-center justify-center gap-2 lg:col-span-3 lg:flex">
                            {isKswResult ? (
                              <span className="rounded-full border border-[#d8ad45]/45 bg-[#fff4dc] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#061426]">
                                KSW MATCH
                              </span>
                            ) : null}
                            <span className="rounded-full border border-emerald-700/20 bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-800">
                              Full Time
                            </span>
                            {outcome ? (
                              <span className="rounded-full bg-[#061426] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#f4d58a]">
                                {outcome}
                              </span>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <p className="rounded-xl bg-white px-4 py-4 text-sm font-semibold text-slate-600 sm:px-5">
                No completed results in {competitionName}.
              </p>
            )}
          </div>
          <div className="border-t border-slate-200 px-4 py-3 text-right sm:px-6">
            <p className="text-xs font-semibold leading-5 text-slate-500">
              ข้อมูลการแข่งขันอ้างอิงจาก {competitionName}
            </p>
          </div>
        </div>
        </div>
      </section>

      {latestChampions.length ? (
        <section className="bg-slate-100">
          <div className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-10">
            <div className="rounded-xl border border-[#d8ad45]/35 bg-white p-5 shadow-xl shadow-slate-900/10 sm:p-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-[#9b1c1f]">Latest Champions</p>
                  <h2 className="mt-2 text-2xl font-black text-[#061426]">แชมป์ล่าสุด</h2>
                </div>
                <Link className="text-sm font-black text-[#9b1c1f] hover:text-[#061426]" href="/competitions">
                  ดูรายการแข่งขันทั้งหมด
                </Link>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {latestChampions.map((champion) => (
                  <Link
                    className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4 transition-colors hover:border-[#d8ad45]/60 hover:bg-[#fff8e3]"
                    href={champion.competitionSlug ? `/competitions/${champion.competitionSlug}` : "/competitions"}
                    key={`${champion.competitionId}-${champion.label}`}
                  >
                    <p className="text-xs font-black text-[#9b1c1f]">{champion.label}</p>
                    <p className="mt-2 break-words text-lg font-black text-[#061426]">{champion.teamName}</p>
                    <p className="mt-1 break-words text-sm font-semibold text-slate-600">{champion.competitionName}</p>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section id="sponsors" className="bg-gradient-to-br from-[#071b31] via-[#0b2745] to-[#061426]">
        <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
        <div className="min-w-0 rounded-lg border border-[#d8ad45]/25 bg-white/[0.08] p-6 shadow-2xl shadow-black/30 backdrop-blur sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
          <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#d8ad45]">
            KSW Partnership
          </p>
          <h2 className="mt-3 text-3xl font-black text-white">Partners & Supporters</h2>
          <p className="mt-4 max-w-xl text-sm leading-7 text-slate-200">
            สนับสนุน KSW L.C. คือการเป็นส่วนหนึ่งของชุมชนฟุตบอลนักกฎหมายที่เชื่อมโยงมิตรภาพ
            เครือข่ายวิชาชีพ และกิจกรรมการแข่งขันตลอดฤดูกาล
          </p>
          <div className="mt-6 grid gap-3">
            {[
              [
                "Brand Visibility",
                "โลโก้ปรากฏบนเว็บไซต์ทางการและสื่อกิจกรรมของทีม",
              ],
              [
                "Legal Community Network",
                "เข้าถึงกลุ่มนักกฎหมาย ผู้บริหาร และผู้ประกอบการ",
              ],
              [
                "Matchday Presence",
                "เชื่อมแบรนด์เข้ากับกิจกรรมการแข่งขันและภาพลักษณ์ของสโมสร",
              ],
            ].map(([title, body]) => (
              <div
                className="rounded-lg border border-white/10 bg-white/[0.07] p-4 shadow-lg shadow-black/15"
                key={title}
              >
                <div className="mb-3 h-0.5 w-10 rounded-full bg-[#d8ad45]" />
                <h3 className="font-black text-white">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-300">{body}</p>
              </div>
            ))}
          </div>
          <div className="mt-7">
            <a
              className="inline-flex items-center justify-center rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/20 transition-transform hover:scale-[1.02]"
              href="/partners"
            >
              Become a KSW Partner
            </a>
          </div>
          </div>
          <div className="rounded-[24px] border border-white/60 bg-[#fafafa] p-6 shadow-xl shadow-black/15 sm:p-8 lg:p-10">
          <div className="space-y-8">
            {sponsorSections.map((section) => (
              <div key={section.key}>
                <p className="mb-4 text-center text-[10px] font-black uppercase tracking-[0.24em] text-[#061426]/60">
                  {section.label}
                </p>
                <div className={section.wrapperClass}>
                  {section.items.map((sponsor, index) => {
                    const sponsorName = text(sponsor, ["name", "sponsor_name"], "YOUR LOGO");
                    const sponsorLogo = text(sponsor, ["logo_url"], "");
                    const sponsorWebsite = text(sponsor, ["website_url"], "");
                    const sponsorMark = (
                      <div
                        className={`flex ${section.logoSlotSize} items-center justify-center text-center transition-transform duration-300 hover:scale-[1.04]`}
                      >
                        {isString(sponsorLogo) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={`${sponsorName} logo`}
                            className="ksw-sponsor-logo-fit"
                            src={sponsorLogo}
                          />
                        ) : (
                          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#061426]/30 sm:text-[10px]">
                            YOUR LOGO
                          </span>
                        )}
                      </div>
                    );

                    return isString(sponsorWebsite) ? (
                      <AnalyticsSponsorLink
                        aria-label={`Visit ${sponsorName} website`}
                        className="cursor-pointer"
                        href={sponsorWebsite}
                        key={text(sponsor, ["id", "name"], `${section.key}-${index}`)}
                        rel="noopener noreferrer"
                        sponsorId={text(sponsor, ["id"], "")}
                        target="_blank"
                      >
                        {sponsorMark}
                      </AnalyticsSponsorLink>
                    ) : (
                      <div key={text(sponsor, ["id", "name"], `${section.key}-${index}`)}>
                        {sponsorMark}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          </div>
          </div>
        </div>
        </div>
      </section>
    </main>
  );
}

"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createKnockoutMatches,
  previewBlankKnockout,
  previewSuggestedKnockout,
  saveKnockoutSetup,
  updateKnockoutMatchResult,
  type KnockoutMatchSlot,
  type KnockoutSlotSource,
  type KnockoutSourceType,
} from "@/app/admin/competitions/[id]/knockout-actions";
import type {
  AdminCompetitionGroup,
  AdminCompetitionGroupTeam,
} from "@/components/admin-competition-groups-manager";
import type { AdminCompetitionMatch } from "@/components/admin-competition-match-manager";
import { TeamLogo } from "@/components/team-logo";
import {
  calculateCupGroupStandings,
  type CupGroupRow,
  type CupGroupStandingRow,
} from "@/lib/cup-group-standings";

type Warning = {
  key: string;
  message: string;
};

type KnockoutResultForm = {
  awayScore: string;
  homeScore: string;
  manualWinnerTeamId: string;
  matchDate: string;
  penaltyAwayScore: string;
  penaltyHomeScore: string;
  status: "scheduled" | "finished";
  venue: string;
};

const bracketSizes = [4, 8, 16, 32, 64];
const sourceTypes: Array<{ label: string; value: KnockoutSourceType }> = [
  { label: "Group rank", value: "group_rank" },
  { label: "Manual team", value: "manual_team" },
  { label: "Bye", value: "bye" },
  { label: "Match winner", value: "match_winner" },
  { label: "Unassigned", value: "unassigned" },
];

function groupDisplayName(group: AdminCompetitionGroup | undefined) {
  return group ? group.label || `Group ${group.name}` : "Group";
}

function sourceKey(source: KnockoutSlotSource) {
  if (source.type === "group_rank") return `group_rank:${source.groupId}:${source.rank}`;
  if (source.type === "manual_team") return `manual_team:${source.teamId}`;
  if (source.type === "match_winner") return `match_winner:${source.sourceRoundIndex}:${source.sourceMatchOrder}`;
  return source.type;
}

function sourceLabel(
  source: KnockoutSlotSource,
  groupsById: Map<string, AdminCompetitionGroup>,
  teamsById: Map<string, AdminCompetitionGroupTeam>,
) {
  if (source.type === "group_rank") {
    return `${groupDisplayName(groupsById.get(source.groupId ?? ""))} Rank ${source.rank || "?"}`;
  }
  if (source.type === "manual_team") {
    return teamsById.get(source.teamId ?? "")?.name ?? "Manual team";
  }
  if (source.type === "match_winner") {
    return `Winner of Match ${source.sourceMatchOrder || "?"}`;
  }
  if (source.type === "bye") return "Bye";
  return "Unassigned";
}

function teamInitials(team: Pick<AdminCompetitionGroupTeam, "name" | "short_name"> | CupGroupStandingRow | undefined) {
  if (!team) return "FC";
  const shortName = "short_name" in team ? team.short_name : null;
  const name = "name" in team ? team.name : team.team_name;
  return (shortName || name || "FC").slice(0, 3).toUpperCase();
}

function toBangkokDateInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).formatToParts(date);
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));

  return `${valueByType.get("year")}-${valueByType.get("month")}-${valueByType.get("day")}T${valueByType.get("hour")}:${valueByType.get("minute")}`;
}

function bangkokDateInputToIso(value: string) {
  if (!value.trim()) return null;
  return new Date(`${value}:00+07:00`).toISOString();
}

function scoreValue(value: string) {
  return value.trim() === "" ? null : Number(value);
}

function knockoutFormFromMatch(match: AdminCompetitionMatch): KnockoutResultForm {
  return {
    awayScore: match.away_score === null ? "" : String(match.away_score),
    homeScore: match.home_score === null ? "" : String(match.home_score),
    manualWinnerTeamId: match.manual_winner_team_id ?? "",
    matchDate: toBangkokDateInput(match.match_date),
    penaltyAwayScore: match.penalty_away_score === null || match.penalty_away_score === undefined ? "" : String(match.penalty_away_score),
    penaltyHomeScore: match.penalty_home_score === null || match.penalty_home_score === undefined ? "" : String(match.penalty_home_score),
    status: match.status === "finished" ? "finished" : "scheduled",
    venue: match.venue ?? "",
  };
}

function normalizeSourceType(type: KnockoutSourceType): KnockoutSlotSource {
  if (type === "bye") return { type: "bye" };
  if (type === "unassigned") return { type: "unassigned" };
  if (type === "group_rank") return { type, rank: 1 };
  if (type === "manual_team") return { type };
  return { sourceMatchOrder: 1, sourceRoundIndex: 1, type };
}

function sortedGroups(groups: AdminCompetitionGroup[]) {
  return [...groups].sort((a, b) => {
    const orderDiff = a.sort_order - b.sort_order;
    if (orderDiff) return orderDiff;
    return groupDisplayName(a).localeCompare(groupDisplayName(b));
  });
}

function sortedTeams(teams: AdminCompetitionGroupTeam[]) {
  return [...teams].sort((a, b) => {
    const orderDiff = a.display_order - b.display_order;
    if (orderDiff) return orderDiff;
    return a.name.localeCompare(b.name);
  });
}

function warningsForMatches(matches: KnockoutMatchSlot[]) {
  const warnings: Warning[] = [];
  const firstRoundSources = new Map<string, number>();

  matches
    .filter((match) => match.roundIndex === 1)
    .forEach((match) => {
      const sources = [match.home, match.away];
      sources.forEach((source) => {
        if (source.type === "bye" || source.type === "unassigned") return;
        const key = sourceKey(source);
        firstRoundSources.set(key, (firstRoundSources.get(key) ?? 0) + 1);
      });

      if (sourceKey(match.home) === sourceKey(match.away) && match.home.type !== "unassigned") {
        warnings.push({
          key: `same-source-${match.matchOrder}`,
          message: `Match ${match.matchOrder} uses the same source on both sides.`,
        });
      }
      if (
        match.home.type === "group_rank" &&
        match.away.type === "group_rank" &&
        match.home.groupId &&
        match.home.groupId === match.away.groupId
      ) {
        warnings.push({
          key: `same-group-${match.matchOrder}`,
          message: `Match ${match.matchOrder} pairs teams from the same group.`,
        });
      }
    });

  firstRoundSources.forEach((count, key) => {
    if (count > 1) {
      warnings.push({ key: `duplicate-${key}`, message: `First round source is used ${count} times: ${key}.` });
    }
  });

  return warnings;
}

function updateMatchSlot(
  matches: KnockoutMatchSlot[],
  target: KnockoutMatchSlot,
  side: "away" | "home",
  source: KnockoutSlotSource,
) {
  return matches.map((match) => {
    if (match.roundIndex !== target.roundIndex || match.matchOrder !== target.matchOrder) return match;
    return { ...match, [side]: source };
  });
}

function groupMatchesByRound(matches: KnockoutMatchSlot[]) {
  const map = new Map<string, KnockoutMatchSlot[]>();
  matches.forEach((match) => {
    map.set(match.roundLabel, [...(map.get(match.roundLabel) ?? []), match]);
  });
  return Array.from(map.entries());
}

export function AdminCompetitionKnockoutManager({
  competitionId,
  groups,
  initialMatches,
  matches: groupMatches,
  schemaReady,
  teams,
}: {
  competitionId: string;
  groups: AdminCompetitionGroup[];
  initialMatches: KnockoutMatchSlot[];
  matches: AdminCompetitionMatch[];
  schemaReady: boolean;
  teams: AdminCompetitionGroupTeam[];
}) {
  const router = useRouter();
  const hasSavedSetup = initialMatches.length > 0;
  const [bracketSize, setBracketSize] = useState(initialMatches[0]?.bracketSize || 8);
  const [pairingMode, setPairingMode] = useState<"edit" | "summary">(hasSavedSetup ? "summary" : "edit");
  const [draftMatches, setDraftMatches] = useState<KnockoutMatchSlot[]>(initialMatches);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [serverWarnings, setServerWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [creatingMatches, setCreatingMatches] = useState(false);
  const [savingResultId, setSavingResultId] = useState("");
  const [expandedRounds, setExpandedRounds] = useState<Record<string, boolean>>({});
  const [advancedDecisions, setAdvancedDecisions] = useState<Record<string, boolean>>({});
  const [specialDecisions, setSpecialDecisions] = useState<Record<string, boolean>>({});
  const [overwriteManualEdits, setOverwriteManualEdits] = useState(false);
  const knockoutMatches = useMemo(
    () => groupMatches.filter((match) => match.competition_stage === "knockout"),
    [groupMatches],
  );
  const knockoutMatchesById = useMemo(
    () => new Map(knockoutMatches.map((match) => [match.id, match])),
    [knockoutMatches],
  );
  const [resultForms, setResultForms] = useState<Record<string, KnockoutResultForm>>(() =>
    Object.fromEntries(knockoutMatches.map((match) => [match.id, knockoutFormFromMatch(match)])),
  );
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.team_id, team])), [teams]);
  const groupsForSelect = useMemo(() => sortedGroups(groups), [groups]);
  const teamsForSelect = useMemo(() => sortedTeams(teams), [teams]);
  const groupStandings = useMemo(
    () =>
      calculateCupGroupStandings({
        groups: groups as unknown as CupGroupRow[],
        matches: groupMatches as unknown as CupGroupRow[],
        teams: teams as unknown as CupGroupRow[],
      }),
    [groupMatches, groups, teams],
  );
  const standingsByGroupId = useMemo(
    () => new Map(groupStandings.map((standing) => [standing.group_id, standing])),
    [groupStandings],
  );
  const groupedDraftMatches = useMemo(() => groupMatchesByRound(draftMatches), [draftMatches]);
  const groupedSavedMatches = useMemo(() => groupMatchesByRound(initialMatches), [initialMatches]);
  const clientWarnings = useMemo(() => (pairingMode === "edit" ? warningsForMatches(draftMatches) : []), [draftMatches, pairingMode]);
  const hasManualEdits = initialMatches.some((match) => match.isManualEdited);
  const hasAnyUnfinishedRound = groupedSavedMatches.some(([, roundMatches]) =>
    roundMatches.some((match) => {
      const realMatch = match.matchId ? knockoutMatchesById.get(match.matchId) : undefined;
      return !realMatch || realMatch.status !== "finished";
    }),
  );

  async function loadSuggested() {
    setMessage("");
    setError("");
    setServerWarnings([]);
    const result = await previewSuggestedKnockout(competitionId, bracketSize);

    if (!result.ok || !result.matches) {
      setError(result.error ?? "Could not generate suggested pairing.");
      setServerWarnings(result.warnings ?? []);
      return;
    }

    setDraftMatches(result.matches);
    setPairingMode("edit");
    setServerWarnings(result.warnings ?? []);
    setMessage("Suggested pairing preview is ready. Review and save when correct.");
  }

  async function loadBlank() {
    setMessage("");
    setError("");
    setServerWarnings([]);
    const result = await previewBlankKnockout(bracketSize);

    if (!result.ok || !result.matches) {
      setError(result.error ?? "Could not start custom bracket.");
      return;
    }

    setDraftMatches(result.matches);
    setPairingMode("edit");
    setMessage("Custom bracket is ready for editing.");
  }

  async function saveSetup() {
    setSaving(true);
    setMessage("");
    setError("");
    setServerWarnings([]);

    const result = await saveKnockoutSetup({
      bracketSize,
      competitionId,
      matches: draftMatches,
      overwriteManualEdits,
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "Could not save knockout setup.");
      setServerWarnings(result.warnings ?? []);
      return;
    }

    setDraftMatches(result.matches ?? draftMatches);
    setPairingMode("summary");
    setOverwriteManualEdits(false);
    setServerWarnings(result.warnings ?? []);
    setMessage("Knockout setup saved.");
    router.refresh();
  }

  async function createMatchesFromSetup() {
    setCreatingMatches(true);
    setMessage("");
    setError("");

    const result = await createKnockoutMatches(competitionId);
    setCreatingMatches(false);

    if (!result.ok) {
      setError(result.error ?? "Could not create knockout matches.");
      return;
    }

    setMessage(`Knockout matches ready: ${result.createdCount ?? 0} created, ${result.advancedByes ?? 0} bye advances.`);
    router.refresh();
  }

  async function saveResult(event: FormEvent<HTMLFormElement>, match: AdminCompetitionMatch) {
    event.preventDefault();
    const form = resultForms[match.id];
    if (!form) return;

    setSavingResultId(match.id);
    setMessage("");
    setError("");

    const result = await updateKnockoutMatchResult(competitionId, {
      awayScore: form.status === "scheduled" ? null : scoreValue(form.awayScore),
      homeScore: form.status === "scheduled" ? null : scoreValue(form.homeScore),
      manualWinnerTeamId: form.status === "scheduled" ? null : form.manualWinnerTeamId || null,
      matchDate: bangkokDateInputToIso(form.matchDate),
      matchId: match.id,
      penaltyAwayScore: form.status === "scheduled" ? null : scoreValue(form.penaltyAwayScore),
      penaltyHomeScore: form.status === "scheduled" ? null : scoreValue(form.penaltyHomeScore),
      status: form.status,
      venue: form.venue,
    });
    setSavingResultId("");

    if (!result.ok) {
      setError(result.error ?? "Could not update knockout result.");
      return;
    }

    setMessage("Knockout result updated.");
    router.refresh();
  }

  function updateSlot(match: KnockoutMatchSlot, side: "away" | "home", source: KnockoutSlotSource) {
    setDraftMatches((current) => updateMatchSlot(current, match, side, source));
  }

  function startPairingEdit() {
    setDraftMatches(initialMatches);
    setBracketSize(initialMatches[0]?.bracketSize || bracketSize);
    setPairingMode("edit");
    setMessage("");
    setError("");
    setServerWarnings([]);
  }

  function cancelPairingEdit() {
    setDraftMatches(initialMatches);
    setPairingMode("summary");
    setMessage("");
    setError("");
    setServerWarnings([]);
  }

  function roundIsExpanded(roundLabel: string, roundMatches: KnockoutMatchSlot[], index: number) {
    if (expandedRounds[roundLabel] !== undefined) return expandedRounds[roundLabel];
    const hasUnfinished = roundMatches.some((match) => {
      const realMatch = match.matchId ? knockoutMatchesById.get(match.matchId) : undefined;
      return !realMatch || realMatch.status !== "finished";
    });
    return hasUnfinished || (!hasAnyUnfinishedRound && index === 0);
  }

  function resolvedGroupRankTeam(source: KnockoutSlotSource) {
    if (source.type !== "group_rank" || !source.groupId || !source.rank) return undefined;
    const row = standingsByGroupId.get(source.groupId)?.rows.find((standingRow) => standingRow.position === source.rank);
    if (!row) return undefined;

    return {
      logo_url: teamsById.get(row.team_id)?.logo_url ?? null,
      name: row.team_name,
      short_name: row.short_name,
      team_id: row.team_id,
    };
  }

  function winnerTeam(match: AdminCompetitionMatch | undefined) {
    return match?.winner_team_id ? teamsById.get(match.winner_team_id) : undefined;
  }

  function SlotTeamPreview({ source }: { source: KnockoutSlotSource }) {
    const groupRankTeam = resolvedGroupRankTeam(source);
    const manualTeam = source.type === "manual_team" ? teamsById.get(source.teamId ?? "") : undefined;
    const resolvedTeam = source.type === "group_rank" ? groupRankTeam : manualTeam;

    if (resolvedTeam) {
      return (
        <div className="flex min-w-0 items-center gap-3 rounded-md border border-white bg-white px-3 py-2">
          <TeamLogo
            className="!size-9 shrink-0 bg-[#061426]"
            initials={teamInitials(resolvedTeam)}
            logoUrl={resolvedTeam.logo_url ?? ""}
            teamName={resolvedTeam.name}
          />
          <div className="min-w-0">
            <p className="break-words text-sm font-black text-[#061426]">{resolvedTeam.name}</p>
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[#8a6418]">
              {source.type === "group_rank" ? "Current team" : "Manual team"}
            </p>
          </div>
        </div>
      );
    }

    if (source.type === "group_rank") {
      return (
        <p className="rounded-md border border-[#d8ad45]/30 bg-[#fff7e6] px-3 py-2 text-xs font-bold text-[#8a6418]">
          Waiting for group standings
        </p>
      );
    }

    if (source.type === "manual_team") {
      return (
        <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500">
          Select a manual team
        </p>
      );
    }

    if (source.type === "match_winner") {
      return (
        <p className="rounded-md border border-[#d8ad45]/30 bg-[#fff7e6] px-3 py-2 text-xs font-bold text-[#8a6418]">
          Waiting for {sourceLabel(source, groupsById, teamsById)}
        </p>
      );
    }

    return (
      <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500">
        {sourceLabel(source, groupsById, teamsById)}
      </p>
    );
  }

  function SlotSummary({ source }: { source: KnockoutSlotSource }) {
    return (
      <div className="grid min-w-0 gap-2 rounded-md border border-slate-100 bg-white px-3 py-2">
        <p className="min-w-0 break-words text-xs font-black uppercase tracking-[0.12em] text-[#8a6418]">
          {sourceLabel(source, groupsById, teamsById)}
        </p>
        <SlotTeamPreview source={source} />
      </div>
    );
  }

  function SlotEditor({
    match,
    side,
    source,
  }: {
    match: KnockoutMatchSlot;
    side: "away" | "home";
    source: KnockoutSlotSource;
  }) {
    const selectedGroupTeamCount = source.groupId
      ? teams.filter((team) => team.group_id === source.groupId).length
      : teams.length;
    const maxRank = Math.max(selectedGroupTeamCount, 1);

    return (
      <div className="grid min-w-0 gap-2 rounded-md border border-slate-100 bg-slate-50 p-3">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{side}</span>
          <span className="min-w-0 break-words text-right text-xs font-black text-[#061426]">
            {sourceLabel(source, groupsById, teamsById)}
          </span>
        </div>
        <SlotTeamPreview source={source} />
        <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">
          Source
          <select
            className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-[#061426]"
            onChange={(event) => updateSlot(match, side, normalizeSourceType(event.target.value as KnockoutSourceType))}
            value={source.type}
          >
            {sourceTypes.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </label>
        {source.type === "group_rank" ? (
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_110px]">
            <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">
              Group
              <select
                className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-[#061426]"
                onChange={(event) => updateSlot(match, side, { ...source, groupId: event.target.value || undefined })}
                value={source.groupId ?? ""}
              >
                <option value="">Select group</option>
                {groupsForSelect.map((group) => (
                  <option key={group.id} value={group.id}>{groupDisplayName(group)}</option>
                ))}
              </select>
            </label>
            <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">
              Rank
              <input
                className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-[#061426]"
                min="1"
                max={maxRank}
                onChange={(event) => updateSlot(match, side, { ...source, rank: Number(event.target.value) || 1 })}
                step="1"
                type="number"
                value={source.rank ?? 1}
              />
            </label>
          </div>
        ) : null}
        {source.type === "manual_team" ? (
          <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">
            Team
            <select
              className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-[#061426]"
              onChange={(event) => updateSlot(match, side, { ...source, teamId: event.target.value || undefined })}
              value={source.teamId ?? ""}
            >
              <option value="">Select team</option>
              {teamsForSelect.map((team) => (
                <option key={team.team_id} value={team.team_id}>{team.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        {source.type === "match_winner" ? (
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">
              Round
              <input
                className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-[#061426]"
                min="1"
                onChange={(event) => updateSlot(match, side, { ...source, sourceRoundIndex: Number(event.target.value) || 1 })}
                step="1"
                type="number"
                value={source.sourceRoundIndex ?? 1}
              />
            </label>
            <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">
              Match
              <input
                className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-[#061426]"
                min="1"
                onChange={(event) => updateSlot(match, side, { ...source, sourceMatchOrder: Number(event.target.value) || 1 })}
                step="1"
                type="number"
                value={source.sourceMatchOrder ?? 1}
              />
            </label>
          </div>
        ) : null}
      </div>
    );
  }

  function KnockoutMatchCard({ setup }: { setup: KnockoutMatchSlot }) {
    const realMatch = setup.matchId ? knockoutMatchesById.get(setup.matchId) : undefined;
    const form = realMatch ? resultForms[realMatch.id] ?? knockoutFormFromMatch(realMatch) : undefined;
    const homeTeam = realMatch ? teamsById.get(realMatch.home_team_id) : undefined;
    const awayTeam = realMatch ? teamsById.get(realMatch.away_team_id) : undefined;
    const winner = winnerTeam(realMatch);
    const nextRound = initialMatches.find((match) =>
      [match.home, match.away].some(
        (source) =>
          source.type === "match_winner" &&
          source.sourceRoundIndex === setup.roundIndex &&
          source.sourceMatchOrder === setup.matchOrder,
      ),
    );
    const normalScoresAreDrawn =
      form?.status === "finished" &&
      form.homeScore.trim() !== "" &&
      form.awayScore.trim() !== "" &&
      Number(form.homeScore) === Number(form.awayScore);
    const advancedDecisionOpen = realMatch ? advancedDecisions[realMatch.id] === true : false;
    const specialDecisionOpen = realMatch ? specialDecisions[realMatch.id] === true || Boolean(form?.manualWinnerTeamId) : false;

    if (!realMatch) {
      return (
        <article className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8a6418]">
            Match {setup.matchOrder}
          </p>
          <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
            <SlotSummary source={setup.home} />
            <span className="rounded-md border border-[#d8ad45]/35 bg-white px-3 py-2 text-center text-xs font-black uppercase tracking-[0.12em] text-[#8a6418]">
              vs
            </span>
            <SlotSummary source={setup.away} />
          </div>
          <p className="mt-3 rounded-md border border-[#d8ad45]/35 bg-[#fff7e6] px-3 py-2 text-xs font-bold text-[#8a6418]">
            Waiting for resolved teams or bye advancement.
          </p>
        </article>
      );
    }

    return (
      <article className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8a6418]">
              Match {setup.matchOrder}
            </p>
            <p className="mt-1 text-xs font-bold text-slate-500">
              {nextRound ? `Winner advances to ${nextRound.roundLabel} Match ${nextRound.matchOrder}` : "Winner completes bracket"}
            </p>
          </div>
          {winner ? (
            <span className="rounded-full border border-emerald-700/20 bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-800">
              Winner: {winner.name}
            </span>
          ) : null}
        </div>

        <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
          <div className="grid min-w-0 gap-2">
            <p className="min-w-0 break-words text-[10px] font-black uppercase tracking-[0.12em] text-[#8a6418]">
              {sourceLabel(setup.home, groupsById, teamsById)}
            </p>
            <div className="flex min-w-0 items-center gap-3">
              <TeamLogo className="!size-10 shrink-0 bg-[#061426]" initials={teamInitials(homeTeam)} logoUrl={homeTeam?.logo_url ?? ""} teamName={homeTeam?.name ?? "Home team"} />
              <p className="min-w-0 break-words text-sm font-black text-[#061426]">{homeTeam?.name ?? "Home team"}</p>
            </div>
          </div>
          <span className="rounded-md border border-[#d8ad45]/35 bg-white px-3 py-2 text-center text-sm font-black text-[#8a6418]">
            {realMatch.status === "finished" && realMatch.home_score !== null && realMatch.away_score !== null
              ? `${realMatch.home_score} - ${realMatch.away_score}`
              : "VS"}
          </span>
          <div className="grid min-w-0 gap-2 sm:justify-items-end">
            <p className="min-w-0 break-words text-[10px] font-black uppercase tracking-[0.12em] text-[#8a6418] sm:text-right">
              {sourceLabel(setup.away, groupsById, teamsById)}
            </p>
            <div className="flex min-w-0 items-center gap-3 sm:justify-end">
              <TeamLogo className="!size-10 shrink-0 bg-[#061426]" initials={teamInitials(awayTeam)} logoUrl={awayTeam?.logo_url ?? ""} teamName={awayTeam?.name ?? "Away team"} />
              <p className="min-w-0 break-words text-sm font-black text-[#061426] sm:text-right">{awayTeam?.name ?? "Away team"}</p>
            </div>
          </div>
        </div>

        {form ? (
          <form className="mt-4 grid min-w-0 gap-3 rounded-lg border border-white bg-white p-3" onSubmit={(event) => void saveResult(event, realMatch)}>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">
                Date & Time
                <input
                  className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 px-3 py-2 text-sm font-bold"
                  onChange={(event) =>
                    setResultForms((current) => ({ ...current, [realMatch.id]: { ...form, matchDate: event.target.value } }))
                  }
                  type="datetime-local"
                  value={form.matchDate}
                />
              </label>
              <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">
                Venue
                <input
                  className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 px-3 py-2 text-sm font-bold"
                  onChange={(event) =>
                    setResultForms((current) => ({ ...current, [realMatch.id]: { ...form, venue: event.target.value } }))
                  }
                  value={form.venue}
                />
              </label>
              <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">
                Status
                <select
                  className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 px-3 py-2 text-sm font-bold"
                  onChange={(event) =>
                    setResultForms((current) => ({
                      ...current,
                      [realMatch.id]: {
                        ...form,
                        awayScore: event.target.value === "scheduled" ? "" : form.awayScore,
                        homeScore: event.target.value === "scheduled" ? "" : form.homeScore,
                        manualWinnerTeamId: event.target.value === "scheduled" ? "" : form.manualWinnerTeamId,
                        penaltyAwayScore: event.target.value === "scheduled" ? "" : form.penaltyAwayScore,
                        penaltyHomeScore: event.target.value === "scheduled" ? "" : form.penaltyHomeScore,
                        status: event.target.value as "scheduled" | "finished",
                      },
                    }))
                  }
                  value={form.status}
                >
                  <option value="scheduled">scheduled</option>
                  <option value="finished">finished</option>
                </select>
              </label>
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              {[
                ["Home Score", "homeScore"],
                ["Away Score", "awayScore"],
              ].map(([label, key]) => (
                <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600" key={key}>
                  {label}
                  <input
                    className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 px-3 py-2 text-sm font-bold"
                    max="999"
                    min="0"
                    onChange={(event) =>
                      setResultForms((current) => ({ ...current, [realMatch.id]: { ...form, [key]: event.target.value, status: event.target.value.trim() ? "finished" : form.status } }))
                    }
                    step="1"
                    type="number"
                    value={form[key as keyof KnockoutResultForm]}
                  />
                </label>
              ))}
            </div>
            {normalScoresAreDrawn ? (
              <div className="grid min-w-0 gap-3 rounded-md border border-[#d8ad45]/35 bg-[#fff7e6] p-3 sm:grid-cols-2">
                <p className="min-w-0 break-words text-xs font-bold text-[#8a6418] sm:col-span-2">
                  Drawn knockout matches require penalty scores or an advanced manual decision.
                </p>
                {[
                  ["Home Penalties", "penaltyHomeScore"],
                  ["Away Penalties", "penaltyAwayScore"],
                ].map(([label, key]) => (
                  <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600" key={key}>
                    {label}
                    <input
                      className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold"
                      max="999"
                      min="0"
                      onChange={(event) =>
                        setResultForms((current) => ({ ...current, [realMatch.id]: { ...form, [key]: event.target.value } }))
                      }
                      step="1"
                      type="number"
                      value={form[key as keyof KnockoutResultForm]}
                    />
                  </label>
                ))}
              </div>
            ) : null}
            <div className="grid min-w-0 gap-3">
              <button
                className="min-h-11 justify-self-start rounded-md border border-slate-200 px-4 py-2 text-sm font-black text-[#061426] hover:border-[#d8ad45]"
                onClick={() =>
                  setAdvancedDecisions((current) => ({ ...current, [realMatch.id]: !advancedDecisionOpen }))
                }
                type="button"
              >
                {advancedDecisionOpen ? "Hide penalty shootout / special decision" : "Penalty shootout / Special decision"}
              </button>
              {advancedDecisionOpen ? (
                <div className="grid min-w-0 gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="min-w-0 break-words text-xs font-bold text-slate-600">
                    Use penalties for a drawn knockout score. Use a special winner override only for exceptional decisions.
                  </p>
                  <label className="flex min-w-0 items-start gap-2 text-xs font-black text-slate-600">
                    <input
                      checked={specialDecisionOpen}
                      className="mt-1 size-4 shrink-0"
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setSpecialDecisions((current) => ({ ...current, [realMatch.id]: checked }));
                        if (!checked) {
                          setResultForms((current) => ({ ...current, [realMatch.id]: { ...form, manualWinnerTeamId: "" } }));
                        }
                      }}
                      type="checkbox"
                    />
                    Special winner override
                  </label>
                  {specialDecisionOpen ? (
                    <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">
                      Manual Winner
                      <select
                        className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold"
                        onChange={(event) =>
                          setResultForms((current) => ({ ...current, [realMatch.id]: { ...form, manualWinnerTeamId: event.target.value } }))
                        }
                        value={form.manualWinnerTeamId}
                      >
                        <option value="">Select special winner</option>
                        <option value={realMatch.home_team_id}>{homeTeam?.name ?? "Home"}</option>
                        <option value={realMatch.away_team_id}>{awayTeam?.name ?? "Away"}</option>
                      </select>
                    </label>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex justify-end">
              <button
                className="min-h-11 rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={savingResultId === realMatch.id}
                type="submit"
              >
                {savingResultId === realMatch.id ? "Saving..." : "Save Match"}
              </button>
            </div>
          </form>
        ) : null}
      </article>
    );
  }

  return (
    <section className="mx-auto w-full max-w-7xl scroll-mt-28 px-4 pb-10 sm:px-6 lg:px-10" id="knockout-summary">
      <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10">
        <div className="mb-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#8a6418]">Cup Workspace</p>
            <h2 className="mt-2 text-2xl font-black">Knockout Bracket Management</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              Manage pairing, match details, results, and winner progression in one workspace.
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            {pairingMode === "summary" && hasSavedSetup ? (
              <>
                <button
                  className="min-h-11 rounded-md border border-[#d8ad45]/45 px-4 py-2 text-sm font-black text-[#061426] hover:bg-[#fff7e6]"
                  onClick={startPairingEdit}
                  type="button"
                >
                  Edit Pairing
                </button>
                <button
                  className="min-h-11 rounded-md border border-slate-200 px-4 py-2 text-sm font-black hover:border-[#d8ad45]"
                  onClick={startPairingEdit}
                  type="button"
                >
                  Rebuild Bracket
                </button>
                <button
                  className="min-h-11 rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] hover:bg-[#091f39] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!schemaReady || creatingMatches || !initialMatches.length}
                  onClick={() => void createMatchesFromSetup()}
                  type="button"
                >
                  {creatingMatches ? "Creating..." : "Create Knockout Matches"}
                </button>
              </>
            ) : (
              <>
                <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600 sm:w-36">
                  Bracket size
                  <select
                    className="min-h-11 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-black text-[#061426]"
                    onChange={(event) => setBracketSize(Number(event.target.value))}
                    value={bracketSize}
                  >
                    {bracketSizes.map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                </label>
                <button
                  className="min-h-11 rounded-md border border-[#d8ad45]/45 px-4 py-2 text-sm font-black text-[#061426] hover:bg-[#fff7e6] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!schemaReady || !groups.length || !teams.length}
                  onClick={() => void loadSuggested()}
                  type="button"
                >
                  Suggested Pairing
                </button>
                <button
                  className="min-h-11 rounded-md border border-slate-200 px-4 py-2 text-sm font-black hover:border-[#d8ad45] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!schemaReady}
                  onClick={() => void loadBlank()}
                  type="button"
                >
                  Custom Blank
                </button>
              </>
            )}
          </div>
        </div>

        {!schemaReady ? (
          <p className="mt-5 rounded-lg border border-[#9b1c1f]/25 bg-[#9b1c1f]/10 px-4 py-3 text-sm font-bold text-[#9b1c1f]">
            Knockout data could not be loaded. Apply the M13F migration before saving knockout setup.
          </p>
        ) : null}
        {hasManualEdits ? (
          <label className="mt-5 flex min-w-0 items-start gap-3 rounded-lg border border-[#d8ad45]/35 bg-[#fff7e6] px-4 py-3 text-sm font-bold text-[#8a6418]">
            <input
              checked={overwriteManualEdits}
              className="mt-1 size-4 shrink-0"
              onChange={(event) => setOverwriteManualEdits(event.target.checked)}
              type="checkbox"
            />
            Existing knockout setup has manual edits. Check this before saving generated changes over it.
          </label>
        ) : null}
        {error ? <p className="mt-4 rounded-md border border-[#9b1c1f]/25 bg-[#9b1c1f]/10 px-3 py-2 text-sm font-bold text-[#9b1c1f]">{error}</p> : null}
        {message ? <p className="mt-4 rounded-md border border-emerald-700/20 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{message}</p> : null}
        {[...serverWarnings.map((warning, index) => ({ key: `server-${index}`, message: warning })), ...clientWarnings].length ? (
          <div className="mt-4 grid gap-2">
            {[...serverWarnings.map((warning, index) => ({ key: `server-${index}`, message: warning })), ...clientWarnings].map((warning) => (
              <p className="rounded-md border border-[#d8ad45]/35 bg-[#fff7e6] px-3 py-2 text-xs font-bold text-[#8a6418]" key={warning.key}>
                {warning.message}
              </p>
            ))}
          </div>
        ) : null}

        {!initialMatches.length && pairingMode === "summary" ? (
          <p className="mt-5 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
            No knockout setup yet. Generate a suggested pairing or start a custom blank bracket.
          </p>
        ) : null}

        {pairingMode === "summary" && initialMatches.length ? (
          <div className="mt-6 grid gap-5">
            <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Bracket size</p>
                <p className="mt-1 text-xl font-black text-[#061426]">{initialMatches[0]?.bracketSize ?? bracketSize}</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Rounds</p>
                <p className="mt-1 text-xl font-black text-[#061426]">{groupedSavedMatches.length}</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Pairs</p>
                <p className="mt-1 text-xl font-black text-[#061426]">{initialMatches.length}</p>
              </div>
            </div>
            {groupedSavedMatches.map(([roundLabel, roundMatches], index) => {
              const isOpen = roundIsExpanded(roundLabel, roundMatches, index);
              const unfinishedCount = roundMatches.filter((match) => {
                const realMatch = match.matchId ? knockoutMatchesById.get(match.matchId) : undefined;
                return !realMatch || realMatch.status !== "finished";
              }).length;

              return (
                <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4" key={roundLabel}>
                  <button
                    aria-expanded={isOpen}
                    className="flex min-h-11 w-full min-w-0 flex-col gap-2 text-left sm:flex-row sm:items-center sm:justify-between"
                    onClick={() => setExpandedRounds((current) => ({ ...current, [roundLabel]: !isOpen }))}
                    type="button"
                  >
                    <span className="text-lg font-black text-[#061426]">{roundLabel}</span>
                    <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-slate-600">
                      {roundMatches.length} total / {unfinishedCount} unfinished
                    </span>
                  </button>
                  {isOpen ? (
                    <div className="mt-4 grid gap-3">
                      {roundMatches.map((setup) => (
                        <KnockoutMatchCard key={`real-${setup.id ?? `${setup.roundIndex}-${setup.matchOrder}`}`} setup={setup} />
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        ) : null}

        {pairingMode === "edit" ? (
          <div className="mt-6 grid gap-5">
            {!draftMatches.length ? (
              <p className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
                No knockout setup yet. Generate a suggested pairing or start a custom blank bracket.
              </p>
            ) : null}
            {groupedDraftMatches.map(([roundLabel, roundMatches]) => (
              <section className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4" key={roundLabel}>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-lg font-black text-[#061426]">{roundLabel}</h3>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                    {roundMatches.length} match{roundMatches.length === 1 ? "" : "es"}
                  </p>
                </div>
                <div className="mt-4 grid gap-3">
                  {roundMatches.map((match) => (
                    <article className="min-w-0 rounded-lg border border-white bg-white p-3 shadow-sm" key={`${match.roundIndex}-${match.matchOrder}`}>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8a6418]">
                        Match {match.matchOrder}
                      </p>
                      <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2">
                        <SlotEditor match={match} side="home" source={match.home} />
                        <SlotEditor match={match} side="away" source={match.away} />
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              {hasSavedSetup ? (
                <button
                  className="min-h-11 rounded-md border border-slate-200 px-5 py-3 text-sm font-black hover:border-[#d8ad45]"
                  onClick={cancelPairingEdit}
                  type="button"
                >
                  Cancel
                </button>
              ) : null}
              <button
                className="min-h-11 rounded-md bg-[#061426] px-5 py-3 text-sm font-black text-[#f4d58a] hover:bg-[#091f39] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!schemaReady || saving || !draftMatches.length}
                onClick={() => void saveSetup()}
                type="button"
              >
                {saving ? "Saving..." : "Save Knockout Setup"}
              </button>
            </div>
          </div>
        ) : null}
      </article>
    </section>
  );
}

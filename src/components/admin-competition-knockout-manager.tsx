"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  previewBlankKnockout,
  previewSuggestedKnockout,
  saveKnockoutSetup,
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
  const [bracketSize, setBracketSize] = useState(initialMatches[0]?.bracketSize || 8);
  const [matches, setMatches] = useState<KnockoutMatchSlot[]>(initialMatches);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [serverWarnings, setServerWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [overwriteManualEdits, setOverwriteManualEdits] = useState(false);
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
  const groupedMatches = useMemo(() => {
    const map = new Map<string, KnockoutMatchSlot[]>();
    matches.forEach((match) => {
      map.set(match.roundLabel, [...(map.get(match.roundLabel) ?? []), match]);
    });
    return Array.from(map.entries());
  }, [matches]);
  const clientWarnings = useMemo(() => warningsForMatches(matches), [matches]);
  const hasManualEdits = initialMatches.some((match) => match.isManualEdited);

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

    setMatches(result.matches);
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

    setMatches(result.matches);
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
      matches,
      overwriteManualEdits,
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "Could not save knockout setup.");
      setServerWarnings(result.warnings ?? []);
      return;
    }

    setMatches(result.matches ?? matches);
    setOverwriteManualEdits(false);
    setServerWarnings(result.warnings ?? []);
    setMessage("Knockout setup saved.");
    router.refresh();
  }

  function updateSlot(match: KnockoutMatchSlot, side: "away" | "home", source: KnockoutSlotSource) {
    setMatches((current) => updateMatchSlot(current, match, side, source));
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

    return (
      <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500">
        {sourceLabel(source, groupsById, teamsById)}
      </p>
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

  return (
    <section className="mx-auto w-full max-w-7xl scroll-mt-28 px-4 pb-10 sm:px-6 lg:px-10" id="knockout-summary">
      <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10">
        <div className="mb-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#8a6418]">Cup Workspace</p>
            <h2 className="mt-2 text-2xl font-black">Knockout Setup</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              Define knockout slot sources. Match progression and public bracket rendering come later.
            </p>
          </div>
          <div className="grid min-w-0 gap-2 sm:grid-cols-[140px_auto_auto]">
            <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">
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

        {!matches.length ? (
          <p className="mt-5 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
            No knockout setup yet. Generate a suggested pairing or start a custom blank bracket.
          </p>
        ) : (
          <div className="mt-6 grid gap-5">
            {groupedMatches.map(([roundLabel, roundMatches]) => (
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
              <button
                className="min-h-11 rounded-md bg-[#061426] px-5 py-3 text-sm font-black text-[#f4d58a] hover:bg-[#091f39] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!schemaReady || saving}
                onClick={() => void saveSetup()}
                type="button"
              >
                {saving ? "Saving..." : "Save Knockout Setup"}
              </button>
            </div>
          </div>
        )}
      </article>
    </section>
  );
}

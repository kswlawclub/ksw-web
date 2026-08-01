"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TeamLogo } from "@/components/team-logo";
import {
  assignCompetitionTeamToGroup,
  createCompetitionGroup,
  deleteCompetitionGroup,
  generateCupGroupFixtures,
  previewCupGroupFixtures,
  updateCompetitionGroup,
  updateCompetitionGroupQualifiers,
  type CupGroupFixturePreviewPair,
} from "@/app/admin/competitions/[id]/group-actions";
import {
  calculateCupGroupStandings,
  type CupGroupRow,
  type CupGroupStanding,
} from "@/lib/cup-group-standings";
import { compareTeamsByName } from "@/lib/team-sort";

export type AdminCompetitionGroup = {
  id: string;
  label: string;
  name: string;
  qualifiers_count: number;
  sort_order: number;
};

export type AdminCompetitionGroupTeam = {
  competition_team_id: string;
  display_order: number;
  group_id: string | null;
  is_active: boolean;
  is_ksw: boolean;
  logo_url: string | null;
  name: string;
  short_name: string | null;
  team_id: string;
};

type GroupForm = {
  id: string;
  label: string;
  name: string;
  sortOrder: string;
};

const emptyForm: GroupForm = {
  id: "",
  label: "",
  name: "",
  sortOrder: "0",
};

function teamInitials(team: AdminCompetitionGroupTeam) {
  return (team.short_name || team.name || "FC").slice(0, 3).toUpperCase();
}

function groupDisplayName(group: AdminCompetitionGroup) {
  return group.label || `Group ${group.name}`;
}

function unassignedFirst(groups: AdminCompetitionGroup[]) {
  return [...groups].sort((a, b) => {
    const orderDiff = a.sort_order - b.sort_order;
    if (orderDiff) return orderDiff;
    return groupDisplayName(a).localeCompare(groupDisplayName(b));
  });
}

function WorkflowStep({
  label,
  status,
}: {
  label: string;
  status: "available" | "coming" | "done";
}) {
  const className =
    status === "done"
      ? "border-emerald-700/20 bg-emerald-50 text-emerald-800"
      : status === "available"
        ? "border-[#d8ad45]/35 bg-[#fff7e6] text-[#8a6418]"
        : "border-slate-200 bg-slate-50 text-slate-500";

  return (
    <li className={`rounded-md border px-3 py-2 text-xs font-black ${className}`}>
      {label}
      <span className="ml-2 rounded-full bg-white/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]">
        {status === "coming" ? "Coming next" : "Available"}
      </span>
    </li>
  );
}

export function AdminCompetitionGroupsManager({
  competitionId,
  groups,
  matches,
  schemaReady,
  teams,
}: {
  competitionId: string;
  groups: AdminCompetitionGroup[];
  matches: CupGroupRow[];
  schemaReady: boolean;
  teams: AdminCompetitionGroupTeam[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<GroupForm>(emptyForm);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [assigningId, setAssigningId] = useState("");
  const [fixtureActionGroupId, setFixtureActionGroupId] = useState("");
  const [fixturePreviewByGroup, setFixturePreviewByGroup] = useState<Record<string, CupGroupFixturePreviewPair[]>>({});
  const [qualifierActionGroupId, setQualifierActionGroupId] = useState("");
  const sortedGroups = useMemo(() => unassignedFirst(groups), [groups]);
  const groupStandings = useMemo(
    () => calculateCupGroupStandings({ groups, matches, teams }),
    [groups, matches, teams],
  );
  const standingsByGroup = useMemo(
    () => new Map(groupStandings.map((standing) => [standing.group_id, standing])),
    [groupStandings],
  );
  const teamsByGroup = useMemo(() => {
    const grouped = new Map<string, AdminCompetitionGroupTeam[]>();
    teams.forEach((team) => {
      const key = team.group_id || "";
      grouped.set(key, [...(grouped.get(key) ?? []), team]);
    });
    grouped.forEach((items, key) => {
      grouped.set(
        key,
        [...items].sort((a, b) => {
          const orderDiff = a.display_order - b.display_order;
          if (orderDiff) return orderDiff;
          return compareTeamsByName(
            { id: a.team_id, name: a.name },
            { id: b.team_id, name: b.name },
          );
        }),
      );
    });
    return grouped;
  }, [teams]);
  const assignedCount = teams.filter((team) => team.group_id).length;
  const unassignedTeams = [...(teamsByGroup.get("") ?? [])].sort((a, b) =>
    compareTeamsByName(
      { id: a.team_id, name: a.name },
      { id: b.team_id, name: b.name },
    ),
  );
  const [showAllUnassignedTeams, setShowAllUnassignedTeams] = useState(false);
  const visibleUnassignedTeams = showAllUnassignedTeams ? unassignedTeams : unassignedTeams.slice(0, 16);

  function editGroup(group: AdminCompetitionGroup) {
    setForm({
      id: group.id,
      label: group.label,
      name: group.name,
      sortOrder: String(group.sort_order),
    });
    setMessage("");
    setError("");
  }

  function resetForm() {
    setForm(emptyForm);
    setError("");
  }

  async function saveGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    const payload = {
      competitionId,
      label: form.label,
      name: form.name,
      sortOrder: form.sortOrder,
    };
    const result = form.id
      ? await updateCompetitionGroup(competitionId, form.id, payload)
      : await createCompetitionGroup(payload);

    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "Could not save group.");
      return;
    }

    setMessage(form.id ? "Group updated." : "Group created.");
    setForm(emptyForm);
    router.refresh();
  }

  async function removeGroup(group: AdminCompetitionGroup) {
    const confirmed = window.confirm(
      `Delete ${groupDisplayName(group)}? Teams in this group will stay in the competition and return to unassigned.`,
    );

    if (!confirmed) return;

    setMessage("");
    setError("");
    const result = await deleteCompetitionGroup(competitionId, group.id);

    if (!result.ok) {
      setError(result.error ?? "Could not delete group.");
      return;
    }

    setMessage("Group deleted. Assigned teams are now unassigned.");
    if (form.id === group.id) setForm(emptyForm);
    router.refresh();
  }

  async function assignTeam(team: AdminCompetitionGroupTeam, groupId: string) {
    setAssigningId(team.competition_team_id);
    setMessage("");
    setError("");
    const result = await assignCompetitionTeamToGroup({
      competitionId,
      competitionTeamId: team.competition_team_id,
      groupId: groupId || null,
    });

    setAssigningId("");

    if (!result.ok) {
      setError(result.error ?? "Could not update team group.");
      return;
    }

    setMessage(groupId ? "Team moved to group." : "Team moved to unassigned.");
    router.refresh();
  }

  async function previewFixtures(group: AdminCompetitionGroup) {
    setFixtureActionGroupId(group.id);
    setMessage("");
    setError("");
    const result = await previewCupGroupFixtures(competitionId, group.id);
    setFixtureActionGroupId("");

    if (!result.ok) {
      setError(result.error ?? "Could not preview fixtures.");
      return;
    }

    setFixturePreviewByGroup((current) => ({ ...current, [group.id]: result.pairs ?? [] }));
    setMessage(`${groupDisplayName(group)} preview ready: ${result.totalPairs ?? 0} fixtures.`);
  }

  async function generateFixtures(group: AdminCompetitionGroup) {
    setFixtureActionGroupId(group.id);
    setMessage("");
    setError("");
    const result = await generateCupGroupFixtures(competitionId, group.id);
    setFixtureActionGroupId("");

    if (!result.ok) {
      setError(result.error ?? "Could not generate fixtures.");
      return;
    }

    setFixturePreviewByGroup((current) => ({ ...current, [group.id]: result.pairs ?? [] }));
    setMessage(
      `${groupDisplayName(group)} fixtures generated: ${result.createdCount ?? 0} created, ${result.skippedCount ?? 0} skipped.`,
    );
    router.refresh();
  }

  async function updateQualifiers(group: AdminCompetitionGroup, value: string, teamCount: number) {
    const qualifiersCount = Number(value);

    setMessage("");
    setError("");

    if (!Number.isInteger(qualifiersCount) || qualifiersCount < 0) {
      setError("Teams qualifying must be zero or a whole number.");
      return;
    }

    if (qualifiersCount > teamCount) {
      setError("Teams qualifying cannot exceed the teams currently in this group.");
      return;
    }

    setQualifierActionGroupId(group.id);
    const result = await updateCompetitionGroupQualifiers({
      competitionId,
      groupId: group.id,
      qualifiersCount,
    });
    setQualifierActionGroupId("");

    if (!result.ok) {
      setError(result.error ?? "Could not update teams qualifying.");
      return;
    }

    setMessage(`${groupDisplayName(group)} qualification setting updated.`);
    router.refresh();
  }

  function GroupStandingsTable({ standings }: { standings: CupGroupStanding }) {
    if (!standings.team_count) {
      return (
        <p className="mt-4 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
          ยังไม่มีทีมในกลุ่มนี้
        </p>
      );
    }

    return (
      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col gap-2 border-b border-slate-100 bg-slate-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8a6418]">Group Standings</p>
            <p className="mt-1 text-xs font-bold text-slate-500">
              {standings.is_complete ? "แข่งครบแล้ว" : "สถานะชั่วคราว"} · {standings.finished_matches}/{standings.total_required_matches} results
            </p>
          </div>
          {!standings.finished_matches ? (
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
              No results yet
            </span>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-separate border-spacing-0 text-left text-xs">
            <thead className="bg-[#061426] text-white">
              <tr>
                {["#", "Team", "P", "W", "D", "L", "GF", "GA", "GD", "Pts", "Status"].map((label) => (
                  <th className="px-3 py-2 font-black" key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {standings.rows.map((row) => (
                <tr className={row.qualifies ? "bg-[#fff7e6]" : "bg-white"} key={row.team_id}>
                  <td className="border-b border-slate-100 px-3 py-2 font-black">{row.position}</td>
                  <td className="min-w-44 border-b border-slate-100 px-3 py-2 font-black text-[#061426]">
                    <span className="break-words">{row.team_name}</span>
                    {row.tie_unresolved ? (
                      <span className="mt-1 block text-[10px] font-bold text-[#8a6418]">อันดับยังเสมอกัน</span>
                    ) : null}
                  </td>
                  {[row.played, row.won, row.drawn, row.lost, row.goals_for, row.goals_against, row.goal_difference, row.points].map((value, index) => (
                    <td className="border-b border-slate-100 px-3 py-2 font-bold" key={index}>{value}</td>
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
      </div>
    );
  }

  function TeamAssignmentRow({ team }: { team: AdminCompetitionGroupTeam }) {
    return (
      <div className="grid min-w-0 gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <TeamLogo
            className="!size-10 shrink-0 bg-[#061426]"
            initials={teamInitials(team)}
            logoUrl={team.logo_url ?? ""}
            teamName={team.name}
          />
          <div className="min-w-0">
            <p className="break-words text-sm font-black text-[#061426]">{team.name}</p>
            {team.is_ksw ? <p className="text-xs font-bold text-[#8a6418]">KSW team</p> : null}
          </div>
        </div>
        <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">
          Group
          <select
            className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-[#061426] outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={assigningId === team.competition_team_id || !schemaReady}
            onChange={(event) => void assignTeam(team, event.target.value)}
            value={team.group_id ?? ""}
          >
            <option value="">ยังไม่จัดกลุ่ม</option>
            {sortedGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {groupDisplayName(group)}
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  }

  function UnassignedTeamCard({ team }: { team: AdminCompetitionGroupTeam }) {
    return (
      <div className="grid min-w-0 gap-2 rounded-md border border-slate-100 bg-slate-50 p-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <TeamLogo
            className="!size-8 shrink-0 bg-[#061426]"
            initials={teamInitials(team)}
            logoUrl={team.logo_url ?? ""}
            teamName={team.name}
          />
          <p className="min-w-0 flex-1 break-words text-sm font-black leading-5 text-[#061426]">{team.name}</p>
          {team.is_ksw ? <span className="shrink-0 rounded-full bg-[#fff7e6] px-2 py-1 text-[10px] font-black text-[#8a6418]">KSW</span> : null}
        </div>
        <label className="grid min-w-0 gap-1 text-[11px] font-black text-slate-600">
          จัดเข้ากลุ่ม
          <select
            className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-[#061426] outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={assigningId === team.competition_team_id || !schemaReady}
            onChange={(event) => void assignTeam(team, event.target.value)}
            value={team.group_id ?? ""}
          >
            <option value="">ยังไม่จัดกลุ่ม</option>
            {sortedGroups.map((group) => <option key={group.id} value={group.id}>{groupDisplayName(group)}</option>)}
          </select>
        </label>
      </div>
    );
  }

  return (
    <section className="mx-auto w-full max-w-7xl scroll-mt-28 px-4 pb-10 sm:px-6 lg:px-10" id="groups-summary">
      <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10">
        <div className="mb-4 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#8a6418]">Cup Workspace</p>
            <h2 className="mt-2 text-2xl font-black">Group Stage</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              Create cup groups and assign participating teams before building group-stage fixtures.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Groups</p>
              <p className="text-xl font-black">{groups.length}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Assigned</p>
              <p className="text-xl font-black">{assignedCount}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Unassigned</p>
              <p className="text-xl font-black">{unassignedTeams.length}</p>
            </div>
          </div>
        </div>

        {!schemaReady ? (
          <p className="mt-5 rounded-lg border border-[#9b1c1f]/25 bg-[#9b1c1f]/10 px-4 py-3 text-sm font-bold text-[#9b1c1f]">
            Group data could not be loaded. Apply the M13C migration before managing cup groups.
          </p>
        ) : null}

        <ol className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <WorkflowStep label="1. เพิ่มทีม" status={teams.length ? "done" : "available"} />
          <WorkflowStep label="2. สร้างกลุ่ม" status={groups.length ? "done" : "available"} />
          <WorkflowStep label="3. จัดทีมลงกลุ่ม" status={assignedCount ? "done" : "available"} />
          <WorkflowStep label="4. สร้างการแข่งขันรอบแบ่งกลุ่ม" status={assignedCount ? "available" : "coming"} />
          <WorkflowStep label="5. ตารางคะแนนและทีมเข้ารอบ" status="coming" />
          <WorkflowStep label="6. Knockout bracket" status="coming" />
        </ol>

        <form className="mt-6 grid gap-3 rounded-lg border border-[#d8ad45]/30 bg-[#fffaf0] p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_140px_auto] lg:items-end" onSubmit={saveGroup}>
          <label className="grid min-w-0 gap-2 text-sm font-black">
            Group Name
            <input
              className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
              disabled={!schemaReady}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="A"
              required
              value={form.name}
            />
          </label>
          <label className="grid min-w-0 gap-2 text-sm font-black">
            Display Label
            <input
              className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
              disabled={!schemaReady}
              onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
              placeholder="Group A"
              value={form.label}
            />
          </label>
          <label className="grid min-w-0 gap-2 text-sm font-black">
            Sort Order
            <input
              className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
              disabled={!schemaReady}
              onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))}
              step="1"
              type="number"
              value={form.sortOrder}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              className="min-h-11 rounded-md bg-[#061426] px-4 py-2 text-sm font-black text-[#f4d58a] hover:bg-[#091f39] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving || !schemaReady}
              type="submit"
            >
              {saving ? "Saving..." : form.id ? "Update Group" : "Add Group"}
            </button>
            {form.id ? (
              <button className="min-h-11 rounded-md border border-slate-200 px-4 py-2 text-sm font-black" onClick={resetForm} type="button">
                Cancel
              </button>
            ) : null}
          </div>
        </form>

        {error ? (
          <p className="mt-4 rounded-md border border-[#9b1c1f]/25 bg-[#9b1c1f]/10 px-3 py-2 text-sm font-bold text-[#9b1c1f]">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="mt-4 rounded-md border border-emerald-700/20 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
            {message}
          </p>
        ) : null}

        {!teams.length ? (
          <p className="mt-5 rounded-lg border border-[#d8ad45]/35 bg-[#fff7e6] px-4 py-3 text-sm font-bold text-[#8a6418]">
            This cup has no teams yet. Add participants from Manage Teams before assigning groups.
          </p>
        ) : null}

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {sortedGroups.length ? (
            sortedGroups.map((group) => {
              const groupTeams = teamsByGroup.get(group.id) ?? [];
              const previewPairs = fixturePreviewByGroup[group.id] ?? [];
              const missingPreviewCount = previewPairs.filter((pair) => !pair.exists).length;
              const standings = standingsByGroup.get(group.id);
              return (
                <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm" key={group.id}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8a6418]">
                        {group.name}
                      </p>
                      <h3 className="mt-1 break-words text-xl font-black">{groupDisplayName(group)}</h3>
                      <p className="mt-1 text-sm font-semibold text-slate-500">
                        {groupTeams.length} teams · Sort {group.sort_order}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="rounded-md border border-[#d8ad45]/45 px-3 py-2 text-xs font-black text-[#061426] hover:bg-[#fff7e6] disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!schemaReady || fixtureActionGroupId === group.id || groupTeams.length < 2}
                        onClick={() => void previewFixtures(group)}
                        type="button"
                      >
                        {fixtureActionGroupId === group.id ? "Loading..." : "Generate Fixtures"}
                      </button>
                      <button
                        className="rounded-md border border-slate-200 px-3 py-2 text-xs font-black hover:border-[#d8ad45]"
                        onClick={() => editGroup(group)}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        className="rounded-md border border-[#9b1c1f]/30 px-3 py-2 text-xs font-black text-[#9b1c1f] hover:bg-[#9b1c1f]/10"
                        onClick={() => void removeGroup(group)}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <label className="grid min-w-0 gap-2 text-xs font-black text-slate-600">
                      Teams qualifying
                      <input
                        className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-[#061426] outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!schemaReady || qualifierActionGroupId === group.id}
                        max={groupTeams.length}
                        min="0"
                        onBlur={(event) => void updateQualifiers(group, event.target.value, groupTeams.length)}
                        step="1"
                        type="number"
                        defaultValue={group.qualifiers_count}
                      />
                    </label>
                    <p className="mt-2 text-xs font-bold text-slate-500">
                      Maximum {groupTeams.length} team{groupTeams.length === 1 ? "" : "s"} in this group.
                    </p>
                  </div>
                  {standings ? <GroupStandingsTable standings={standings} /> : null}
                  <div className="mt-4 grid gap-2">
                    {groupTeams.length ? (
                      groupTeams.map((team) => <TeamAssignmentRow key={team.competition_team_id} team={team} />)
                    ) : (
                      <p className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
                        This group is empty.
                      </p>
                    )}
                  </div>
                  {groupTeams.length < 2 ? (
                    <p className="mt-3 rounded-md border border-[#d8ad45]/35 bg-[#fff7e6] px-3 py-2 text-xs font-bold text-[#8a6418]">
                      ต้องมีอย่างน้อย 2 ทีมในกลุ่มก่อนสร้างคู่แข่งขัน
                    </p>
                  ) : null}
                  {previewPairs.length ? (
                    <div className="mt-4 rounded-lg border border-[#d8ad45]/30 bg-[#fffaf0] p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8a6418]">
                            Fixture Preview
                          </p>
                          <p className="mt-1 text-sm font-bold text-slate-600">
                            {previewPairs.length} fixtures · {missingPreviewCount} to create
                          </p>
                        </div>
                        <button
                          className="min-h-11 rounded-md bg-[#061426] px-4 py-2 text-xs font-black text-[#f4d58a] hover:bg-[#091f39] disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={fixtureActionGroupId === group.id || missingPreviewCount === 0}
                          onClick={() => void generateFixtures(group)}
                          type="button"
                        >
                          {missingPreviewCount === 0 ? "All Created" : "Confirm Generate"}
                        </button>
                      </div>
                      <div className="mt-3 grid gap-2">
                        {previewPairs.map((pair) => (
                          <div
                            className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-white bg-white px-3 py-2 text-sm font-bold text-[#061426]"
                            key={`${pair.homeTeamId}-${pair.awayTeamId}`}
                          >
                            <span className="min-w-0 break-words">{pair.homeTeamName} vs {pair.awayTeamName}</span>
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${
                              pair.exists ? "bg-slate-100 text-slate-500" : "bg-[#d8ad45]/15 text-[#8a6418]"
                            }`}>
                              {pair.exists ? "Existing" : "New"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })
          ) : (
            <p className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600 lg:col-span-2">
              No groups yet. Create Group A, Group B, or another group to start the cup group stage.
            </p>
          )}
        </div>

        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-xl font-black">ทีมที่ยังไม่จัดกลุ่ม</h3>
          <div className="mt-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-600">
            ทีมที่ยังไม่จัดกลุ่ม <strong className="ml-2 text-[#061426]">{unassignedTeams.length}</strong>
          </div>
          <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {unassignedTeams.length ? (
              visibleUnassignedTeams.map((team) => <UnassignedTeamCard key={team.competition_team_id} team={team} />)
            ) : (
              <p className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600 xl:col-span-4">
                ทุกทีมถูกจัดกลุ่มแล้ว
              </p>
            )}
          </div>
          {unassignedTeams.length > 16 ? (
            <button className="mt-4 min-h-11 rounded-md border border-slate-200 px-4 py-2 text-sm font-black text-[#061426] hover:border-[#d8ad45]" onClick={() => setShowAllUnassignedTeams((current) => !current)} type="button">
              {showAllUnassignedTeams ? "แสดงน้อยลง" : "แสดงทั้งหมด / Show all"}
            </button>
          ) : null}
        </section>
      </article>
    </section>
  );
}

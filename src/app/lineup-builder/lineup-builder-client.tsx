"use client";

import { type CSSProperties, useMemo, useState } from "react";

export type LineupMember = {
  id: string;
  nickname: string;
  photo_url: string | null;
  shirt_number: number | null;
  birth_year_be: number | null;
  is_active: boolean;
};

export type OpponentTeam = {
  id: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
};

type PositionSlot = {
  label: string;
  x: number;
  y: number;
};

type LineupBuilderProps = {
  members: LineupMember[];
  opponents: OpponentTeam[];
};

type Formation =
  | "4-4-2"
  | "4-4-1-1"
  | "4-3-3"
  | "4-2-3-1"
  | "4-1-4-1"
  | "4-5-1"
  | "4-3-1-2"
  | "4-3-2-1"
  | "4-2-2-2"
  | "4-1-2-1-2"
  | "4-2-4"
  | "3-5-2"
  | "3-4-3"
  | "3-4-2-1"
  | "3-4-1-2"
  | "3-3-3-1"
  | "3-2-4-1"
  | "5-3-2"
  | "5-4-1"
  | "5-2-3"
  | "5-2-1-2"
  | "5-1-3-1"
  | "4-1-3-2"
  | "4-2-1-3"
  | "4-3-3 False 9"
  | "4-3-3 Holding"
  | "4-3-3 Attack"
  | "4-4-2 Diamond"
  | "4-4-2 Flat"
  | "4-2-3-1 Wide"
  | "4-2-3-1 Narrow"
  | "3-5-1-1"
  | "3-6-1";

const formations: Record<Formation, string[][]> = {
  "4-4-2": [["GK"], ["LB", "CB", "CB", "RB"], ["LM", "CM", "CM", "RM"], ["ST", "ST"]],
  "4-4-1-1": [["GK"], ["LB", "CB", "CB", "RB"], ["LM", "CM", "CM", "RM"], ["SS"], ["ST"]],
  "4-3-3": [["GK"], ["LB", "CB", "CB", "RB"], ["CM", "CM", "CM"], ["LW", "ST", "RW"]],
  "4-2-3-1": [["GK"], ["LB", "CB", "CB", "RB"], ["DM", "DM"], ["LW", "AM", "RW"], ["ST"]],
  "4-1-4-1": [["GK"], ["LB", "CB", "CB", "RB"], ["DM"], ["LM", "CM", "CM", "RM"], ["ST"]],
  "4-5-1": [["GK"], ["LB", "CB", "CB", "RB"], ["LM", "CM", "CM", "CM", "RM"], ["ST"]],
  "4-3-1-2": [["GK"], ["LB", "CB", "CB", "RB"], ["CM", "CM", "CM"], ["AM"], ["ST", "ST"]],
  "4-3-2-1": [["GK"], ["LB", "CB", "CB", "RB"], ["CM", "CM", "CM"], ["AM", "AM"], ["ST"]],
  "4-2-2-2": [["GK"], ["LB", "CB", "CB", "RB"], ["DM", "DM"], ["AM", "AM"], ["ST", "ST"]],
  "4-1-2-1-2": [["GK"], ["LB", "CB", "CB", "RB"], ["DM"], ["CM", "CM"], ["AM"], ["ST", "ST"]],
  "4-2-4": [["GK"], ["LB", "CB", "CB", "RB"], ["CM", "CM"], ["LW", "ST", "ST", "RW"]],
  "3-5-2": [["GK"], ["CB", "CB", "CB"], ["LWB", "CM", "CM", "CM", "RWB"], ["ST", "ST"]],
  "3-4-3": [["GK"], ["CB", "CB", "CB"], ["LM", "CM", "CM", "RM"], ["LW", "ST", "RW"]],
  "3-4-2-1": [["GK"], ["CB", "CB", "CB"], ["LWB", "CM", "CM", "RWB"], ["AM", "AM"], ["ST"]],
  "3-4-1-2": [["GK"], ["CB", "CB", "CB"], ["LWB", "CM", "CM", "RWB"], ["AM"], ["ST", "ST"]],
  "3-3-3-1": [["GK"], ["CB", "CB", "CB"], ["DM", "CM", "DM"], ["LW", "AM", "RW"], ["ST"]],
  "3-2-4-1": [["GK"], ["CB", "CB", "CB"], ["DM", "DM"], ["LW", "AM", "AM", "RW"], ["ST"]],
  "5-3-2": [["GK"], ["LB", "CB", "CB", "CB", "RB"], ["CM", "CM", "CM"], ["ST", "ST"]],
  "5-4-1": [["GK"], ["LB", "CB", "CB", "CB", "RB"], ["LM", "CM", "CM", "RM"], ["ST"]],
  "5-2-3": [["GK"], ["LB", "CB", "CB", "CB", "RB"], ["CM", "CM"], ["LW", "ST", "RW"]],
  "5-2-1-2": [["GK"], ["LB", "CB", "CB", "CB", "RB"], ["CM", "CM"], ["AM"], ["ST", "ST"]],
  "5-1-3-1": [["GK"], ["LB", "CB", "CB", "CB", "RB"], ["DM"], ["LW", "AM", "RW"], ["ST"]],
  "4-1-3-2": [["GK"], ["LB", "CB", "CB", "RB"], ["DM"], ["LM", "CM", "RM"], ["ST", "ST"]],
  "4-2-1-3": [["GK"], ["LB", "CB", "CB", "RB"], ["DM", "DM"], ["AM"], ["LW", "ST", "RW"]],
  "4-3-3 False 9": [["GK"], ["LB", "CB", "CB", "RB"], ["CM", "CM", "CM"], ["LW", "CF", "RW"]],
  "4-3-3 Holding": [["GK"], ["LB", "CB", "CB", "RB"], ["DM", "CM", "CM"], ["LW", "ST", "RW"]],
  "4-3-3 Attack": [["GK"], ["LB", "CB", "CB", "RB"], ["CM", "CM", "AM"], ["LW", "ST", "RW"]],
  "4-4-2 Diamond": [["GK"], ["LB", "CB", "CB", "RB"], ["DM"], ["CM", "CM"], ["AM"], ["ST", "ST"]],
  "4-4-2 Flat": [["GK"], ["LB", "CB", "CB", "RB"], ["LM", "CM", "CM", "RM"], ["ST", "ST"]],
  "4-2-3-1 Wide": [["GK"], ["LB", "CB", "CB", "RB"], ["DM", "DM"], ["LW", "AM", "RW"], ["ST"]],
  "4-2-3-1 Narrow": [["GK"], ["LB", "CB", "CB", "RB"], ["DM", "DM"], ["AM", "AM", "AM"], ["ST"]],
  "3-5-1-1": [["GK"], ["CB", "CB", "CB"], ["LWB", "CM", "CM", "CM", "RWB"], ["SS"], ["ST"]],
  "3-6-1": [["GK"], ["CB", "CB", "CB"], ["LWB", "DM", "CM", "AM", "CM", "RWB"], ["ST"]],
};

const formationOptions = Object.keys(formations) as Formation[];
const rowYByCount: Record<number, number[]> = {
  4: [90, 71, 48, 22],
  5: [90, 73, 56, 39, 20],
  6: [90, 74, 61, 48, 35, 19],
};

function rowXs(count: number) {
  if (count === 1) return [50];
  if (count === 2) return [39, 61];
  if (count === 3) return [28, 50, 72];
  if (count === 4) return [18, 39, 61, 82];
  if (count === 5) return [13, 31, 50, 69, 87];
  return [10, 26, 42, 58, 74, 90];
}

function formationPositions(formationName: Formation) {
  const rows = formations[formationName];
  const yValues = rowYByCount[rows.length] ?? rowYByCount[5];

  return rows.flatMap((row, rowIndex) => {
    const xValues = rowXs(row.length);

    return row.map((label, index) => ({
      label,
      x: xValues[index],
      y: yValues[rowIndex],
    }));
  });
}

function formatPublicLawyerName(nickname: string) {
  const value = nickname.trim();

  if (!value) {
    return "ทนาย";
  }

  return value.startsWith("ทนาย") ? value : `ทนาย${value}`;
}

function formatDropdownNickname(nickname: string) {
  return nickname.trim().replace(/^ทนาย\s*/, "") || "Player";
}

function currentBuddhistYear() {
  return new Date().getFullYear() + 543;
}

function displayAge(member: Pick<LineupMember, "birth_year_be">) {
  const birthYear = member.birth_year_be;
  const currentYear = currentBuddhistYear();

  if (!birthYear || Number.isNaN(birthYear) || birthYear < 2400 || birthYear > currentYear) {
    return null;
  }

  return currentYear - birthYear;
}

const ageGroupStyles = [
  {
    label: "U35",
    sampleClass: "bg-[#c93a3a]",
    borderClass: "border-[#c93a3a]",
    textColor: "#ff8b8b",
    glow: "rgba(201,58,58,0.3)",
    match: (age: number | null) => age !== null && age < 35,
  },
  {
    label: "35-39",
    sampleClass: "bg-[#e7c947]",
    borderClass: "border-[#e7c947]",
    textColor: "#f4d85f",
    glow: "rgba(231,201,71,0.32)",
    match: (age: number | null) => age !== null && age >= 35 && age <= 39,
  },
  {
    label: "40-44",
    sampleClass: "bg-white ring-1 ring-slate-300",
    borderClass: "border-white",
    textColor: "#ffffff",
    glow: "rgba(255,255,255,0.34)",
    match: (age: number | null) => age !== null && age >= 40 && age <= 44,
  },
  {
    label: "45-49",
    sampleClass: "bg-[#3b82c4]",
    borderClass: "border-[#3b82c4]",
    textColor: "#8fc5ff",
    glow: "rgba(59,130,196,0.34)",
    match: (age: number | null) => age !== null && age >= 45 && age <= 49,
  },
  {
    label: "50+",
    sampleClass: "bg-[#d8ad45]",
    borderClass: "border-[#d8ad45]",
    textColor: "#f4d58a",
    glow: "rgba(216,173,69,0.36)",
    match: (age: number | null) => age !== null && age >= 50,
  },
];
const missingAgeGroup = {
  label: "Age -",
  sampleClass: "bg-slate-400",
  borderClass: "border-slate-400",
  textColor: "#cbd5e1",
  glow: "rgba(148,163,184,0.26)",
};
const goalkeeperAgeGroup = {
  label: "GK",
  sampleClass: "bg-[#d8ad45]",
  borderClass: "border-[#d8ad45]",
  textColor: "#f4d58a",
  glow: "rgba(216,173,69,0.38)",
};
const ageLegend = [...ageGroupStyles, missingAgeGroup];

function ageGroup(age: number | null) {
  return (
    ageGroupStyles.find((group) => group.match(age)) ?? missingAgeGroup
  );
}

function markerGroupForPosition(positionLabel: string, age: number | null) {
  return positionLabel === "GK" ? goalkeeperAgeGroup : ageGroup(age);
}

function memberOptionLabel(member: LineupMember) {
  const number = member.shirt_number ? `#${member.shirt_number} ` : "";
  const age = displayAge(member);

  return `${number}${formatDropdownNickname(member.nickname)} · ${age === null ? "Age -" : `Age ${age}`}`;
}

function compareMembersByDisplayAge(a: LineupMember, b: LineupMember) {
  const leftAge = displayAge(a);
  const rightAge = displayAge(b);

  if (leftAge === null && rightAge === null) {
    return formatDropdownNickname(a.nickname).localeCompare(formatDropdownNickname(b.nickname));
  }

  if (leftAge === null) return 1;
  if (rightAge === null) return -1;

  return leftAge - rightAge || formatDropdownNickname(a.nickname).localeCompare(formatDropdownNickname(b.nickname));
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function LineupBuilderClient({ members, opponents }: LineupBuilderProps) {
  const [formation, setFormation] = useState<Formation>("4-3-3");
  const [opponentId, setOpponentId] = useState("");
  const [selectedPlayers, setSelectedPlayers] = useState<Record<number, string>>({});
  const [recentlyChangedPosition, setRecentlyChangedPosition] = useState<number | null>(null);
  const [openDropdown, setOpenDropdown] = useState<number | null>(null);
  const [mobileDetailPosition, setMobileDetailPosition] = useState<number | null>(null);

  const positions = useMemo(() => formationPositions(formation), [formation]);
  const opponent = opponents.find((team) => team.id === opponentId) ?? null;
  const selectedIds = useMemo(
    () => new Set(Object.values(selectedPlayers).filter(Boolean)),
    [selectedPlayers],
  );
  const sortedMembers = useMemo(
    () => [...members].sort(compareMembersByDisplayAge),
    [members],
  );
  const mobileDetail = useMemo(() => {
    if (mobileDetailPosition === null) {
      return null;
    }

    const position = positions[mobileDetailPosition];
    const member = members.find((item) => item.id === selectedPlayers[mobileDetailPosition]);

    if (!position || !member) {
      return null;
    }

    const age = displayAge(member);

    return {
      age,
      group: ageGroup(age),
      member,
      position,
    };
  }, [members, mobileDetailPosition, positions, selectedPlayers]);

  function selectFormation(value: Formation) {
    setFormation(value);
    setSelectedPlayers({});
    setRecentlyChangedPosition(null);
    setOpenDropdown(null);
    setMobileDetailPosition(null);
  }

  function selectPlayer(positionIndex: number, playerId: string) {
    setSelectedPlayers((current) => {
      const next = { ...current };

      if (playerId) {
        next[positionIndex] = playerId;
        setRecentlyChangedPosition(positionIndex);
        setOpenDropdown(null);
      } else {
        delete next[positionIndex];
      }

      return next;
    });
  }

  function clearPosition(positionIndex: number) {
    setSelectedPlayers((current) => {
      const next = { ...current };
      delete next[positionIndex];
      return next;
    });
    setOpenDropdown((current) => (current === positionIndex ? null : current));
    setMobileDetailPosition((current) => (current === positionIndex ? null : current));
  }

  function clearAll() {
    setSelectedPlayers({});
    setRecentlyChangedPosition(null);
    setOpenDropdown(null);
    setMobileDetailPosition(null);
  }

  function resetFormation() {
    setFormation("4-3-3");
    setSelectedPlayers({});
    setRecentlyChangedPosition(null);
    setOpenDropdown(null);
    setMobileDetailPosition(null);
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#061426] text-white">
      <section className="relative overflow-hidden border-b border-[#d8ad45]/25">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.22),transparent_32%),linear-gradient(135deg,#061426,#0b2745_58%,#071b31)]" />
        <div className="relative mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-10">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ad45]">
            KSW L.C.
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white sm:text-6xl">
            Lineup Builder
          </h1>
          <p className="mt-4 max-w-2xl text-base font-bold leading-7 text-slate-300 sm:text-lg">
            Choose formation, opponent, and KSW players.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-10">
        <div className="rounded-2xl border border-[#d8ad45]/25 bg-white/[0.06] p-4 shadow-2xl shadow-black/20 backdrop-blur sm:p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_160px] lg:items-end">
            <label className="grid gap-2 text-sm font-black text-[#f4d58a]">
              Opponent
              <select
                className="min-h-12 rounded-md border border-white/15 bg-[#071b31] px-3 py-3 text-sm font-bold text-white outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/25"
                onChange={(event) => setOpponentId(event.target.value)}
                value={opponentId}
              >
                <option value="">No Opponent</option>
                {opponents.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              {!opponents.length ? (
                <span className="text-xs font-bold text-slate-400">
                  No opponent teams available.
                </span>
              ) : null}
            </label>

            <label className="grid gap-2 text-sm font-black text-[#f4d58a]">
              Formation
              <select
                className="min-h-12 rounded-md border border-white/15 bg-[#071b31] px-3 py-3 text-sm font-bold text-white outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/25"
                onChange={(event) => selectFormation(event.target.value as Formation)}
                value={formation}
              >
                {formationOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex gap-2">
              <button
                className="min-h-12 flex-1 rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-4 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/20 transition-transform hover:scale-[1.01]"
                onClick={clearAll}
                type="button"
              >
                Clear All
              </button>
              <button
                className="min-h-12 rounded-md border border-[#d8ad45]/40 px-4 py-3 text-sm font-black text-[#f4d58a] transition-colors hover:bg-[#d8ad45]/10"
                onClick={resetFormation}
                type="button"
              >
                Reset
              </button>
            </div>
          </div>
          <div className="mt-5 rounded-xl border border-white/10 bg-[#071b31]/70 p-3">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#d8ad45]">
              Age Groups
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {ageLegend.slice(0, 5).map((group) => (
                <span
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-black text-white"
                  key={group.label}
                >
                  <span className={`size-2.5 rounded-full ${group.sampleClass}`} />
                  {group.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[390px_minmax(0,1fr)]">
          <div className="order-2 rounded-2xl border border-[#d8ad45]/25 bg-white/[0.06] p-4 shadow-2xl shadow-black/20 backdrop-blur lg:order-1">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-[#d8ad45]">
                  Select Players
                </p>
                <h2 className="mt-1 text-2xl font-black">Position List</h2>
              </div>
              <span className="rounded-full border border-[#d8ad45]/35 px-3 py-1 text-xs font-black text-[#f4d58a]">
                {formation}
              </span>
            </div>

            {!members.length ? (
              <p className="rounded-lg border border-white/10 bg-white/[0.04] p-4 text-sm font-bold text-slate-300">
                No active members available.
              </p>
            ) : (
              <div className="grid gap-3">
                {positions.map((position, index) => {
                  const selectedId = selectedPlayers[index] ?? "";
                  const selectedMember = members.find((member) => member.id === selectedId);
                  const selectedAgeGroup = selectedMember ? ageGroup(displayAge(selectedMember)) : null;

                  return (
                    <div
                      className="grid gap-2 rounded-lg border border-white/10 bg-[#071b31]/80 p-3 sm:grid-cols-[58px_minmax(0,1fr)_auto] sm:items-center"
                      key={`${formation}-${index}-${position.label}`}
                    >
                      <span className="rounded-md bg-[#d8ad45] px-3 py-2 text-center text-sm font-black text-[#061426]">
                        {position.label}
                      </span>
                      <div className="relative min-w-0">
                        <button
                          aria-expanded={openDropdown === index}
                          className="flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-md border border-white/15 bg-[#061426] px-3 py-2 text-left text-sm font-bold outline-none transition-colors hover:border-[#d8ad45]/70 focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/25"
                          onClick={() => setOpenDropdown((current) => (current === index ? null : index))}
                          style={{ color: selectedAgeGroup?.textColor ?? "#cbd5e1" }}
                          type="button"
                        >
                          <span className="min-w-0 truncate">
                            {selectedMember ? memberOptionLabel(selectedMember) : "Choose player"}
                          </span>
                          <span className="shrink-0 text-[#f4d58a]">⌄</span>
                        </button>
                        {openDropdown === index ? (
                          <div
                            className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-72 overflow-y-auto rounded-lg border border-[#d8ad45]/35 bg-[#061426] p-1 shadow-2xl shadow-black/45"
                            role="listbox"
                          >
                            <button
                              className="flex w-full rounded-md px-3 py-2 text-left text-sm font-bold text-slate-300 hover:bg-white/10"
                              onClick={() => selectPlayer(index, "")}
                              type="button"
                            >
                              Choose player
                            </button>
                            {sortedMembers.map((member) => {
                              const disabled = selectedIds.has(member.id) && selectedId !== member.id;
                              const optionAgeGroup = ageGroup(displayAge(member));

                              return (
                                <button
                                  className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm font-black transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
                                  disabled={disabled}
                                  key={member.id}
                                  onClick={() => selectPlayer(index, member.id)}
                                  style={{ color: optionAgeGroup.textColor }}
                                  type="button"
                                >
                                  <span className="min-w-0 truncate">{memberOptionLabel(member)}</span>
                                  {disabled ? (
                                    <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                                      Picked
                                    </span>
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                      <button
                        className="min-h-10 rounded-md border border-[#9b1c1f]/45 px-3 py-2 text-xs font-black text-[#ffb4b7] transition-colors hover:bg-[#9b1c1f]/15 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={!selectedId}
                        onClick={() => clearPosition(index)}
                        type="button"
                      >
                        Clear
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="order-1 rounded-2xl border border-[#d8ad45]/25 bg-white/[0.06] p-4 shadow-2xl shadow-black/20 backdrop-blur sm:p-5 lg:order-2">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-[#d8ad45]">
                  Formation Preview
                </p>
                <h2 className="mt-1 text-2xl font-black">
                  {opponent ? `KSW L.C. vs ${opponent.name}` : "KSW L.C. Formation Preview"}
                </h2>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-full border border-[#d8ad45]/40 bg-[#061426] text-xs font-black text-[#f4d58a]">
                  KSW
                </div>
                {opponent ? (
                  <>
                    <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">vs</span>
                    <div className="flex size-12 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-white text-xs font-black text-[#061426]">
                      {opponent.logo_url ? (
                        <img alt={opponent.name} className="h-full w-full object-contain p-1.5" src={opponent.logo_url} />
                      ) : (
                        <span>{initials(opponent.short_name || opponent.name)}</span>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            <div className="relative mx-auto aspect-[3/4] w-full max-w-[720px] overflow-hidden rounded-2xl border border-[#d8ad45]/40 bg-[radial-gradient(circle_at_center,rgba(216,173,69,0.16),transparent_34%),linear-gradient(180deg,#1d6a42,#0b3d2d)] shadow-inner shadow-black/40">
              <div className="absolute inset-4 rounded-xl border-2 border-white/45" />
              <div className="absolute left-1/2 top-1/2 size-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/35 sm:size-36" />
              <div className="absolute left-4 right-4 top-1/2 h-0.5 -translate-y-1/2 bg-white/35" />
              <div className="absolute left-1/2 top-4 h-14 w-32 -translate-x-1/2 rounded-b-full border-x-2 border-b-2 border-white/35 sm:w-44" />
              <div className="absolute bottom-4 left-1/2 h-14 w-32 -translate-x-1/2 rounded-t-full border-x-2 border-t-2 border-white/35 sm:w-44" />

              {positions.map((position, index) => {
                const member = members.find((item) => item.id === selectedPlayers[index]);
                const hasSelectedPlayer = Boolean(member);
                const age = member ? displayAge(member) : null;
                const markerAgeGroup = markerGroupForPosition(position.label, age);

                return (
                  <div
                    className="absolute flex w-[58px] -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center sm:w-[96px]"
                    key={`${formation}-preview-${index}-${position.label}`}
                    style={{ left: `${position.x}%`, top: `${position.y}%` }}
                  >
                    <div
                      className={`lineup-marker group relative flex flex-col items-center outline-none ${
                        hasSelectedPlayer ? "lineup-marker-selected" : "lineup-marker-empty"
                      } ${recentlyChangedPosition === index ? "lineup-marker-bounce" : ""}`}
                      onClick={() => {
                        if (member) {
                          setMobileDetailPosition(index);
                        }
                      }}
                      onAnimationEnd={() => {
                        if (recentlyChangedPosition === index) {
                          setRecentlyChangedPosition(null);
                        }
                      }}
                      tabIndex={0}
                    >
                      <div
                        className={`lineup-marker-circle relative z-10 flex size-12 items-center justify-center overflow-hidden rounded-full shadow-lg transition duration-300 sm:size-16 ${
                          member
                            ? `border-4 ${markerAgeGroup.borderClass} bg-[#061426] shadow-[#d8ad45]/30`
                            : "border-2 border-white/55 bg-white/15"
                        }`}
                        style={
                          member
                            ? ({ "--lineup-age-glow": markerAgeGroup.glow } as CSSProperties)
                            : undefined
                        }
                      >
                        {member?.photo_url ? (
                          <img
                            alt={formatPublicLawyerName(member.nickname)}
                            className="h-full w-full object-cover object-center"
                            src={member.photo_url}
                          />
                        ) : member ? (
                          <span className="text-xs font-black text-[#f4d58a] sm:text-sm">
                            {initials(formatPublicLawyerName(member.nickname))}
                          </span>
                        ) : (
                          <span className="text-xs font-black text-white/85">{position.label}</span>
                        )}
                      </div>
                      <span
                        className={`lineup-marker-tail -mt-1 block size-3 rotate-45 rounded-[2px] sm:size-4 ${
                          member
                            ? "bg-gradient-to-br from-[#f4d58a] to-[#d8ad45]"
                            : "bg-white/30"
                        }`}
                      />
                    </div>
                    <div className="mt-0.5 flex max-w-[58px] flex-col items-center gap-0.5 text-[9px] font-black leading-none sm:hidden">
                      {member ? (
                        <>
                          <span className="rounded-full border border-[#d8ad45]/35 bg-[#061426]/90 px-1.5 py-0.5 text-[#f4d58a] shadow-md shadow-black/20">
                            {member.shirt_number ? `#${member.shirt_number}` : "-"}
                          </span>
                          <span className="rounded-full border border-white/20 bg-[#061426]/85 px-1.5 py-0.5 text-white shadow-md shadow-black/20">
                            {position.label}
                          </span>
                        </>
                      ) : (
                        <span className="rounded-full border border-white/20 bg-[#061426]/80 px-1.5 py-0.5 text-[#f4d58a]">
                          {position.label}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 hidden max-w-[88px] rounded-md border border-black/10 bg-[#061426]/90 px-1.5 py-1 text-[10px] font-black leading-tight text-white shadow-lg shadow-black/20 sm:block sm:max-w-[112px] sm:text-xs">
                      {member ? (
                        <>
                          {member.shirt_number ? (
                            <span className="block text-[#f4d58a]">#{member.shirt_number}</span>
                          ) : null}
                          <span className="line-clamp-2">{formatPublicLawyerName(member.nickname)}</span>
                          <span className="mt-1 inline-flex rounded-full border border-[#d8ad45]/25 bg-white/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-white sm:text-[10px]">
                            Age {age ?? "-"}
                          </span>
                          <span className="mt-0.5 block text-[9px] uppercase tracking-[0.12em] text-slate-300 sm:text-[10px]">
                            {position.label}
                          </span>
                        </>
                      ) : (
                        <span className="text-[#f4d58a]">{position.label}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {mobileDetail ? (
              <div className="mt-4 rounded-xl border border-[#d8ad45]/25 bg-[#061426]/90 p-3 shadow-xl shadow-black/25 sm:hidden">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 ${markerGroupForPosition(
                      mobileDetail.position.label,
                      mobileDetail.age,
                    ).borderClass} bg-[#061426]`}
                    style={
                      {
                        "--lineup-age-glow": markerGroupForPosition(
                          mobileDetail.position.label,
                          mobileDetail.age,
                        ).glow,
                      } as CSSProperties
                    }
                  >
                    {mobileDetail.member.photo_url ? (
                      <img
                        alt={formatPublicLawyerName(mobileDetail.member.nickname)}
                        className="h-full w-full object-cover object-center"
                        src={mobileDetail.member.photo_url}
                      />
                    ) : (
                      <span className="text-xs font-black text-[#f4d58a]">
                        {initials(formatPublicLawyerName(mobileDetail.member.nickname))}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-base font-black text-white">
                      {formatPublicLawyerName(mobileDetail.member.nickname)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-[0.08em]">
                      <span className="rounded-full bg-[#d8ad45] px-2 py-1 text-[#061426]">
                        {mobileDetail.member.shirt_number ? `#${mobileDetail.member.shirt_number}` : "No #"}
                      </span>
                      <span className="rounded-full border border-white/15 px-2 py-1 text-white">
                        {mobileDetail.position.label}
                      </span>
                      <span className="rounded-full border border-white/15 px-2 py-1 text-white">
                        Age {mobileDetail.age ?? "-"}
                      </span>
                      <span
                        className="rounded-full border border-white/15 px-2 py-1"
                        style={{ color: mobileDetail.group.textColor }}
                      >
                        {mobileDetail.group.label}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
      <style jsx>{`
        .lineup-marker {
          transform-origin: center bottom;
          filter: drop-shadow(0 10px 16px rgba(0, 0, 0, 0.28));
        }

        .lineup-marker-selected .lineup-marker-circle {
          box-shadow:
            0 0 0 3px rgba(216, 173, 69, 0.14),
            0 14px 24px rgba(0, 0, 0, 0.34),
            0 0 20px var(--lineup-age-glow, rgba(216, 173, 69, 0.22));
        }

        .lineup-marker-selected:hover,
        .lineup-marker-selected:focus-visible {
          transform: translateY(-4px);
        }

        .lineup-marker-selected:hover .lineup-marker-circle,
        .lineup-marker-selected:focus-visible .lineup-marker-circle {
          box-shadow:
            0 0 0 3px rgba(244, 213, 138, 0.18),
            0 18px 30px rgba(0, 0, 0, 0.38),
            0 0 26px var(--lineup-age-glow, rgba(216, 173, 69, 0.32));
        }

        .lineup-marker-empty {
          animation: lineup-empty-pulse 2.8s ease-in-out infinite;
        }

        .lineup-marker-bounce {
          animation: lineup-marker-bounce 460ms cubic-bezier(0.2, 0.78, 0.25, 1);
        }

        @keyframes lineup-marker-bounce {
          0% {
            transform: translateY(0) scale(0.96);
            opacity: 0.86;
          }
          45% {
            transform: translateY(-10px) scale(1.04);
            opacity: 1;
          }
          72% {
            transform: translateY(2px) scale(0.99);
          }
          100% {
            transform: translateY(0) scale(1);
          }
        }

        @keyframes lineup-empty-pulse {
          0%,
          100% {
            opacity: 0.78;
            filter: drop-shadow(0 8px 12px rgba(0, 0, 0, 0.18));
          }
          50% {
            opacity: 1;
            filter: drop-shadow(0 0 16px rgba(255, 255, 255, 0.22));
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .lineup-marker,
          .lineup-marker-empty,
          .lineup-marker-bounce,
          .lineup-marker-circle {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>
    </main>
  );
}

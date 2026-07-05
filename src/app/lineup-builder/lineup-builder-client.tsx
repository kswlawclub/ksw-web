"use client";

import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";

export type LineupMember = {
  id: string;
  nickname: string;
  photo_url: string | null;
  shirt_number: number | null;
  birth_year_be: number | null;
  is_active: boolean;
  lineup_enabled: boolean;
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

type MarkerCoordinate = Pick<PositionSlot, "x" | "y">;

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
  const [customPositions, setCustomPositions] = useState<Record<number, MarkerCoordinate>>({});
  const [movePositionsMode, setMovePositionsMode] = useState(false);
  const [tacticalZonesEnabled, setTacticalZonesEnabled] = useState(true);
  const [draggingPosition, setDraggingPosition] = useState<number | null>(null);
  const [recentlyChangedPosition, setRecentlyChangedPosition] = useState<number | null>(null);
  const [activePickerPosition, setActivePickerPosition] = useState<number | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const pitchRef = useRef<HTMLDivElement>(null);

  const defaultPositions = useMemo(() => formationPositions(formation), [formation]);
  const positions = useMemo(
    () =>
      defaultPositions.map((position, index) => ({
        ...position,
        ...(customPositions[index] ?? {}),
      })),
    [customPositions, defaultPositions],
  );
  const opponent = opponents.find((team) => team.id === opponentId) ?? null;
  const selectedIds = useMemo(
    () => new Set(Object.values(selectedPlayers).filter(Boolean)),
    [selectedPlayers],
  );
  const sortedMembers = useMemo(
    () => [...members].sort(compareMembersByDisplayAge),
    [members],
  );
  const activePosition = activePickerPosition === null ? null : positions[activePickerPosition] ?? null;

  useEffect(() => {
    if (activePickerPosition === null) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActivePickerPosition(null);
      }
    }

    function closeOnOutsideClick(event: MouseEvent) {
      if (pickerRef.current?.contains(event.target as Node)) {
        return;
      }

      setActivePickerPosition(null);
    }

    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("mousedown", closeOnOutsideClick);

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("mousedown", closeOnOutsideClick);
    };
  }, [activePickerPosition]);

  useEffect(() => {
    if (draggingPosition === null || !movePositionsMode) {
      return;
    }

    const positionIndex = draggingPosition;

    function updateDraggedPosition(event: PointerEvent) {
      const pitch = pitchRef.current;

      if (!pitch) {
        return;
      }

      event.preventDefault();
      const rect = pitch.getBoundingClientRect();
      const x = Math.min(95, Math.max(5, ((event.clientX - rect.left) / rect.width) * 100));
      const y = Math.min(95, Math.max(5, ((event.clientY - rect.top) / rect.height) * 100));

      setCustomPositions((current) => ({
        ...current,
        [positionIndex]: { x, y },
      }));
    }

    function stopDragging() {
      setDraggingPosition(null);
    }

    document.addEventListener("pointermove", updateDraggedPosition, { passive: false });
    document.addEventListener("pointerup", stopDragging);
    document.addEventListener("pointercancel", stopDragging);

    return () => {
      document.removeEventListener("pointermove", updateDraggedPosition);
      document.removeEventListener("pointerup", stopDragging);
      document.removeEventListener("pointercancel", stopDragging);
    };
  }, [draggingPosition, movePositionsMode]);

  function selectFormation(value: Formation) {
    setFormation(value);
    setSelectedPlayers({});
    setCustomPositions({});
    setDraggingPosition(null);
    setRecentlyChangedPosition(null);
    setActivePickerPosition(null);
  }

  function selectPlayer(positionIndex: number, playerId: string) {
    setSelectedPlayers((current) => {
      const next = { ...current };

      if (playerId) {
        next[positionIndex] = playerId;
        setRecentlyChangedPosition(positionIndex);
      } else {
        delete next[positionIndex];
      }

      return next;
    });
    setActivePickerPosition(null);
  }

  function clearPosition(positionIndex: number) {
    setSelectedPlayers((current) => {
      const next = { ...current };
      delete next[positionIndex];
      return next;
    });
    setActivePickerPosition((current) => (current === positionIndex ? null : current));
  }

  function clearAll() {
    setSelectedPlayers({});
    setRecentlyChangedPosition(null);
    setActivePickerPosition(null);
  }

  function resetPositions() {
    setCustomPositions({});
    setDraggingPosition(null);
    setRecentlyChangedPosition(null);
    setActivePickerPosition(null);
  }

  function openPositionPicker(positionIndex: number) {
    if (movePositionsMode) {
      return;
    }

    setActivePickerPosition(positionIndex);
  }

  function startMarkerDrag(positionIndex: number, event: ReactPointerEvent<HTMLButtonElement>) {
    if (!movePositionsMode) {
      return;
    }

    event.preventDefault();
    setDraggingPosition(positionIndex);
    setActivePickerPosition(null);
  }

  function renderPlayerPicker(positionIndex: number) {
    const position = positions[positionIndex];
    const selectedId = selectedPlayers[positionIndex] ?? "";
    const hasSelection = Boolean(selectedId);

    return (
      <div className="flex max-h-full min-h-0 flex-col">
        <div className="shrink-0 flex items-start justify-between gap-4 border-b border-white/10 pb-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#d8ad45]">
              Select Player
            </p>
            <h3 className="mt-1 text-lg font-black text-white">
              Select Player for {position.label}
            </h3>
          </div>
          <button
            aria-label="Close player picker"
            className="rounded-full border border-white/15 px-3 py-1 text-sm font-black text-slate-300 transition-colors hover:bg-white/10"
            onClick={() => setActivePickerPosition(null)}
            type="button"
          >
            Close
          </button>
        </div>

        <div className="lineup-picker-scroll mt-3 grid min-h-0 flex-1 gap-2 overflow-y-auto pb-3 pr-1">
          {!sortedMembers.length ? (
            <p className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm font-bold text-slate-300">
              No active members available.
            </p>
          ) : (
            sortedMembers.map((member) => {
              const disabled = selectedIds.has(member.id) && selectedId !== member.id;
              const optionAgeGroup = ageGroup(displayAge(member));
              const isCurrent = selectedId === member.id;

              return (
                <button
                  className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm font-black transition-colors ${
                    isCurrent
                      ? "border-[#d8ad45]/60 bg-[#d8ad45]/12"
                      : "border-white/10 bg-white/[0.04] hover:border-[#d8ad45]/40 hover:bg-white/[0.08]"
                  } disabled:cursor-not-allowed disabled:opacity-35`}
                  disabled={disabled}
                  key={member.id}
                  onClick={() => selectPlayer(positionIndex, member.id)}
                  style={{ color: optionAgeGroup.textColor }}
                  type="button"
                >
                  <span className="min-w-0 truncate">{memberOptionLabel(member)}</span>
                  <span className="flex shrink-0 items-center gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                    <span className={`size-2.5 rounded-full ${optionAgeGroup.sampleClass}`} />
                    {disabled ? "Picked" : isCurrent ? "Current" : optionAgeGroup.label}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="shrink-0 mt-3 grid gap-2 border-t border-white/10 pt-3 sm:grid-cols-2">
          <button
            className="min-h-11 rounded-lg border border-[#9b1c1f]/45 px-4 py-2 text-sm font-black text-[#ffb4b7] transition-colors hover:bg-[#9b1c1f]/15 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!hasSelection}
            onClick={() => clearPosition(positionIndex)}
            type="button"
          >
            Clear Position
          </button>
          <button
            className="min-h-11 rounded-lg border border-white/15 px-4 py-2 text-sm font-black text-slate-200 transition-colors hover:bg-white/10"
            onClick={() => setActivePickerPosition(null)}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    );
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
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_220px_150px_170px_160px_150px] xl:items-end">
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

            <label className="grid gap-2 text-sm font-black text-[#f4d58a]">
              Tactical Zones
              <button
                aria-pressed={tacticalZonesEnabled}
                className={`min-h-12 rounded-md border px-4 py-3 text-sm font-black transition-colors ${
                  tacticalZonesEnabled
                    ? "border-[#d8ad45] bg-[#d8ad45] text-[#061426] shadow-lg shadow-[#d8ad45]/20"
                    : "border-[#d8ad45]/40 text-[#f4d58a] hover:bg-[#d8ad45]/10"
                }`}
                onClick={() => setTacticalZonesEnabled((current) => !current)}
                type="button"
              >
                {tacticalZonesEnabled ? "On" : "Off"}
              </button>
            </label>

            <label className="grid gap-2 text-sm font-black text-[#f4d58a]">
              Move Positions
              <button
                aria-pressed={movePositionsMode}
                className={`min-h-12 rounded-md border px-4 py-3 text-sm font-black transition-colors ${
                  movePositionsMode
                    ? "border-[#d8ad45] bg-[#d8ad45] text-[#061426] shadow-lg shadow-[#d8ad45]/20"
                    : "border-[#d8ad45]/40 text-[#f4d58a] hover:bg-[#d8ad45]/10"
                }`}
                onClick={() => {
                  setMovePositionsMode((current) => !current);
                  setActivePickerPosition(null);
                  setDraggingPosition(null);
                }}
                type="button"
              >
                {movePositionsMode ? "On" : "Off"}
              </button>
            </label>

            <div className="grid gap-2 text-sm font-black text-[#f4d58a]">
              Reset Positions
              <button
                className="min-h-12 rounded-md border border-[#d8ad45]/40 px-4 py-3 text-sm font-black text-[#f4d58a] transition-colors hover:bg-[#d8ad45]/10"
                onClick={resetPositions}
                type="button"
              >
                Reset Positions
              </button>
            </div>

            <div className="grid gap-2 text-sm font-black text-[#f4d58a]">
              Clear Players
              <button
                className="min-h-12 rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-4 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/20 transition-transform hover:scale-[1.01]"
                onClick={clearAll}
                type="button"
              >
                Clear Players
              </button>
            </div>
          </div>
          {movePositionsMode ? (
            <p className="mt-4 rounded-lg border border-[#d8ad45]/25 bg-[#d8ad45]/10 px-3 py-2 text-sm font-bold text-[#f4d58a]">
              Drag markers to adjust positions.
            </p>
          ) : null}
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

        <div className="mt-6">
          <div className="rounded-2xl border border-[#d8ad45]/25 bg-white/[0.06] p-4 shadow-2xl shadow-black/20 backdrop-blur sm:p-5">
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

            <div
              className={`lineup-premium-pitch relative mx-auto aspect-[3/4] w-full max-w-[760px] overflow-hidden rounded-2xl border ${
                movePositionsMode ? "border-[#f4d58a] ring-2 ring-[#d8ad45]/25" : "border-[#d8ad45]/40"
              }`}
              ref={pitchRef}
            >
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.14),transparent_24%),radial-gradient(circle_at_bottom,rgba(6,20,38,0.35),transparent_32%)]" />
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.04)_0_12.5%,transparent_12.5%_25%,rgba(255,255,255,0.035)_25%_37.5%,transparent_37.5%_50%,rgba(255,255,255,0.035)_50%_62.5%,transparent_62.5%_75%,rgba(255,255,255,0.035)_75%_87.5%,transparent_87.5%_100%)]" />
              <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(115deg,rgba(255,255,255,0.035)_0_1px,transparent_1px_14px)] opacity-60" />

              {tacticalZonesEnabled ? (
                <div className="pointer-events-none absolute inset-4 z-10 overflow-hidden rounded-xl">
                  <div className="absolute inset-x-0 bottom-0 h-1/3 bg-[#0c3554]/25" />
                  <div className="absolute inset-x-0 top-1/3 h-1/3 bg-[#d8ad45]/10" />
                  <div className="absolute inset-x-0 top-0 h-1/3 bg-[#d8ad45]/16" />
                  <div className="absolute inset-y-0 left-0 w-[17%] bg-white/[0.055]" />
                  <div className="absolute inset-y-0 right-0 w-[17%] bg-white/[0.055]" />
                  <div className="absolute inset-y-0 left-[28%] w-[12%] bg-[#f4d58a]/[0.075]" />
                  <div className="absolute inset-y-0 right-[28%] w-[12%] bg-[#f4d58a]/[0.075]" />
                  <span className="absolute bottom-[17%] left-1/2 hidden -translate-x-1/2 text-[10px] font-black uppercase tracking-[0.22em] text-white/35 sm:block">
                    Defensive
                  </span>
                  <span className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 text-[10px] font-black uppercase tracking-[0.22em] text-white/35 sm:block">
                    Midfield
                  </span>
                  <span className="absolute left-1/2 top-[15%] hidden -translate-x-1/2 text-[10px] font-black uppercase tracking-[0.22em] text-[#f4d58a]/45 sm:block">
                    Attacking
                  </span>
                  <span className="absolute left-[8%] top-1/2 hidden -translate-y-1/2 rotate-[-90deg] text-[9px] font-black uppercase tracking-[0.2em] text-white/30 sm:block">
                    Wide
                  </span>
                  <span className="absolute right-[8%] top-1/2 hidden -translate-y-1/2 rotate-90 text-[9px] font-black uppercase tracking-[0.2em] text-white/30 sm:block">
                    Wide
                  </span>
                  <span className="absolute left-[34%] top-[46%] hidden -translate-x-1/2 rotate-[-90deg] text-[8px] font-black uppercase tracking-[0.16em] text-[#f4d58a]/35 sm:block">
                    Half Space
                  </span>
                  <span className="absolute right-[34%] top-[46%] hidden translate-x-1/2 rotate-90 text-[8px] font-black uppercase tracking-[0.16em] text-[#f4d58a]/35 sm:block">
                    Half Space
                  </span>
                </div>
              ) : null}

              <div className="pointer-events-none absolute inset-4 z-20 rounded-xl border-2 border-white/55 shadow-[inset_0_0_26px_rgba(255,255,255,0.08)]" />
              <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 size-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/45 sm:size-36" />
              <div className="pointer-events-none absolute left-4 right-4 top-1/2 z-20 h-0.5 -translate-y-1/2 bg-white/45" />
              <div className="pointer-events-none absolute left-1/2 top-4 z-20 h-14 w-32 -translate-x-1/2 rounded-b-full border-x-2 border-b-2 border-white/45 sm:w-44" />
              <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 h-14 w-32 -translate-x-1/2 rounded-t-full border-x-2 border-t-2 border-white/45 sm:w-44" />
              <div className="pointer-events-none absolute left-1/2 top-4 z-20 h-7 w-16 -translate-x-1/2 rounded-b-lg border-x border-b border-white/35 sm:w-24" />
              <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 h-7 w-16 -translate-x-1/2 rounded-t-lg border-x border-t border-white/35 sm:w-24" />
              <div className="pointer-events-none absolute inset-0 z-30 shadow-[inset_0_0_70px_rgba(0,0,0,0.36)]" />

              {positions.map((position, index) => {
                const member = members.find((item) => item.id === selectedPlayers[index]);
                const hasSelectedPlayer = Boolean(member);
                const age = member ? displayAge(member) : null;
                const markerAgeGroup = markerGroupForPosition(position.label, age);

                return (
                  <div
                    className="absolute z-40 flex w-[58px] -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center sm:w-[96px]"
                    key={`${formation}-preview-${index}-${position.label}`}
                    style={{ left: `${position.x}%`, top: `${position.y}%` }}
                  >
                    <button
                      aria-label={
                        movePositionsMode
                          ? `Move ${position.label} marker`
                          : `Select player for ${position.label}`
                      }
                      className={`lineup-marker group relative flex flex-col items-center appearance-none border-0 bg-transparent p-0 outline-none ${
                        hasSelectedPlayer ? "lineup-marker-selected" : "lineup-marker-empty"
                      } ${movePositionsMode ? "lineup-marker-movable" : "cursor-pointer"} ${
                        draggingPosition === index ? "lineup-marker-dragging" : ""
                      } ${recentlyChangedPosition === index ? "lineup-marker-bounce" : ""}`}
                      onClick={() => openPositionPicker(index)}
                      onPointerDown={(event) => startMarkerDrag(index, event)}
                      onAnimationEnd={() => {
                        if (recentlyChangedPosition === index) {
                          setRecentlyChangedPosition(null);
                        }
                      }}
                      type="button"
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
                    </button>
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
          </div>
        </div>
      </section>

      {activePosition ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-6 backdrop-blur-sm sm:items-center sm:p-6">
          <div
            className="flex max-h-[82vh] w-full max-w-2xl flex-col rounded-t-2xl border-t border-[#d8ad45]/35 bg-[#061426]/98 p-4 shadow-2xl shadow-black/60 sm:max-h-[80vh] sm:rounded-2xl sm:border sm:p-5"
            ref={pickerRef}
            role="dialog"
          >
            {renderPlayerPicker(activePickerPosition ?? 0)}
          </div>
        </div>
      ) : null}

      <style jsx>{`
        .lineup-premium-pitch {
          background:
            radial-gradient(circle at 50% 36%, rgba(244, 213, 138, 0.14), transparent 28%),
            radial-gradient(circle at 50% 15%, rgba(255, 255, 255, 0.12), transparent 24%),
            linear-gradient(180deg, rgba(6, 20, 38, 0.18), transparent 22%, transparent 78%, rgba(6, 20, 38, 0.36)),
            repeating-linear-gradient(
              90deg,
              rgba(48, 138, 78, 0.92) 0%,
              rgba(48, 138, 78, 0.92) 10%,
              rgba(27, 112, 68, 0.96) 10%,
              rgba(27, 112, 68, 0.96) 20%
            ),
            linear-gradient(180deg, #2c8f52 0%, #176f46 48%, #0d4f38 100%);
          box-shadow:
            inset 0 0 72px rgba(0, 0, 0, 0.42),
            inset 0 0 0 1px rgba(255, 255, 255, 0.08),
            0 22px 52px rgba(0, 0, 0, 0.28),
            0 0 38px rgba(216, 173, 69, 0.14);
        }

        .lineup-marker {
          transform-origin: center bottom;
          filter: drop-shadow(0 10px 16px rgba(0, 0, 0, 0.28));
        }

        .lineup-marker-movable {
          cursor: grab;
          touch-action: none;
        }

        .lineup-marker-dragging {
          cursor: grabbing;
          transform: translateY(-3px) scale(1.03);
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

        .lineup-picker-scroll {
          scrollbar-color: rgba(216, 173, 69, 0.72) rgba(255, 255, 255, 0.08);
          scrollbar-width: thin;
        }

        .lineup-picker-scroll::-webkit-scrollbar {
          width: 8px;
        }

        .lineup-picker-scroll::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.08);
          border-radius: 999px;
        }

        .lineup-picker-scroll::-webkit-scrollbar-thumb {
          background: rgba(216, 173, 69, 0.72);
          border-radius: 999px;
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

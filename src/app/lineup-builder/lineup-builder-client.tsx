"use client";

import { useMemo, useState } from "react";

export type LineupMember = {
  id: string;
  nickname: string;
  photo_url: string | null;
  shirt_number: number | null;
  is_active: boolean;
};

export type OpponentTeam = {
  id: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
};

type Formation = "4-3-3" | "4-4-2" | "4-2-3-1" | "3-5-2" | "5-3-2";
type PositionSlot = {
  label: string;
  x: number;
  y: number;
};

type LineupBuilderProps = {
  members: LineupMember[];
  opponents: OpponentTeam[];
};

const formations: Record<Formation, PositionSlot[]> = {
  "4-3-3": [
    { label: "GK", x: 50, y: 90 },
    { label: "LB", x: 18, y: 72 },
    { label: "CB", x: 39, y: 73 },
    { label: "CB", x: 61, y: 73 },
    { label: "RB", x: 82, y: 72 },
    { label: "CM", x: 30, y: 52 },
    { label: "CM", x: 50, y: 48 },
    { label: "CM", x: 70, y: 52 },
    { label: "LW", x: 24, y: 27 },
    { label: "ST", x: 50, y: 21 },
    { label: "RW", x: 76, y: 27 },
  ],
  "4-4-2": [
    { label: "GK", x: 50, y: 90 },
    { label: "LB", x: 18, y: 72 },
    { label: "CB", x: 39, y: 73 },
    { label: "CB", x: 61, y: 73 },
    { label: "RB", x: 82, y: 72 },
    { label: "LM", x: 20, y: 49 },
    { label: "CM", x: 40, y: 49 },
    { label: "CM", x: 60, y: 49 },
    { label: "RM", x: 80, y: 49 },
    { label: "ST", x: 40, y: 22 },
    { label: "ST", x: 60, y: 22 },
  ],
  "4-2-3-1": [
    { label: "GK", x: 50, y: 90 },
    { label: "LB", x: 18, y: 72 },
    { label: "CB", x: 39, y: 73 },
    { label: "CB", x: 61, y: 73 },
    { label: "RB", x: 82, y: 72 },
    { label: "DM", x: 39, y: 57 },
    { label: "DM", x: 61, y: 57 },
    { label: "LAM", x: 26, y: 39 },
    { label: "CAM", x: 50, y: 36 },
    { label: "RAM", x: 74, y: 39 },
    { label: "ST", x: 50, y: 19 },
  ],
  "3-5-2": [
    { label: "GK", x: 50, y: 90 },
    { label: "CB", x: 30, y: 73 },
    { label: "CB", x: 50, y: 75 },
    { label: "CB", x: 70, y: 73 },
    { label: "LWB", x: 16, y: 52 },
    { label: "CM", x: 36, y: 49 },
    { label: "CM", x: 50, y: 46 },
    { label: "CM", x: 64, y: 49 },
    { label: "RWB", x: 84, y: 52 },
    { label: "ST", x: 40, y: 21 },
    { label: "ST", x: 60, y: 21 },
  ],
  "5-3-2": [
    { label: "GK", x: 50, y: 90 },
    { label: "LB", x: 14, y: 71 },
    { label: "CB", x: 32, y: 73 },
    { label: "CB", x: 50, y: 75 },
    { label: "CB", x: 68, y: 73 },
    { label: "RB", x: 86, y: 71 },
    { label: "CM", x: 34, y: 49 },
    { label: "CM", x: 50, y: 46 },
    { label: "CM", x: 66, y: 49 },
    { label: "ST", x: 40, y: 22 },
    { label: "ST", x: 60, y: 22 },
  ],
};

const formationOptions = Object.keys(formations) as Formation[];

function publicMemberName(nickname: string) {
  const value = nickname.trim();

  if (!value) {
    return "ทนาย";
  }

  return value.startsWith("ทนาย") ? value : `ทนาย${value}`;
}

function memberOptionLabel(member: LineupMember) {
  const number = member.shirt_number ? `#${member.shirt_number} ` : "";

  return `${number}${publicMemberName(member.nickname)}`;
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
  const [opponentId, setOpponentId] = useState(opponents[0]?.id ?? "");
  const [selectedPlayers, setSelectedPlayers] = useState<Record<number, string>>({});

  const positions = formations[formation];
  const opponent = opponents.find((team) => team.id === opponentId) ?? null;
  const selectedIds = useMemo(
    () => new Set(Object.values(selectedPlayers).filter(Boolean)),
    [selectedPlayers],
  );

  function selectFormation(value: Formation) {
    setFormation(value);
    setSelectedPlayers({});
  }

  function selectPlayer(positionIndex: number, playerId: string) {
    setSelectedPlayers((current) => {
      const next = { ...current };

      if (playerId) {
        next[positionIndex] = playerId;
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
  }

  function clearAll() {
    setSelectedPlayers({});
  }

  function resetFormation() {
    setFormation("4-3-3");
    setSelectedPlayers({});
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
                disabled={!opponents.length}
                onChange={(event) => setOpponentId(event.target.value)}
                value={opponentId}
              >
                {opponents.length ? (
                  opponents.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))
                ) : (
                  <option value="">No opponent teams available.</option>
                )}
              </select>
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

                  return (
                    <div
                      className="grid gap-2 rounded-lg border border-white/10 bg-[#071b31]/80 p-3 sm:grid-cols-[58px_minmax(0,1fr)_auto] sm:items-center"
                      key={`${formation}-${index}-${position.label}`}
                    >
                      <span className="rounded-md bg-[#d8ad45] px-3 py-2 text-center text-sm font-black text-[#061426]">
                        {position.label}
                      </span>
                      <select
                        className="min-h-11 min-w-0 rounded-md border border-white/15 bg-[#061426] px-3 py-2 text-sm font-bold text-white outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/25"
                        onChange={(event) => selectPlayer(index, event.target.value)}
                        value={selectedId}
                      >
                        <option value="">Choose player</option>
                        {members.map((member) => {
                          const disabled = selectedIds.has(member.id) && selectedId !== member.id;

                          return (
                            <option disabled={disabled} key={member.id} value={member.id}>
                              {memberOptionLabel(member)}
                            </option>
                          );
                        })}
                      </select>
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
                <h2 className="mt-1 text-2xl font-black">KSW L.C. vs {opponent?.name ?? "Opponent"}</h2>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-full border border-[#d8ad45]/40 bg-[#061426] text-xs font-black text-[#f4d58a]">
                  KSW
                </div>
                <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">vs</span>
                <div className="flex size-12 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-white text-xs font-black text-[#061426]">
                  {opponent?.logo_url ? (
                    <img alt={opponent.name} className="h-full w-full object-contain p-1.5" src={opponent.logo_url} />
                  ) : (
                    <span>{initials(opponent?.short_name || opponent?.name || "OPP")}</span>
                  )}
                </div>
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

                return (
                  <div
                    className="absolute flex w-[72px] -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center sm:w-[96px]"
                    key={`${formation}-preview-${index}-${position.label}`}
                    style={{ left: `${position.x}%`, top: `${position.y}%` }}
                  >
                    <div
                      className={`flex size-12 items-center justify-center overflow-hidden rounded-full border-2 shadow-lg sm:size-16 ${
                        member
                          ? "border-[#d8ad45] bg-[#061426] shadow-[#d8ad45]/20"
                          : "border-white/45 bg-white/15"
                      }`}
                    >
                      {member?.photo_url ? (
                        <img
                          alt={publicMemberName(member.nickname)}
                          className="h-full w-full object-cover object-center"
                          src={member.photo_url}
                        />
                      ) : member ? (
                        <span className="text-xs font-black text-[#f4d58a] sm:text-sm">
                          {initials(publicMemberName(member.nickname))}
                        </span>
                      ) : (
                        <span className="text-xs font-black text-white/80">{position.label}</span>
                      )}
                    </div>
                    <div className="mt-1 max-w-[88px] rounded-md border border-black/10 bg-[#061426]/90 px-1.5 py-1 text-[10px] font-black leading-tight text-white shadow-lg shadow-black/20 sm:max-w-[112px] sm:text-xs">
                      {member ? (
                        <>
                          {member.shirt_number ? (
                            <span className="block text-[#f4d58a]">#{member.shirt_number}</span>
                          ) : null}
                          <span className="line-clamp-2">{publicMemberName(member.nickname)}</span>
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
    </main>
  );
}

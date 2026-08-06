"use client";

import { useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import { getPublicParticipantDisplayList, shouldShowPublicParticipantToggle, type PublicParticipant } from "@/lib/public-council-cup-presentation";

export function ActiveCouncilParticipants({ teams }: { teams: PublicParticipant[] }) {
  const [expanded, setExpanded] = useState(false);
  const visibleTeams = getPublicParticipantDisplayList(teams, expanded);
  const showToggle = shouldShowPublicParticipantToggle(teams);

  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {visibleTeams.map((team) => (
          <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-3" key={team.id}>
            <div className="flex min-w-0 items-center gap-3">
              <TeamLogo className="!size-9 shrink-0" initials={(team.shortName || team.name || "?").slice(0, 3).toUpperCase()} logoUrl={team.logoUrl} teamName={team.name} />
              <div className="min-w-0">
                <p className="break-words text-sm font-black leading-5 text-[#061426]">{team.name}</p>
                {team.seed ? <p className="mt-1 text-xs font-bold text-slate-500">Seed {team.seed}</p> : null}
              </div>
            </div>
          </article>
        ))}
      </div>
      {showToggle ? (
        <div className="mt-4 flex justify-end">
          <button className="rounded-md text-sm font-black text-[#8a6418] underline decoration-[#d8ad45]/60 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d8ad45]" onClick={() => setExpanded((current) => !current)} type="button">
            {expanded ? "ย่อรายชื่อทีม" : `แสดงทีมทั้งหมดอีก ${teams.length - visibleTeams.length} ทีม`}
          </button>
        </div>
      ) : null}
    </>
  );
}

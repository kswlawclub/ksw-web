"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { TeamLogo } from "@/components/team-logo";

export type CompletedParticipantTeam = {
  id: string;
  logoUrl: string;
  name: string;
  shortName: string;
};

export function CompletedParticipatingTeamsGrid({ teams }: { teams: CompletedParticipantTeam[] }) {
  const [expanded, setExpanded] = useState(false);
  const visibleTeams = expanded ? teams : teams.slice(0, 12);

  return (
    <>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visibleTeams.map((team) => (
          <div className="flex min-w-0 items-center gap-2 rounded-md border border-slate-200/75 bg-[#fffdf8] px-2.5 py-1.5" key={team.id}>
            <TeamLogo className="!size-6" initials={(team.shortName || team.name).slice(0, 3)} logoUrl={team.logoUrl} teamName={team.name} />
            <span className="min-w-0 text-wrap text-sm font-black text-[#061426]">{team.name}</span>
          </div>
        ))}
      </div>
      {teams.length > 12 ? (
        <button aria-expanded={expanded} className="mt-3 inline-flex items-center gap-1.5 text-sm font-black text-[#8a6418] underline underline-offset-4" onClick={() => setExpanded((current) => !current)} type="button">
          {expanded ? <ChevronUp aria-hidden="true" className="size-4 shrink-0" /> : <ChevronDown aria-hidden="true" className="size-4 shrink-0" />}
          {expanded ? "ซ่อนทีมเพิ่มเติม" : "แสดงทีมทั้งหมด"}
        </button>
      ) : null}
    </>
  );
}

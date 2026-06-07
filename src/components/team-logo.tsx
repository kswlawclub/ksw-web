"use client";

import { useState } from "react";

type TeamLogoProps = {
  logoUrl: string;
  initials: string;
  teamName: string;
  className?: string;
};

export function TeamLogo({ logoUrl, initials, teamName, className = "" }: TeamLogoProps) {
  const [failed, setFailed] = useState(!logoUrl);

  return (
    <span
      className={`flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#d8ad45]/40 bg-[#d8ad45]/15 text-[10px] font-black text-[#f4d58a] sm:size-7 md:size-8 ${className}`}
    >
      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={`${teamName} logo`}
          className="size-full object-contain"
          src={logoUrl}
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{initials}</span>
      )}
    </span>
  );
}

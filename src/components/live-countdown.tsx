"use client";

import { useEffect, useState } from "react";

type LiveCountdownProps = {
  targetDate: string;
  className?: string;
};

function formatCountdown(targetDate: string) {
  const target = new Date(targetDate).getTime();

  if (Number.isNaN(target)) {
    return "TBC";
  }

  const diff = target - Date.now();

  if (diff <= 0) {
    return "KICKOFF";
  }

  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${days}d ${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

export function LiveCountdown({ targetDate, className = "" }: LiveCountdownProps) {
  const [label, setLabel] = useState("0d 0h 00m 00s");

  useEffect(() => {
    const updateLabel = () => {
      setLabel(formatCountdown(targetDate));
    };

    updateLabel();
    const intervalId = window.setInterval(updateLabel, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [targetDate]);

  return <p className={className}>{label}</p>;
}

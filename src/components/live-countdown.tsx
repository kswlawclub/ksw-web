"use client";

import { useEffect, useRef, useState } from "react";

type LiveCountdownProps = {
  targetDate: string;
  className?: string;
};

type CountdownState =
  | {
      status: "countdown";
      days: number;
      hours: number;
      minutes: number;
      seconds: number;
    }
  | {
      status: "kickoff" | "tbc";
    };

type CountdownUnitProps = {
  value: string;
  tone: "day" | "hour" | "minute" | "second";
};

const unitToneClasses = {
  day: "from-[#f4d58a] via-[#d8ad45] to-[#b98724] text-[#061426] shadow-[#d8ad45]/20",
  hour: "from-[#fff4c2] via-[#f4d58a] to-[#d8ad45] text-[#061426] shadow-[#f4d58a]/15",
  minute: "from-[#e8f1ff] via-white to-[#9fc4ff] text-[#061426] shadow-[#9fc4ff]/10",
  second: "from-white via-[#f4d58a] to-[#d8ad45] text-[#061426] shadow-[#f4d58a]/20",
};

function getCountdownState(targetDate: string): CountdownState {
  const target = new Date(targetDate).getTime();

  if (Number.isNaN(target)) {
    return { status: "tbc" };
  }

  const diff = target - Date.now();

  if (diff <= 0) {
    return { status: "kickoff" };
  }

  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return { status: "countdown", days, hours, minutes, seconds };
}

function CountdownUnit({ value, tone }: CountdownUnitProps) {
  const previousValue = useRef(value);
  const [exitingValue, setExitingValue] = useState("");

  useEffect(() => {
    if (previousValue.current === value) {
      return;
    }

    setExitingValue(previousValue.current);
    previousValue.current = value;

    const timeoutId = window.setTimeout(() => {
      setExitingValue("");
    }, 340);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [value]);

  return (
    <span
      className={`relative inline-flex min-w-[3.9rem] justify-center overflow-hidden rounded-xl bg-gradient-to-br px-2.5 py-2 text-center text-2xl font-black leading-none shadow-lg sm:min-w-[4.35rem] sm:px-3 sm:text-3xl ${unitToneClasses[tone]}`}
    >
      {exitingValue ? (
        <span className="ksw-countdown-old absolute inset-0 flex items-center justify-center">
          {exitingValue}
        </span>
      ) : null}
      <span className="ksw-countdown-new block">{value}</span>
    </span>
  );
}

export function LiveCountdown({ targetDate, className = "" }: LiveCountdownProps) {
  const [countdown, setCountdown] = useState<CountdownState>({
    status: "countdown",
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });

  useEffect(() => {
    const updateCountdown = () => {
      setCountdown(getCountdownState(targetDate));
    };

    updateCountdown();
    const intervalId = window.setInterval(updateCountdown, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [targetDate]);

  if (countdown.status === "kickoff") {
    return <p className={className}>KICKOFF</p>;
  }

  if (countdown.status === "tbc") {
    return <p className={className}>TBC</p>;
  }

  if (countdown.status !== "countdown") {
    return null;
  }

  return (
    <div className={`${className} flex flex-wrap gap-1.5 sm:gap-2`}>
      <CountdownUnit tone="day" value={`${countdown.days}d`} />
      <CountdownUnit tone="hour" value={`${countdown.hours}h`} />
      <CountdownUnit tone="minute" value={`${String(countdown.minutes).padStart(2, "0")}m`} />
      <CountdownUnit tone="second" value={`${String(countdown.seconds).padStart(2, "0")}s`} />
    </div>
  );
}

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
  label: string;
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

function CountdownUnit({ value, label }: CountdownUnitProps) {
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
    <span className="grid min-w-[3.25rem] justify-items-center gap-1 sm:min-w-[3.4rem]">
      <span className="relative flex h-12 w-full items-center justify-center overflow-hidden rounded-lg border border-[#d8ad45]/20 bg-[linear-gradient(180deg,#22324a_0%,#111b2c_48%,#07101f_52%,#020815_100%)] text-2xl font-black leading-none text-slate-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),inset_0_-8px_18px_rgba(0,0,0,0.38),0_10px_24px_rgba(0,0,0,0.28)] sm:h-14 sm:text-3xl">
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-white/[0.07]" />
        <span className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-px bg-black/70 shadow-[0_-1px_0_rgba(255,255,255,0.08)]" />
        <span className="pointer-events-none absolute left-2 top-2 size-1 rounded-full bg-white/25" />
        <span className="pointer-events-none absolute right-2 top-2 size-1 rounded-full bg-white/20" />
        {exitingValue ? (
          <span className="ksw-countdown-old absolute inset-0 flex items-center justify-center">
            {exitingValue}
          </span>
        ) : null}
        <span className="ksw-countdown-new block tabular-nums">{value}</span>
      </span>
      <span className="text-[9px] font-black uppercase tracking-[0.18em] text-[#f4d58a] sm:text-[10px]">
        {label}
      </span>
    </span>
  );
}

function padUnit(value: number) {
  return String(value).padStart(2, "0");
}

function StatusCountdown({ label, className }: { label: string; className: string }) {
  return (
    <div className={`${className} inline-flex`}>
      <span className="rounded-lg border border-[#d8ad45]/25 bg-[linear-gradient(180deg,#22324a,#020815)] px-4 py-3 text-2xl font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_24px_rgba(0,0,0,0.28)]">
        {label}
      </span>
    </div>
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
    return <StatusCountdown className={className} label="KICKOFF" />;
  }

  if (countdown.status === "tbc") {
    return <StatusCountdown className={className} label="TBC" />;
  }

  if (countdown.status !== "countdown") {
    return null;
  }

  return (
    <div className={`${className} grid grid-cols-2 gap-2 min-[420px]:flex min-[420px]:flex-wrap`}>
      <CountdownUnit label="Days" value={padUnit(countdown.days)} />
      <CountdownUnit label="Hours" value={padUnit(countdown.hours)} />
      <CountdownUnit label="Minutes" value={padUnit(countdown.minutes)} />
      <CountdownUnit label="Seconds" value={padUnit(countdown.seconds)} />
    </div>
  );
}

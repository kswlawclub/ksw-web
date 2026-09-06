"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { MemberFootballCard } from "@/components/member-football-card";
import type { MemberFootballRating } from "@/lib/member-football-rating";

export function PublicMemberRating({ children, name, photoUrl, rating }: {
  children: ReactNode; name: string; photoUrl: string | null; rating: MemberFootballRating;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = useRef(false);
  const suppressFocus = useRef(false);
  const opening = useRef(false);
  const [open, setOpen] = useState(false);

  function keepOpen() {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  }
  function position() {
    const card = panel.current;
    const button = trigger.current;
    if (!card || !button) return;
    const bounds = button.getBoundingClientRect();
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const left = window.innerWidth < 640 ? (window.innerWidth - width) / 2 : bounds.left + bounds.width / 2 - width / 2;
    const top = window.innerWidth < 640 ? (window.innerHeight - height) / 2 : bounds.bottom + 12;
    card.style.left = `${Math.max(12, Math.min(left, window.innerWidth - width - 12))}px`;
    card.style.top = `${Math.max(12, Math.min(top, window.innerHeight - height - 12))}px`;
  }
  function show() {
    if (opening.current || suppressFocus.current) return;
    keepOpen();
    if (!panel.current?.matches(":popover-open")) {
      opening.current = true;
      try { panel.current?.showPopover(); } finally { opening.current = false; }
    }
    position();
  }
  function close(restoreFocus = false) {
    keepOpen();
    pinned.current = false;
    panel.current?.hidePopover();
    if (restoreFocus) {
      suppressFocus.current = true;
      trigger.current?.focus();
    }
  }
  function scheduleClose() {
    keepOpen();
    leaveTimer.current = setTimeout(() => {
      if (!pinned.current && !panel.current?.contains(document.activeElement) && document.activeElement !== trigger.current) close();
    }, 220);
  }
  useEffect(() => {
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    };
  }, []);

  return (
    <div className="relative mx-auto size-[130px] shrink-0">
      <button ref={trigger} type="button" popoverTarget={id} popoverTargetAction="show" aria-label={`ดู Football Rating ${name}`} aria-expanded={open} aria-controls={id} aria-haspopup="dialog"
        className="block rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#9b1c1f]"
        onPointerEnter={(event) => { if (event.pointerType === "mouse") show(); }} onPointerLeave={scheduleClose}
        onFocus={() => { if (!suppressFocus.current) show(); }} onBlur={scheduleClose}
        onClick={() => { suppressFocus.current = false; pinned.current = true; show(); }}>
        {children}
      </button>
      <div ref={panel} id={id} popover="auto" role="dialog" aria-label={`Football Rating ${name}`}
        className="fixed m-0 max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-sm overflow-y-auto rounded-lg border border-[#d8ad45]/60 bg-[#061426] p-5 text-white shadow-2xl"
        onBeforeToggle={(event) => { if (event.newState === "closed") suppressFocus.current = true; }}
        onToggle={(event) => { setOpen(event.newState === "open"); suppressFocus.current = false; if (event.newState === "closed") pinned.current = false; }}
        onPointerEnter={keepOpen} onPointerLeave={scheduleClose} onFocus={keepOpen} onBlur={scheduleClose}>
        <div className="mb-2 flex justify-end"><button type="button" aria-label="ปิด Football Rating" onClick={() => close(true)} className="flex size-11 items-center justify-center rounded-md border border-white/25 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#f4d58a]"><X aria-hidden="true" className="size-5" /></button></div>
        <MemberFootballCard name={name} photoUrl={photoUrl} rating={rating} />
      </div>
    </div>
  );
}

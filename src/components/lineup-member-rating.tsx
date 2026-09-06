"use client";

import { useCallback, useEffect, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent } from "react";
import Image from "next/image";
import { ArrowLeftRight, UserMinus, X } from "lucide-react";
import { MemberFootballCard } from "@/components/member-football-card";
import { getMemberDisplayName, type MembershipType } from "@/lib/club-members";
import type { MemberFootballRating } from "@/lib/member-football-rating";
import { isTouchLineupActivation, positionLineupRatingPreview } from "@/lib/lineup-rating-presentation";

type RatingMember = { id: string; nickname: string; membership_type: MembershipType; photo_url: string | null };
type View = {
  mode: "preview" | "info" | "actions";
  member: RatingMember;
  rating?: MemberFootballRating;
  anchor: HTMLElement;
  actions?: { change: () => void; clear: () => void };
};

export function useLineupMemberRating() {
  const [view, setView] = useState<View | null>(null);
  const pointer = useRef("");
  const suppressFocus = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepOpen = useCallback(() => { if (timer.current) clearTimeout(timer.current); }, []);

  useEffect(() => {
    const onPointer = (event: globalThis.PointerEvent) => { pointer.current = event.pointerType; };
    const onKey = () => {
      pointer.current = "";
      suppressFocus.current = null;
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
      keepOpen();
    };
  }, [keepOpen]);

  const dismiss = useCallback((restoreFocus = false) => {
    keepOpen();
    suppressFocus.current = view?.anchor ?? null;
    setView(null);
    if (restoreFocus && view?.anchor.isConnected) {
      const target = view.anchor.matches("button") ? view.anchor : view.anchor.querySelector<HTMLElement>("button:not(:disabled)");
      target?.focus();
    }
  }, [keepOpen, view]);

  const scheduleClose = useCallback(() => {
    keepOpen();
    timer.current = setTimeout(() => setView((current) => {
      const focus = document.activeElement;
      if (current?.mode !== "preview" || current.anchor.contains(focus) || focus?.closest('[data-lineup-rating-overlay="preview"]')) return current;
      return null;
    }), 220);
  }, [keepOpen]);

  function preview(member: RatingMember, rating: MemberFootballRating | undefined, anchor: HTMLElement) {
    if (!rating) return;
    keepOpen();
    setView((current) => {
      if (current && current.mode !== "preview") return current;
      if (current?.member.id === member.id && current.anchor === anchor) return current;
      return { mode: "preview", member, rating, anchor };
    });
  }

  return {
    dismiss,
    scheduleClose,
    pointerPreview(event: PointerEvent<HTMLElement>, member: RatingMember, rating: MemberFootballRating | undefined) {
      if (event.pointerType !== "mouse" || !window.matchMedia("(any-hover: hover) and (any-pointer: fine)").matches) return;
      suppressFocus.current = null;
      preview(member, rating, event.currentTarget);
    },
    focusPreview(event: FocusEvent<HTMLElement>, member: RatingMember, rating: MemberFootballRating | undefined) {
      if (pointer.current === "touch" || pointer.current === "pen" || (suppressFocus.current && event.currentTarget.contains(suppressFocus.current))) return;
      preview(member, rating, event.currentTarget);
    },
    isTouchClick(event: MouseEvent<HTMLElement>) {
      const actualPointer = (event.nativeEvent as globalThis.PointerEvent).pointerType || (event.detail === 0 ? "" : pointer.current);
      return isTouchLineupActivation(actualPointer, event.detail, window.matchMedia("(any-hover: hover) and (any-pointer: fine)").matches);
    },
    info(member: RatingMember, rating: MemberFootballRating, anchor: HTMLElement) {
      keepOpen();
      setView({ mode: "info", member, rating, anchor });
    },
    actions(member: RatingMember, rating: MemberFootballRating | undefined, anchor: HTMLElement, actions: NonNullable<View["actions"]>) {
      keepOpen();
      setView({ mode: "actions", member, rating, anchor, actions });
    },
    overlay: view ? <LineupRatingOverlay key={`${view.member.id}-${view.mode}`} view={view} onClose={dismiss} keepOpen={keepOpen} scheduleClose={scheduleClose} /> : null,
  };
}

const panelClass = "fixed m-auto max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-sm overflow-y-auto rounded-lg border border-[#d8ad45]/60 bg-[#061426] p-5 text-white shadow-2xl";
const buttonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f4d58a]";

function LineupRatingOverlay({ view, onClose, keepOpen, scheduleClose }: {
  view: View; onClose: (restoreFocus?: boolean) => void; keepOpen: () => void; scheduleClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const name = getMemberDisplayName(view.member);
  const preview = view.mode === "preview";

  useEffect(() => {
    const element = preview ? panel.current : dialog.current;
    if (!element) return;
    function position() {
      if (!preview || !element) return;
      const bounds = view.anchor.getBoundingClientRect();
      if (bounds.bottom <= 12 || bounds.top >= window.innerHeight - 12) { onClose(); return; }
      const layout = positionLineupRatingPreview(bounds, { width: window.innerWidth, height: window.innerHeight }, element.scrollHeight + 2);
      Object.assign(element.style, Object.fromEntries(Object.entries(layout).map(([key, value]) => [key, `${value}px`])));
    }
    if (preview) { element.showPopover(); position(); }
    else (element as HTMLDialogElement).showModal();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    };
    const onOutside = (event: globalThis.PointerEvent) => {
      if (!preview || element.contains(event.target as Node) || view.anchor.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onOutside, true);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      if (preview) element.hidePopover();
      else (element as HTMLDialogElement).close();
    };
  }, [onClose, preview, view]);

  const content = <>
    <div className="mb-2 flex justify-end"><button type="button" aria-label="ปิด Football Rating" onClick={() => onClose(true)} className={`${buttonClass} size-11 border-white/25 hover:bg-white/10`}><X aria-hidden="true" className="size-5" /></button></div>
    {view.rating ? <MemberFootballCard name={name} photoUrl={view.member.photo_url} rating={view.rating} /> : <div className="text-center">
      <div className="mx-auto flex size-20 items-center justify-center overflow-hidden rounded-full border border-[#d8ad45] bg-white/10">
        {view.member.photo_url ? <Image unoptimized src={view.member.photo_url} alt="" width={80} height={80} className="size-full object-cover" /> : <span className="font-black text-[#f4d58a]">KSW</span>}
      </div>
      <h2 className="mt-3 break-words text-xl font-black">{name}</h2>
      <p className="mt-2 text-sm text-slate-300">ยังไม่มี Football Rating</p>
    </div>}
    {view.actions ? <div className="mt-4 grid gap-2 border-t border-white/15 pt-4">
      <button type="button" className={`${buttonClass} border-[#d8ad45] bg-[#d8ad45] text-[#061426]`} onClick={() => { onClose(); view.actions?.change(); }}><ArrowLeftRight aria-hidden="true" className="size-4" />เปลี่ยนผู้เล่น</button>
      <button type="button" className={`${buttonClass} border-white/25 text-white hover:bg-white/10`} onClick={() => { onClose(); view.actions?.clear(); }}><UserMinus aria-hidden="true" className="size-4" />นำออกจากตำแหน่ง</button>
      <button type="button" className={`${buttonClass} border-white/25 text-slate-300 hover:bg-white/10`} onClick={() => onClose(true)}><X aria-hidden="true" className="size-4" />ปิด</button>
    </div> : null}
  </>;

  return preview ? <div ref={panel} popover="manual" role="dialog" aria-label={`Football Rating ${name}`} data-lineup-rating-overlay="preview"
    className={`${panelClass} !m-0`} onPointerEnter={keepOpen} onPointerLeave={scheduleClose} onFocus={keepOpen} onBlur={scheduleClose} onMouseDown={(event) => event.stopPropagation()}>{content}</div>
    : <dialog ref={dialog} aria-label={`${view.mode === "actions" ? "จัดการผู้เล่น" : "Football Rating"} ${name}`} data-lineup-rating-overlay={view.mode}
      className={`${panelClass} inset-0 backdrop:bg-black/60`} onCancel={(event) => { event.preventDefault(); onClose(true); }} onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => { if (event.target !== event.currentTarget) return; const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(true); }}>{content}</dialog>;
}

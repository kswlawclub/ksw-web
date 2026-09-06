"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { Check, Trash2, X } from "lucide-react";
import { clearMemberFootballRating, saveMemberFootballRating } from "@/app/admin/members/rating-actions";
import { clubRoleLabel, getMemberDisplayName, membershipTypeLabel, type ClubMember } from "@/lib/club-members";
import { createFootballRatingForm, footballOverallPreview, footballRatingFormInput, footballStats, parseFootballRatingInput, type MemberFootballRating } from "@/lib/member-football-rating";
import { footballRatingFailure, type FootballRatingFailureCode } from "@/lib/member-football-rating-diagnostics";

const controlClass = "min-h-11 rounded-md border border-slate-300 px-3 py-2 focus-visible:outline-2 focus-visible:outline-[#9b1c1f] disabled:opacity-50";

export function AdminMemberRatingModal({ member, initialRating, onSaved, onClose }: {
  member: ClubMember; initialRating: MemberFootballRating | null;
  onSaved: (rating: MemberFootballRating | null) => void; onClose: () => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const [saved, setSaved] = useState(initialRating);
  const [form, setForm] = useState(() => createFootballRatingForm(initialRating));
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const input = footballRatingFormInput(member.id, form);
  const validation = parseFootballRatingInput(input);
  const preview = validation.ok ? footballOverallPreview(form.rating_type, validation.payload) : null;
  const unchanged = saved && JSON.stringify(form) === JSON.stringify(createFootballRatingForm(saved));
  const name = getMemberDisplayName(member);

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  function close() { if (!busyRef.current) onClose(); }
  function showSaveFailure(code: unknown) {
    const failure = footballRatingFailure(code);
    setMessage("");
    setError(`บันทึกไม่สำเร็จ [รหัส: ${failure.code}]\n${failure.error}`);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (confirmClear || !validation.ok || busyRef.current) return;
    await mutate(false);
  }
  async function mutate(clear: boolean) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(""); setMessage("");
    let boundary: FootballRatingFailureCode = "RATING_TRANSPORT";
    try {
      const result = clear ? await clearMemberFootballRating(member.id) : await saveMemberFootballRating(input);
      if (!result.ok) {
        if (clear) setError(result.error);
        else showSaveFailure("code" in result ? result.code : "RATING_SERVER");
        return;
      }
      boundary = "RATING_CLIENT_STATE";
      setSaved(result.rating);
      setForm(createFootballRatingForm(result.rating));
      setConfirmClear(false);
      setMessage(result.rating ? `บันทึกแล้ว · OVR ${result.rating.overall}` : "ล้าง Rating แล้ว ข้อมูลสมาชิกยังคงเดิม");
      onSaved(result.rating);
    } catch {
      if (clear) setError("เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่");
      else showSaveFailure(boundary);
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close(); } }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-xl overflow-y-auto rounded-lg border border-[#d8ad45]/60 bg-white p-0 text-[#061426] shadow-2xl backdrop:bg-slate-950/60">
      <header className="bg-[#061426] p-5 text-white sm:p-6">
        <div className="flex items-start justify-between gap-3"><h2 id={titleId} className="text-lg font-black text-[#f4d58a]">KSW Football Rating</h2><button autoFocus type="button" disabled={busy} onClick={close} aria-label="ปิด Football Rating" className="flex size-11 shrink-0 items-center justify-center rounded-md border border-white/30 focus-visible:outline-2 focus-visible:outline-[#f4d58a] disabled:opacity-50"><X aria-hidden="true" className="size-5" /></button></div>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#d8ad45] bg-white/10 text-xs font-black">{member.photo_url ? <Image unoptimized src={member.photo_url} alt="" width={64} height={64} className="h-full w-full object-cover" /> : "KSW"}</div>
          <div className="min-w-0"><p className="break-words text-xl font-black">{name}</p><p className="mt-1 text-xs text-slate-300">{membershipTypeLabel(member.membership_type)} · {clubRoleLabel(member.club_role)}</p></div>
        </div>
      </header>
      <form onSubmit={submit} className="p-5 sm:p-6">
        <fieldset disabled={busy || confirmClear}>
          <legend className="text-sm font-bold">Rating Type</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">{(["player", "goalkeeper"] as const).map((type) => <label key={type} className={`${controlClass} flex cursor-pointer items-center gap-2 text-sm font-bold ${form.rating_type === type ? "border-[#d8ad45] bg-amber-50" : "bg-white"}`}><input type="radio" name="rating-type" value={type} checked={form.rating_type === type} onChange={() => { setForm(createFootballRatingForm(null, type)); setMessage(""); setError(""); }} className="accent-[#061426]" />{type === "player" ? "Player" : "Goalkeeper"}</label>)}</div>
          <div className="my-5 flex items-center justify-between gap-3 border-y border-slate-200 py-4"><div><p className="text-xs font-bold text-slate-500">OVERALL</p><p className="mt-1 text-sm text-slate-600">{!saved ? "ยังไม่ได้ตั้งค่าความสามารถ" : unchanged ? "Rating ที่บันทึกไว้" : "ตัวอย่างก่อนบันทึก"}</p></div><output aria-label="Overall preview" className="text-4xl font-black tabular-nums">{unchanged ? saved.overall : preview ?? "–"}</output></div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">{footballStats[form.rating_type].map(({ field, label, name: statName }) => <label key={field} className="grid min-w-0 gap-1 text-sm font-black"><span>{label} <span className="font-normal text-slate-500">{statName}</span></span><input aria-label={`${label} ${statName}`} type="number" min={1} max={99} step={1} required inputMode="numeric" className={`${controlClass} w-full min-w-0 bg-slate-50 text-lg tabular-nums`} value={form.values[field] ?? ""} onChange={(event) => { setForm((current) => ({ ...current, values: { ...current.values, [field]: event.target.value } })); setMessage(""); }} /></label>)}</div>
        </fieldset>
        {!validation.ok && !confirmClear ? <p className="mt-3 text-xs text-slate-600">{validation.error}</p> : null}
        {error ? <p role="alert" className="mt-4 break-words whitespace-pre-line text-sm font-bold text-red-700">{error}</p> : null}
        {message ? <p role="status" className="mt-4 text-sm font-bold text-emerald-800">{message}</p> : null}
        {confirmClear ? <div className="mt-5 border-t border-amber-300 pt-4"><p className="text-sm font-bold">ล้างค่าความสามารถฟุตบอลของ{name}?</p><p className="mt-1 text-sm text-slate-600">ลบเฉพาะ Rating ไม่ลบรูปหรือข้อมูลสมาชิก</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} className={`${controlClass} bg-red-700 text-white`} onClick={() => void mutate(true)}>ยืนยันล้าง Rating</button><button type="button" disabled={busy} className={controlClass} onClick={() => setConfirmClear(false)}>ยกเลิก</button></div></div> : <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
          <button type="submit" disabled={busy || !validation.ok} className={`${controlClass} inline-flex items-center justify-center gap-2 border-[#061426] bg-[#061426] font-bold text-[#f4d58a]`}><Check aria-hidden="true" className="size-4" />{busy ? "กำลังบันทึก..." : "Save Rating"}</button>
          <button type="button" disabled={busy} onClick={close} className={controlClass}>Cancel</button>
          {saved ? <button type="button" disabled={busy} onClick={() => setConfirmClear(true)} className={`${controlClass} inline-flex items-center gap-2 sm:ml-auto`}><Trash2 aria-hidden="true" className="size-4" />Clear Rating</button> : null}
        </div>}
      </form>
    </dialog>
  );
}

"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { normalizeMapsUrl } from "@/lib/venue-maps";
import {
  createCompetition,
  deleteCompetitionById,
  setCompetitionPublication,
  updateCompetition,
} from "./actions";
import { ActionButton, useActionFeedback } from "@/components/admin-action-feedback";
import {
  COMPETITION_TYPES,
  getCompetitionTypeLabel,
  normalizeCompetitionType,
  type CompetitionType,
} from "@/lib/competition-format";

type SeasonStatus = "upcoming" | "active" | "completed";

type Competition = {
  id: string;
  name: string;
  season: string | null;
  slug: string | null;
  short_description: string | null;
  description: string | null;
  cover_image_url: string | null;
  edition_number: number | null;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  location_maps_url: string | null;
  display_order: number | null;
  competition_type: CompetitionType;
  season_status: SeasonStatus;
  is_active: boolean;
  is_featured: boolean;
  is_published: boolean;
  created_at: string;
};

type CompetitionForm = {
  id: string;
  name: string;
  season: string;
  slug: string;
  shortDescription: string;
  description: string;
  coverImageUrl: string;
  editionNumber: string;
  startDate: string;
  endDate: string;
  location: string;
  locationMapsUrl: string;
  displayOrder: string;
  competitionType: CompetitionType;
  seasonStatus: SeasonStatus;
  isActive: boolean;
  isFeatured: boolean;
  isPublished: boolean;
};

type ThaiDateParts = {
  buddhistYear: string;
  day: string;
  month: string;
};

const emptyForm: CompetitionForm = {
  id: "",
  name: "",
  season: "",
  slug: "",
  shortDescription: "",
  description: "",
  coverImageUrl: "",
  editionNumber: "",
  startDate: "",
  endDate: "",
  location: "",
  locationMapsUrl: "",
  displayOrder: "0",
  competitionType: "league",
  seasonStatus: "active",
  isActive: true,
  isFeatured: false,
  isPublished: false,
};

const maxCoverImageSize = 6 * 1024 * 1024;
const coverImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const thaiMonths = [
  { label: "มกราคม", value: "1" },
  { label: "กุมภาพันธ์", value: "2" },
  { label: "มีนาคม", value: "3" },
  { label: "เมษายน", value: "4" },
  { label: "พฤษภาคม", value: "5" },
  { label: "มิถุนายน", value: "6" },
  { label: "กรกฎาคม", value: "7" },
  { label: "สิงหาคม", value: "8" },
  { label: "กันยายน", value: "9" },
  { label: "ตุลาคม", value: "10" },
  { label: "พฤศจิกายน", value: "11" },
  { label: "ธันวาคม", value: "12" },
];

function emptyThaiDateParts(): ThaiDateParts {
  return {
    buddhistYear: "",
    day: "",
    month: "",
  };
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function isLeapYear(gregorianYear: number) {
  return (gregorianYear % 4 === 0 && gregorianYear % 100 !== 0) || gregorianYear % 400 === 0;
}

function daysInMonth(month: string, buddhistYear: string) {
  const monthNumber = Number(month);
  const buddhistYearNumber = Number(buddhistYear);

  if (!monthNumber || !buddhistYearNumber) {
    return 31;
  }

  if ([4, 6, 9, 11].includes(monthNumber)) {
    return 30;
  }

  if (monthNumber === 2) {
    return isLeapYear(buddhistYearNumber - 543) ? 29 : 28;
  }

  return 31;
}

function coerceThaiDateParts(parts: ThaiDateParts): ThaiDateParts {
  if (!parts.day) {
    return parts;
  }

  const maxDay = daysInMonth(parts.month, parts.buddhistYear);
  const dayNumber = Number(parts.day);

  if (!dayNumber || dayNumber <= maxDay) {
    return parts;
  }

  return {
    ...parts,
    day: String(maxDay),
  };
}

function parseIsoDateToThaiParts(value: string): ThaiDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return emptyThaiDateParts();
  }

  return {
    buddhistYear: String(Number(match[1]) + 543),
    day: String(Number(match[3])),
    month: String(Number(match[2])),
  };
}

function hasAnyThaiDatePart(parts: ThaiDateParts) {
  return Boolean(parts.day || parts.month || parts.buddhistYear);
}

function hasCompleteThaiDateParts(parts: ThaiDateParts) {
  return Boolean(parts.day && parts.month && parts.buddhistYear);
}

function thaiPartsToIsoDate(parts: ThaiDateParts) {
  if (!hasAnyThaiDatePart(parts)) {
    return "";
  }

  if (!hasCompleteThaiDateParts(parts)) {
    return null;
  }

  const dayNumber = Number(parts.day);
  const monthNumber = Number(parts.month);
  const buddhistYearNumber = Number(parts.buddhistYear);

  if (!dayNumber || !monthNumber || !buddhistYearNumber) {
    return null;
  }

  const maxDay = daysInMonth(parts.month, parts.buddhistYear);

  if (dayNumber > maxDay) {
    return null;
  }

  return `${buddhistYearNumber - 543}-${padDatePart(monthNumber)}-${padDatePart(dayNumber)}`;
}

function validateThaiDateParts(label: string, parts: ThaiDateParts) {
  const isoDate = thaiPartsToIsoDate(parts);

  if (isoDate === null) {
    return {
      error: `กรุณาเลือกวัน เดือน และปีของ${label}ให้ครบถ้วน`,
      isoDate: "",
    };
  }

  return {
    error: "",
    isoDate,
  };
}

function buddhistYearOptions() {
  const currentBuddhistYear = new Date().getFullYear() + 543;

  return Array.from({ length: 16 }, (_, index) => String(currentBuddhistYear - 5 + index));
}

function toCompetitionType(value: string | null): CompetitionType {
  return normalizeCompetitionType(value);
}

function isSeasonStatus(value: string): value is SeasonStatus {
  return ["upcoming", "active", "completed"].includes(value);
}

function toSeasonStatus(value: string | null): SeasonStatus {
  return value && isSeasonStatus(value) ? value : "active";
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugFromName(value: string) {
  return normalizeSlug(value.normalize("NFKD"));
}

function nullableText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nullableNumber(value: string) {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
}

export default function AdminCompetitionsPage() {
  const { runAction } = useActionFeedback();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [deletingCompetitionId, setDeletingCompetitionId] = useState("");
  const [form, setForm] = useState<CompetitionForm>(emptyForm);
  const [startDateParts, setStartDateParts] = useState<ThaiDateParts>(emptyThaiDateParts);
  const [endDateParts, setEndDateParts] = useState<ThaiDateParts>(emptyThaiDateParts);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState("");
  const [removeCoverImage, setRemoveCoverImage] = useState(false);
  const [slugEditedManually, setSlugEditedManually] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [publicationFilter, setPublicationFilter] = useState<"all" | "hidden" | "published">("all");
  const formRef = useRef<HTMLFormElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const coverObjectUrlRef = useRef("");

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    return () => {
      if (coverObjectUrlRef.current) {
        URL.revokeObjectURL(coverObjectUrlRef.current);
      }
    };
  }, []);

  async function loadData() {
    const supabase = getSupabase();

    setLoading(true);
    setError("");

    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const result = await supabase
      .from("leagues")
      .select(
        "id, name, season, slug, short_description, description, cover_image_url, edition_number, start_date, end_date, location, location_maps_url, display_order, competition_type, season_status, is_active, is_featured, is_published, created_at",
      )
      .order("created_at", { ascending: false });

    if (result.error) {
      console.error("admin competitions query failed", result.error.message);
      setError(
        `Could not load competitions from leagues. Apply the competition metadata migration if it has not been applied yet. ${result.error.message}`,
      );
    } else {
      setCompetitions(
        ((result.data ?? []) as Competition[]).map((competition) => ({
          ...competition,
          competition_type: toCompetitionType(competition.competition_type),
          season_status: toSeasonStatus(competition.season_status),
        })),
      );
    }

    setLoading(false);
  }

  async function setPublication(competition: Competition, published: boolean) {
    if (!published && competition.is_published && !window.confirm(`ต้องการซ่อน “${competition.name}” จากเว็บไซต์ใช่หรือไม่`)) return;
    const result = await runAction({
      errorMessage: (value) => !value.ok ? value.error ?? "ไม่สามารถอัปเดตสถานะการเผยแพร่ได้" : null,
      id: `competition-publication:${competition.id}`,
      loadingMessage: published ? "กำลังเผยแพร่…" : "กำลังซ่อน…",
      successMessage: published ? "เผยแพร่แล้ว" : "ซ่อนแล้ว",
    }, () => setCompetitionPublication(competition.id, published));
    if (!result?.ok) { setError(result?.error ?? "ไม่สามารถอัปเดตสถานะการเผยแพร่ได้"); return; }
    setCompetitions((current) => current.map((item) => item.id === competition.id ? { ...item, is_published: published } : item));
  }

  function resetForm() {
    setForm(emptyForm);
    setStartDateParts(emptyThaiDateParts());
    setEndDateParts(emptyThaiDateParts());
    setCoverFile(null);
    if (coverObjectUrlRef.current) {
      URL.revokeObjectURL(coverObjectUrlRef.current);
      coverObjectUrlRef.current = "";
    }
    setCoverPreviewUrl("");
    setRemoveCoverImage(false);
    setSlugEditedManually(false);
    setMessage("");
    setError("");
  }

  function scrollToEditForm() {
    window.setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      firstFieldRef.current?.focus({ preventScroll: true });
    }, 50);
  }

  function editCompetition(competition: Competition) {
    const startDateValue = competition.start_date ?? "";
    const endDateValue = competition.end_date ?? "";

    setForm({
      id: competition.id,
      name: competition.name,
      season: competition.season ?? "",
      slug: competition.slug ?? "",
      shortDescription: competition.short_description ?? "",
      description: competition.description ?? "",
      coverImageUrl: competition.cover_image_url ?? "",
      editionNumber: competition.edition_number === null ? "" : String(competition.edition_number),
      startDate: startDateValue,
      endDate: endDateValue,
      location: competition.location ?? "",
      locationMapsUrl: competition.location_maps_url ?? "",
      displayOrder: competition.display_order === null ? "0" : String(competition.display_order),
      competitionType: competition.competition_type,
      seasonStatus: toSeasonStatus(competition.season_status),
      isActive: competition.is_active,
      isFeatured: competition.is_featured,
      isPublished: competition.is_published,
    });
    setStartDateParts(parseIsoDateToThaiParts(startDateValue));
    setEndDateParts(parseIsoDateToThaiParts(endDateValue));
    setCoverFile(null);
    if (coverObjectUrlRef.current) {
      URL.revokeObjectURL(coverObjectUrlRef.current);
      coverObjectUrlRef.current = "";
    }
    setCoverPreviewUrl("");
    setRemoveCoverImage(false);
    setSlugEditedManually(true);
    setMessage("");
    setError("");
    scrollToEditForm();
  }

  async function saveCompetition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const startDateValidation = validateThaiDateParts("วันเริ่มการแข่งขัน", startDateParts);
    const endDateValidation = validateThaiDateParts("วันสิ้นสุดการแข่งขัน", endDateParts);

    if (startDateValidation.error || endDateValidation.error) {
      setError(startDateValidation.error || endDateValidation.error);
      return;
    }

    if (
      startDateValidation.isoDate &&
      endDateValidation.isoDate &&
      endDateValidation.isoDate < startDateValidation.isoDate
    ) {
      setError("วันสิ้นสุดการแข่งขันต้องไม่ก่อนวันเริ่มการแข่งขัน");
      return;
    }

    const payload = {
      name: form.name.trim(),
      season: form.season.trim() || null,
      slug: nullableText(normalizeSlug(form.slug)),
      short_description: nullableText(form.shortDescription),
      description: nullableText(form.description),
      cover_image_url: removeCoverImage ? null : nullableText(form.coverImageUrl),
      edition_number: nullableNumber(form.editionNumber),
      start_date: nullableText(startDateValidation.isoDate),
      end_date: nullableText(endDateValidation.isoDate),
      location: nullableText(form.location),
      location_maps_url: nullableText(form.locationMapsUrl),
      display_order: nullableNumber(form.displayOrder) ?? 0,
      competition_type: form.competitionType,
      season_status: form.seasonStatus,
      is_active: form.isActive,
      is_featured: form.isFeatured,
      is_published: form.isPublished,
    };

    setSaving(true);
    setMessage("");
    setError("");

    const coverData = new FormData();

    if (coverFile) {
      coverData.append("cover", coverFile);
    }

    const result = form.id
      ? await updateCompetition(form.id, payload, coverFile ? coverData : null)
      : await createCompetition(payload, coverFile ? coverData : null);

    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "Could not save competition.");
      return;
    }

    setMessage(form.id ? "Competition updated." : "Competition added.");
    setForm(emptyForm);
    setStartDateParts(emptyThaiDateParts());
    setEndDateParts(emptyThaiDateParts());
    setCoverFile(null);
    if (coverObjectUrlRef.current) {
      URL.revokeObjectURL(coverObjectUrlRef.current);
      coverObjectUrlRef.current = "";
    }
    setCoverPreviewUrl("");
    setRemoveCoverImage(false);
    setSlugEditedManually(false);
    await loadData();
  }

  function selectCoverFile(file: File | null) {
    setMessage("");

    if (!file) {
      setCoverFile(null);
      if (coverObjectUrlRef.current) {
        URL.revokeObjectURL(coverObjectUrlRef.current);
        coverObjectUrlRef.current = "";
      }
      setCoverPreviewUrl("");
      return;
    }

    if (!coverImageTypes.has(file.type)) {
      setError("Cover image must be a PNG, JPG, JPEG, or WebP file.");
      setCoverFile(null);
      if (coverObjectUrlRef.current) {
        URL.revokeObjectURL(coverObjectUrlRef.current);
        coverObjectUrlRef.current = "";
      }
      setCoverPreviewUrl("");
      return;
    }

    if (file.size > maxCoverImageSize) {
      setError("Cover image file must be 6MB or smaller.");
      setCoverFile(null);
      if (coverObjectUrlRef.current) {
        URL.revokeObjectURL(coverObjectUrlRef.current);
        coverObjectUrlRef.current = "";
      }
      setCoverPreviewUrl("");
      return;
    }

    if (coverObjectUrlRef.current) {
      URL.revokeObjectURL(coverObjectUrlRef.current);
    }

    const previewUrl = URL.createObjectURL(file);
    coverObjectUrlRef.current = previewUrl;
    setError("");
    setCoverFile(file);
    setCoverPreviewUrl(previewUrl);
    setRemoveCoverImage(false);
  }

  function markCoverForRemoval() {
    setCoverFile(null);
    if (coverObjectUrlRef.current) {
      URL.revokeObjectURL(coverObjectUrlRef.current);
      coverObjectUrlRef.current = "";
    }
    setCoverPreviewUrl("");
    setRemoveCoverImage(true);
    setForm((current) => ({ ...current, coverImageUrl: "" }));
    setMessage("");
    setError("");
  }

  function updateName(value: string) {
    setForm((current) => ({
      ...current,
      name: value,
      slug: current.id || slugEditedManually ? current.slug : slugFromName(value),
    }));
  }

  function updateSlug(value: string) {
    setSlugEditedManually(true);
    setForm((current) => ({ ...current, slug: normalizeSlug(value) }));
  }

  function generateSlugFromCurrentName() {
    setSlugEditedManually(true);
    setForm((current) => ({ ...current, slug: slugFromName(current.name) }));
  }

  function updateThaiDatePart(
    field: "startDate" | "endDate",
    part: keyof ThaiDateParts,
    value: string,
  ) {
    const currentParts = field === "startDate" ? startDateParts : endDateParts;
    const nextParts = coerceThaiDateParts({
      ...currentParts,
      [part]: value,
    });
    const isoDate = thaiPartsToIsoDate(nextParts);

    if (field === "startDate") {
      setStartDateParts(nextParts);
    } else {
      setEndDateParts(nextParts);
    }

    setForm((current) => ({
      ...current,
      [field]: isoDate ?? "",
    }));
    setError("");
  }

  async function deleteCompetition(competition: Competition) {
    const confirmed = window.confirm(`ลบรายการ “${competition.name}” พร้อมโปรแกรมแข่งขัน กลุ่ม และข้อมูลจัดสายทั้งหมดหรือไม่? การดำเนินการนี้ไม่สามารถย้อนกลับได้`);

    if (!confirmed) {
      return;
    }

    setDeletingCompetitionId(competition.id);
    let result: Awaited<ReturnType<typeof deleteCompetitionById>>;
    try {
      result = await deleteCompetitionById(competition.id);
    } catch {
      setError("ไม่สามารถลบรายการแข่งขันได้ ระบบยังไม่ได้ลบข้อมูลใด ๆ");
      return;
    } finally {
      setDeletingCompetitionId("");
    }

    if (!result.ok) {
      setError(result.error ?? "Could not delete competition.");
      return;
    }

    setMessage("Competition deleted.");
    await loadData();
  }

  const displayedCoverUrl = coverPreviewUrl || (!removeCoverImage ? form.coverImageUrl : "");
  const yearOptions = buddhistYearOptions();
  const startDayOptions = Array.from(
    { length: daysInMonth(startDateParts.month, startDateParts.buddhistYear) },
    (_, index) => String(index + 1),
  );
  const endDayOptions = Array.from(
    { length: daysInMonth(endDateParts.month, endDateParts.buddhistYear) },
    (_, index) => String(index + 1),
  );
  const isCompletedCompetition = Boolean(form.id && form.seasonStatus === "completed");

  const visibleCompetitions = competitions.filter((competition) => publicationFilter === "all" || (publicationFilter === "published" ? competition.is_published : !competition.is_published));

  return (
    <main className="min-h-screen bg-[#f6f2ea] text-[#061426]">
      <section className="bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.16),transparent_34%),linear-gradient(135deg,#061426,#091f39)] px-4 py-12 text-white sm:px-6 lg:px-10">
        <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-5">
          <Link className="text-sm font-bold text-[#f4d58a] hover:text-white" href="/admin">
            Back to Admin
          </Link>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ad45]">
              KSW Admin
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-tight">
              Manage Competitions
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
              Manage league, cup, friendly, and tournament records from the leagues table.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl min-w-0 gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:px-10">
        <form
          className="w-full min-w-0 max-w-full rounded-lg border border-[#d8ad45]/30 bg-white p-4 shadow-xl shadow-slate-900/10 sm:p-5"
          onSubmit={saveCompetition}
          ref={formRef}
        >
          <div className="mb-5 flex min-w-0 items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
              <h2 className="text-2xl font-black">
                {form.id ? "Edit Competition" : "Add Competition"}
              </h2>
            </div>
            {form.id ? (
              <button className="text-sm font-black text-[#9b1c1f]" onClick={resetForm} type="button">
                Cancel
              </button>
            ) : null}
          </div>

          <div className="grid gap-4">
            {isCompletedCompetition ? (
              <p className="rounded-md border border-amber-200 bg-[#fff7e6] px-3 py-2 text-sm font-semibold text-[#6f5115]">
                รายการแข่งขันจบแล้ว แก้ไขได้เฉพาะข้อมูลนำเสนอและข้อมูลประวัติ โครงสร้าง สถานะ และผลการแข่งขันถูกล็อก
              </p>
            ) : null}
            <label className="grid min-w-0 gap-2 text-sm font-black">
              Name
              <input
                className="w-full min-w-0 max-w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) => updateName(event.target.value)}
                ref={firstFieldRef}
                required
                value={form.name}
              />
            </label>

            <label className="grid min-w-0 gap-2 text-sm font-black">
              Season
              <input
                className="w-full min-w-0 max-w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) => setForm((current) => ({ ...current, season: event.target.value }))}
                value={form.season}
              />
            </label>

            <label className="grid min-w-0 gap-2 text-sm font-black">
              Slug
              <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  className="w-full min-w-0 max-w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                  disabled={isCompletedCompetition}
                  onChange={(event) => updateSlug(event.target.value)}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  placeholder="thai-lawyers-league-season-6"
                  value={form.slug}
                />
                <button
                  className="min-h-11 w-full max-w-full rounded-md border border-[#d8ad45]/45 px-3 py-2 text-center text-xs font-black leading-tight text-[#061426] hover:bg-[#fff4dc] sm:w-auto"
                  disabled={isCompletedCompetition}
                  onClick={generateSlugFromCurrentName}
                  type="button"
                >
                  Regenerate from name
                </button>
              </div>
              <span className="break-words text-xs font-semibold text-slate-500">
                Lowercase English letters, numbers, and hyphens only.
              </span>
              <span className="break-words text-xs font-semibold text-slate-500">
                Slug is used in the public URL. Changing it may break existing links.
              </span>
              <span className="block max-w-full break-all rounded-md bg-slate-50 px-3 py-2 font-mono text-xs font-bold text-slate-600">
                {form.slug ? `/competitions/${form.slug}` : "/competitions/[slug]"}
              </span>
            </label>

            <label className="grid min-w-0 gap-2 text-sm font-black">
              Short Description
              <input
                className="w-full min-w-0 max-w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) =>
                  setForm((current) => ({ ...current, shortDescription: event.target.value }))
                }
                value={form.shortDescription}
              />
            </label>

            <label className="grid min-w-0 gap-2 text-sm font-black">
              Description
              <textarea
                className="min-h-28 w-full min-w-0 max-w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                value={form.description}
              />
            </label>

            <div className="grid min-w-0 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div>
                <p className="text-sm font-black">Cover Image</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  Upload PNG, JPG, JPEG, or WebP. Max 6MB. Uploaded files are resized and converted to WebP.
                </p>
              </div>

              {displayedCoverUrl ? (
                <div
                  aria-label="Competition cover preview"
                  className="aspect-video w-full min-w-0 max-w-full overflow-hidden rounded-md border border-[#d8ad45]/30 bg-white bg-cover bg-center"
                  role="img"
                  style={{ backgroundImage: `url("${displayedCoverUrl}")` }}
                />
              ) : (
                <div className="flex aspect-video w-full min-w-0 max-w-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-white text-center text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                  No Cover Image
                </div>
              )}

              {coverFile ? (
                <p className="break-words text-xs font-bold text-emerald-700">
                  New file selected: {coverFile.name}
                </p>
              ) : null}

              {removeCoverImage ? (
                <p className="rounded-md border border-[#d8ad45]/30 bg-[#fff7e6] px-3 py-2 text-xs font-bold text-[#8a6418]">
                  Cover image will be removed when you save.
                </p>
              ) : null}

              <label className="grid min-w-0 gap-2 text-sm font-black">
                Upload Cover Image
                <input
                  accept="image/jpeg,image/png,image/webp"
                  className="w-full min-w-0 max-w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm file:mr-2 file:rounded-md file:border-0 file:bg-[#061426] file:px-3 file:py-2 file:text-xs file:font-black file:text-white file:hover:bg-[#0d2745]"
                  onChange={(event) => selectCoverFile(event.target.files?.[0] ?? null)}
                  type="file"
                />
              </label>

              <label className="grid min-w-0 gap-2 text-sm font-black">
                Cover Image URL <span className="text-xs font-semibold text-slate-500">Advanced / optional fallback</span>
                <input
                  className="w-full min-w-0 max-w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                  onChange={(event) => {
                    setRemoveCoverImage(false);
                    setForm((current) => ({ ...current, coverImageUrl: event.target.value }));
                  }}
                  placeholder="https://..."
                  type="url"
                  value={form.coverImageUrl}
                />
              </label>

              {displayedCoverUrl || coverFile || form.coverImageUrl ? (
                <button
                  className="rounded-md border border-[#9b1c1f]/30 px-3 py-2 text-xs font-black text-[#9b1c1f] hover:bg-[#9b1c1f]/10"
                  onClick={markCoverForRemoval}
                  type="button"
                >
                  Remove Cover Image
                </button>
              ) : null}
            </div>

            <label className="grid min-w-0 gap-2 text-sm font-black">
              Edition Number
              <input
                className="w-full min-w-0 max-w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                min="1"
                onChange={(event) =>
                  setForm((current) => ({ ...current, editionNumber: event.target.value }))
                }
                type="number"
                value={form.editionNumber}
              />
            </label>

            <div className="w-full min-w-0 max-w-full space-y-5">
              <div className="w-full min-w-0 max-w-full">
                <p className="mb-2 text-sm font-black">Start Date</p>
                <div className="grid w-full min-w-0 max-w-full grid-cols-2 gap-2">
                  <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">
                    วัน
                    <select
                      aria-label="วันเริ่มการแข่งขัน"
                      className="h-12 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 text-base outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20 sm:text-sm"
                      onChange={(event) => updateThaiDatePart("startDate", "day", event.target.value)}
                      value={startDateParts.day}
                    >
                      <option value="">วัน</option>
                      {startDayOptions.map((day) => (
                        <option key={day} value={day}>
                          {day}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">
                    เดือน
                    <select
                      aria-label="เดือนเริ่มการแข่งขัน"
                      className="h-12 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 text-base outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20 sm:text-sm"
                      onChange={(event) => updateThaiDatePart("startDate", "month", event.target.value)}
                      value={startDateParts.month}
                    >
                      <option value="">เดือน</option>
                      {thaiMonths.map((month) => (
                        <option key={month.value} value={month.value}>
                          {month.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="col-span-2 grid min-w-0 gap-1 text-xs font-black text-slate-600 sm:col-span-1">
                    ปี พ.ศ.
                    <select
                      aria-label="ปีเริ่มการแข่งขัน"
                      className="h-12 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 text-base outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20 sm:text-sm"
                      onChange={(event) => updateThaiDatePart("startDate", "buddhistYear", event.target.value)}
                      value={startDateParts.buddhistYear}
                    >
                      <option value="">ปี พ.ศ.</option>
                      {yearOptions.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="w-full min-w-0 max-w-full">
                <p className="mb-2 text-sm font-black">End Date</p>
                <div className="grid w-full min-w-0 max-w-full grid-cols-2 gap-2">
                  <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">
                    วัน
                    <select
                      aria-label="วันสิ้นสุดการแข่งขัน"
                      className="h-12 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 text-base outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20 sm:text-sm"
                      onChange={(event) => updateThaiDatePart("endDate", "day", event.target.value)}
                      value={endDateParts.day}
                    >
                      <option value="">วัน</option>
                      {endDayOptions.map((day) => (
                        <option key={day} value={day}>
                          {day}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid min-w-0 gap-1 text-xs font-black text-slate-600">
                    เดือน
                    <select
                      aria-label="เดือนสิ้นสุดการแข่งขัน"
                      className="h-12 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 text-base outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20 sm:text-sm"
                      onChange={(event) => updateThaiDatePart("endDate", "month", event.target.value)}
                      value={endDateParts.month}
                    >
                      <option value="">เดือน</option>
                      {thaiMonths.map((month) => (
                        <option key={month.value} value={month.value}>
                          {month.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="col-span-2 grid min-w-0 gap-1 text-xs font-black text-slate-600 sm:col-span-1">
                    ปี พ.ศ.
                    <select
                      aria-label="ปีสิ้นสุดการแข่งขัน"
                      className="h-12 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 text-base outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20 sm:text-sm"
                      onChange={(event) => updateThaiDatePart("endDate", "buddhistYear", event.target.value)}
                      value={endDateParts.buddhistYear}
                    >
                      <option value="">ปี พ.ศ.</option>
                      {yearOptions.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>

            <label className="grid min-w-0 gap-2 text-sm font-black">
              สถานที่แข่งขัน
              <input
                className="w-full min-w-0 max-w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
                value={form.location}
              />
            </label>

            <div className="grid min-w-0 gap-2 text-sm font-black">
              <label className="grid min-w-0 gap-2">
                Google Maps URL
                <input
                  className="w-full min-w-0 max-w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                  onChange={(event) => setForm((current) => ({ ...current, locationMapsUrl: event.target.value }))}
                  placeholder="https://maps.app.goo.gl/..."
                  type="url"
                  value={form.locationMapsUrl}
                />
              </label>
              <p className="text-xs font-semibold leading-5 text-slate-500">วางลิงก์แชร์จาก Google Maps เพื่อให้ผู้ชมเปิดตำแหน่งที่ถูกต้อง</p>
              {normalizeMapsUrl(form.locationMapsUrl) ? <a className="inline-flex min-h-11 w-fit items-center rounded-md border border-[#d8ad45]/45 px-3 py-2 text-sm font-black text-[#8a6418] hover:bg-[#fff7e6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a6418]" href={normalizeMapsUrl(form.locationMapsUrl)!} rel="noopener noreferrer" target="_blank">ทดสอบเปิดแผนที่</a> : null}
            </div>

            <label className="grid min-w-0 gap-2 text-sm font-black">
              Display Order
              <input
                className="w-full min-w-0 max-w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) =>
                  setForm((current) => ({ ...current, displayOrder: event.target.value }))
                }
                step="1"
                type="number"
                value={form.displayOrder}
              />
              <span className="break-words text-xs font-semibold text-slate-500">
                Lower numbers appear first within the same section.
              </span>
            </label>

            <label className="grid min-w-0 gap-2 text-sm font-black">
              Type
              <select
                className="w-full min-w-0 max-w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                disabled={isCompletedCompetition}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    competitionType: toCompetitionType(event.target.value),
                  }))
                }
                value={form.competitionType}
              >
                {COMPETITION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {getCompetitionTypeLabel(type)} ({type})
                  </option>
                ))}
              </select>
            </label>

            <label className="grid min-w-0 gap-2 text-sm font-black">
              Season Status
              <select
                className="w-full min-w-0 max-w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                disabled={isCompletedCompetition}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    seasonStatus: toSeasonStatus(event.target.value),
                  }))
                }
                value={form.seasonStatus}
              >
                <option value="upcoming">Upcoming — ยังไม่เริ่ม</option>
                <option value="active">Active — กำลังแข่งขัน</option>
                <option value="completed">Completed — จบฤดูกาลแล้ว</option>
              </select>
            </label>

            <label className="flex min-w-0 items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-sm font-black">
              <input
                checked={form.isActive}
                className="size-4 accent-[#d8ad45]"
                disabled={isCompletedCompetition}
                onChange={(event) =>
                  setForm((current) => ({ ...current, isActive: event.target.checked }))
                }
                type="checkbox"
              />
              Active
            </label>

            <label className="flex min-w-0 items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-sm font-black">
              <input
                checked={form.isFeatured}
                className="size-4 accent-[#d8ad45]"
                disabled={isCompletedCompetition}
                onChange={(event) =>
                  setForm((current) => ({ ...current, isFeatured: event.target.checked }))
                }
                type="checkbox"
              />
              Featured
            </label>

            <label className="flex min-w-0 items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-sm font-black">
              <input
                checked={form.isPublished}
                className="size-4 accent-[#d8ad45]"
                disabled={isCompletedCompetition}
                onChange={(event) =>
                  setForm((current) => ({ ...current, isPublished: event.target.checked }))
                }
                type="checkbox"
              />
              Published
            </label>

            {error ? (
              <p className="break-words rounded-md border border-[#9b1c1f]/25 bg-[#9b1c1f]/10 px-3 py-2 text-sm font-bold text-[#9b1c1f]">
                {error}
              </p>
            ) : null}
            {message ? (
              <p className="break-words rounded-md border border-emerald-700/20 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
                {message}
              </p>
            ) : null}

            <button
              className="min-h-11 w-full rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/20 transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving}
              type="submit"
            >
              {saving ? "Saving..." : form.id ? "Update Competition" : "Add Competition"}
            </button>
          </div>
        </form>

        <div className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="flex min-w-0 flex-col gap-2 border-b border-slate-200 p-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
              <h2 className="text-2xl font-black">Competition List</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2"><div className="flex rounded border p-0.5 text-xs font-bold">{([['all', 'ทั้งหมด'], ['published', 'เผยแพร่แล้ว'], ['hidden', 'ซ่อนอยู่']] as const).map(([value, label]) => <button className={`rounded px-2 py-1 ${publicationFilter === value ? "bg-[#061426] text-[#f4d58a]" : "text-slate-600"}`} key={value} onClick={() => setPublicationFilter(value)} type="button">{label}</button>)}</div><p className="break-words text-sm font-bold text-slate-500">{visibleCompetitions.length} competitions</p></div>
          </div>

          {loading ? (
            <p className="p-5 text-sm font-bold text-slate-600">Loading competitions...</p>
          ) : (
            <div className="w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
                <thead className="bg-[#061426] text-xs uppercase tracking-[0.14em] text-[#f4d58a]">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Slug</th>
                    <th className="px-4 py-3">Season</th>
                    <th className="px-4 py-3">Dates</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3 text-center">Display Order</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Season Status</th>
                    <th className="px-4 py-3">Competition</th>
                    <th className="px-4 py-3">Public</th>
                    <th className="px-4 py-3">Created At</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCompetitions.map((competition) => (
                    <tr
                      className="border-b border-slate-100 last:border-b-0 hover:bg-[#f8f3e7]"
                      key={competition.id}
                    >
                      <td className="px-4 py-3 font-black">{competition.name}</td>
                      <td className="px-4 py-3">
                        {competition.slug ? (
                          <span className="font-mono text-xs font-bold text-slate-600">{competition.slug}</span>
                        ) : (
                          <span className="text-xs font-bold text-slate-400">Preparing</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{competition.season ?? "-"}</td>
                      <td className="px-4 py-3">
                        {[competition.start_date, competition.end_date].filter(Boolean).join(" - ") || "-"}
                      </td>
                      <td className="px-4 py-3">{competition.location ?? "-"}</td>
                      <td className="px-4 py-3 text-center font-black">{competition.display_order ?? 0}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full border border-[#d8ad45]/40 bg-[#d8ad45]/10 px-3 py-1 text-xs font-black text-[#061426]">
                          {getCompetitionTypeLabel(competition.competition_type)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black capitalize text-[#061426]">
                          {competition.season_status}
                        </span>
                      </td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-black ${competition.season_status === "completed" ? "bg-emerald-100 text-emerald-800" : competition.season_status === "upcoming" ? "bg-amber-100 text-amber-900" : "bg-blue-100 text-blue-800"}`}>{competition.season_status === "completed" ? "Completed" : competition.season_status === "upcoming" ? "Upcoming" : "Ongoing"}</span></td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-black ${competition.is_published ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{competition.is_published ? "Published" : competition.season_status === "completed" ? "Completed · Hidden" : "Hidden"}</span></td>
                      <td className="px-4 py-3">{formatDate(competition.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Link
                            className="rounded-md border border-[#d8ad45]/45 px-3 py-2 text-xs font-black text-[#061426] hover:bg-[#fff4dc]"
                            href={`/admin/competitions/${competition.id}`}
                          >
                            Open Workspace
                          </Link>
                          <button
                            className="rounded-md border border-slate-200 px-3 py-2 text-xs font-black text-[#061426] hover:border-[#d8ad45]"
                            onClick={() => editCompetition(competition)}
                            type="button"
                          >
                            Edit
                          </button>
                          <ActionButton actionId={`competition-publication:${competition.id}`} className={`rounded-md border px-3 py-2 text-xs font-black ${competition.is_published ? "border-amber-300 text-amber-950" : "border-emerald-300 text-emerald-800"}`} loadingLabel={competition.is_published ? "กำลังซ่อน…" : "กำลังเผยแพร่…"} onClick={() => void setPublication(competition, !competition.is_published)} successLabel={competition.is_published ? "ซ่อนแล้ว" : "เผยแพร่แล้ว"} type="button">{competition.is_published ? "ซ่อนจากเว็บไซต์" : "เผยแพร่สู่เว็บไซต์"}</ActionButton>
                          <button
                            className="rounded-md border border-[#9b1c1f]/30 px-3 py-2 text-xs font-black text-[#9b1c1f] hover:bg-[#9b1c1f]/10"
                            disabled={deletingCompetitionId === competition.id}
                            onClick={() => void deleteCompetition(competition)}
                            type="button"
                          >
                            {deletingCompetitionId === competition.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visibleCompetitions.length === 0 ? (
                <p className="p-5 text-sm font-bold text-slate-600">
                  No competitions found.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

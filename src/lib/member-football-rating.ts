import { isMemberId } from "./club-members";

export const footballStats = {
  player: [
    { field: "pace", label: "PAC", name: "Pace" },
    { field: "shooting", label: "SHO", name: "Shooting" },
    { field: "passing", label: "PAS", name: "Passing" },
    { field: "dribbling", label: "DRI", name: "Dribbling" },
    { field: "defending", label: "DEF", name: "Defending" },
    { field: "physical", label: "PHY", name: "Physical" },
  ],
  goalkeeper: [
    { field: "gk_diving", label: "DIV", name: "Diving" },
    { field: "gk_handling", label: "HAN", name: "Handling" },
    { field: "gk_kicking", label: "KIC", name: "Kicking" },
    { field: "gk_reflexes", label: "REF", name: "Reflexes" },
    { field: "gk_speed", label: "SPD", name: "Speed" },
    { field: "gk_positioning", label: "POS", name: "Positioning" },
  ],
} as const;

export type FootballRatingType = keyof typeof footballStats;
export type FootballStatField = (typeof footballStats)[FootballRatingType][number]["field"];
export type FootballRatingWrite = { member_id: string; rating_type: FootballRatingType } & Record<FootballStatField, number | null>;
export type MemberFootballRating = FootballRatingWrite & { overall: number };
export type FootballRatingForm = { rating_type: FootballRatingType; values: Partial<Record<FootballStatField, string>> };

const allFields = [...footballStats.player, ...footballStats.goalkeeper].map((stat) => stat.field);
export const footballRatingColumns = ["member_id", "rating_type", ...allFields, "overall"].join(", ");

export function isFootballRatingType(value: unknown): value is FootballRatingType {
  return value === "player" || value === "goalkeeper";
}

export function isFootballStat(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 99;
}

// Input contains only the selected six stats. Opposite-type NULLs are created here, never trusted from a client.
export function parseFootballRatingInput(input: unknown): { ok: true; payload: FootballRatingWrite } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "ข้อมูล Rating ไม่ถูกต้อง" };
  const row = input as Record<string, unknown>;
  if (!isMemberId(row.member_id)) return { ok: false, error: "Member ID ไม่ถูกต้อง" };
  if (!isFootballRatingType(row.rating_type)) return { ok: false, error: "Rating Type ต้องเป็น Player หรือ Goalkeeper" };
  const selected = footballStats[row.rating_type];
  const allowed = new Set<string>(["member_id", "rating_type", ...selected.map((stat) => stat.field)]);
  if (Object.keys(row).some((key) => !allowed.has(key))) return { ok: false, error: "ห้ามส่ง OVR หรือค่าของ Rating Type อื่น" };
  if (selected.some((stat) => !isFootballStat(row[stat.field]))) return { ok: false, error: "กรอกค่าความสามารถให้ครบ 6 ค่า เป็นจำนวนเต็ม 1–99" };
  const values = Object.fromEntries(allFields.map((field) => [field, allowed.has(field) ? row[field] : null])) as Record<FootballStatField, number | null>;
  return { ok: true, payload: { member_id: row.member_id.toLowerCase(), rating_type: row.rating_type, ...values } };
}

export function footballOverallPreview(type: FootballRatingType, values: Partial<Record<FootballStatField, unknown>>): number | null {
  const stats = footballStats[type].map(({ field }) => values[field]);
  return stats.every(isFootballStat) ? Math.round(stats.reduce((sum, value) => sum + value, 0) / 6) : null;
}

export function createFootballRatingForm(rating?: MemberFootballRating | null, type: FootballRatingType = rating?.rating_type ?? "player"): FootballRatingForm {
  return { rating_type: type, values: Object.fromEntries(footballStats[type].map(({ field }) => [field,
    rating?.rating_type === type ? String(rating[field] ?? "") : "",
  ])) };
}

export function footballRatingFormInput(memberId: string, form: FootballRatingForm) {
  return { member_id: memberId, rating_type: form.rating_type, ...Object.fromEntries(
    footballStats[form.rating_type].map(({ field }) => [field, form.values[field]?.trim() ? Number(form.values[field]) : null]),
  ) };
}

// Fail closed on corrupt/partial query rows. The stored DB overall, not a recomputed preview, is returned.
export function readFootballRating(value: unknown): MemberFootballRating | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!isFootballRatingType(row.rating_type) || !isFootballStat(row.overall)) return null;
  const selected = new Set<string>(footballStats[row.rating_type].map(({ field }) => field));
  if (allFields.some((field) => !selected.has(field) && row[field] !== null)) return null;
  const parsed = parseFootballRatingInput({ member_id: row.member_id, rating_type: row.rating_type,
    ...Object.fromEntries([...selected].map((field) => [field, row[field]])),
  });
  return parsed.ok ? { ...parsed.payload, overall: row.overall } : null;
}

export function mapFootballRatings(rows: readonly unknown[], memberIds: readonly string[]): Record<string, MemberFootballRating> {
  const allowed = new Set(memberIds.map((id) => id.toLowerCase()));
  const result: Record<string, MemberFootballRating> = {};
  for (const row of rows) {
    const rating = readFootballRating(row);
    if (rating && allowed.has(rating.member_id)) result[rating.member_id] = rating;
  }
  return result;
}

export function footballRadarPoint(index: number, value: number) {
  const angle = (index * 60 - 90) * Math.PI / 180;
  const radius = Math.max(0, Math.min(99, Number.isFinite(value) ? value : 0)) / 99 * 76;
  return { x: Number((120 + Math.cos(angle) * radius).toFixed(3)), y: Number((110 + Math.sin(angle) * radius).toFixed(3)) };
}

"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin-server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isMemberId } from "@/lib/club-members";
import { footballRatingColumns, mapFootballRatings, parseFootballRatingInput, readFootballRating, type MemberFootballRating } from "@/lib/member-football-rating";
import { footballRatingFailure, type FootballRatingFailure, type FootballRatingFailureCode } from "@/lib/member-football-rating-diagnostics";

type RatingResult = { ok: true; rating: MemberFootballRating | null } | { ok: false; error: string };

function revalidateRatings() {
  revalidatePath("/admin/members");
  revalidatePath("/team");
}

export async function listMemberFootballRatings(memberIds: string[]): Promise<
  { ok: true; ratings: Record<string, MemberFootballRating> } | { ok: false; error: string }
> {
  await requireAdminSession();
  if (!Array.isArray(memberIds) || memberIds.some((id) => !isMemberId(id))) return { ok: false, error: "Member ID ไม่ถูกต้อง" };
  const ids = [...new Set(memberIds.map((id) => id.toLowerCase()))];
  if (!ids.length) return { ok: true, ratings: {} };
  const client = getSupabaseAdmin();
  if (!client) return { ok: false, error: "ไม่สามารถเชื่อมต่อข้อมูล Rating ได้" };
  const ratings: Record<string, MemberFootballRating> = {};
  // Bounded batches avoid URL length/row-limit truncation, without a per-member query.
  for (let index = 0; index < ids.length; index += 200) {
    const batch = ids.slice(index, index + 200);
    const result = await client.from("club_member_football_ratings").select(footballRatingColumns).in("member_id", batch);
    if (result.error) return { ok: false, error: "โหลด Rating ไม่สำเร็จ กรุณาลองใหม่" };
    Object.assign(ratings, mapFootballRatings(result.data ?? [], batch));
  }
  return { ok: true, ratings };
}

export async function saveMemberFootballRating(input: unknown): Promise<{ ok: true; rating: MemberFootballRating } | FootballRatingFailure> {
  let boundary: FootballRatingFailureCode = "RATING_AUTH";
  try {
    await requireAdminSession();
    boundary = "RATING_SERVER";
    const parsed = parseFootballRatingInput(input);
    if (!parsed.ok) return footballRatingFailure("RATING_VALIDATION");

    boundary = "RATING_CLIENT_INIT";
    const client = getSupabaseAdmin();
    if (!client) return footballRatingFailure(boundary);

    boundary = "RATING_DB_WRITE";
    // The FK validates member existence. This action never writes club_members or client overall.
    const result = await client.from("club_member_football_ratings")
      .upsert(parsed.payload, { onConflict: "member_id" }).select(footballRatingColumns).single();
    boundary = "RATING_READBACK";
    if (result.error) return footballRatingFailure("RATING_DB_WRITE");
    const rating = readFootballRating(result.data);
    if (!rating || rating.member_id !== parsed.payload.member_id) return footballRatingFailure(boundary);

    boundary = "RATING_REVALIDATE";
    revalidateRatings();
    return { ok: true, rating };
  } catch {
    // Do not log payloads, member IDs, credentials or raw exception/DB details.
    console.error("member football rating save failed", { code: boundary });
    return footballRatingFailure(boundary);
  }
}

export async function clearMemberFootballRating(memberId: string): Promise<RatingResult> {
  await requireAdminSession();
  if (!isMemberId(memberId)) return { ok: false, error: "Member ID ไม่ถูกต้อง" };
  const id = memberId.toLowerCase();
  const client = getSupabaseAdmin();
  if (!client) return { ok: false, error: "ไม่สามารถเชื่อมต่อข้อมูล Rating ได้" };
  const result = await client.from("club_member_football_ratings").delete().eq("member_id", id).select("member_id");
  if (result.error || !result.data || result.data.length > 1 || result.data.some((row) => row.member_id !== id)) {
    return { ok: false, error: "ล้าง Rating ไม่สำเร็จ กรุณาโหลดข้อมูลใหม่" };
  }
  // An already-cleared row is an idempotent success; no member/photo/lifecycle mutation.
  revalidateRatings();
  return { ok: true, rating: null };
}

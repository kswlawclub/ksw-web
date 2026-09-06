import type { SupabaseClient } from "@supabase/supabase-js";
import { footballRatingColumns, mapFootballRatings, type MemberFootballRating } from "./member-football-rating";

export async function getPublicMemberFootballRatings(client: SupabaseClient, memberIds: string[]): Promise<Record<string, MemberFootballRating>> {
  const ids = [...new Set(memberIds.map((id) => id.toLowerCase()))];
  const ratings: Record<string, MemberFootballRating> = {};
  try {
    for (let index = 0; index < ids.length; index += 200) {
      const batch = ids.slice(index, index + 200);
      const result = await client.from("club_member_football_ratings").select(footballRatingColumns).in("member_id", batch);
      if (result.error) throw new Error("Rating read failed");
      Object.assign(ratings, mapFootballRatings(result.data ?? [], batch));
    }
    return ratings;
  } catch {
    console.error("public lineup football ratings unavailable");
    return {};
  }
}

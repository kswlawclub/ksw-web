import {
  createFootballRatingForm, footballOverallPreview, footballRatingFormInput,
  parseFootballRatingInput, type FootballRatingForm, type MemberFootballRating,
} from "./member-football-rating";

// Compare the same normalized values sent to the action, not input formatting or
// change-event history. Invalid values must not collapse into empty/null values.
export function deriveFootballRatingSaveState(memberId: string, form: FootballRatingForm, saved: MemberFootballRating | null) {
  const input = footballRatingFormInput(memberId, form);
  const current: Record<string, unknown> = input;
  const baseline = footballRatingFormInput(memberId, createFootballRatingForm(saved));
  const dirty = Object.entries(baseline).some(([key, value]) => !Object.is(current[key], value));
  const validation = parseFootballRatingInput(input);
  const kind = saved && !dirty ? "saved" : !saved && validation.ok ? "ready" : dirty ? "dirty" : "new";
  const overall = saved && !dirty ? saved.overall : validation.ok ? footballOverallPreview(form.rating_type, validation.payload) : null;

  return {
    input, validation, dirty, kind, overall,
    canSave: dirty && validation.ok,
    status: kind === "saved" ? "บันทึกแล้ว" : kind === "ready" ? "พร้อมบันทึก Rating" : kind === "dirty" ? "มีการแก้ไขที่ยังไม่บันทึก" : "ยังไม่ได้ตั้งค่าความสามารถ",
    saveLabel: saved ? dirty ? "บันทึกการเปลี่ยนแปลง" : "บันทึกแล้ว" : "บันทึก Rating",
  };
}

export const unsavedFootballRatingCloseMessage = "มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการออกโดยไม่บันทึกหรือไม่?";

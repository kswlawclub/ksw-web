const failureMessages = {
  RATING_VALIDATION: "ข้อมูล Rating ไม่ถูกต้อง กรุณากรอกค่าของประเภทที่เลือกให้ครบ 6 ค่า เป็นจำนวนเต็ม 1–99",
  RATING_AUTH: "ตรวจสอบสิทธิ์ผู้ดูแลไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่",
  RATING_CLIENT_INIT: "เริ่มต้นการเชื่อมต่อระบบ Rating ไม่สำเร็จ กรุณาส่งรหัสนี้ให้ผู้ดูแลระบบ",
  RATING_DB_WRITE: "ระบบไม่สามารถยืนยันการบันทึก Rating ได้ กรุณาตรวจสอบข้อมูลที่บันทึกไว้ก่อนลองใหม่",
  RATING_READBACK: "ไม่สามารถตรวจสอบข้อมูล Rating ที่ระบบตอบกลับได้ กรุณาเปิดข้อมูลใหม่เพื่อตรวจสอบก่อนบันทึกซ้ำ",
  RATING_REVALIDATE: "บันทึก Rating แล้ว แต่รีเฟรชข้อมูลหน้าเว็บไม่สำเร็จ กรุณาเปิดข้อมูลใหม่เพื่อตรวจสอบก่อนบันทึกซ้ำ",
  RATING_SERVER: "เกิดข้อผิดพลาดภายในระบบ Rating กรุณาส่งรหัสนี้ให้ผู้ดูแลระบบ",
  RATING_TRANSPORT: "ไม่ได้รับคำตอบที่ตรวจสอบได้จากระบบบันทึก กรุณาตรวจสอบ Rating ที่บันทึกไว้ก่อนลองใหม่",
  RATING_CLIENT_STATE: "ได้รับคำตอบสำเร็จจากระบบ แต่ปรับการแสดงผลไม่สำเร็จ กรุณาปิดแล้วเปิดข้อมูลใหม่",
} as const;

export type FootballRatingFailureCode = keyof typeof failureMessages;

// Only our fixed codes/messages cross the UI boundary, never an exception or DB message.
export function footballRatingFailure(value: unknown) {
  const code: FootballRatingFailureCode = typeof value === "string" && Object.hasOwn(failureMessages, value)
    ? value as FootballRatingFailureCode : "RATING_SERVER";
  return { ok: false as const, code, error: failureMessages[code] };
}

export type FootballRatingFailure = ReturnType<typeof footballRatingFailure>;

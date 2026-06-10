"use server";

export async function verifyAdminPassword(password: string) {
  const adminPassword = process.env.KSW_ADMIN_PASSWORD ?? "";

  if (!adminPassword) {
    return { configured: false, valid: false };
  }

  return { configured: true, valid: password === adminPassword };
}

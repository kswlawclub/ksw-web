"use server";

import { clearAdminSession, createAdminSession } from "@/lib/admin-server-auth";
import {
  isAdminPasswordConfigured,
  isAdminSessionSecretConfigured,
  verifyAdminPasswordValue,
} from "@/lib/admin-auth";
import { redirect } from "next/navigation";

export async function loginAdmin(password: string) {
  if (!isAdminPasswordConfigured()) {
    return { ok: false, error: "Admin password is not configured." };
  }

  if (!isAdminSessionSecretConfigured()) {
    return { ok: false, error: "Admin session secret is not configured." };
  }

  if (!verifyAdminPasswordValue(password)) {
    return { ok: false, error: "Wrong password. Please try again." };
  }

  const created = await createAdminSession();

  if (!created) {
    return { ok: false, error: "Admin session could not be created." };
  }

  return { ok: true };
}

export async function logoutAdmin() {
  await clearAdminSession();
  redirect("/admin/login");
}

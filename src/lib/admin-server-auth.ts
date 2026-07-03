import "server-only";

import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE,
  createAdminSessionValue,
  isValidAdminSessionValue,
} from "@/lib/admin-auth";

const cookieOptions = {
  httpOnly: true,
  maxAge: ADMIN_SESSION_MAX_AGE,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

export async function getAdminSession() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;

  return isValidAdminSessionValue(sessionCookie);
}

export async function requireAdminSession() {
  const valid = await getAdminSession();

  if (!valid) {
    throw new Error("Unauthorized admin session.");
  }
}

export async function createAdminSession() {
  const sessionValue = await createAdminSessionValue();

  if (!sessionValue) {
    return false;
  }

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, sessionValue, cookieOptions);

  return true;
}

export async function clearAdminSession() {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, "", {
    ...cookieOptions,
    maxAge: 0,
  });
}

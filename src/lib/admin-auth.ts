export const ADMIN_SESSION_COOKIE = "ksw-admin-session";
export const ADMIN_SESSION_MAX_AGE = 8 * 60 * 60;

function adminSessionSecret() {
  return process.env.KSW_ADMIN_SESSION_SECRET ?? "";
}

function adminPassword() {
  return process.env.KSW_ADMIN_PASSWORD ?? "";
}

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}

async function sign(value: string) {
  const secret = adminSessionSecret();

  if (!secret) {
    return "";
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));

  return toHex(signature);
}

export function isAdminPasswordConfigured() {
  return Boolean(adminPassword());
}

export function isAdminSessionSecretConfigured() {
  return Boolean(adminSessionSecret());
}

export function verifyAdminPasswordValue(password: string) {
  const configuredPassword = adminPassword();

  return Boolean(configuredPassword) && password === configuredPassword;
}

export async function createAdminSessionValue() {
  const expiresAt = Date.now() + ADMIN_SESSION_MAX_AGE * 1000;
  const signature = await sign(String(expiresAt));

  if (!signature) {
    return "";
  }

  return `${expiresAt}.${signature}`;
}

export async function isValidAdminSessionValue(value: string | undefined) {
  if (!value) {
    return false;
  }

  const [expiresAt, signature] = value.split(".");

  if (!expiresAt || !signature || !/^\d+$/.test(expiresAt)) {
    return false;
  }

  if (Number(expiresAt) <= Date.now()) {
    return false;
  }

  const expectedSignature = await sign(expiresAt);

  return Boolean(expectedSignature) && safeEqual(signature, expectedSignature);
}

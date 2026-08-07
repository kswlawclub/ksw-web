export function normalizeMapsUrl(value: string | null | undefined) {
  if (!value?.trim()) return null;

  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function validateMapsUrl(value: string | null | undefined) {
  return value?.trim() && !normalizeMapsUrl(value)
    ? "Google Maps URL ต้องเป็นลิงก์ http/https ที่ถูกต้อง"
    : "";
}

export function getExplicitVenueMapsUrl({ mapsUrl, venueName }: { mapsUrl: string | null | undefined; venueName: string | null | undefined }) {
  return venueName?.trim() ? normalizeMapsUrl(mapsUrl) : null;
}

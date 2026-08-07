export type VenueMapsInput = {
  mapsUrl?: string | null;
  venueName?: string | null;
};

function validHttpUrl(value: string | null | undefined) {
  if (!value?.trim()) return null;

  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function getVenueMapsUrl({ mapsUrl, venueName }: VenueMapsInput) {
  const customUrl = validHttpUrl(mapsUrl);
  if (customUrl) return customUrl;

  const name = venueName?.trim();
  return name ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}` : null;
}

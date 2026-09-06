export function isTouchLineupActivation(pointerType: string, detail: number, canHover: boolean) {
  if (pointerType === "touch" || pointerType === "pen") return true;
  if (pointerType === "mouse" || detail === 0) return false;
  return !canHover;
}

type Bounds = { left: number; right: number; top: number; bottom: number };

// Prefer a side preview; on narrow screens constrain its height above/below the
// anchor so the original Select Player button is never covered by the panel.
export function positionLineupRatingPreview(anchor: Bounds, viewport: { width: number; height: number }, height: number) {
  const gap = 12;
  const width = Math.min(360, viewport.width - gap * 2);
  const maxHeight = viewport.height - gap * 2;
  const top = Math.max(gap, Math.min(anchor.top, viewport.height - Math.min(height, maxHeight) - gap));
  if (viewport.width - anchor.right - gap * 2 >= width) return { left: anchor.right + gap, top, width, maxHeight };
  if (anchor.left - gap * 2 >= width) return { left: anchor.left - gap - width, top, width, maxHeight };
  const left = Math.max(gap, Math.min(anchor.left, viewport.width - width - gap));
  const above = Math.max(0, anchor.top - gap * 2);
  const below = Math.max(0, viewport.height - anchor.bottom - gap * 2);
  if (above > below) return { left, top: anchor.top - gap - Math.min(height, above), width, maxHeight: above };
  return { left, top: anchor.bottom + gap, width, maxHeight: below };
}

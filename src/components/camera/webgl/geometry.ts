/**
 * Pure geometry helpers shared by the WebGL pipeline and unit tests.
 * Kept free of DOM/GL so they run anywhere (node scripts included).
 */

export type AspectRatio = "free" | "1:1" | "4:3" | "16:9" | "3:4";

export function aspectRatioValue(a: AspectRatio): number | null {
  switch (a) {
    case "1:1":
      return 1;
    case "4:3":
      return 4 / 3;
    case "16:9":
      return 16 / 9;
    case "3:4":
      return 3 / 4;
    default:
      return null;
  }
}

/**
 * Center crop box to reach the target aspect ratio at native resolution.
 * Mirrors the old server-side `computeCropBox` exactly.
 */
export function computeCropBox(
  w: number,
  h: number,
  aspect: AspectRatio,
): { left: number; top: number; width: number; height: number } {
  const ar = aspectRatioValue(aspect);
  if (ar == null) return { left: 0, top: 0, width: w, height: h };
  const current = w / h;
  if (Math.abs(current - ar) < 0.01) {
    return { left: 0, top: 0, width: w, height: h };
  }
  if (current > ar) {
    const newW = Math.round(h * ar);
    const left = Math.round((w - newW) / 2);
    return { left, top: 0, width: newW, height: h };
  }
  const newH = Math.round(w / ar);
  const top = Math.round((h - newH) / 2);
  return { left: 0, top, width: w, height: newH };
}

/**
 * Final output size for an upscale request, clamped by:
 * 1. GPU max texture size (both sides)
 * 2. the requested upscale factor (never upscales beyond it)
 * 3. the per-device pixel budget (max total pixels)
 * 4. the absolute max side (old server MAX_SIDE = 8000)
 *
 * Returns the ACTUAL effective factor as well (may be < requested on
 * constrained devices — "capai hasil maksimal di device tersebut").
 */
export function fitTargetSize(
  srcW: number,
  srcH: number,
  upscale: number,
  maxSide: number,
  maxPixels: number,
  maxTextureSize: number,
): [number, number] {
  const capSide = Math.min(maxSide, maxTextureSize);
  let w = srcW * upscale;
  let h = srcH * upscale;
  if (Math.max(w, h) > capSide) {
    const s = capSide / Math.max(w, h);
    w *= s;
    h *= s;
  }
  const px = w * h;
  if (px > maxPixels) {
    const s = Math.sqrt(maxPixels / px);
    w *= s;
    h *= s;
  }
  w = Math.round(Math.min(w, capSide));
  h = Math.round(Math.min(h, capSide));
  return [Math.max(2, w), Math.max(2, h)];
}

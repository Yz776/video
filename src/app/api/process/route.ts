import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type FilterPreset =
  | "none"
  | "vivid"
  | "mono"
  | "warm"
  | "cool"
  | "cinema"
  | "night"
  | "vintage";

type AspectRatio = "free" | "1:1" | "4:3" | "16:9" | "3:4";
type WatermarkPosition =
  | "bl" // bottom-left
  | "br" // bottom-right
  | "tl" // top-left
  | "tr" // top-right
  | "c" // center
  | "none";

interface ProcessParams {
  file: File;
  upscale: number; // 1, 2, 4
  quality: number; // 60-100
  sharpen: boolean;
  denoise: boolean;
  enhance: boolean;
  filter: FilterPreset;
  aspect: AspectRatio;
  watermark: WatermarkPosition;
  watermarkText: string;
  watermarkOpacity: number; // 0-1
  wantPreview: boolean;
  exposure: number; // -1 .. 1
  contrast: number; // -1 .. 1
  saturation: number; // -1 .. 1
  temperature: number; // -1 .. 1 (warm-cool)
  vignette: boolean;
  hdr: boolean;
}

/**
 * Build an SVG overlay for the "kangwifi cam" watermark.
 *
 * Layout:
 *   - Corner positions (bl/br/tl/tr): icon + text on a single row.
 *     For bl/tl the icon sits at the left and text flows rightward
 *     (text-anchor=start). For br/tr the icon sits at the right and
 *     text flows leftward (text-anchor=end) — this guarantees the
 *     text can NEVER be clipped at the image edge regardless of its
 *     rendered width.
 *   - Center (c): icon stacked above the text, both horizontally
 *     centered. Previously the icon was placed at the same anchor
 *     as the text and they overlapped — that was the bug.
 *
 * Font: DejaVu Sans / Liberation Sans are installed on the server,
 * Inter/Arial are NOT — so we list the installed ones first to
 * guarantee consistent rendering.
 *
 * Legibility: a strong soft drop shadow (not a hard outline) is
 * applied to the whole group, which keeps the watermark readable
 * on both bright and dark photos without needing a pill background.
 */
function buildWatermarkSvg(opts: {
  width: number;
  height: number;
  position: WatermarkPosition;
  text: string;
  opacity: number;
}): Buffer {
  const { width, height, position, text, opacity } = opts;
  if (position === "none" || !text.trim()) return Buffer.alloc(0);

  // Scale font size relative to image size — caps to keep things sensible
  const fontSize = Math.max(28, Math.min(96, Math.round(width / 32)));
  const iconSize = Math.round(fontSize * 1.1);
  const pad = Math.round(fontSize * 0.8);
  const gap = Math.round(fontSize * 0.35);

  const FONT_FAMILY =
    "DejaVu Sans, Liberation Sans, Arial, Helvetica, sans-serif";

  let iconX = pad;
  let iconY = height - pad - iconSize;
  let textX = pad;
  let textY = height - pad;
  let anchor: "start" | "middle" | "end" = "start";

  switch (position) {
    case "bl": {
      iconX = pad;
      iconY = height - pad - iconSize;
      textX = iconX + iconSize + gap;
      // Baseline near bottom of icon so text vertically centers with icon
      textY = iconY + iconSize * 0.78;
      anchor = "start";
      break;
    }
    case "br": {
      iconX = width - pad - iconSize;
      iconY = height - pad - iconSize;
      // Text ENDS just left of icon — guaranteed never to clip on right
      textX = iconX - gap;
      textY = iconY + iconSize * 0.78;
      anchor = "end";
      break;
    }
    case "tl": {
      iconX = pad;
      iconY = pad;
      textX = iconX + iconSize + gap;
      textY = iconY + iconSize * 0.78;
      anchor = "start";
      break;
    }
    case "tr": {
      iconX = width - pad - iconSize;
      iconY = pad;
      textX = iconX - gap;
      textY = iconY + iconSize * 0.78;
      anchor = "end";
      break;
    }
    case "c": {
      // Stack: icon above, text below — both horizontally centered.
      const totalH = iconSize + gap + fontSize;
      const top = height / 2 - totalH / 2;
      iconX = width / 2 - iconSize / 2;
      iconY = top;
      textX = width / 2;
      textY = top + iconSize + gap + fontSize * 0.78;
      anchor = "middle";
      break;
    }
  }

  const shadowStd = Math.max(1.5, fontSize / 12);
  const shadowDy = Math.max(1, fontSize / 20);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="wmDs" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${shadowStd}"/>
      <feOffset dx="0" dy="${shadowDy}" result="o"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.55"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <linearGradient id="wmIc" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FCD34D"/>
      <stop offset="100%" stop-color="#F59E0B"/>
    </linearGradient>
  </defs>
  <g opacity="${opacity}" filter="url(#wmDs)">
    <g transform="translate(${iconX}, ${iconY})">
      <rect width="${iconSize}" height="${iconSize}" rx="${iconSize * 0.22}" fill="url(#wmIc)"/>
      <text x="${iconSize / 2}" y="${iconSize * 0.7}" font-family="${FONT_FAMILY}" font-size="${iconSize * 0.58}" font-weight="900" text-anchor="middle" fill="#0b0b0b">K</text>
    </g>
    <text x="${textX}" y="${textY}" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="800" text-anchor="${anchor}" fill="#ffffff" letter-spacing="${Math.max(0.5, fontSize / 40)}">${escapeXml(text)}</text>
  </g>
</svg>`;
  return Buffer.from(svg);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Apply a filter preset by chaining sharp operations.
 */
function applyFilter(p: sharp.Sharp, filter: FilterPreset): sharp.Sharp {
  switch (filter) {
    case "vivid":
      return p.modulate({ saturation: 1.35, brightness: 1.04 }).linear(1.08, -8);
    case "mono":
      // Greyscale via sharp's desaturate
      return p.greyscale().linear(1.1, -10);
    case "warm":
      return p.modulate({ saturation: 1.15, brightness: 1.03 })
        .tint({ r: 255, g: 215, b: 175 });
    case "cool":
      return p.modulate({ saturation: 1.1, brightness: 1.02 })
        .tint({ r: 200, g: 225, b: 255 });
    case "cinema":
      // Teal-orange lift via linear curves approximation
      return p
        .modulate({ saturation: 1.2, brightness: 0.98 })
        .linear(1.12, -12)
        .tint({ r: 255, g: 225, b: 200 });
    case "night":
      return p.modulate({ brightness: 1.18, saturation: 0.9 }).linear(1.15, -18);
    case "vintage":
      return p
        .modulate({ saturation: 0.85, brightness: 1.05 })
        .tint({ r: 255, g: 220, b: 170 })
        .linear(0.95, 8);
    default:
      return p;
  }
}

/**
 * Convert aspect ratio string to width/height ratio.
 */
function aspectRatioValue(a: AspectRatio): number | null {
  switch (a) {
    case "1:1": return 1;
    case "4:3": return 4 / 3;
    case "16:9": return 16 / 9;
    case "3:4": return 3 / 4;
    default: return null;
  }
}

/**
 * Compute crop dimensions to hit a target aspect ratio.
 */
function computeCropBox(
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
    // too wide — crop width
    const newW = Math.round(h * ar);
    const left = Math.round((w - newW) / 2);
    return { left, top: 0, width: newW, height: h };
  }
  const newH = Math.round(w / ar);
  const top = Math.round((h - newH) / 2);
  return { left: 0, top, width: w, height: newH };
}

/**
 * Build vignette SVG overlay (radial darkening at corners).
 */
function buildVignetteSvg(w: number, h: number): Buffer {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.sqrt(cx * cx + cy * cy);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <radialGradient id="v" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/>
      <stop offset="65%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.45"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#v)"/>
</svg>`;
  return Buffer.from(svg);
}

/**
 * HDR-like local contrast boost viaCLAHE-like approximation using
 * high-pass sharpening + gamma. Combined with mild denoise.
 */
function applyHdrLike(p: sharp.Sharp): sharp.Sharp {
  return p
    .sharpen({
      sigma: 1.6,
      m1: 2.5,
      m2: 1.2,
      x1: 1,
      y2: 10,
    })
    .gamma(1.05)
    .clahe({ width: 7, height: 7, maxSlope: 4 });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const params: ProcessParams = {
      file,
      upscale: clampNum(formData.get("upscale"), 1, [1, 2, 4], 2),
      quality: clampNum(formData.get("quality"), 95, [60, 100], 95),
      sharpen: formData.get("sharpen") !== "0",
      denoise: formData.get("denoise") === "1",
      enhance: formData.get("enhance") !== "0",
      filter: (String(formData.get("filter") ?? "none") as FilterPreset),
      aspect: (String(formData.get("aspect") ?? "free") as AspectRatio),
      watermark: (String(formData.get("watermark") ?? "br") as WatermarkPosition),
      watermarkText: String(formData.get("watermarkText") ?? "kangwifi cam"),
      watermarkOpacity: clampNum(formData.get("watermarkOpacity"), 0.85, [0.2, 1], 0.85),
      wantPreview: formData.get("preview") === "1",
      exposure: clampNum(formData.get("exposure"), 0, [-1, 1], 0),
      contrast: clampNum(formData.get("contrast"), 0, [-1, 1], 0),
      saturation: clampNum(formData.get("saturation"), 0, [-1, 1], 0),
      temperature: clampNum(formData.get("temperature"), 0, [-1, 1], 0),
      vignette: formData.get("vignette") === "1",
      hdr: formData.get("hdr") === "1",
    };

    const inputBuf = Buffer.from(await file.arrayBuffer());

    // ---- Read metadata ----
    const meta = await sharp(inputBuf).metadata();
    const origW = meta.width ?? 1920;
    const origH = meta.height ?? 1080;

    // ---- Aspect crop (pre-upscale, so we crop at native resolution) ----
    const cropBox = computeCropBox(origW, origH, params.aspect);

    // ---- Compute target output size ----
    const MAX_SIDE = 8000;
    let targetW = cropBox.width * params.upscale;
    let targetH = cropBox.height * params.upscale;
    if (Math.max(targetW, targetH) > MAX_SIDE) {
      const scale = MAX_SIDE / Math.max(targetW, targetH);
      targetW = Math.round(targetW * scale);
      targetH = Math.round(targetH * scale);
    }

    // ---- Build pipeline ----
    let pipeline = sharp(inputBuf, { failOn: "none" }).rotate();

    // Crop to aspect ratio
    if (params.aspect !== "free") {
      pipeline = pipeline.extract({
        left: cropBox.left,
        top: cropBox.top,
        width: cropBox.width,
        height: cropBox.height,
      });
    }

    // Upscale with high-quality lanczos3 kernel
    pipeline = pipeline.resize({
      width: targetW,
      height: targetH,
      fit: "fill",
      kernel: "lanczos3",
      withoutEnlargement: false,
      withoutReduction: false,
    });

    // ---- Denoise (mild, before sharpening) ----
    if (params.denoise) {
      // Mild blur to suppress noise — followed by sharp recovery below
      pipeline = pipeline.median(1);
    }

    // ---- HDR-like local contrast ----
    if (params.hdr) {
      pipeline = applyHdrLike(pipeline);
    }

    // ---- Filter presets ----
    pipeline = applyFilter(pipeline, params.filter);

    // ---- Manual exposure/contrast/saturation/temperature ----
    // Exposure: brightness multiplier; Contrast: linear slope; Saturation: modulate
    const brightness = 1 + params.exposure * 0.35;
    const satMultiplier =
      params.filter === "mono" ? 0 : 1 + params.saturation * 0.5;
    if (params.exposure !== 0 || params.saturation !== 0) {
      pipeline = pipeline.modulate({
        brightness,
        saturation: satMultiplier,
      });
    }
    if (params.contrast !== 0) {
      const slope = 1 + params.contrast * 0.4;
      const intercept = -params.contrast * 0.05 * 255;
      pipeline = pipeline.linear(slope, intercept);
    }
    if (params.temperature !== 0) {
      // Warm = +red/-blue; Cool = -red/+blue. Approximate via tint.
      const t = params.temperature;
      const r = 255;
      const g = Math.round(255 - Math.abs(t) * 30);
      const b = Math.round(255 - t * 60);
      pipeline = pipeline.tint({
        r: Math.min(255, Math.max(0, r)),
        g: Math.min(255, Math.max(0, g)),
        b: Math.min(255, Math.max(0, b)),
      });
    }

    // ---- Auto-enhance (legacy "enhance" toggle) ----
    if (params.enhance) {
      pipeline = pipeline.modulate({
        brightness: 1.03,
        saturation: 1.08,
      });
      pipeline = pipeline.linear(1.04, -5);
    }

    // ---- Sharpening (after all color/contrast ops) ----
    if (params.sharpen) {
      // Adaptive sharpen — stronger mid-frequency, mild high-frequency to
      // avoid noise amplification. Recovers detail lost in upscale without
      // introducing halos.
      pipeline = pipeline.sharpen({
        sigma: 0.8,
        m1: 1.4,
        m2: 0.5,
        x1: 1.5,
        y2: 6,
      });
    }

    // ---- Fork for preview BEFORE encoding ----
    const previewPipeline = pipeline.clone();

    // ---- Vignette overlay ----
    if (params.vignette) {
      const vignetteSvg = buildVignetteSvg(targetW, targetH);
      pipeline = pipeline.composite([
        { input: vignetteSvg, blend: "over" },
      ]);
    }

    // ---- Watermark overlay ----
    const wmSvg = buildWatermarkSvg({
      width: targetW,
      height: targetH,
      position: params.watermark,
      text: params.watermarkText,
      opacity: params.watermarkOpacity,
    });
    if (wmSvg.length > 0) {
      pipeline = pipeline.composite([
        { input: wmSvg, blend: "over" },
      ]);
    }

    // ---- Encode HEIC (AV1) ----
    const heicBuf = await pipeline
      .heif({ compression: "av1", quality: params.quality, effort: 2 })
      .toBuffer();

    // ---- Preview JPEG (forked before watermark/vignette for clarity on thumb) ----
    let previewBuf: Buffer | null = null;
    if (params.wantPreview) {
      const previewMaxSide = 1600;
      const scale = Math.min(1, previewMaxSide / Math.max(targetW, targetH));
      const pW = Math.max(1, Math.round(targetW * scale));
      const pH = Math.max(1, Math.round(targetH * scale));
      // Re-composite watermark + vignette on preview too so the user sees
      // what they will download.
      let prevPipe = previewPipeline
        .resize({ width: pW, height: pH, fit: "inside" });
      if (params.vignette) {
        prevPipe = prevPipe.composite([
          { input: buildVignetteSvg(pW, pH), blend: "over" },
        ]);
      }
      const prevWm = buildWatermarkSvg({
        width: pW,
        height: pH,
        position: params.watermark,
        text: params.watermarkText,
        opacity: params.watermarkOpacity,
      });
      if (prevWm.length > 0) {
        prevPipe = prevPipe.composite([{ input: prevWm, blend: "over" }]);
      }
      previewBuf = await prevPipe
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer();
    }

    return NextResponse.json({
      heic: heicBuf.toString("base64"),
      preview: previewBuf ? previewBuf.toString("base64") : null,
      width: targetW,
      height: targetH,
      originalWidth: origW,
      originalHeight: origH,
      mime: "image/heic",
      filter: params.filter,
      aspect: params.aspect,
      watermark: params.watermark,
      upscaled: params.upscale > 1,
      upscaleFactor: params.upscale,
      hdr: params.hdr,
      vignette: params.vignette,
      denoise: params.denoise,
    });
  } catch (err) {
    console.error("[/api/process] Error:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function clampNum(
  v: FormDataEntryValue | null,
  def: number,
  range: [number, number],
  roundedDef?: number,
): number {
  if (v == null) return def;
  const n = Number(v);
  if (!isFinite(n)) return def;
  const clamped = Math.min(range[1], Math.max(range[0], n));
  if (roundedDef !== undefined && range[0] === 1 && range[1] === 100) {
    return Math.round(clamped);
  }
  return clamped;
}

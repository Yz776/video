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

interface ProcessParams {
  file: File;
  upscale: number; // 1, 2, 4
  quality: number; // 60-100
  sharpen: boolean;
  denoise: boolean;
  enhance: boolean;
  filter: FilterPreset;
  aspect: AspectRatio;
  wantPreview: boolean;
  exposure: number; // -1 .. 1
  contrast: number; // -1 .. 1
  saturation: number; // -1 .. 1
  temperature: number; // -1 .. 1 (warm-cool)
  vignette: boolean;
  hdr: boolean;
}

/**
 * Apply a filter preset by chaining sharp operations.
 */
function applyFilter(p: sharp.Sharp, filter: FilterPreset): sharp.Sharp {
  switch (filter) {
    case "vivid":
      return p.modulate({ saturation: 1.35, brightness: 1.04 }).linear(1.08, -8);
    case "mono":
      return p.greyscale().linear(1.1, -10);
    case "warm":
      return p.modulate({ saturation: 1.15, brightness: 1.03 })
        .tint({ r: 255, g: 215, b: 175 });
    case "cool":
      return p.modulate({ saturation: 1.1, brightness: 1.02 })
        .tint({ r: 200, g: 225, b: 255 });
    case "cinema":
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
 * HDR-like local contrast: gentle sharpen + gamma + CLAHE.
 * Milder than before to avoid halos that look like "pecah".
 */
function applyHdrLike(p: sharp.Sharp): sharp.Sharp {
  return p
    .sharpen({
      sigma: 1.2,
      m1: 1.5,
      m2: 0.6,
      x1: 1,
      y2: 6,
    })
    .gamma(1.04)
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
      upscale: clampNum(formData.get("upscale"), 2, [1, 4], 2),
      quality: clampNum(formData.get("quality"), 98, [60, 100], 98),
      sharpen: formData.get("sharpen") !== "0",
      denoise: formData.get("denoise") === "1",
      enhance: formData.get("enhance") !== "0",
      filter: (String(formData.get("filter") ?? "none") as FilterPreset),
      aspect: (String(formData.get("aspect") ?? "free") as AspectRatio),
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

    // ============================================================
    // SUPER-HD PIPELINE
    // Order matters: noise must be removed BEFORE upscale (otherwise
    // it gets amplified 4x and looks like "pecah"), edges must be
    // recovered with a mild pre-sharpen so lanczos3 has detail to
    // preserve, and final sharpen must be gentle to avoid halos.
    // ============================================================

    let pipeline = sharp(inputBuf, { failOn: "none" }).rotate();

    // 1. Aspect crop at native resolution
    if (params.aspect !== "free") {
      pipeline = pipeline.extract({
        left: cropBox.left,
        top: cropBox.top,
        width: cropBox.width,
        height: cropBox.height,
      });
    }

    // 2. PRE-DENOISE — remove sensor noise & JPEG DCT block artifacts.
    //    Critical: any noise or 8x8 JPEG blocks get magnified when
    //    upscaling, producing the "pecah pecah" look. We use a combo:
    //      - median(1): 3x3 median, kills single-pixel noise & outliers
    //      - blur(0.3): very mild gaussian, smooths 8x8 DCT block edges
    //    Both are very mild — they preserve real detail but eliminate
    //    the compression artifacts that would otherwise become visible
    //    after upscale. Always on when upscaling; respects toggle otherwise.
    if (params.denoise || params.upscale > 1) {
      pipeline = pipeline.median(1);
      if (params.upscale > 1) {
        pipeline = pipeline.blur(0.3);
      }
    }

    // (Pre-sharpen removed — median(1) is mild enough that it doesn't
    //  need compensation, and pre-sharpen was creating halos that got
    //  amplified by upscale.)

    // 3. UPSCALE — multi-pass for high factors.
    //    Single-pass lanczos3 is fine for 2x. For 4x, two-pass (each 2x)
    //    produces smoother gradients and less ringing than one giant leap.
    //    An intermediate median(1) between passes kills any ringing from
    //    the first pass before the second pass amplifies it.
    if (params.upscale >= 4) {
      const midW = Math.round(cropBox.width * 2);
      const midH = Math.round(cropBox.height * 2);
      pipeline = pipeline.resize({
        width: midW,
        height: midH,
        fit: "fill",
        kernel: "lanczos3",
        withoutEnlargement: false,
        withoutReduction: false,
      });
      // Inter-pass smoothing — kills ringing before second pass amplifies it
      pipeline = pipeline.median(1);
      pipeline = pipeline.resize({
        width: targetW,
        height: targetH,
        fit: "fill",
        kernel: "lanczos3",
        withoutEnlargement: false,
        withoutReduction: false,
      });
    } else {
      pipeline = pipeline.resize({
        width: targetW,
        height: targetH,
        fit: "fill",
        kernel: "lanczos3",
        withoutEnlargement: false,
        withoutReduction: false,
      });
    }

    // 5. CLAHE local contrast — REMOVED from default pipeline.
    //    Why: CLAHE amplifies JPEG DCT block boundaries in flat areas
    //    (sky, walls), producing the "pecah pecah" look. Even on clean
    //    sources it tends to over-process. The HDR toggle (which uses
    //    a milder CLAHE) remains available for users who want it.
    //
    // 6. HDR-like local contrast (optional, user toggle)
    if (params.hdr) {
      pipeline = applyHdrLike(pipeline);
    }

    // 7. Filter presets
    pipeline = applyFilter(pipeline, params.filter);

    // 8. Manual exposure/contrast/saturation/temperature adjustments
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

    // 9. Auto-enhance — slight saturation & contrast lift
    if (params.enhance) {
      pipeline = pipeline.modulate({
        brightness: 1.02,
        saturation: 1.06,
      });
      pipeline = pipeline.linear(1.04, -5);
    }

    // 10. Gamma lift — gentle midtone lift for "jernih" (clear) look.
    //     gamma=1.02 brightens midtones slightly without clipping highlights.
    pipeline = pipeline.gamma(1.02);

    // 11. FINAL SHARPEN — very gentle, no halos.
    //     Previous settings (sigma=0.8, m1=1.4) were too aggressive and
    //     produced visible halos that read as "pecah". Current settings
    //     (sigma=0.6, m1=0.5) recover detail cleanly without ringing.
    //     Trade-off: slightly less crisp, but no halos = no "pecah".
    if (params.sharpen) {
      pipeline = pipeline.sharpen({
        sigma: 0.6,
        m1: 0.5,
        m2: 0.2,
        x1: 0.8,
        y2: 2,
      });
    }

    // 12. Fork for preview BEFORE vignette/encoding
    const previewPipeline = pipeline.clone();

    // 13. Vignette overlay
    if (params.vignette) {
      const vignetteSvg = buildVignetteSvg(targetW, targetH);
      pipeline = pipeline.composite([
        { input: vignetteSvg, blend: "over" },
      ]);
    }

    // 14. ENCODE HEIC (AV1) — high quality
    //     effort=3 (was 2): AV1 spends more time on rate-distortion
    //       optimization, fewer blocking artifacts ("pecah") in flat
    //       areas like sky/walls. effort=4 was better but took 10s
    //       per photo — too slow for a camera app. effort=3 is the
    //       sweet spot: ~5s for 1080p, visibly better than effort=2.
    //     quality=98 (was 95): higher fidelity, near-lossless.
    const heicBuf = await pipeline
      .heif({ compression: "av1", quality: params.quality, effort: 3 })
      .toBuffer();

    // 15. Preview JPEG (forked before vignette so thumbnail matches download)
    let previewBuf: Buffer | null = null;
    if (params.wantPreview) {
      const previewMaxSide = 1600;
      const scale = Math.min(1, previewMaxSide / Math.max(targetW, targetH));
      const pW = Math.max(1, Math.round(targetW * scale));
      const pH = Math.max(1, Math.round(targetH * scale));
      let prevPipe = previewPipeline
        .resize({ width: pW, height: pH, fit: "inside" });
      if (params.vignette) {
        prevPipe = prevPipe.composite([
          { input: buildVignetteSvg(pW, pH), blend: "over" },
        ]);
      }
      previewBuf = await prevPipe
        .jpeg({ quality: 95, mozjpeg: true })
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

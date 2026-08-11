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
      quality: clampNum(formData.get("quality"), 99, [60, 100], 99),
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
    //      - blur(0.4): mild gaussian, smooths 8x8 DCT block edges
    //    Always on when upscaling; respects toggle otherwise.
    if (params.denoise || params.upscale > 1) {
      pipeline = pipeline.median(1);
      if (params.upscale > 1) {
        pipeline = pipeline.blur(0.4);
      }
    }

    // 3. PRE-SHARPEN (NEW) — very mild recovery pass after denoise.
    //    median(1) + blur(0.4) slightly softens real edges; this gentle
    //    unsharp mask restores micro-contrast WITHOUT creating halos that
    //    upscale would later amplify. sigma=0.5 keeps the sharpening kernel
    //    small (1px radius) so it only affects fine detail, not large edges.
    if (params.upscale > 1) {
      pipeline = pipeline.sharpen({
        sigma: 0.5,
        m1: 0.4,
        m2: 0.15,
        x1: 0.6,
        y2: 1.5,
      });
    }

    // 4. UPSCALE — multi-pass with MIXED kernels for best quality.
    //    For 4x: two-pass strategy with Mitchell first, Lanczos3 second.
    //      - Mitchell (B=C=1/3) is the smoothest edge-preserving kernel —
    //        it doesn't ring on hard edges like Lanczos does, so the first
    //        2x jump preserves gradient continuity (no "pecah" halos).
    //      - median(1) between passes kills any residual ringing before the
    //        second pass amplifies it.
    //      - Lanczos3 on the final pass recovers fine detail that Mitchell
    //        softened — best of both worlds: smooth gradients + crisp detail.
    //    For 2x: single-pass Lanczos3 (one pass is too few to ring).
    if (params.upscale >= 4) {
      const midW = Math.round(cropBox.width * 2);
      const midH = Math.round(cropBox.height * 2);
      // Pass 1: Mitchell — smooth, halo-free 2x enlargement
      pipeline = pipeline.resize({
        width: midW,
        height: midH,
        fit: "fill",
        kernel: "mitchell",
        withoutEnlargement: false,
        withoutReduction: false,
      });
      // Inter-pass smoothing — kills ringing before second pass amplifies it
      pipeline = pipeline.median(1);
      // Pass 2: Lanczos3 — recover fine detail Mitchell softened
      pipeline = pipeline.resize({
        width: targetW,
        height: targetH,
        fit: "fill",
        kernel: "lanczos3",
        withoutEnlargement: false,
        withoutReduction: false,
      });
    } else if (params.upscale === 2) {
      pipeline = pipeline.resize({
        width: targetW,
        height: targetH,
        fit: "fill",
        kernel: "lanczos3",
        withoutEnlargement: false,
        withoutReduction: false,
      });
    }
    // upscale === 1: no resize needed

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

    // 11. FINAL SHARPEN — gentle unsharp mask to recover detail lost to
    //     denoise + upscale. Settings tuned to recover crispness WITHOUT
    //     creating halos that read as "pecah".
    //       - sigma=0.7: ~1.5px radius, hits fine detail without bleeding
    //         into large edges.
    //       - m1=0.6: low amount for bright-side sharpening (avoids halos
    //         on highlights).
    //       - m2=0.25: even lower for dark-side (avoids halos on shadows).
    //       - y2=2.5: clamps the sharpening near clipping to prevent
    //         overshoot on saturated colors.
    if (params.sharpen) {
      pipeline = pipeline.sharpen({
        sigma: 0.7,
        m1: 0.6,
        m2: 0.25,
        x1: 0.8,
        y2: 2.5,
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

    // 14. ENCODE HEIC (AV1) — maximum quality, no compromise.
    //     effort=4 (was 3): AV1 spends even more time on rate-distortion
    //       optimization and motion estimation. effort=4 takes ~7s for a
    //       4K frame but produces noticeably fewer blocking artifacts in
    //       flat areas (sky, walls) — the main cause of "pecah pecah".
    //     quality=99 (default): near-lossless. AV1 at q=99 with effort=4
    //       produces files ~30% larger than q=95 but visually identical
    //       to the source — exactly what "super HD jernih tanpa pecah" means.
    //     chromaSubsampling="4:4:4": full chroma resolution, no color
    //       bleeding on saturated edges (e.g. red text on white, green
    //       leaves against blue sky). Default AV1 uses 4:2:0 which causes
    //       visible color smearing — 4:4:4 eliminates that.
    const heicBuf = await pipeline
      .heif({
        compression: "av1",
        quality: params.quality,
        effort: 4,
        chromaSubsampling: "4:4:4",
      })
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

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/process
 * Body: FormData with:
 *   - file: Blob (image/jpeg or image/png from camera)
 *   - upscale: "1" | "2" | "4" (default: 2)
 *   - quality: "80" | "90" | "95" | "100" (default: 95)
 *   - sharpen: "0" | "1" (default: 1)
 *   - enhance: "0" | "1" (default: 1)
 *   - preview: "0" | "1" (default: 0)
 *
 * Returns: JSON { heic, preview, width, height, originalWidth, originalHeight }
 * where heic and preview are base64-encoded strings.
 *
 * Pipeline:
 *   1. Auto-orient based on EXIF
 *   2. Upscale (lanczos3 kernel) to target size
 *   3. Unsharp mask (subtle — recovers detail lost in upscale)
 *   4. Color enhance (saturation + brightness + contrast)
 *   5. Encode as HEIC (AV1 compression)
 *   6. (Optional) Fork to JPEG preview for in-browser display
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const upscaleFactor = Number(formData.get("upscale") ?? "2");
    const quality = Math.min(100, Math.max(60, Number(formData.get("quality") ?? "95")));
    const sharpen = formData.get("sharpen") !== "0";
    const enhance = formData.get("enhance") !== "0";
    const wantPreview = formData.get("preview") === "1";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const inputBuf = Buffer.from(await file.arrayBuffer());

    const meta = await sharp(inputBuf).metadata();
    const origW = meta.width ?? 1920;
    const origH = meta.height ?? 1080;

    // Cap final dimension to 8000px max side to avoid memory blowups
    const MAX_SIDE = 8000;
    let targetW = origW * upscaleFactor;
    let targetH = origH * upscaleFactor;
    if (Math.max(targetW, targetH) > MAX_SIDE) {
      const scale = MAX_SIDE / Math.max(targetW, targetH);
      targetW = Math.round(targetW * scale);
      targetH = Math.round(targetH * scale);
    }

    // Build the main pipeline — fork via .clone() so we can encode HEIC + JPEG
    // from the same processed pixels without re-decoding the HEIC.
    let pipeline = sharp(inputBuf, { failOn: "none" }).rotate();

    pipeline = pipeline.resize({
      width: targetW,
      height: targetH,
      fit: "fill",
      kernel: "lanczos3",
      withoutEnlargement: false,
      withoutReduction: false,
    });

    if (sharpen) {
      pipeline = pipeline.sharpen({
        sigma: 1.0,
        m1: 1.2,
        m2: 0.4,
        x1: 2,
        y2: 8,
      });
    }

    if (enhance) {
      pipeline = pipeline.modulate({
        brightness: 1.03,
        saturation: 1.08,
      });
      pipeline = pipeline.linear(1.04, -5);
    }

    // Fork for preview BEFORE the expensive HEIC encoding
    const previewPipeline = pipeline.clone();

    // Encode HEIC (AV1) — effort 2 keeps encoding time reasonable for
    // interactive camera use (AV1 is computationally expensive; effort 0-2
    // is the practical sweet spot for live capture).
    const heicBuf = await pipeline
      .heif({ compression: "av1", quality, effort: 2 })
      .toBuffer();

    // Optional preview JPEG (downscaled for in-browser display)
    let previewBuf: Buffer | null = null;
    if (wantPreview) {
      const previewMaxSide = 1280;
      const scale = Math.min(1, previewMaxSide / Math.max(targetW, targetH));
      const pW = Math.max(1, Math.round(targetW * scale));
      const pH = Math.max(1, Math.round(targetH * scale));
      previewBuf = await previewPipeline
        .resize({ width: pW, height: pH, fit: "inside" })
        .jpeg({ quality: 88, mozjpeg: true })
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
    });
  } catch (err) {
    console.error("[/api/process] Error:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

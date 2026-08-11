import type { CameraSettings, UpscaleFactor } from "@/components/camera/types";

/**
 * Pick the best constraints for getUserMedia — prefer the highest resolution
 * the device's main camera can provide. We deliberately allow the browser to
 * pick a resolution equal to or larger than 1920×1080.
 */
export function getIdealStreamConstraints(facing: "environment" | "user") {
  return {
    audio: true,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 4096 },
      height: { ideal: 2160 },
      // Prefer the back camera's main sensor on multi-camera phones
      resizeMode: "none" as const,
    },
  };
}

/**
 * Try to grab a full-resolution still frame from the live video track using
 * ImageCapture. This usually yields a much larger image than drawing the
 * <video> element to a canvas (which is capped at the video preview size).
 *
 * Falls back to canvas capture when ImageCapture is unavailable.
 */
export async function captureFullResolutionPhoto(
  video: HTMLVideoElement,
  stream: MediaStream | null,
): Promise<{ blob: Blob; width: number; height: number }> {
  // 1. Try ImageCapture API for true sensor-resolution photo
  if (stream && typeof ImageCapture !== "undefined") {
    const track = stream.getVideoTracks()[0];
    if (track) {
      try {
        const ic = new ImageCapture(track);
        // Some browsers expose takePhoto which returns a Blob at sensor res
        if (typeof ic.takePhoto === "function") {
          const blob: Blob = await ic.takePhoto({
            imageWidth: { ideal: 4096 },
            imageHeight: { ideal: 3072 },
            whiteBalanceMode: "auto",
            exposureMode: "auto",
            focusMode: "auto",
          });
          // Read dimensions from the blob via createImageBitmap
          try {
            const bmp = await createImageBitmap(blob);
            return { blob, width: bmp.width, height: bmp.height };
          } catch {
            return { blob, width: 0, height: 0 };
          }
        }
      } catch {
        // fall through to canvas capture
      }
    }
  }

  // 2. Fallback: draw the current video frame to a canvas at native resolution
  const w = video.videoWidth || 1920;
  const h = video.videoHeight || 1080;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(video, 0, 0, w, h);
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      0.98,
    ),
  );
  return { blob, width: w, height: h };
}

/**
 * Send a still image to the backend for upscale + HEIC conversion.
 * Also returns a downscaled JPEG preview for in-browser display,
 * since most browsers cannot render HEIC images directly.
 */
export async function processToHeic(
  blob: Blob,
  settings: CameraSettings,
): Promise<{
  blob: Blob;
  previewBlob: Blob;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}> {
  const fd = new FormData();
  fd.append("file", blob, "capture.jpg");
  fd.append("upscale", String(settings.upscale));
  fd.append("quality", String(settings.quality));
  fd.append("sharpen", settings.sharpen ? "1" : "0");
  fd.append("enhance", settings.enhance ? "1" : "0");
  fd.append("preview", "1");

  const res = await fetch("/api/process", { method: "POST", body: fd });
  if (!res.ok) {
    const txt = await res.text().catch(() => "Unknown error");
    throw new Error(`HEIC processing failed (${res.status}): ${txt}`);
  }

  // The response is a multipart/mixed-like JSON envelope containing
  // base64-encoded HEIC + JPEG preview blobs.
  const data = (await res.json()) as {
    heic: string;
    preview: string;
    width: number;
    height: number;
    originalWidth: number;
    originalHeight: number;
  };
  const heicBytes = base64ToBytes(data.heic);
  const previewBytes = base64ToBytes(data.preview);
  return {
    blob: new Blob([heicBytes], { type: "image/heic" }),
    previewBlob: new Blob([previewBytes], { type: "image/jpeg" }),
    width: data.width,
    height: data.height,
    originalWidth: data.originalWidth,
    originalHeight: data.originalHeight,
  };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Pick a MIME type for MediaRecorder that the browser actually supports.
 * Prefers MP4/H.264 when available (more Android-friendly than webm).
 */
export function pickRecorderMime(): { mime: string; ext: "webm" | "mp4" } {
  const candidates: { mime: string; ext: "webm" | "mp4" }[] = [
    { mime: "video/mp4;codecs=h264,aac", ext: "mp4" },
    { mime: "video/mp4;codecs=h264", ext: "mp4" },
    { mime: "video/mp4", ext: "mp4" },
    { mime: "video/webm;codecs=vp9,opus", ext: "webm" },
    { mime: "video/webm;codecs=vp8,opus", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
  ];
  for (const c of candidates) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(c.mime)
    ) {
      return c;
    }
  }
  return { mime: "video/webm", ext: "webm" };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

import type { CameraSettings, CloudFile } from "@/components/camera/types";

/**
 * Pick the best constraints for getUserMedia — prefer the highest resolution
 * the device's main camera can provide.
 *
 * Strategy: ask for 4K (4096×3072) as `ideal`. If the device can't do 4K,
 * the browser will fall back to the closest supported resolution. We also
 * add `min: 1920×1080` so we never get stuck at 1280×720 (the browser
 * default when no constraints are given) — that would make the viewfinder
 * look soft on modern phone screens.
 *
 * The `advanced` array lists additional resolution candidates the browser
 * should try in order if the primary ideal fails. Many Android phones cap
 * stream at 1920×1080 for live preview, so we explicitly list that as a
 * fallback so the viewfinder stays crisp HD rather than dropping to SD.
 *
 * aspectRatio 4:3 matches most rear phone cameras natively (4032×3024 etc);
 * forcing 16:9 would crop the sensor and lose megapixels.
 */
export function getIdealStreamConstraints(
  facing: "environment" | "user",
  zoom: number = 1,
) {
  const zoomConstraint =
    zoom > 1 ? { zoom: { ideal: zoom } } : {};
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: {
      facingMode: { ideal: facing },
      width: { min: 1920, ideal: 4096 },
      height: { min: 1080, ideal: 3072 },
      aspectRatio: { ideal: facing === "environment" ? 4 / 3 : 3 / 4 },
      frameRate: { min: 24, ideal: 30, max: 60 },
      resizeMode: "none" as const,
      ...zoomConstraint,
      advanced: [
        // Try 4K first (most rear cameras support this for stills),
        // then 1080p HD as a safe fallback that all phones support.
        { width: 4096, height: 3072 },
        { width: 3840, height: 2160 },
        { width: 3264, height: 2448 },
        { width: 2560, height: 1920 },
        { width: 1920, height: 1080 },
      ] as MediaTrackConstraintSet[],
    },
  };
}

/**
 * After getUserMedia succeeds, check whether the active track actually
 * delivered a high resolution. If the browser capped it at SD (640×480
 * or 1280×720), try to upgrade by applying 4K constraints. This handles
 * the common Android behavior where the first request silently returns
 * a low-res stream.
 */
export async function upgradeStreamResolution(
  stream: MediaStream,
  targetWidth: number = 4096,
  targetHeight: number = 3072,
): Promise<void> {
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  const settings = track.getSettings();
  // If we already got at least 1080p, leave it alone
  if ((settings.width ?? 0) >= 1920 && (settings.height ?? 0) >= 1080) return;
  try {
    await track.applyConstraints({
      width: { ideal: targetWidth },
      height: { ideal: targetHeight },
      advanced: [
        { width: 4096, height: 3072 },
        { width: 3264, height: 2448 },
        { width: 1920, height: 1080 },
      ],
    } as MediaTrackConstraints);
  } catch {
    // If applyConstraints rejects, the device genuinely can't do higher —
    // just keep what we have. The viewfinder will still work.
  }
}

/**
 * Try to grab a full-resolution still frame from the live video track using
 * ImageCapture. Falls back to canvas capture when ImageCapture is unavailable.
 *
 * ImageCapture.takePhoto() goes directly to the camera sensor and produces
 * a JPEG at the sensor's native resolution (often 4032×3024 on Android,
 * 12MP+). This is fundamentally higher quality than drawing the video
 * element to a canvas, which only captures the live preview stream
 * (usually capped at 1920×1080).
 *
 * PhotoSettings we pass:
 *   imageWidth/imageHeight: 4096×3072 ideal — same as getUserMedia,
 *     the camera driver will pick the closest native resolution.
 *   focusMode: "auto" — continuous AF for sharp results
 *   exposureMode: "auto" — auto exposure for balanced brightness
 *   whiteBalanceMode: "auto" — auto WB for accurate colors
 *   fillLightMode: "off" — flash handled separately via torch toggle
 *     (passing "auto"/"flash" here would double-fire the flash)
 */
export async function captureFullResolutionPhoto(
  video: HTMLVideoElement,
  stream: MediaStream | null,
): Promise<{ blob: Blob; width: number; height: number }> {
  if (stream && typeof ImageCapture !== "undefined") {
    const track = stream.getVideoTracks()[0];
    if (track) {
      try {
        const ic = new ImageCapture(track);
        if (typeof ic.takePhoto === "function") {
          const blob: Blob = await ic.takePhoto({
            imageWidth: { ideal: 4096 },
            imageHeight: { ideal: 3072 },
            whiteBalanceMode: "auto",
            exposureMode: "auto",
            focusMode: "auto",
            // ISO and focus distance left unset — auto is best for general shooting
          });
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
  // Fallback: canvas capture at video stream resolution.
  // This is lower quality than ImageCapture (preview stream, not sensor)
  // but works on browsers without ImageCapture support (Firefox, Safari < 17).
  const w = video.videoWidth || 1920;
  const h = video.videoHeight || 1080;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  // imageSmoothingQuality="high" ensures the canvas snapshot uses the
  // best possible filtering when the video source is non-integer scaled.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
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
 * Send a still image to the backend for upscale + HEIC + filter.
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
  meta: Record<string, unknown>;
}> {
  const fd = new FormData();
  fd.append("file", blob, "capture.jpg");
  fd.append("upscale", String(settings.upscale));
  fd.append("quality", String(settings.quality));
  fd.append("sharpen", settings.sharpen ? "1" : "0");
  fd.append("denoise", settings.denoise ? "1" : "0");
  fd.append("enhance", settings.enhance ? "1" : "0");
  fd.append("filter", settings.filter);
  fd.append("aspect", settings.aspect);
  fd.append("vignette", settings.vignette ? "1" : "0");
  fd.append("hdr", settings.hdr ? "1" : "0");
  fd.append("preview", "1");
  fd.append("exposure", String(settings.exposure));
  fd.append("contrast", String(settings.contrast));
  fd.append("saturation", String(settings.saturation));
  fd.append("temperature", String(settings.temperature));

  const res = await fetch("/api/process", { method: "POST", body: fd });
  if (!res.ok) {
    const txt = await res.text().catch(() => "Unknown error");
    throw new Error(`HEIC processing failed (${res.status}): ${txt}`);
  }

  const data = (await res.json()) as {
    heic: string;
    preview: string;
    width: number;
    height: number;
    originalWidth: number;
    originalHeight: number;
    filter: string;
    aspect: string;
    upscaled: boolean;
    upscaleFactor: number;
    hdr: boolean;
    vignette: boolean;
    denoise: boolean;
  };
  const heicBytes = base64ToBytes(data.heic);
  const previewBytes = base64ToBytes(data.preview);
  const {
    width,
    height,
    originalWidth,
    originalHeight,
    ...metaRest
  } = data;
  return {
    blob: new Blob([heicBytes], { type: "image/heic" }),
    previewBlob: new Blob([previewBytes], { type: "image/jpeg" }),
    width,
    height,
    originalWidth,
    originalHeight,
    meta: metaRest,
  };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

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

/**
 * Detect if the device is mobile / touch for UI tweaks.
 */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

// ============================================================
// CLOUD — upload / list / delete via our /api/cloud-* proxies
// ============================================================

const CLOUD_PAGE_URL = "https://cloud.kangwifi.eu.org/";

/**
 * Upload a Blob (HEIC photo, MP4 video, etc.) to the kangwifi cloud.
 * Returns the public URL the file can be accessed from.
 */
export async function uploadToCloud(
  blob: Blob,
  filename: string,
  mime: string,
): Promise<{
  success: boolean;
  url?: string;
  key?: string;
  name?: string;
  size?: number;
  sizeHuman?: string;
  hfUrl?: string | null;
  cloudPage?: string;
  error?: string;
}> {
  const fd = new FormData();
  // Rename file to start with "kangwifi-" so we can filter later
  const cloudName = filename.startsWith("kangwifi-")
    ? filename
    : `kangwifi-${Date.now()}-${filename}`;
  const file = new File([blob], cloudName, { type: mime });
  fd.append("file", file);

  const res = await fetch("/api/cloud-upload", {
    method: "POST",
    body: fd,
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    return { success: false, error: data.error ?? `HTTP ${res.status}` };
  }
  return {
    success: true,
    url: data.url,
    key: data.key,
    name: data.name,
    size: data.size,
    sizeHuman: data.sizeHuman,
    hfUrl: data.hfUrl,
    cloudPage: data.cloudPage ?? CLOUD_PAGE_URL,
  };
}

/**
 * List image files from the cloud. By default only files starting with
 * "kangwifi-" prefix are returned (so we don't show unrelated files).
 */
export async function listCloudImages(
  prefix: string = "kangwifi-",
): Promise<{ success: boolean; files?: CloudFile[]; error?: string }> {
  const url = `/api/cloud-list?prefix=${encodeURIComponent(prefix)}&images=1`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok || !data.success) {
    return { success: false, error: data.error ?? `HTTP ${res.status}` };
  }
  // Map to our CloudFile type
  const files: CloudFile[] = (data.files ?? []).map(
    (f: Record<string, unknown>) => ({
      id: String(f.id ?? f.key ?? ""),
      name: String(f.name ?? ""),
      key: String(f.key ?? ""),
      size: Number(f.size ?? 0),
      sizeHuman: String(f.size_human ?? ""),
      mime: f.mime ? String(f.mime) : undefined,
      status: (f.status === "cloud" ? "cloud" : "local") as "local" | "cloud",
      isPublic: Boolean(f.is_public ?? true),
      url: String(f.url ?? `https://cloud.kangwifi.eu.org/file/${encodeURIComponent(String(f.key))}`),
      hfUrl: f.hf_url ? String(f.hf_url) : null,
      createdAt: Number(f.created_at ?? Date.now()),
    }),
  );
  // Newest first
  files.sort((a, b) => b.createdAt - a.createdAt);
  return { success: true, files };
}

/**
 * Delete a file from the cloud by its key.
 */
export async function deleteCloudFile(
  key: string,
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`/api/cloud-delete?key=${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    return { success: false, error: data.error ?? `HTTP ${res.status}` };
  }
  return { success: true };
}

export const CLOUD_URL = CLOUD_PAGE_URL;

import type { CameraSettings, CloudFile } from "@/components/camera/types";

/**
 * Camera constraint ladder.
 *
 * We try each level in order. The first one that doesn't throw
 * OverconstrainedError wins. This is necessary because device support
 * varies wildly:
 *   - Flagship Android: handles 4K ideal + min 1080p + advanced ladder fine
 *   - Mid-range Android: rejects `min: 1080` on front camera (only 720p)
 *   - Old phones / webcams: reject `aspectRatio` and `frameRate.min`
 *   - Some Chrome builds: reject `advanced` entirely
 *
 * Level 0 (STRICT): 4K ideal + min 1080p + 4:3 aspect + 30fps + advanced ladder
 * Level 1 (LOOSE):  4K ideal + advanced ladder (no min, no aspect, no fps min)
 * Level 2 (MINIMAL): just width/height ideal, no advanced
 * Level 3 (BASIC):  facingMode only — last resort, always works
 */
export const CAMERA_CONSTRAINT_LEVELS = {
  STRICT: 0,
  LOOSE: 1,
  MINIMAL: 2,
  BASIC: 3,
} as const;

export type ConstraintLevel =
  (typeof CAMERA_CONSTRAINT_LEVELS)[keyof typeof CAMERA_CONSTRAINT_LEVELS];

const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/**
 * Build the constraints object for a given level.
 * Returns the full MediaStreamConstraints to pass to getUserMedia.
 */
export function buildStreamConstraints(
  facing: "environment" | "user",
  level: ConstraintLevel,
  zoom: number = 1,
): MediaStreamConstraints {
  const zoomConstraint = zoom > 1 ? { zoom: { ideal: zoom } } : {};

  switch (level) {
    case CAMERA_CONSTRAINT_LEVELS.STRICT:
      return {
        audio: AUDIO_CONSTRAINTS,
        video: {
          facingMode: { ideal: facing },
          width: { min: 1920, ideal: 4096 },
          height: { min: 1080, ideal: 3072 },
          aspectRatio: { ideal: facing === "environment" ? 4 / 3 : 3 / 4 },
          frameRate: { min: 24, ideal: 30, max: 60 },
          resizeMode: "none" as const,
          ...zoomConstraint,
          advanced: [
            { width: 4096, height: 3072 },
            { width: 3840, height: 2160 },
            { width: 3264, height: 2448 },
            { width: 2560, height: 1920 },
            { width: 1920, height: 1080 },
          ] as MediaTrackConstraintSet[],
        },
      };

    case CAMERA_CONSTRAINT_LEVELS.LOOSE:
      // Drop min/aspect/frameRate.min — common rejection points on mid-range
      // devices. Keep `ideal` and `advanced` ladder.
      return {
        audio: AUDIO_CONSTRAINTS,
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 4096 },
          height: { ideal: 3072 },
          frameRate: { ideal: 30, max: 60 },
          resizeMode: "none" as const,
          ...zoomConstraint,
          advanced: [
            { width: 4096, height: 3072 },
            { width: 3840, height: 2160 },
            { width: 3264, height: 2448 },
            { width: 2560, height: 1920 },
            { width: 1920, height: 1080 },
          ] as MediaTrackConstraintSet[],
        },
      };

    case CAMERA_CONSTRAINT_LEVELS.MINIMAL:
      // Only ideal width/height + facing. No advanced, no aspect, no fps max.
      // This matches what most basic PWA camera apps use.
      return {
        audio: AUDIO_CONSTRAINTS,
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 4096 },
          height: { ideal: 3072 },
          ...zoomConstraint,
        },
      };

    case CAMERA_CONSTRAINT_LEVELS.BASIC:
      // Last resort: just facing mode. Always works on any device with a
      // camera — gives whatever default resolution the browser picks.
      return {
        audio: AUDIO_CONSTRAINTS,
        video: {
          facingMode: { ideal: facing },
          ...zoomConstraint,
        },
      };
  }
}

/**
 * Open a camera stream with progressive constraint fallback.
 *
 * Tries STRICT → LOOSE → MINIMAL → BASIC. The first that succeeds wins.
 * If all fail, throws the last error (typically NotAllowedError or
 * NotFoundError, which are not constraint-related).
 *
 * Returns the stream AND the level that succeeded (useful for logging
 * and for adjusting downstream behavior — e.g. if we fell back to BASIC,
 * we know not to bother trying upgradeStreamResolution).
 */
export async function openCameraStream(
  facing: "environment" | "user",
  zoom: number = 1,
): Promise<{ stream: MediaStream; level: ConstraintLevel }> {
  const levels: ConstraintLevel[] = [
    CAMERA_CONSTRAINT_LEVELS.STRICT,
    CAMERA_CONSTRAINT_LEVELS.LOOSE,
    CAMERA_CONSTRAINT_LEVELS.MINIMAL,
    CAMERA_CONSTRAINT_LEVELS.BASIC,
  ];
  let lastErr: unknown = null;
  for (const level of levels) {
    try {
      const constraints = buildStreamConstraints(facing, level, zoom);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      return { stream, level };
    } catch (e) {
      lastErr = e;
      const err = e as DOMException;
      // OverconstrainedError → try next softer level
      if (err.name === "OverconstrainedError") {
        console.warn(
          `[camera] constraints level ${level} rejected (${err.message || err.constraint}),
          falling back to level ${level + 1}`,
        );
        continue;
      }
      // NotAllowedError, NotFoundError, NotReadableError — these aren't
      // constraint issues, no point retrying. Throw immediately.
      throw e;
    }
  }
  // All levels exhausted — throw the last error
  throw lastErr;
}

/**
 * @deprecated Use buildStreamConstraints + openCameraStream instead.
 * Kept for backward compatibility with any code that imported this name.
 */
export function getIdealStreamConstraints(
  facing: "environment" | "user",
  zoom: number = 1,
): MediaStreamConstraints {
  return buildStreamConstraints(facing, CAMERA_CONSTRAINT_LEVELS.LOOSE, zoom);
}

/**
 * After getUserMedia succeeds, check whether the active track actually
 * delivered a high resolution. If the browser capped it at SD (640×480
 * or 1280×720), try to upgrade by applying 4K constraints. This handles
 * the common Android behavior where the first request silently returns
 * a low-res stream.
 *
 * Safe to call after any constraint level — only attempts upgrade if
 * current width < 1920. Errors are silently swallowed (we already have
 * a working stream, no point breaking it).
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
 * Get or create a stable device ID for this browser/device.
 *
 * Each device (browser profile) gets its own ID, persisted in localStorage.
 * This is used as part of the cloud file prefix so each device only sees
 * its own photos in the gallery — e.g. device "ab12cd34" uploads files
 * named "kangwifi-ab12cd34-1735000000-photo.heic", and only requests
 * files with prefix "kangwifi-ab12cd34-" when listing.
 *
 * The ID is 8 hex chars from crypto.getRandomValues — collision-resistant
 * enough for this use case (birthday paradox at 4 billion devices).
 * Stored under localStorage key "kangwifi-device-id".
 *
 * If localStorage is unavailable (private mode / disabled), falls back to
 * a per-session random ID (gallery isolation still works within session).
 */
export function getDeviceId(): string {
  const STORAGE_KEY = "kangwifi-device-id";

  // Try to load existing ID from localStorage
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && /^[a-f0-9]{8}$/.test(existing)) {
      return existing;
    }
  } catch {
    // localStorage unavailable (private mode, disabled, etc.) — fall through
  }

  // Generate a new 8-char hex ID
  const arr = new Uint8Array(4);
  crypto.getRandomValues(arr);
  const id = Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Try to persist (ignore failure — session-only ID is acceptable)
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore
  }

  return id;
}

/**
 * Build the cloud file prefix for this device.
 * Format: "kangwifi-{deviceId}-"
 * All files uploaded from this device get this prefix, and listCloudImages
 * filters by it so each device only sees its own gallery.
 */
export function getCloudPrefix(): string {
  return `kangwifi-${getDeviceId()}-`;
}

/**
 * Upload a Blob (HEIC photo, MP4 video, etc.) to the kangwifi cloud.
 * Returns the public URL the file can be accessed from.
 *
 * Files are prefixed with "kangwifi-{deviceId}-" so each device's gallery
 * stays isolated (see getDeviceId for details).
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
  const prefix = getCloudPrefix();
  // Build the cloud file name: kangwifi-{deviceId}-{timestamp}-{original}
  // If filename already starts with our device prefix (re-upload case),
  // don't double-prefix.
  const cloudName = filename.startsWith(prefix)
    ? filename
    : `${prefix}${Date.now()}-${filename}`;
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
 * List image files from the cloud, scoped to THIS device's gallery.
 *
 * Uses the device-specific prefix "kangwifi-{deviceId}-" so each device
 * only sees its own uploads. Pass a custom prefix only if you really
 * need cross-device listing (e.g. admin view).
 */
export async function listCloudImages(
  prefix: string = getCloudPrefix(),
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

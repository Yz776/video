export type CameraMode = "photo" | "video" | "live" | "burst" | "portrait";

export type FacingMode = "environment" | "user";

export type FlashMode = "auto" | "on" | "off" | "torch";

export type UpscaleFactor = 1 | 2 | 4;

export type FilterPreset =
  | "none"
  | "vivid"
  | "mono"
  | "warm"
  | "cool"
  | "cinema"
  | "night"
  | "vintage";

export type AspectRatio = "free" | "1:1" | "4:3" | "16:9" | "3:4";

export type TimerDuration = 0 | 3 | 5 | 10;

export interface CameraSettings {
  upscale: UpscaleFactor;
  quality: number;
  sharpen: boolean;
  denoise: boolean;
  enhance: boolean;
  filter: FilterPreset;
  aspect: AspectRatio;
  vignette: boolean;
  hdr: boolean;
  grid: boolean;
  level: boolean;
  timer: TimerDuration;
  zoom: number; // 1.0 - 8.0
  exposure: number; // -1 .. 1
  contrast: number; // -1 .. 1
  saturation: number; // -1 .. 1
  temperature: number; // -1 .. 1
  /**
   * When true, captures are uploaded to cloud.kangwifi.eu.org after being
   * saved locally. When false (default), captures stay only in this
   * device's IndexedDB — no network upload happens at all.
   *
   * Default: false (offline-first). User can enable in Settings.
   */
  cloudUpload: boolean;
}

export interface CaptureItem {
  id: string;
  createdAt: string;
  kind: CameraMode;
  previewUrl: string;
  liveVideoUrl?: string;
  downloadUrl: string;
  ext: "heic" | "webm" | "mp4";
  mime: string;
  width?: number;
  height?: number;
  size: number;
  filename: string;
  filter?: FilterPreset;
  upscaled?: boolean;
  hdr?: boolean;
  burstCount?: number;
  burstId?: string;
  selected?: boolean;
  cloudUrl?: string;       // Public cloud URL after upload
  cloudKey?: string;       // Cloud file key for delete
  cloudUploadedAt?: string;
}

/** A file that lives on the cloud (https://cloud.kangwifi.eu.org). */
export interface CloudFile {
  id: string;
  name: string;
  key: string;
  size: number;
  sizeHuman: string;
  mime?: string;
  status: "local" | "cloud";
  isPublic: boolean;
  url: string;        // Direct download URL
  hfUrl?: string | null; // HuggingFace mirror URL (if synced)
  createdAt: number;  // Unix ms
}

export const DEFAULT_SETTINGS: CameraSettings = {
  upscale: 2,
  quality: 92,
  sharpen: true,
  denoise: true,
  enhance: true,
  filter: "none",
  aspect: "free",
  vignette: false,
  hdr: false,
  grid: true,
  level: false,
  timer: 0,
  zoom: 1,
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  cloudUpload: false,
};

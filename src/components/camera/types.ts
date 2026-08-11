export type CameraMode = "photo" | "video" | "live";

export type FacingMode = "environment" | "user";

export type FlashMode = "auto" | "on" | "off";

export type UpscaleFactor = 1 | 2 | 4;

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
}

export interface CameraSettings {
  upscale: UpscaleFactor;
  quality: number;
  sharpen: boolean;
  enhance: boolean;
}

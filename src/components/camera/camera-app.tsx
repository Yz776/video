"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CameraMode,
  CameraSettings,
  CaptureItem,
  FacingMode,
  FlashMode,
} from "./types";
import {
  captureFullResolutionPhoto,
  genId,
  getIdealStreamConstraints,
  pickRecorderMime,
  processToHeic,
} from "./utils";
import {
  CaptureButton,
  ModeSelector,
  PermissionGate,
  ProcessingOverlay,
  SettingsSheet,
  TopBar,
} from "./controls";
import { GalleryStrip, PreviewModal } from "./gallery";

const DEFAULT_SETTINGS: CameraSettings = {
  upscale: 2,
  quality: 95,
  sharpen: true,
  enhance: true,
};

interface PreRecordingChunk {
  blob: Blob;
  timestamp: number;
}

export function CameraApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const liveVideoChunksRef = useRef<Blob[]>([]);
  const livePhotoTriggeredRef = useRef(false);
  const preBufferRef = useRef<PreRecordingChunk[]>([]);
  const flashFrameRef = useRef<HTMLDivElement>(null);
  const captureLockRef = useRef(false);

  const [facing, setFacing] = useState<FacingMode>("environment");
  const [mode, setMode] = useState<CameraMode>("photo");
  const [flash, setFlash] = useState<FlashMode>("off");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [processing, setProcessing] = useState<string | null>(null);
  const [gallery, setGallery] = useState<CaptureItem[]>([]);
  const [previewItem, setPreviewItem] = useState<CaptureItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<CameraSettings>(DEFAULT_SETTINGS);

  // ---- Camera start / stop ----
  const startCamera = useCallback(async (facingMode: FacingMode) => {
    setError(null);
    try {
      // Stop any prior stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      const constraints = getIdealStreamConstraints(facingMode);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setStreaming(true);

      // Try to apply torch if available (for "flash on" mode)
      applyTorch(stream, flash === "on");
    } catch (e) {
      console.error(e);
      const err = e as Error;
      if (err.name === "NotAllowedError" || err.name === "SecurityError") {
        setError("Izinkan akses kamera di pengaturan browser, lalu coba lagi.");
      } else if (err.name === "NotFoundError") {
        setError("Tidak ada kamera yang terdeteksi pada perangkat ini.");
      } else {
        setError(err.message || "Gagal membuka kamera.");
      }
      setStreaming(false);
    }
  }, [flash]);

  useEffect(() => {
    startCamera(facing);
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
     
  }, [facing]);

  // Apply torch when flash mode changes
  useEffect(() => {
    if (streamRef.current) {
      applyTorch(streamRef.current, flash === "on");
    }
  }, [flash]);

  // ---- Recording timer ----
  useEffect(() => {
    if (!isRecording) {
      setRecordingSeconds(0);
      return;
    }
    const startTs = Date.now();
    const t = setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - startTs) / 1000));
    }, 500);
    return () => clearInterval(t);
  }, [isRecording]);

  // ---- Flash effect (visual) ----
  const triggerFlashEffect = useCallback(() => {
    const el = flashFrameRef.current;
    if (!el) return;
    el.style.opacity = "0.9";
    requestAnimationFrame(() => {
      el.style.transition = "opacity 320ms ease-out";
      el.style.opacity = "0";
    });
    setTimeout(() => {
      if (el) {
        el.style.transition = "none";
        el.style.opacity = "0";
      }
    }, 360);
  }, []);

  // ---- PHOTO capture ----
  const capturePhoto = useCallback(
    async (alsoCaptureVideoClip = false): Promise<{
      photo: CaptureItem | null;
      videoClip: Blob | null;
    }> => {
      if (!videoRef.current || !streamRef.current) {
        toast.error("Kamera belum siap");
        return { photo: null, videoClip: null };
      }
      if (captureLockRef.current) return { photo: null, videoClip: null };
      captureLockRef.current = true;

      // Visual flash effect
      const shouldFlash = flash === "on" || (flash === "auto" && Math.random() > 0.5);
      if (shouldFlash) triggerFlashEffect();

      setProcessing("Memproses HEIC super HD…");

      // For Live Photo: also start a short video recording in parallel
      let clipBlob: Blob | null = null;
      let clipRecorder: MediaRecorder | null = null;
      let clipChunks: Blob[] = [];
      if (alsoCaptureVideoClip) {
        try {
          const { mime } = pickRecorderMime();
          const r = new MediaRecorder(streamRef.current, {
            mimeType: mime,
            videoBitsPerSecond: 12_000_000,
            audioBitsPerSecond: 192_000,
          });
          clipChunks = [];
          r.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) clipChunks.push(e.data);
          };
          const clipDone = new Promise<Blob>((resolve) => {
            r.onstop = () => {
              resolve(new Blob(clipChunks, { type: mime }));
            };
          });
          r.start();
          clipRecorder = r;
          // Wait for the clip — capture photo at ~1.5s midpoint
          await new Promise((r) => setTimeout(r, 1500));
          // Photo capture happens below — fire & forget the photo capture
          // Continue recording for 1.5s more after photo
          await new Promise((r) => setTimeout(r, 1500));
          r.stop();
          clipBlob = await clipDone;
        } catch (e) {
          console.warn("Live clip recording failed", e);
        }
      }

      // Capture the photo (full resolution from ImageCapture if available)
      let photo: CaptureItem | null = null;
      try {
        const { blob: rawBlob, width, height } = await captureFullResolutionPhoto(
          videoRef.current,
          streamRef.current,
        );
        const result = await processToHeic(rawBlob, settings);
        const finalWidth = result.width || width;
        const finalHeight = result.height || height;
        const heicBlob = result.blob;
        // Use JPEG preview for in-browser display (browsers can't render HEIC),
        // and HEIC blob as the downloadable file.
        const previewUrl = result.previewBlob
          ? URL.createObjectURL(result.previewBlob)
          : URL.createObjectURL(heicBlob);
        const downloadUrl = URL.createObjectURL(heicBlob);
        const clipUrl = clipBlob ? URL.createObjectURL(clipBlob) : undefined;
        photo = {
          id: genId(),
          createdAt: new Date().toISOString(),
          kind: alsoCaptureVideoClip ? "live" : "photo",
          previewUrl,
          downloadUrl,
          liveVideoUrl: clipUrl,
          ext: "heic",
          mime: "image/heic",
          width: finalWidth,
          height: finalHeight,
          size: heicBlob.size,
          filename: `heic-cam-${Date.now()}.${alsoCaptureVideoClip ? "live" : "photo"}.heic`,
        };
        setGallery((g) => [photo!, ...g]);
      } catch (e) {
        console.error(e);
        const msg = e instanceof Error ? e.message : "Gagal memproses foto";
        toast.error(msg);
      } finally {
        setProcessing(null);
        captureLockRef.current = false;
      }

      return { photo, videoClip: clipBlob };
    },
    [flash, settings, triggerFlashEffect],
  );

  // ---- VIDEO recording ----
  const toggleVideoRecording = useCallback(async () => {
    if (!streamRef.current) return;
    if (isRecording) {
      // stop
      const r = recorderRef.current;
      if (r && r.state !== "inactive") {
        r.stop();
      }
      return;
    }
    // start
    try {
      chunksRef.current = [];
      const { mime, ext } = pickRecorderMime();
      const r = new MediaRecorder(streamRef.current, {
        mimeType: mime,
        videoBitsPerSecond: 12_000_000,
        audioBitsPerSecond: 192_000,
      });
      r.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      r.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        const url = URL.createObjectURL(blob);
        const item: CaptureItem = {
          id: genId(),
          createdAt: new Date().toISOString(),
          kind: "video",
          previewUrl: url,
          downloadUrl: url,
          ext,
          mime,
          size: blob.size,
          filename: `heic-cam-${Date.now()}.video.${ext}`,
        };
        setGallery((g) => [item, ...g]);
        setIsRecording(false);
        toast.success("Video tersimpan", {
          description: `${ext.toUpperCase()} · ${(blob.size / 1024 / 1024).toFixed(2)} MB`,
        });
      };
      r.start(250);
      recorderRef.current = r;
      setIsRecording(true);
      toast.info("Merekam video…");
    } catch (e) {
      console.error(e);
      toast.error("Gagal mulai merekam");
    }
  }, [isRecording]);

  // ---- Main capture dispatcher ----
  const handleCapture = useCallback(() => {
    if (mode === "video") {
      void toggleVideoRecording();
    } else if (mode === "live") {
      void capturePhoto(true).then(({ photo }) => {
        if (photo) {
          toast.success("Live Photo tersimpan", {
            description: "Foto HEIC + klip video pendek",
          });
        }
      });
    } else {
      void capturePhoto(false).then(({ photo }) => {
        if (photo) {
          toast.success("Foto HEIC tersimpan", {
            description: `${photo.width}×${photo.height} · super HD`,
          });
        }
      });
    }
  }, [mode, capturePhoto, toggleVideoRecording]);

  // ---- Gallery management ----
  const handleDelete = useCallback((id: string) => {
    setGallery((g) => {
      const item = g.find((x) => x.id === id);
      if (item) {
        if (item.previewUrl !== item.downloadUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
        URL.revokeObjectURL(item.downloadUrl);
        if (item.liveVideoUrl) URL.revokeObjectURL(item.liveVideoUrl);
      }
      return g.filter((x) => x.id !== id);
    });
  }, []);

  const handleClearAll = useCallback(() => {
    setGallery((g) => {
      g.forEach((it) => {
        if (it.previewUrl !== it.downloadUrl) {
          URL.revokeObjectURL(it.previewUrl);
        }
        URL.revokeObjectURL(it.downloadUrl);
        if (it.liveVideoUrl) URL.revokeObjectURL(it.liveVideoUrl);
      });
      return [];
    });
  }, []);

  const hdBadge =
    settings.upscale === 1
      ? "HD"
      : settings.upscale === 2
        ? "2× SUPER HD"
        : "4× ULTRA HD";

  return (
    <div className="fixed inset-0 bg-black text-white select-none">
      {/* Viewfinder */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className={cnVideo(facing)}
      />

      {/* Flash overlay (visual effect on capture) */}
      <div
        ref={flashFrameRef}
        className="absolute inset-0 bg-white pointer-events-none z-30"
        style={{ opacity: 0 }}
      />

      {/* Rule-of-thirds grid (subtle) */}
      <div className="absolute inset-0 z-10 pointer-events-none opacity-20">
        <div className="absolute inset-y-0 left-1/3 w-px bg-white" />
        <div className="absolute inset-y-0 left-2/3 w-px bg-white" />
        <div className="absolute inset-x-0 top-1/3 h-px bg-white" />
        <div className="absolute inset-x-0 top-2/3 h-px bg-white" />
      </div>

      {/* Top bar */}
      <TopBar
        flash={flash}
        onFlashCycle={() =>
          setFlash((f) => (f === "off" ? "auto" : f === "auto" ? "on" : "off"))
        }
        facing={facing}
        onSwitchFacing={() =>
          setFacing((f) => (f === "environment" ? "user" : "environment"))
        }
        onOpenSettings={() => setSettingsOpen(true)}
        hdBadge={hdBadge}
      />

      {/* Bottom controls */}
      <div className="absolute bottom-0 inset-x-0 z-20 pb-[max(env(safe-area-inset-bottom),1.5rem)] px-4 pt-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
        {/* Gallery strip */}
        <div className="mb-3">
          <GalleryStrip
            items={gallery}
            onOpen={setPreviewItem}
            onClear={handleClearAll}
          />
        </div>

        {/* Mode selector + capture */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1" />
          <div className="flex flex-col items-center gap-2">
            <CaptureButton
              mode={mode}
              isRecording={isRecording}
              onCapture={handleCapture}
              recordingSeconds={recordingSeconds}
            />
            <div className="h-4" />
          </div>
          <div className="flex-1 flex justify-end">
            <div className="text-right">
              <div className="text-[10px] text-white/50">Format</div>
              <div className="text-xs font-bold text-amber-300">HEIC</div>
            </div>
          </div>
        </div>
        <div className="mt-1">
          <ModeSelector
            mode={mode}
            onChange={setMode}
            isRecording={isRecording}
          />
        </div>
      </div>

      {/* Permission gate */}
      {!streaming && error && (
        <PermissionGate error={error} onRetry={() => startCamera(facing)} />
      )}

      {/* Processing overlay */}
      <ProcessingOverlay
        visible={!!processing}
        message={processing ?? ""}
      />

      {/* Settings sheet */}
      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSettingsChange={setSettings}
      />

      {/* Preview modal */}
      <PreviewModal
        item={previewItem}
        onClose={() => setPreviewItem(null)}
        onDelete={handleDelete}
      />
    </div>
  );
}

function applyTorch(stream: MediaStream, on: boolean) {
  try {
    const track = stream.getVideoTracks()[0];
    const caps =
      (track.getCapabilities?.() as MediaTrackCapabilities & {
        torch?: boolean;
      }) || {};
    if ("torch" in caps && caps.torch !== undefined) {
      track.applyConstraints({
        advanced: [{ torch: on } as MediaTrackConstraintSet],
      } as MediaTrackConstraints);
    }
  } catch {
    // torch not supported — visual flash only
  }
}

/** Mirrors the preview when using the front camera so it behaves like a selfie cam. */
function cnVideo(facing: FacingMode): string {
  const base =
    "absolute inset-0 w-full h-full object-cover z-0 bg-black transition-transform";
  return facing === "user" ? `${base} scale-x-[-1]` : base;
}

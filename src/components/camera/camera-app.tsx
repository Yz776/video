"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CameraMode,
  CameraSettings,
  CaptureItem,
  FacingMode,
  FlashMode,
  DEFAULT_SETTINGS,
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
import { GalleryStrip, PreviewModal, CloudGallery } from "./gallery";
import { cn } from "@/lib/utils";
import { listCloudImages } from "./utils";

export function CameraApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const flashFrameRef = useRef<HTMLDivElement>(null);
  const captureLockRef = useRef(false);
  const deviceOrientationRef = useRef<number>(0);

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
  const [timerCountdown, setTimerCountdown] = useState<number | null>(null);
  const [burstCount, setBurstCount] = useState<number>(0);
  const [orientation, setOrientation] = useState(0);
  const [cloudGalleryOpen, setCloudGalleryOpen] = useState(false);
  const [cloudCount, setCloudCount] = useState<number>(0);

  // ---- Camera start / stop ----
  const startCamera = useCallback(
    async (facingMode: FacingMode, zoom: number) => {
      setError(null);
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        const constraints = getIdealStreamConstraints(facingMode, zoom);
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStreaming(true);
        applyTorch(stream, flash === "on" || flash === "torch");
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
    },
    [flash],
  );

  // Restart camera when facing changes
  useEffect(() => {
    startCamera(facing, settings.zoom);
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [facing]);

  // Restart camera when zoom changes
  useEffect(() => {
    if (streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      if (track) {
        try {
          track.applyConstraints({
            advanced: [{ zoom: settings.zoom } as MediaTrackConstraintSet],
          } as MediaTrackConstraints);
        } catch {
          // Zoom via constraints not supported — fallback to CSS transform
        }
      }
    }
  }, [settings.zoom]);

  // Torch toggle when flash changes
  useEffect(() => {
    if (streamRef.current) {
      applyTorch(streamRef.current, flash === "on" || flash === "torch");
    }
  }, [flash]);

  // Device orientation for level indicator
  useEffect(() => {
    if (!settings.level) return;
    const handler = (e: DeviceOrientationEvent) => {
      const gamma = e.gamma ?? 0;
      deviceOrientationRef.current = gamma;
      setOrientation(gamma);
    };
    window.addEventListener("deviceorientation", handler, true);
    return () => window.removeEventListener("deviceorientation", handler, true);
  }, [settings.level]);

  // Recording timer
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

  // ---- Flash effect ----
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

  // ---- Photo capture (single, with optional live clip) ----
  const capturePhoto = useCallback(
    async (
      alsoCaptureVideoClip = false,
      kindOverride?: CameraMode,
    ): Promise<CaptureItem | null> => {
      if (!videoRef.current || !streamRef.current) {
        toast.error("Kamera belum siap");
        return null;
      }
      if (captureLockRef.current) return null;
      captureLockRef.current = true;

      const shouldFlash =
        flash === "on" ||
        flash === "torch" ||
        (flash === "auto" && Math.random() > 0.5);
      if (shouldFlash) triggerFlashEffect();

      setProcessing("Memproses HEIC super HD jernih…");

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
            r.onstop = () => resolve(new Blob(clipChunks, { type: mime }));
          });
          r.start();
          clipRecorder = r;
          await new Promise((r) => setTimeout(r, 1500));
          await new Promise((r) => setTimeout(r, 1500));
          r.stop();
          clipBlob = await clipDone;
        } catch (e) {
          console.warn("Live clip recording failed", e);
        }
      }

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
        const previewUrl = result.previewBlob
          ? URL.createObjectURL(result.previewBlob)
          : URL.createObjectURL(heicBlob);
        const downloadUrl = URL.createObjectURL(heicBlob);
        const clipUrl = clipBlob ? URL.createObjectURL(clipBlob) : undefined;
        photo = {
          id: genId(),
          createdAt: new Date().toISOString(),
          kind: kindOverride ?? (alsoCaptureVideoClip ? "live" : "photo"),
          previewUrl,
          downloadUrl,
          liveVideoUrl: clipUrl,
          ext: "heic",
          mime: "image/heic",
          width: finalWidth,
          height: finalHeight,
          size: heicBlob.size,
          filename: `kangwifi-${Date.now()}.${kindOverride ?? (alsoCaptureVideoClip ? "live" : "photo")}.heic`,
          filter: settings.filter,
          upscaled: settings.upscale > 1,
          hdr: settings.hdr,
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

      return photo;
    },
    [flash, settings, triggerFlashEffect],
  );

  // ---- Burst capture: 5 photos in quick succession ----
  const captureBurst = useCallback(async () => {
    if (!videoRef.current || !streamRef.current || captureLockRef.current) return;
    captureLockRef.current = true;
    setProcessing("Burst capture (5 foto)…");
    const burstId = genId();
    const items: CaptureItem[] = [];
    try {
      for (let i = 0; i < 5; i++) {
        setBurstCount(i + 1);
        // Capture frame to canvas (no live clip for burst)
        const { blob: rawBlob, width, height } = await captureFullResolutionPhoto(
          videoRef.current,
          streamRef.current,
        );
        // Process each frame — but only enqueue, run them sequentially
        const result = await processToHeic(rawBlob, settings);
        const previewUrl = result.previewBlob
          ? URL.createObjectURL(result.previewBlob)
          : URL.createObjectURL(result.blob);
        const downloadUrl = URL.createObjectURL(result.blob);
        const item: CaptureItem = {
          id: genId(),
          createdAt: new Date().toISOString(),
          kind: "burst",
          previewUrl,
          downloadUrl,
          ext: "heic",
          mime: "image/heic",
          width: result.width || width,
          height: result.height || height,
          size: result.blob.size,
          filename: `kangwifi-burst-${burstId}-${i + 1}.heic`,
          burstId,
          burstCount: i + 1,
          filter: settings.filter,
          upscaled: settings.upscale > 1,
          hdr: settings.hdr,
        };
        items.push(item);
        // Tiny pause to avoid sensor frame duplicates
        await new Promise((r) => setTimeout(r, 200));
      }
      setGallery((g) => [...items.reverse(), ...g]);
      toast.success("Burst 5 foto disimpan", {
        description: "Semua sudah di-upscale + HEIC",
      });
    } catch (e) {
      console.error(e);
      toast.error("Burst gagal");
    } finally {
      setBurstCount(0);
      setProcessing(null);
      captureLockRef.current = false;
    }
  }, [settings]);

  // ---- Timer countdown then capture ----
  const runWithTimer = useCallback(
    (fn: () => void) => {
      if (settings.timer === 0) {
        fn();
        return;
      }
      let count = settings.timer;
      setTimerCountdown(count);
      const tick = setInterval(() => {
        count -= 1;
        if (count <= 0) {
          clearInterval(tick);
          setTimerCountdown(null);
          fn();
        } else {
          setTimerCountdown(count);
        }
      }, 1000);
    },
    [settings.timer],
  );

  // ---- Video recording ----
  const toggleVideoRecording = useCallback(async () => {
    if (!streamRef.current) return;
    if (isRecording) {
      const r = recorderRef.current;
      if (r && r.state !== "inactive") r.stop();
      return;
    }
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
          filename: `kangwifi-${Date.now()}.video.${ext}`,
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
      runWithTimer(() => void toggleVideoRecording());
    } else if (mode === "live") {
      runWithTimer(() =>
        void capturePhoto(true, "live").then((p) => {
          if (p) {
            toast.success("Live Photo tersimpan", {
              description: "Foto HEIC + klip video",
            });
          }
        }),
      );
    } else if (mode === "burst") {
      runWithTimer(() => void captureBurst());
    } else if (mode === "portrait") {
      runWithTimer(() =>
        void capturePhoto(false, "portrait").then((p) => {
          if (p) {
            toast.success("Portrait tersimpan", {
              description: "HEIC · super HD · jernih",
            });
          }
        }),
      );
    } else {
      // photo
      runWithTimer(() =>
        void capturePhoto(false).then((p) => {
          if (p) {
            toast.success("Foto HEIC tersimpan", {
              description: `${p.width}×${p.height} · super HD jernih`,
            });
          }
        }),
      );
    }
  }, [mode, capturePhoto, captureBurst, toggleVideoRecording, runWithTimer]);

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

  // ---- Update gallery item (e.g. after cloud upload sets cloudUrl) ----
  const handleItemUpdate = useCallback((updated: CaptureItem) => {
    setGallery((g) => g.map((it) => (it.id === updated.id ? updated : it)));
    // Also update the preview if it's the currently open item
    setPreviewItem((p) => (p && p.id === updated.id ? updated : p));
  }, []);

  // ---- Fetch cloud file count on mount ----
  useEffect(() => {
    let cancelled = false;
    listCloudImages().then((result) => {
      if (cancelled) return;
      if (result.success && result.files) {
        setCloudCount(result.files.length);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [cloudGalleryOpen]); // refresh count when cloud gallery closes

  // ---- Open cloud gallery if URL has ?cloud=1 (from PWA shortcut) ----
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("cloud") === "1") {
      setCloudGalleryOpen(true);
      // Clean the URL so it doesn't reopen on refresh
      url.searchParams.delete("cloud");
      window.history.replaceState({}, "", url.toString());
    }
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

  // CSS-based zoom (fallback when MediaTrackConstraint zoom not supported)
  const cssZoom = settings.zoom > 1 ? settings.zoom : 1;

  const videoProps = cnVideo(facing, cssZoom);

  return (
    <div className="fixed inset-0 bg-black text-white select-none">
      {/* Viewfinder */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={videoProps.className}
          style={videoProps.style}
        />
        {/* Aspect ratio crop overlay */}
        <AspectRatioOverlay aspect={settings.aspect} />
      </div>

      {/* Flash overlay */}
      <div
        ref={flashFrameRef}
        className="absolute inset-0 bg-white pointer-events-none z-30"
        style={{ opacity: 0 }}
      />

      {/* Grid overlay */}
      {settings.grid && (
        <div className="absolute inset-0 z-10 pointer-events-none">
          <div className="absolute inset-y-0 left-1/3 w-px bg-white/30" />
          <div className="absolute inset-y-0 left-2/3 w-px bg-white/30" />
          <div className="absolute inset-x-0 top-1/3 h-px bg-white/30" />
          <div className="absolute inset-x-0 top-2/3 h-px bg-white/30" />
          {/* Center crosshair */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 size-12 border border-amber-300/50 rounded-full" />
        </div>
      )}

      {/* Level indicator */}
      {settings.level && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
          <div
            className="w-32 h-px bg-amber-300/80"
            style={{
              transform: `rotate(${orientation}deg)`,
              transformOrigin: "center",
            }}
          />
        </div>
      )}

      {/* Filter preview badge */}
      {settings.filter !== "none" && (
        <div className="absolute top-20 right-4 z-20 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md">
          <span className="text-[10px] font-bold text-amber-300 uppercase tracking-wider">
            {settings.filter}
          </span>
        </div>
      )}

      {/* Timer countdown overlay */}
      {typeof timerCountdown === "number" && timerCountdown > 0 && (
        <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
          <span
            className="text-9xl font-black text-amber-300 animate-ping-slow"
            style={{ textShadow: "0 0 30px rgba(252, 211, 77, 0.6)" }}
          >
            {timerCountdown}
          </span>
        </div>
      )}

      {/* Top bar */}
      <TopBar
        flash={flash}
        onFlashCycle={() =>
          setFlash((f) =>
            f === "off" ? "auto" : f === "auto" ? "on" : f === "on" ? "torch" : "off",
          )
        }
        facing={facing}
        onSwitchFacing={() =>
          setFacing((f) => (f === "environment" ? "user" : "environment"))
        }
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenCloud={() => setCloudGalleryOpen(true)}
        cloudCount={cloudCount}
        hdBadge={hdBadge}
      />

      {/* Zoom quick buttons (above capture) */}
      <div className="absolute bottom-44 inset-x-0 z-20 flex justify-center gap-2 px-4">
        <ZoomPill label="1×" active={settings.zoom === 1} onClick={() => setSettings((s) => ({ ...s, zoom: 1 }))} />
        <ZoomPill label="2×" active={settings.zoom === 2} onClick={() => setSettings((s) => ({ ...s, zoom: 2 }))} />
        <ZoomPill label="4×" active={settings.zoom === 4} onClick={() => setSettings((s) => ({ ...s, zoom: 4 }))} />
        <ZoomPill label="8×" active={settings.zoom === 8} onClick={() => setSettings((s) => ({ ...s, zoom: 8 }))} />
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-0 inset-x-0 z-20 pb-[max(env(safe-area-inset-bottom),1.5rem)] px-4 pt-4 bg-gradient-to-t from-black/85 via-black/50 to-transparent">
        <div className="mb-3">
          <GalleryStrip
            items={gallery}
            onOpen={setPreviewItem}
            onClear={handleClearAll}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 flex flex-col items-start">
            <div className="text-[10px] text-white/40">UPSCALE</div>
            <div className="text-xs font-bold text-amber-300 truncate max-w-[80px]">
              {settings.upscale > 1 ? `${settings.upscale}× HD` : "Original"}
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <CaptureButton
              mode={mode}
              isRecording={isRecording}
              onCapture={handleCapture}
              recordingSeconds={recordingSeconds}
              timerCountdown={timerCountdown}
              burstCount={burstCount}
            />
            <div className="h-4" />
          </div>
          <div className="flex-1 flex justify-end">
            <div className="text-right">
              <div className="text-[10px] text-white/40">FORMAT</div>
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

      {!streaming && error && (
        <PermissionGate error={error} onRetry={() => startCamera(facing, settings.zoom)} />
      )}

      <ProcessingOverlay visible={!!processing} message={processing ?? ""} />

      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSettingsChange={setSettings}
      />

      <PreviewModal
        item={previewItem}
        onClose={() => setPreviewItem(null)}
        onDelete={handleDelete}
        onItemUpdate={handleItemUpdate}
      />

      <CloudGallery
        open={cloudGalleryOpen}
        onClose={() => setCloudGalleryOpen(false)}
      />
    </div>
  );
}

function AspectRatioOverlay({ aspect }: { aspect: string }) {
  if (aspect === "free") return null;
  // Render a black mask to crop viewfinder to target aspect ratio
  return (
    <div className="absolute inset-0 z-[5] pointer-events-none">
      <AspectMask aspect={aspect} />
    </div>
  );
}

function AspectMask({ aspect }: { aspect: string }) {
  // Compute the visible window
  let ratio = 0;
  switch (aspect) {
    case "1:1": ratio = 1; break;
    case "4:3": ratio = 4 / 3; break;
    case "16:9": ratio = 16 / 9; break;
    case "3:4": ratio = 3 / 4; break;
    default: return null;
  }
  // Use CSS to compute via aspect-ratio property
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div
        className="relative"
        style={{
          width: "100%",
          height: "100%",
          maxWidth: ratio >= 1 ? "100%" : `${(ratio / 1) * 100}%`,
          maxHeight: ratio >= 1 ? `${(1 / ratio) * 100}%` : "100%",
          aspectRatio: aspect.replace(":", " / "),
        }}
      >
        {/* Black borders around the visible window */}
        <div className="absolute -top-[100vh] left-0 right-0 h-[100vh] bg-black/60" />
        <div className="absolute -bottom-[100vh] left-0 right-0 h-[100vh] bg-black/60" />
        <div className="absolute top-0 bottom-0 -left-[100vw] w-[100vw] bg-black/60" />
        <div className="absolute top-0 bottom-0 -right-[100vw] w-[100vw] bg-black/60" />
      </div>
    </div>
  );
}

function ZoomPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 rounded-full text-[11px] font-bold backdrop-blur-md transition-colors",
        active ? "bg-amber-300 text-black" : "bg-black/40 text-white/70",
      )}
    >
      {label}
    </button>
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
    // torch not supported
  }
}

function cnVideo(facing: FacingMode, zoom: number): { className: string; style: React.CSSProperties } {
  const base =
    "absolute inset-0 w-full h-full object-cover bg-black transition-transform duration-200";
  const scaleX = facing === "user" ? -1 : 1;
  const scale = zoom > 1 ? zoom : 1;
  return {
    className: base,
    style: {
      transform: `scaleX(${scaleX}) scale(${scale})`,
      transformOrigin: "center center",
    },
  };
}

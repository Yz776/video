"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CameraMode,
  CameraSettings,
  CloudFile,
  FacingMode,
  FlashMode,
  DEFAULT_SETTINGS,
} from "./types";
import {
  captureFullResolutionPhoto,
  deleteCloudFile,
  genId,
  openCameraStream,
  CAMERA_CONSTRAINT_LEVELS,
  listCloudImagesWithLocalFallback,
  pickRecorderMime,
  processToHeic,
  upgradeStreamResolution,
  uploadCaptureWithLocalFallback,
} from "./utils";
import {
  CaptureButton,
  ModeSelector,
  PermissionGate,
  ProcessingOverlay,
  SettingsSheet,
  TopBar,
} from "./controls";
import {
  CloudStrip,
  CloudGallery,
  JustCapturedModal,
  type JustCapturedInfo,
} from "./gallery";
import type { CaptureKind } from "./local-gallery";
import { cn } from "@/lib/utils";
import {
  Aperture as ApertureIcon,
  Check as CheckIcon,
  Download as DownloadIcon,
  ExternalLink as ExternalLinkIcon,
  Link2 as Link2Icon,
  Play as PlayIcon,
  Trash2 as Trash2Icon,
  X as XIcon,
} from "lucide-react";

export function CameraApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const flashFrameRef = useRef<HTMLDivElement>(null);
  const captureLockRef = useRef(false);
  const deviceOrientationRef = useRef<number>(0);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [facing, setFacing] = useState<FacingMode>("environment");
  const [mode, setMode] = useState<CameraMode>("photo");
  const [flash, setFlash] = useState<FlashMode>("off");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [processing, setProcessing] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<CameraSettings>(DEFAULT_SETTINGS);
  const [timerCountdown, setTimerCountdown] = useState<number | null>(null);
  const [burstCount, setBurstCount] = useState<number>(0);
  const [orientation, setOrientation] = useState(0);
  const [cloudGalleryOpen, setCloudGalleryOpen] = useState(false);
  const [cloudFiles, setCloudFiles] = useState<CloudFile[]>([]);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudCount, setCloudCount] = useState<number>(0);
  const [selectedCloudFile, setSelectedCloudFile] = useState<CloudFile | null>(null);
  const [justCaptured, setJustCaptured] = useState<JustCapturedInfo | null>(null);

  // Track blob URLs that need cleanup when justCaptured closes
  const justCapturedUrlsRef = useRef<{ preview?: string; download?: string }>({});

  // ---- Camera start / stop ----
  const startCamera = useCallback(
    async (facingMode: FacingMode, zoom: number) => {
      setError(null);
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        // openCameraStream tries STRICT → LOOSE → MINIMAL → BASIC constraints,
        // so OverconstrainedError on one level auto-falls-back to the next.
        // This handles front cameras that can't do 4K, old phones that reject
        // aspectRatio, and Chrome builds that reject `advanced` arrays.
        const { stream, level } = await openCameraStream(facingMode, zoom);
        streamRef.current = stream;
        // Try to upgrade resolution if browser gave us a low-res stream.
        // Skip if we already fell back to BASIC (device is clearly limited).
        if (level > CAMERA_CONSTRAINT_LEVELS.BASIC) {
          await upgradeStreamResolution(stream);
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStreaming(true);
        // Log actual track settings + which constraint level worked
        const track = stream.getVideoTracks()[0];
        if (track) {
          const s = track.getSettings();
          const levelName = ["STRICT", "LOOSE", "MINIMAL", "BASIC"][level] ?? `L${level}`;
          console.log(
            `[camera] active stream: ${s.width}×${s.height} @ ${s.frameRate}fps, facing=${s.facingMode}, constraint=${levelName}`,
          );
        }
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

  // Device orientation for level indicator (throttled via rAF)
  useEffect(() => {
    if (!settings.level) return;
    let raf = 0;
    let pending = false;
    const handler = (e: DeviceOrientationEvent) => {
      const gamma = e.gamma ?? 0;
      deviceOrientationRef.current = gamma;
      if (!pending) {
        pending = true;
        raf = requestAnimationFrame(() => {
          setOrientation(deviceOrientationRef.current);
          pending = false;
        });
      }
    };
    window.addEventListener("deviceorientation", handler, true);
    return () => {
      window.removeEventListener("deviceorientation", handler, true);
      if (raf) cancelAnimationFrame(raf);
    };
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

  // Cleanup timer interval on unmount (defensive — for runWithTimer)
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, []);

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

  // ---- Cloud list refresh (with local IndexedDB fallback) ----
  // When cloud.kangwifi.eu.org is unreachable (403, network error), this
  // automatically falls back to listing files from local IndexedDB so the
  // user still sees their captured photos in the gallery strip.
  const refreshCloud = useCallback(async () => {
    setCloudLoading(true);
    const result = await listCloudImagesWithLocalFallback();
    setCloudLoading(false);
    if (result.success && result.files) {
      setCloudFiles(result.files);
      setCloudCount(result.files.length);
      // Log the source so we can debug "why is gallery showing old data"
      if (result.source === "local") {
        console.info(
          "[gallery] cloud unreachable — showing local IndexedDB gallery",
          result.error ? `(${result.error})` : "",
        );
      }
    }
  }, []);

  // Fetch cloud count on mount
  useEffect(() => {
    refreshCloud();
  }, [refreshCloud]);

  // Refresh cloud when CloudGallery closes
  useEffect(() => {
    if (!cloudGalleryOpen) refreshCloud();
  }, [cloudGalleryOpen, refreshCloud]);

  // ---- Open cloud gallery if URL has ?cloud=1 (from PWA shortcut) ----
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("cloud") === "1") {
      setCloudGalleryOpen(true);
      url.searchParams.delete("cloud");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  // ---- Cleanup justCaptured blob URLs when modal closes ----
  const closeJustCaptured = useCallback(() => {
    const urls = justCapturedUrlsRef.current;
    if (urls.preview && urls.preview !== urls.download) {
      URL.revokeObjectURL(urls.preview);
    }
    if (urls.download) URL.revokeObjectURL(urls.download);
    justCapturedUrlsRef.current = {};
    setJustCaptured(null);
    // Refresh cloud strip after dismissing
    refreshCloud();
  }, [refreshCloud]);

  // ---- Upload a processed capture to cloud (with local IndexedDB fallback) ----
  // Even if cloud.kangwifi.eu.org is unreachable (403, network error), the
  // capture is saved to local IndexedDB so the user never loses their photo.
  // The gallery strip will show local files when cloud is down.
  const uploadCapture = useCallback(
    async (
      heicBlob: Blob,
      previewBlob: Blob | null,
      filename: string,
      mime: string,
      width: number,
      height: number,
      kind: CameraMode,
    ): Promise<JustCapturedInfo | null> => {
      setProcessing("Mengunggah ke cloud…");
      try {
        // uploadCaptureWithLocalFallback always saves to IDB + tries cloud.
        // Returns success=true even if cloud failed (photo still saved locally).
        // Map CameraMode → CaptureKind: burst/portrait are stored as "photo".
        const storageKind: CaptureKind =
          kind === "video" ? "video" : kind === "live" ? "live" : "photo";
        const result = await uploadCaptureWithLocalFallback(
          heicBlob,
          previewBlob,
          filename,
          mime,
          storageKind,
          width,
          height,
        );
        if (!result.success) {
          throw new Error(result.cloudError ?? "Penyimpanan gagal");
        }

        // Create blob URLs for preview & download (work regardless of cloud)
        const previewUrl = previewBlob
          ? URL.createObjectURL(previewBlob)
          : URL.createObjectURL(heicBlob);
        const downloadUrl = URL.createObjectURL(heicBlob);
        justCapturedUrlsRef.current = { preview: previewUrl, download: downloadUrl };

        const info: JustCapturedInfo = {
          id: result.localId, // Use local IDB id — gallery can fetch full blob later
          previewUrl,
          downloadUrl,
          filename,
          mime,
          width,
          height,
          size: heicBlob.size,
          // If cloud uploaded, use cloud URL; otherwise leave undefined
          // (download button falls back to local blob URL)
          cloudUrl: result.cloudUrl ?? undefined,
          cloudKey: result.cloudKey ?? undefined,
          hfUrl: result.hfUrl ?? undefined,
          cloudUploaded: result.cloudUploaded,
          kind,
        };

        // If cloud failed but local succeeded, notify user
        if (!result.cloudUploaded) {
          toast.warning(
            "Cloud sedang offline — foto disimpan lokal di perangkat ini",
          );
        }

        return info;
      } finally {
        setProcessing(null);
      }
    },
    [],
  );

  // ---- Photo capture (single, with optional live clip) ----
  const capturePhoto = useCallback(
    async (
      alsoCaptureVideoClip = false,
      kindOverride?: CameraMode,
    ): Promise<void> => {
      if (!videoRef.current || !streamRef.current) {
        toast.error("Kamera belum siap");
        return;
      }
      if (captureLockRef.current) return;
      captureLockRef.current = true;

      const shouldFlash =
        flash === "on" ||
        flash === "torch" ||
        (flash === "auto" && Math.random() > 0.5);
      if (shouldFlash) triggerFlashEffect();

      setProcessing("Memproses HEIC super HD jernih…");

      let clipBlob: Blob | null = null;
      if (alsoCaptureVideoClip) {
        try {
          const { mime } = pickRecorderMime();
          const clipChunks: Blob[] = [];
          const r = new MediaRecorder(streamRef.current, {
            mimeType: mime,
            videoBitsPerSecond: 12_000_000,
            audioBitsPerSecond: 192_000,
          });
          r.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) clipChunks.push(e.data);
          };
          const clipDone = new Promise<Blob>((resolve) => {
            r.onstop = () => resolve(new Blob(clipChunks, { type: mime }));
          });
          r.start();
          // Record a 1.5s motion clip alongside the still photo
          await new Promise((r) => setTimeout(r, 1500));
          r.stop();
          clipBlob = await clipDone;
        } catch (e) {
          console.warn("Live clip recording failed", e);
        }
      }

      try {
        const { blob: rawBlob, width, height } = await captureFullResolutionPhoto(
          videoRef.current,
          streamRef.current,
        );
        const result = await processToHeic(rawBlob, settings);
        const finalWidth = result.width || width;
        const finalHeight = result.height || height;
        const heicBlob = result.blob;
        const kind = kindOverride ?? (alsoCaptureVideoClip ? "live" : "photo");
        const filename = `kangwifi-${Date.now()}.${kind}.heic`;

        // Upload to cloud
        const info = await uploadCapture(
          heicBlob,
          result.previewBlob,
          filename,
          "image/heic",
          finalWidth,
          finalHeight,
          kind,
        );

        // If live photo: also upload the video clip
        if (clipBlob && info) {
          // Fire-and-forget video upload — don't block the UI.
          // Uses local fallback so the clip is never lost if cloud is down.
          const videoFilename = `kangwifi-${Date.now()}.live.webm`;
          uploadCaptureWithLocalFallback(
            clipBlob,
            null,
            videoFilename,
            clipBlob.type || "video/webm",
            "video",
          )
            .then((videoResult) => {
              if (videoResult.cloudUploaded) {
                toast.success("Klip Live Photo terupload", {
                  description: "Video pendek menyertai foto HEIC",
                });
              }
            })
            .catch((e) => console.warn("Live clip upload failed", e));
        }

        if (info) {
          setJustCaptured(info);
          // Only show "tersimpan di cloud" toast if cloud actually succeeded;
          // uploadCapture already showed a warning toast if cloud failed.
          if (info.cloudUploaded) {
            toast.success("Foto tersimpan di cloud", {
              description: `${finalWidth}×${finalHeight} · super HD jernih`,
            });
          }
        }
      } catch (e) {
        console.error(e);
        const msg = e instanceof Error ? e.message : "Gagal memproses foto";
        toast.error(msg);
      } finally {
        setProcessing(null);
        captureLockRef.current = false;
      }
    },
    [flash, settings, triggerFlashEffect, uploadCapture],
  );

  // ---- Burst capture: 5 photos in quick succession ----
  const captureBurst = useCallback(async () => {
    if (!videoRef.current || !streamRef.current || captureLockRef.current) return;
    captureLockRef.current = true;
    setProcessing("Burst capture (5 foto)…");
    const burstId = genId();
    let successCount = 0;
    let lastInfo: JustCapturedInfo | null = null;
    try {
      for (let i = 0; i < 5; i++) {
        setBurstCount(i + 1);
        setProcessing(`Burst ${i + 1}/5 — proses HEIC + upload…`);
        try {
          const { blob: rawBlob, width, height } = await captureFullResolutionPhoto(
            videoRef.current,
            streamRef.current,
          );
          const result = await processToHeic(rawBlob, settings);
          const filename = `kangwifi-burst-${burstId}-${i + 1}.heic`;
          const info = await uploadCapture(
            result.blob,
            result.previewBlob,
            filename,
            "image/heic",
            result.width || width,
            result.height || height,
            "burst",
          );
          if (info) {
            lastInfo = info;
            successCount++;
            // Revoke all but the last preview/download URLs — only show the
            // last burst photo in the JustCapturedModal to keep memory low.
            if (i < 4) {
              const urls = justCapturedUrlsRef.current;
              if (urls.preview && urls.preview !== urls.download) {
                URL.revokeObjectURL(urls.preview);
              }
              if (urls.download) URL.revokeObjectURL(urls.download);
              justCapturedUrlsRef.current = {};
            }
          }
          // Tiny pause to avoid sensor frame duplicates
          await new Promise((r) => setTimeout(r, 150));
        } catch (e) {
          console.error(`Burst ${i + 1} failed`, e);
        }
      }
      if (lastInfo) {
        setJustCaptured(lastInfo);
      }
      if (successCount > 0) {
        if (lastInfo?.cloudUploaded) {
          toast.success(`Burst ${successCount}/5 terupload ke cloud`, {
            description: "Semua sudah di-upscale + HEIC",
          });
        } else {
          toast.warning(`Burst ${successCount}/5 tersimpan lokal`, {
            description: "Cloud sedang offline — coba lagi nanti",
          });
        }
      } else {
        toast.error("Burst gagal total");
      }
    } finally {
      setBurstCount(0);
      setProcessing(null);
      captureLockRef.current = false;
    }
  }, [settings, uploadCapture]);

  // ---- Timer countdown then capture ----
  const runWithTimer = useCallback(
    (fn: () => void) => {
      if (settings.timer === 0) {
        fn();
        return;
      }
      let count = settings.timer;
      setTimerCountdown(count);
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      timerIntervalRef.current = setInterval(() => {
        count -= 1;
        if (count <= 0) {
          if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current);
            timerIntervalRef.current = null;
          }
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
      r.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        setIsRecording(false);
        if (blob.size === 0) {
          toast.error("Video kosong");
          return;
        }
        const filename = `kangwifi-${Date.now()}.video.${ext}`;
        setProcessing("Mengunggah video ke cloud…");
        try {
          // Use unified upload with local fallback — same path as photos.
          // If cloud fails, video is saved to local IDB so it's never lost.
          const result = await uploadCaptureWithLocalFallback(
            blob,
            null, // videos have no previewBlob
            filename,
            mime,
            "video",
          );
          if (!result.success) {
            throw new Error(result.cloudError ?? "Upload video gagal");
          }
          const previewUrl = URL.createObjectURL(blob);
          const downloadUrl = previewUrl; // same URL — video previews from blob
          justCapturedUrlsRef.current = {
            preview: previewUrl,
            download: downloadUrl,
          };
          setJustCaptured({
            id: result.localId,
            previewUrl,
            downloadUrl,
            filename,
            mime,
            size: blob.size,
            cloudUrl: result.cloudUrl ?? undefined,
            cloudKey: result.cloudKey ?? undefined,
            hfUrl: result.hfUrl ?? undefined,
            cloudUploaded: result.cloudUploaded,
            kind: "video",
          });
          if (result.cloudUploaded) {
            toast.success("Video tersimpan di cloud", {
              description: `${ext.toUpperCase()} · ${(blob.size / 1024 / 1024).toFixed(2)} MB`,
            });
          } else {
            toast.warning(
              "Cloud sedang offline — video disimpan lokal di perangkat ini",
            );
          }
        } catch (e) {
          console.error(e);
          toast.error(e instanceof Error ? e.message : "Upload video gagal");
        } finally {
          setProcessing(null);
        }
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
        void capturePhoto(true, "live"),
      );
    } else if (mode === "burst") {
      runWithTimer(() => void captureBurst());
    } else if (mode === "portrait") {
      runWithTimer(() => void capturePhoto(false, "portrait"));
    } else {
      // photo
      runWithTimer(() => void capturePhoto(false));
    }
  }, [mode, capturePhoto, captureBurst, toggleVideoRecording, runWithTimer]);

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
          <CloudStrip
            files={cloudFiles}
            loading={cloudLoading}
            onOpen={(f) => setSelectedCloudFile(f)}
            onOpenCloud={() => setCloudGalleryOpen(true)}
            onRefresh={refreshCloud}
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

      <JustCapturedModal
        info={justCaptured}
        onClose={closeJustCaptured}
        onOpenCloud={() => {
          closeJustCaptured();
          setCloudGalleryOpen(true);
        }}
      />

      <CloudGallery
        open={cloudGalleryOpen}
        onClose={() => setCloudGalleryOpen(false)}
      />

      {/* Selected cloud file from strip — render CloudFileDetail via CloudGallery's modal */}
      {selectedCloudFile && (
        <CloudFileDetailAdapter
          file={selectedCloudFile}
          onClose={() => setSelectedCloudFile(null)}
          onDeleted={() => {
            setCloudFiles((f) => f.filter((x) => x.key !== selectedCloudFile.key));
            setCloudCount((c) => Math.max(0, c - 1));
            setSelectedCloudFile(null);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// CloudFileDetailAdapter — lightweight wrapper that renders a
// detail modal for a cloud file opened from the strip, with
// delete + copy link + download. Mirrors the CloudFileDetail
// inside CloudGallery but as a standalone export-able component.
// ============================================================

function CloudFileDetailAdapter({
  file,
  onClose,
  onDeleted,
}: {
  file: CloudFile;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const isHeic = /\.heic?$/i.test(file.name) || file.mime === "image/heic";
  const isVideo = /^video\//i.test(file.mime ?? "") || /\.(webm|mp4|mov)$/i.test(file.name);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(file.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Hapus ${file.name} dari cloud?`)) return;
    const result = await deleteCloudFile(file.key);
    if (!result.success) {
      alert(`Gagal hapus: ${result.error}`);
      return;
    }
    onDeleted();
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-3 bg-gradient-to-b from-black/80 to-transparent">
        <button
          onClick={onClose}
          className="size-10 rounded-full bg-black/50 flex items-center justify-center"
          aria-label="Close"
        >
          <XIcon className="size-5 text-white" />
        </button>
        <div className="text-center">
          <div className="text-xs text-white/80 font-mono truncate max-w-[200px]">
            {file.name}
          </div>
          <div className="text-[10px] text-white/40">
            {file.sizeHuman} · {new Date(file.createdAt).toLocaleString("id-ID")}
          </div>
        </div>
        <button
          onClick={handleDelete}
          className="size-10 rounded-full bg-red-500/20 flex items-center justify-center"
          aria-label="Delete"
        >
          <Trash2Icon className="size-5 text-red-400" />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center px-4">
        {isVideo ? (
          <video
            src={file.url}
            className="max-w-full max-h-full rounded-lg"
            controls
            playsInline
          />
        ) : isHeic ? (
          <div className="text-center space-y-3">
            <div className="size-24 mx-auto rounded-2xl bg-zinc-900 flex items-center justify-center">
              <ApertureIcon className="size-10 text-amber-300" />
            </div>
            <p className="text-sm text-white/70">
              File HEIC tidak bisa dipratinjau di browser.
            </p>
            <p className="text-xs text-white/50">
              Unduh untuk melihat di galeri Android.
            </p>
          </div>
        ) : (
          <img
            src={file.url}
            alt={file.name}
            className="max-w-full max-h-full object-contain rounded-lg"
          />
        )}
      </div>

      <div className="px-4 py-3 bg-zinc-950/80 border-t border-zinc-800 space-y-2">
        <div className="flex items-center gap-1.5">
          <input
            readOnly
            value={file.url}
            className="flex-1 px-2.5 py-1.5 bg-black/40 rounded-lg text-[11px] text-white/90 font-mono border border-zinc-700"
          />
          <button
            onClick={copy}
            className="size-8 rounded-lg bg-sky-500/20 text-sky-300 flex items-center justify-center"
            aria-label="Copy link"
          >
            {copied ? <CheckIcon className="size-4" /> : <Link2Icon className="size-4" />}
          </button>
          <a
            href={file.url}
            target="_blank"
            rel="noopener noreferrer"
            className="size-8 rounded-lg bg-sky-500/20 text-sky-300 flex items-center justify-center"
            aria-label="Open in new tab"
          >
            <ExternalLinkIcon className="size-4" />
          </a>
          <a
            href={file.url}
            download={file.name}
            className="size-8 rounded-lg bg-amber-300/20 text-amber-300 flex items-center justify-center"
            aria-label="Download"
          >
            <DownloadIcon className="size-4" />
          </a>
        </div>
      </div>
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
      // Crisp rendering hints — most browsers honor image-rendering:auto
      // but `high-quality` forces the GPU to use bicubic instead of bilinear.
      // The slight contrast/saturation bump makes the preview feel more
      // "HD" on AMOLED screens without changing the actual capture (filter
      // is applied to <video> only, NOT to the ImageCapture still which
      // goes straight to the backend untouched).
      imageRendering: "high-quality" as React.CSSProperties["imageRendering"],
      filter: "contrast(1.04) saturate(1.06)",
    },
  };
}

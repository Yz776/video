"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  FlashMode,
  CameraMode,
  CameraSettings,
} from "./types";
import {
  Zap,
  ZapOff,
  RefreshCw,
  Settings as SettingsIcon,
  Sparkles,
  Camera,
  Video,
  CircleDot,
  X,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";

interface TopBarProps {
  flash: FlashMode;
  onFlashCycle: () => void;
  facing: "environment" | "user";
  onSwitchFacing: () => void;
  onOpenSettings: () => void;
  hdBadge?: string;
}

export function TopBar({
  flash,
  onFlashCycle,
  facing,
  onSwitchFacing,
  onOpenSettings,
  hdBadge,
}: TopBarProps) {
  return (
    <div className="absolute top-0 inset-x-0 z-20 px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-6 bg-gradient-to-b from-black/70 to-transparent">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onFlashCycle}
            className="size-11 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center active:scale-95 transition-transform"
            aria-label="Flash"
          >
            {flash === "off" ? (
              <ZapOff className="size-5 text-white/80" />
            ) : (
              <Zap
                className={cn(
                  "size-5",
                  flash === "on" ? "text-yellow-300" : "text-white/80",
                )}
              />
            )}
          </button>
          {flash === "auto" && (
            <span className="text-[10px] font-bold text-white/80 bg-black/40 backdrop-blur-md px-1.5 py-0.5 rounded">
              AUTO
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {hdBadge && (
            <div className="px-2.5 py-1 rounded-md bg-black/40 backdrop-blur-md flex items-center gap-1">
              <Sparkles className="size-3 text-amber-300" />
              <span className="text-[11px] font-bold tracking-wider text-white">
                {hdBadge}
              </span>
            </div>
          )}
          <button
            onClick={onOpenSettings}
            className="size-11 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center active:scale-95 transition-transform"
            aria-label="Settings"
          >
            <SettingsIcon className="size-5 text-white/80" />
          </button>
          <button
            onClick={onSwitchFacing}
            className="size-11 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center active:scale-95 transition-transform"
            aria-label="Switch camera"
          >
            <RefreshCw className="size-5 text-white/80" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface ModeSelectorProps {
  mode: CameraMode;
  onChange: (m: CameraMode) => void;
  isRecording: boolean;
}

export function ModeSelector({ mode, onChange, isRecording }: ModeSelectorProps) {
  const modes: { id: CameraMode; label: string; icon: React.ReactNode }[] = [
    { id: "photo", label: "FOTO", icon: <Camera className="size-3.5" /> },
    { id: "video", label: "VIDEO", icon: <Video className="size-3.5" /> },
    { id: "live", label: "LIVE", icon: <CircleDot className="size-3.5" /> },
  ];
  return (
    <div className="flex items-center justify-center gap-1">
      {modes.map((m) => {
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            disabled={isRecording}
            onClick={() => onChange(m.id)}
            className={cn(
              "px-3.5 py-1.5 rounded-full flex items-center gap-1.5 text-[11px] font-bold tracking-wider transition-all",
              active
                ? "bg-amber-300 text-black"
                : "text-white/70 hover:text-white",
              isRecording && !active && "opacity-30",
            )}
          >
            {m.icon}
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

interface CaptureButtonProps {
  mode: CameraMode;
  isRecording: boolean;
  onCapture: () => void;
  recordingSeconds: number;
}

export function CaptureButton({
  mode,
  isRecording,
  onCapture,
  recordingSeconds,
}: CaptureButtonProps) {
  if (mode === "video") {
    return (
      <button
        onClick={onCapture}
        className="relative size-20 rounded-full flex items-center justify-center active:scale-95 transition-transform"
        aria-label={isRecording ? "Stop recording" : "Start recording"}
      >
        <span className="absolute inset-0 rounded-full border-4 border-white" />
        {isRecording ? (
          <span className="size-8 rounded-md bg-red-500 animate-pulse" />
        ) : (
          <span className="size-14 rounded-full bg-red-500" />
        )}
        {isRecording && (
          <span className="absolute -bottom-7 text-xs font-bold text-red-400 tabular-nums">
            {formatTime(recordingSeconds)}
          </span>
        )}
      </button>
    );
  }

  // Photo + Live share the same capture look, live gets a yellow ring
  return (
    <button
      onClick={onCapture}
      className="relative size-20 rounded-full flex items-center justify-center active:scale-95 transition-transform"
      aria-label="Capture"
    >
      <span
        className={cn(
          "absolute inset-0 rounded-full border-4",
          mode === "live" ? "border-amber-300" : "border-white",
        )}
      />
      <span
        className={cn(
          "size-16 rounded-full",
          mode === "live" ? "bg-amber-300" : "bg-white",
        )}
      />
      {mode === "live" && (
        <span className="absolute -bottom-7 text-[10px] font-bold tracking-wider text-amber-300">
          LIVE PHOTO
        </span>
      )}
    </button>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: CameraSettings;
  onSettingsChange: (s: CameraSettings) => void;
}

export function SettingsSheet({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
}: SettingsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="bg-zinc-950/95 border-zinc-800 text-white"
      >
        <SheetHeader>
          <SheetTitle className="text-white">Pengaturan Kualitas</SheetTitle>
        </SheetHeader>
        <div className="space-y-6 px-1 pb-6">
          {/* Upscale factor */}
          <div className="space-y-3">
            <Label className="text-xs text-white/70 uppercase tracking-wider">
              Upscale Factor
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {([1, 2, 4] as const).map((f) => (
                <button
                  key={f}
                  onClick={() =>
                    onSettingsChange({ ...settings, upscale: f })
                  }
                  className={cn(
                    "py-3 rounded-xl text-sm font-bold transition-colors",
                    settings.upscale === f
                      ? "bg-amber-300 text-black"
                      : "bg-zinc-800 text-white/70",
                  )}
                >
                  {f === 1 ? "Original" : `${f}× Super HD`}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-white/50 leading-relaxed">
              Upscale 2× menggandakan resolusi dengan lanczos3 + sharpening.
              4× untuk hasil super HD maksimal (lebih lama).
            </p>
          </div>

          {/* Quality */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-white/70 uppercase tracking-wider">
                Kualitas HEIC
              </Label>
              <span className="text-sm font-bold text-amber-300 tabular-nums">
                {settings.quality}
              </span>
            </div>
            <Slider
              value={[settings.quality]}
              min={60}
              max={100}
              step={5}
              onValueChange={(v) =>
                onSettingsChange({ ...settings, quality: v[0] })
              }
            />
          </div>

          {/* Sharpen */}
          <div className="flex items-center justify-between rounded-xl bg-zinc-900 px-4 py-3">
            <div>
              <Label className="text-sm font-medium">Sharpening</Label>
              <p className="text-[11px] text-white/50">
                Unsharp mask untuk detail lebih tajam
              </p>
            </div>
            <Switch
              checked={settings.sharpen}
              onCheckedChange={(c) =>
                onSettingsChange({ ...settings, sharpen: c })
              }
            />
          </div>

          {/* Enhance */}
          <div className="flex items-center justify-between rounded-xl bg-zinc-900 px-4 py-3">
            <div>
              <Label className="text-sm font-medium">Color Enhance</Label>
              <p className="text-[11px] text-white/50">
                Boost saturasi + kontras
              </p>
            </div>
            <Switch
              checked={settings.enhance}
              onCheckedChange={(c) =>
                onSettingsChange({ ...settings, enhance: c })
              }
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface ProcessingOverlayProps {
  visible: boolean;
  message: string;
}

export function ProcessingOverlay({ visible, message }: ProcessingOverlayProps) {
  if (!visible) return null;
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="size-12 rounded-full border-2 border-white/20 border-t-amber-300 animate-spin" />
      <p className="mt-4 text-sm text-white/80 font-medium">{message}</p>
    </div>
  );
}

interface PermissionGateProps {
  error: string | null;
  onRetry: () => void;
}

export function PermissionGate({ error, onRetry }: PermissionGateProps) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center px-6 text-center">
      <div className="size-16 rounded-full bg-amber-300/10 flex items-center justify-center mb-4">
        <Camera className="size-8 text-amber-300" />
      </div>
      <h2 className="text-lg font-bold text-white mb-2">
        Akses Kamera Diperlukan
      </h2>
      <p className="text-sm text-white/60 mb-6 max-w-xs">
        {error
          ? error
          : "Izinkan akses kamera untuk mulai mengambil foto super HD dalam format HEIC."}
      </p>
      <Button
        onClick={onRetry}
        className="bg-amber-300 text-black hover:bg-amber-200"
      >
        Coba Lagi
      </Button>
    </div>
  );
}

interface CloseButtonProps {
  onClose: () => void;
}

export function CloseButton({ onClose }: CloseButtonProps) {
  return (
    <button
      onClick={onClose}
      className="size-10 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center active:scale-95 transition-transform"
      aria-label="Close"
    >
      <X className="size-5 text-white" />
    </button>
  );
}

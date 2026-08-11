"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  FlashMode,
  CameraMode,
  CameraSettings,
  FilterPreset,
  AspectRatio,
  TimerDuration,
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
  Grid3x3,
  Gauge,
  Layers,
  Palette,
  Crop,
  Droplet,
  Sun,
  Contrast,
  Droplets,
  Thermometer,
  Timer,
  Image as ImageIcon,
  Flame,
  Aperture,
  Cloud as CloudIcon,
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
import { useState } from "react";

interface TopBarProps {
  flash: FlashMode;
  onFlashCycle: () => void;
  facing: "environment" | "user";
  onSwitchFacing: () => void;
  onOpenSettings: () => void;
  onOpenCloud?: () => void;
  cloudCount?: number;
  hdBadge?: string;
}

export function TopBar({
  flash,
  onFlashCycle,
  facing,
  onSwitchFacing,
  onOpenSettings,
  onOpenCloud,
  cloudCount,
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
            ) : flash === "torch" ? (
              <Flame className="size-5 text-orange-400" />
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
          {onOpenCloud && (
            <button
              onClick={onOpenCloud}
              className="relative size-11 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center active:scale-95 transition-transform"
              aria-label="Cloud gallery"
            >
              <CloudIcon className="size-5 text-sky-400" />
              {cloudCount != null && cloudCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-sky-500 text-[9px] font-bold text-white flex items-center justify-center">
                  {cloudCount > 99 ? "99+" : cloudCount}
                </span>
              )}
            </button>
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
    { id: "portrait", label: "PORTRAIT", icon: <Aperture className="size-3.5" /> },
    { id: "live", label: "LIVE", icon: <CircleDot className="size-3.5" /> },
    { id: "burst", label: "BURST", icon: <Layers className="size-3.5" /> },
    { id: "video", label: "VIDEO", icon: <Video className="size-3.5" /> },
  ];
  return (
    <div className="flex items-center justify-center gap-1 overflow-x-auto no-scrollbar">
      {modes.map((m) => {
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            disabled={isRecording}
            onClick={() => onChange(m.id)}
            className={cn(
              "px-3 py-1.5 rounded-full flex items-center gap-1.5 text-[11px] font-bold tracking-wider transition-all flex-shrink-0",
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
  timerCountdown?: number | null;
  burstCount?: number;
}

export function CaptureButton({
  mode,
  isRecording,
  onCapture,
  recordingSeconds,
  timerCountdown,
  burstCount,
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
        {typeof timerCountdown === "number" && timerCountdown > 0 && (
          <span className="absolute inset-0 flex items-center justify-center text-3xl font-bold text-amber-300">
            {timerCountdown}
          </span>
        )}
      </button>
    );
  }

  // Photo / Live / Burst / Portrait
  const ringColor =
    mode === "live"
      ? "border-amber-300"
      : mode === "burst"
        ? "border-sky-300"
        : mode === "portrait"
          ? "border-fuchsia-300"
          : "border-white";

  const fillColor =
    mode === "live"
      ? "bg-amber-300"
      : mode === "burst"
        ? "bg-sky-300"
        : mode === "portrait"
          ? "bg-fuchsia-300"
          : "bg-white";

  return (
    <button
      onClick={onCapture}
      className="relative size-20 rounded-full flex items-center justify-center active:scale-95 transition-transform"
      aria-label="Capture"
    >
      <span className={cn("absolute inset-0 rounded-full border-4", ringColor)} />
      <span className={cn("size-16 rounded-full", fillColor)} />
      {typeof timerCountdown === "number" && timerCountdown > 0 && (
        <span className="absolute inset-0 flex items-center justify-center text-4xl font-black text-black animate-ping-slow">
          {timerCountdown}
        </span>
      )}
      {typeof burstCount === "number" && burstCount > 0 && (
        <span className="absolute inset-0 flex items-center justify-center text-2xl font-black text-black">
          {burstCount}
        </span>
      )}
      {mode === "live" && (
        <span className="absolute -bottom-7 text-[10px] font-bold tracking-wider text-amber-300">
          LIVE PHOTO
        </span>
      )}
      {mode === "burst" && (
        <span className="absolute -bottom-7 text-[10px] font-bold tracking-wider text-sky-300">
          BURST (5×)
        </span>
      )}
      {mode === "portrait" && (
        <span className="absolute -bottom-7 text-[10px] font-bold tracking-wider text-fuchsia-300">
          PORTRAIT
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

const FILTERS: { id: FilterPreset; label: string }[] = [
  { id: "none", label: "Normal" },
  { id: "vivid", label: "Vivid" },
  { id: "mono", label: "Mono" },
  { id: "warm", label: "Warm" },
  { id: "cool", label: "Cool" },
  { id: "cinema", label: "Cinema" },
  { id: "night", label: "Night" },
  { id: "vintage", label: "Vintage" },
];

const ASPECTS: { id: AspectRatio; label: string }[] = [
  { id: "free", label: "Free" },
  { id: "1:1", label: "1:1" },
  { id: "4:3", label: "4:3" },
  { id: "16:9", label: "16:9" },
  { id: "3:4", label: "3:4" },
];

const TIMERS: { id: TimerDuration; label: string }[] = [
  { id: 0, label: "Off" },
  { id: 3, label: "3s" },
  { id: 5, label: "5s" },
  { id: 10, label: "10s" },
];

export function SettingsSheet({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
}: SettingsSheetProps) {
  const [tab, setTab] = useState<"quality" | "filter" | "adjust">(
    "quality",
  );
  const update = (patch: Partial<CameraSettings>) =>
    onSettingsChange({ ...settings, ...patch });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="bg-zinc-950/95 border-zinc-800 text-white max-h-[90vh] overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle className="text-white flex items-center gap-2">
            <Sparkles className="size-4 text-amber-300" />
            Pengaturan Kamera kangwifi
          </SheetTitle>
        </SheetHeader>

        {/* Tabs */}
        <div className="flex gap-1 px-1 mt-3 mb-4 bg-zinc-900 p-1 rounded-xl">
          {([
            ["quality", "Kualitas"],
            ["filter", "Filter"],
            ["adjust", "Adjust"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex-1 py-2 rounded-lg text-xs font-bold transition-colors",
                tab === id ? "bg-amber-300 text-black" : "text-white/60",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="px-1 pb-6 space-y-5">
          {tab === "quality" && (
            <>
              {/* Upscale */}
              <div className="space-y-2">
                <Label className="text-xs text-white/70 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="size-3" />
                  Upscale Factor
                </Label>
                <div className="grid grid-cols-3 gap-2">
                  {([1, 2, 4] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => update({ upscale: f })}
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
                  Upscale 2× = 2× resolusi (Full HD → 4K). 4× = Ultra HD
                  (maksimal, lebih lama). Pakai lanczos3 + adaptive sharpening.
                </p>
              </div>

              {/* Quality */}
              <div className="space-y-2">
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
                  onValueChange={(v) => update({ quality: v[0] })}
                />
              </div>

              {/* HDR */}
              <ToggleRow
                icon={<Sun className="size-4 text-amber-300" />}
                title="HDR Local Contrast"
                desc="CLAHE + gamma boost untuk shadow/highlight seimbang"
                checked={settings.hdr}
                onCheck={(c) => update({ hdr: c })}
              />

              {/* Denoise */}
              <ToggleRow
                icon={<Droplet className="size-4 text-sky-300" />}
                title="Denoise"
                desc="Reduce noise sebelum upscale (median filter)"
                checked={settings.denoise}
                onCheck={(c) => update({ denoise: c })}
              />

              {/* Sharpen */}
              <ToggleRow
                icon={<Contrast className="size-4 text-emerald-300" />}
                title="Adaptive Sharpen"
                desc="Unsharp mask untuk detail super tajam"
                checked={settings.sharpen}
                onCheck={(c) => update({ sharpen: c })}
              />

              {/* Auto enhance */}
              <ToggleRow
                icon={<Sparkles className="size-4 text-fuchsia-300" />}
                title="Auto Enhance"
                desc="Boost otomatis saturasi + kontras + brightness"
                checked={settings.enhance}
                onCheck={(c) => update({ enhance: c })}
              />

              {/* Vignette */}
              <ToggleRow
                icon={<Aperture className="size-4 text-violet-300" />}
                title="Vignette"
                desc="Pekat di tepi — kesan sinematik"
                checked={settings.vignette}
                onCheck={(c) => update({ vignette: c })}
              />
            </>
          )}

          {tab === "filter" && (
            <div className="grid grid-cols-4 gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => update({ filter: f.id })}
                  className={cn(
                    "aspect-square rounded-xl flex flex-col items-center justify-center text-[11px] font-bold transition-all",
                    settings.filter === f.id
                      ? "bg-amber-300 text-black scale-105"
                      : "bg-zinc-800 text-white/70",
                  )}
                >
                  <Palette className="size-4 mb-1" />
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {tab === "adjust" && (
            <>
              <AdjustSlider
                icon={<Sun className="size-4 text-amber-300" />}
                label="Exposure"
                value={settings.exposure}
                onValueChange={(v) => update({ exposure: v })}
              />
              <AdjustSlider
                icon={<Contrast className="size-4 text-emerald-300" />}
                label="Contrast"
                value={settings.contrast}
                onValueChange={(v) => update({ contrast: v })}
              />
              <AdjustSlider
                icon={<Droplets className="size-4 text-fuchsia-300" />}
                label="Saturation"
                value={settings.saturation}
                onValueChange={(v) => update({ saturation: v })}
              />
              <AdjustSlider
                icon={<Thermometer className="size-4 text-orange-300" />}
                label="Temperature (Warm/Cool)"
                value={settings.temperature}
                onValueChange={(v) => update({ temperature: v })}
              />
              <AdjustSlider
                icon={<Gauge className="size-4 text-sky-300" />}
                label="Zoom (Digital)"
                min={1}
                max={8}
                step={0.5}
                value={settings.zoom}
                onValueChange={(v) => update({ zoom: v })}
                showValue={(v) => `${v.toFixed(1)}×`}
              />
            </>
          )}
        </div>

        {/* Bottom quick toggles (always visible) */}
        <div className="border-t border-zinc-800 pt-4 pb-2 flex flex-wrap gap-2 justify-between">
          <QuickPill
            icon={<Grid3x3 className="size-3.5" />}
            label="Grid"
            active={settings.grid}
            onClick={() => update({ grid: !settings.grid })}
          />
          <QuickPill
            icon={<Gauge className="size-3.5" />}
            label="Level"
            active={settings.level}
            onClick={() => update({ level: !settings.level })}
          />
          <div className="flex items-center gap-1 bg-zinc-900 rounded-full p-1">
            <Timer className="size-3.5 text-white/50 ml-2" />
            {TIMERS.map((t) => (
              <button
                key={t.id}
                onClick={() => update({ timer: t.id })}
                className={cn(
                  "px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors",
                  settings.timer === t.id
                    ? "bg-amber-300 text-black"
                    : "text-white/60",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Aspect ratio */}
        <div className="mt-3 flex flex-wrap gap-2">
          {ASPECTS.map((a) => (
            <button
              key={a.id}
              onClick={() => update({ aspect: a.id })}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors",
                settings.aspect === a.id
                  ? "bg-amber-300 text-black"
                  : "bg-zinc-800 text-white/70",
              )}
            >
              <Crop className="size-3" />
              {a.label}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ToggleRow({
  icon,
  title,
  desc,
  checked,
  onCheck,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  checked: boolean;
  onCheck: (c: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-zinc-900 px-4 py-3">
      <div className="flex items-start gap-3 flex-1">
        <div className="mt-0.5">{icon}</div>
        <div>
          <Label className="text-sm font-medium">{title}</Label>
          <p className="text-[11px] text-white/50">{desc}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheck} />
    </div>
  );
}

function AdjustSlider({
  icon,
  label,
  value,
  onValueChange,
  min = -1,
  max = 1,
  step = 0.05,
  showValue,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  onValueChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  showValue?: (v: number) => string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-white/70 uppercase tracking-wider flex items-center gap-1.5">
          {icon}
          {label}
        </Label>
        <span className="text-sm font-bold text-amber-300 tabular-nums">
          {showValue ? showValue(value) : value.toFixed(2)}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onValueChange(v[0])}
      />
    </div>
  );
}

function QuickPill({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors",
        active ? "bg-amber-300 text-black" : "bg-zinc-800 text-white/70",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

interface ProcessingOverlayProps {
  visible: boolean;
  message: string;
  progress?: number;
}

export function ProcessingOverlay({
  visible,
  message,
  progress,
}: ProcessingOverlayProps) {
  if (!visible) return null;
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative size-12">
        <div className="absolute inset-0 rounded-full border-2 border-white/20" />
        <div className="absolute inset-0 rounded-full border-2 border-t-amber-300 border-transparent animate-spin" />
        {typeof progress === "number" && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-amber-300 tabular-nums">
            {Math.round(progress)}%
          </div>
        )}
      </div>
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
          : "Izinkan akses kamera untuk mulai mengambil foto super HD HEIC."}
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

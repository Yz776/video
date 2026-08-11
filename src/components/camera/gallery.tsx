"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { CaptureItem } from "./types";
import { formatBytes } from "./utils";
import {
  Download,
  Share2,
  Trash2,
  Play,
  X,
  Sparkles,
  Camera,
  Video,
  CircleDot,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface GalleryStripProps {
  items: CaptureItem[];
  onOpen: (item: CaptureItem) => void;
  onClear: () => void;
}

export function GalleryStrip({ items, onOpen, onClear }: GalleryStripProps) {
  if (items.length === 0) {
    return (
      <div className="h-12 flex items-center text-[11px] text-white/40">
        Belum ada hasil
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar h-12">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onOpen(it)}
          className="relative size-12 rounded-lg overflow-hidden flex-shrink-0 border border-white/20 active:scale-95 transition-transform"
        >
          {it.kind === "video" ? (
            <div className="size-full bg-zinc-800 flex items-center justify-center">
              <Play className="size-4 text-white fill-white" />
            </div>
          ) : (
            // For HEIC: <img> may not render on all browsers; try anyway.
            // Fall back to an icon if it errors.
            <ThumbPreview item={it} />
          )}
          {it.kind === "live" && (
            <span className="absolute top-0.5 right-0.5 px-1 rounded bg-amber-300 text-[8px] font-bold text-black">
              LIVE
            </span>
          )}
          {it.kind === "video" && (
            <span className="absolute bottom-0.5 left-0.5 px-1 rounded bg-black/60 text-[8px] font-bold text-white">
              VID
            </span>
          )}
        </button>
      ))}
      <button
        onClick={onClear}
        className="size-12 rounded-lg flex-shrink-0 bg-white/5 flex items-center justify-center active:scale-95 transition-transform"
        aria-label="Clear gallery"
      >
        <Trash2 className="size-4 text-white/60" />
      </button>
    </div>
  );
}

function ThumbPreview({ item }: { item: CaptureItem }) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <div className="size-full bg-zinc-800 flex items-center justify-center">
        <Camera className="size-4 text-white/60" />
      </div>
    );
  }
  return (
    <img
      src={item.previewUrl}
      alt="thumb"
      className="size-full object-cover"
      onError={() => setErr(true)}
    />
  );
}

interface PreviewModalProps {
  item: CaptureItem | null;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export function PreviewModal({ item, onClose, onDelete }: PreviewModalProps) {
  if (!item) return null;

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = item.downloadUrl;
    a.download = item.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleShare = async () => {
    try {
      const res = await fetch(item.downloadUrl);
      const blob = await res.blob();
      const file = new File([blob], item.filename, { type: item.mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "HEIC Cam Pro",
        });
      } else {
        handleDownload();
      }
    } catch {
      // user cancelled or share failed
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-3 bg-gradient-to-b from-black/80 to-transparent">
        <button
          onClick={onClose}
          className="size-10 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center"
          aria-label="Close"
        >
          <X className="size-5 text-white" />
        </button>
        <div className="text-center">
          <div className="text-xs text-white/60">
            {new Date(item.createdAt).toLocaleString("id-ID")}
          </div>
          <div className="text-[11px] text-white/40">
            {item.width && item.height
              ? `${item.width}×${item.height} · ${formatBytes(item.size)}`
              : formatBytes(item.size)}
          </div>
        </div>
        <button
          onClick={() => {
            onDelete(item.id);
            onClose();
          }}
          className="size-10 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center"
          aria-label="Delete"
        >
          <Trash2 className="size-5 text-red-400" />
        </button>
      </div>

      {/* Main preview */}
      <div className="flex-1 flex items-center justify-center px-4 relative">
        <PreviewContent item={item} />
      </div>

      {/* Bottom actions */}
      <div className="px-6 pt-4 pb-[max(env(safe-area-inset-bottom),2rem)] bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex items-center justify-center gap-3">
          <Button
            onClick={handleShare}
            variant="secondary"
            className="flex-1 max-w-[160px] bg-zinc-800 text-white hover:bg-zinc-700 border-0"
          >
            <Share2 className="size-4" />
            Bagikan
          </Button>
          <Button
            onClick={handleDownload}
            className="flex-1 max-w-[160px] bg-amber-300 text-black hover:bg-amber-200"
          >
            <Download className="size-4" />
            Unduh {item.ext.toUpperCase()}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PreviewContent({ item }: { item: CaptureItem }) {
  if (item.kind === "video") {
    return (
      <video
        src={item.previewUrl}
        className="max-w-full max-h-full rounded-lg"
        controls
        autoPlay
        playsInline
        loop
      />
    );
  }
  if (item.kind === "live") {
    return <LivePhotoPreview item={item} />;
  }
  // Photo
  return <PhotoPreview item={item} />;
}

function PhotoPreview({ item }: { item: CaptureItem }) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <div className="text-center space-y-3">
        <div className="size-24 mx-auto rounded-2xl bg-zinc-900 flex items-center justify-center">
          <Camera className="size-10 text-amber-300" />
        </div>
        <p className="text-sm text-white/70">
          Pratinjau tidak dapat dimuat.
        </p>
        <p className="text-xs text-white/50">
          Tetap unduh file — file HEIC asli akan tampil sempurna di galeri
          Android.
        </p>
      </div>
    );
  }
  return (
    <img
      src={item.previewUrl}
      alt={item.filename}
      className="max-w-full max-h-full object-contain rounded-lg"
      onError={() => setErr(true)}
    />
  );
}

function LivePhotoPreview({ item }: { item: CaptureItem }) {
  const [playing, setPlaying] = useState(false);
  if (playing && item.liveVideoUrl) {
    return (
      <video
        src={item.liveVideoUrl}
        className="max-w-full max-h-full rounded-lg"
        autoPlay
        playsInline
        onEnded={() => setPlaying(false)}
        controls
      />
    );
  }
  return (
    <div className="relative">
      <PhotoPreview item={item} />
      <button
        onClick={() => setPlaying(true)}
        className="absolute bottom-3 left-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-300/90 text-black text-xs font-bold active:scale-95"
      >
        <CircleDot className="size-3.5" />
        Putar Live
      </button>
    </div>
  );
}

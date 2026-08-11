"use client";

import { useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { CaptureItem, CloudFile } from "./types";
import {
  formatBytes,
  uploadToCloud,
  listCloudImages,
  deleteCloudFile,
  CLOUD_URL,
} from "./utils";
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
  Layers,
  Aperture,
  Info,
  Sun,
  Crop,
  CloudUpload,
  Cloud,
  Link2,
  ExternalLink,
  Loader2,
  Check,
  RefreshCw,
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
      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-300/15 text-[10px] text-amber-300 font-bold flex-shrink-0">
        {items.length}
      </div>
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
            <ThumbPreview item={it} />
          )}
          {it.kind === "live" && (
            <span className="absolute top-0.5 right-0.5 px-1 rounded bg-amber-300 text-[8px] font-bold text-black">
              LIVE
            </span>
          )}
          {it.kind === "burst" && (
            <span className="absolute top-0.5 right-0.5 px-1 rounded bg-sky-300 text-[8px] font-bold text-black">
              B×{it.burstCount ?? 5}
            </span>
          )}
          {it.kind === "video" && (
            <span className="absolute bottom-0.5 left-0.5 px-1 rounded bg-black/60 text-[8px] font-bold text-white">
              VID
            </span>
          )}
          {it.upscaled && (
            <span className="absolute bottom-0.5 right-0.5 px-0.5 rounded bg-emerald-500/80 text-[7px] font-bold text-white">
              HD
            </span>
          )}
          {it.cloudUrl && (
            <span
              className="absolute top-0.5 left-0.5 size-2 rounded-full bg-sky-400 shadow-[0_0_4px_rgba(56,189,248,0.8)]"
              title="Sudah di-upload ke cloud"
            />
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
  onItemUpdate?: (item: CaptureItem) => void;
}

export function PreviewModal({ item, onClose, onDelete, onItemUpdate }: PreviewModalProps) {
  const [showInfo, setShowInfo] = useState(false);
  const [uploadState, setUploadState] = useState<
    | { status: "idle" }
    | { status: "uploading" }
    | { status: "done"; url: string; hfUrl?: string | null }
    | { status: "error"; msg: string }
  >({ status: "idle" });
  const [copied, setCopied] = useState(false);

  // Reset upload state when item changes
  useEffect(() => {
    setUploadState(
      item?.cloudUrl
        ? { status: "done", url: item.cloudUrl, hfUrl: null }
        : { status: "idle" },
    );
    setCopied(false);
  }, [item?.id, item?.cloudUrl]);

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
          title: "kangwifi cam",
        });
      } else {
        handleDownload();
      }
    } catch {
      // user cancelled
    }
  };

  const handleUploadToCloud = async () => {
    setUploadState({ status: "uploading" });
    try {
      const res = await fetch(item.downloadUrl);
      const blob = await res.blob();
      const result = await uploadToCloud(blob, item.filename, item.mime);
      if (!result.success || !result.url) {
        setUploadState({
          status: "error",
          msg: result.error ?? "Upload gagal",
        });
        return;
      }
      setUploadState({
        status: "done",
        url: result.url,
        hfUrl: result.hfUrl,
      });
      // Update the capture item so the gallery thumb shows cloud badge
      if (onItemUpdate) {
        onItemUpdate({
          ...item,
          cloudUrl: result.url,
          cloudKey: result.key,
          cloudUploadedAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      setUploadState({
        status: "error",
        msg: e instanceof Error ? e.message : "Upload gagal",
      });
    }
  };

  const handleCopyLink = async () => {
    if (uploadState.status !== "done") return;
    try {
      await navigator.clipboard.writeText(uploadState.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleShareLink = async () => {
    if (uploadState.status !== "done") return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "kangwifi cam",
          text: "Foto dari kangwifi cam",
          url: uploadState.url,
        });
      } catch {
        // user cancelled
      }
    } else {
      handleCopyLink();
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
          onClick={() => setShowInfo((s) => !s)}
          className={cn(
            "size-10 rounded-full backdrop-blur-md flex items-center justify-center",
            showInfo ? "bg-amber-300 text-black" : "bg-black/50 text-white",
          )}
          aria-label="Info"
        >
          <Info className="size-5" />
        </button>
      </div>

      {/* Main preview */}
      <div className="flex-1 flex items-center justify-center px-4 relative">
        <PreviewContent item={item} />
      </div>

      {/* Cloud upload status panel */}
      {uploadState.status === "done" && (
        <div className="px-4 py-3 bg-sky-950/60 border-t border-sky-800/50 backdrop-blur-md">
          <div className="max-w-md mx-auto space-y-2">
            <div className="flex items-center gap-2 text-sky-300 text-xs font-bold">
              <Check className="size-4" />
              Berhasil di-upload ke cloud
            </div>
            <div className="flex items-center gap-1.5">
              <input
                readOnly
                value={uploadState.url}
                className="flex-1 px-2.5 py-1.5 bg-black/40 rounded-lg text-[11px] text-white/90 font-mono border border-sky-800/50"
              />
              <button
                onClick={handleCopyLink}
                className="size-8 rounded-lg bg-sky-500/20 text-sky-300 flex items-center justify-center active:scale-95"
                aria-label="Copy link"
              >
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Link2 className="size-4" />
                )}
              </button>
              <a
                href={uploadState.url}
                target="_blank"
                rel="noopener noreferrer"
                className="size-8 rounded-lg bg-sky-500/20 text-sky-300 flex items-center justify-center active:scale-95"
                aria-label="Open in new tab"
              >
                <ExternalLink className="size-4" />
              </a>
              <button
                onClick={handleShareLink}
                className="size-8 rounded-lg bg-sky-500/20 text-sky-300 flex items-center justify-center active:scale-95"
                aria-label="Share link"
              >
                <Share2 className="size-4" />
              </button>
            </div>
            <a
              href={CLOUD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-sky-400/70 hover:text-sky-300 inline-flex items-center gap-1"
            >
              <Cloud className="size-3" />
              Buka cloud.kangwifi.eu.org
            </a>
          </div>
        </div>
      )}
      {uploadState.status === "error" && (
        <div className="px-4 py-3 bg-red-950/60 border-t border-red-800/50 backdrop-blur-md">
          <div className="max-w-md mx-auto text-red-300 text-xs">
            Gagal upload: {uploadState.msg}
          </div>
        </div>
      )}

      {/* Info panel */}
      {showInfo && (
        <div className="px-4 py-3 bg-zinc-950/80 backdrop-blur-md border-t border-zinc-800">
          <InfoPanel item={item} />
        </div>
      )}

      {/* Bottom actions */}
      <div className="px-6 pt-4 pb-[max(env(safe-area-inset-bottom),2rem)] bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex items-center justify-center gap-2">
          <Button
            onClick={handleShare}
            variant="secondary"
            className="flex-1 max-w-[110px] bg-zinc-800 text-white hover:bg-zinc-700 border-0"
          >
            <Share2 className="size-4" />
            Share
          </Button>
          <Button
            onClick={handleUploadToCloud}
            disabled={uploadState.status === "uploading" || uploadState.status === "done"}
            className="flex-1 max-w-[140px] bg-sky-500 text-white hover:bg-sky-400 disabled:opacity-50"
          >
            {uploadState.status === "uploading" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Upload…
              </>
            ) : uploadState.status === "done" ? (
              <>
                <Check className="size-4" />
                Cloud
              </>
            ) : (
              <>
                <CloudUpload className="size-4" />
                Cloud
              </>
            )}
          </Button>
          <Button
            onClick={handleDownload}
            className="flex-1 max-w-[140px] bg-amber-300 text-black hover:bg-amber-200"
          >
            <Download className="size-4" />
            Unduh
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
        <p className="text-sm text-white/70">Pratinjau tidak dapat dimuat.</p>
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

function InfoPanel({ item }: { item: CaptureItem }) {
  const rows: { label: string; value: string }[] = [
    { label: "Tipe", value: kindLabel(item.kind) },
    { label: "Format", value: item.ext.toUpperCase() },
    {
      label: "Dimensi",
      value:
        item.width && item.height
          ? `${item.width} × ${item.height} px`
          : "—",
    },
    { label: "Ukuran File", value: formatBytes(item.size) },
    { label: "Dibuat", value: new Date(item.createdAt).toLocaleString("id-ID") },
    { label: "Filter", value: item.filter ? item.filter.toUpperCase() : "NONE" },
    {
      label: "Upscaled",
      value: item.upscaled ? "YA" : "TIDAK",
    },
    { label: "HDR", value: item.hdr ? "YA" : "TIDAK" },
  ];
  if (item.burstCount) {
    rows.push({ label: "Burst Count", value: String(item.burstCount) });
  }
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 max-w-md mx-auto">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-white/50">{r.label}</span>
          <span className="text-xs font-bold text-white text-right">
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function kindLabel(k: CaptureItem["kind"]): string {
  switch (k) {
    case "photo": return "Foto";
    case "video": return "Video";
    case "live": return "Live Photo";
    case "burst": return "Burst";
    case "portrait": return "Portrait";
    default: return k;
  }
}

// ============================================================
// CloudGallery — full-screen view showing all photos uploaded
// to https://cloud.kangwifi.eu.org. Fetched via /api/cloud-list.
// ============================================================

interface CloudGalleryProps {
  open: boolean;
  onClose: () => void;
}

export function CloudGallery({ open, onClose }: CloudGalleryProps) {
  const [files, setFiles] = useState<CloudFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CloudFile | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await listCloudImages();
    setLoading(false);
    if (!result.success || !result.files) {
      setError(result.error ?? "Gagal memuat cloud");
      return;
    }
    setFiles(result.files);
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleDelete = async (file: CloudFile) => {
    if (!confirm(`Hapus ${file.name} dari cloud?`)) return;
    const result = await deleteCloudFile(file.key);
    if (!result.success) {
      alert(`Gagal hapus: ${result.error}`);
      return;
    }
    setFiles((f) => f.filter((x) => x.key !== file.key));
    if (selected?.key === file.key) setSelected(null);
  };

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // ignore
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-zinc-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-3 border-b border-zinc-800">
        <button
          onClick={onClose}
          className="size-10 rounded-full bg-white/5 flex items-center justify-center"
          aria-label="Close"
        >
          <X className="size-5 text-white" />
        </button>
        <div className="text-center">
          <div className="text-sm font-bold text-white flex items-center gap-1.5 justify-center">
            <Cloud className="size-4 text-sky-400" />
            Cloud Gallery
          </div>
          <div className="text-[10px] text-white/40">
            {files.length} file · cloud.kangwifi.eu.org
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="size-10 rounded-full bg-white/5 flex items-center justify-center disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={cn("size-5 text-white", loading && "animate-spin")} />
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {error && (
          <div className="text-center text-red-400 text-sm py-8">{error}</div>
        )}
        {!error && !loading && files.length === 0 && (
          <div className="text-center text-white/40 text-sm py-12">
            <Cloud className="size-12 mx-auto mb-3 opacity-30" />
            <p>Belum ada foto di cloud.</p>
            <p className="text-xs mt-1 text-white/30">
              Upload foto dari galeri, lalu refresh di sini.
            </p>
          </div>
        )}
        {files.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5">
            {files.map((f) => (
              <CloudThumb
                key={f.key}
                file={f}
                onClick={() => setSelected(f)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer link */}
      <div className="px-4 py-3 border-t border-zinc-800 text-center">
        <a
          href={CLOUD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-sky-400/70 hover:text-sky-300 inline-flex items-center gap-1"
        >
          <ExternalLink className="size-3" />
          Buka cloud.kangwifi.eu.org
        </a>
      </div>

      {/* Detail modal */}
      {selected && (
        <CloudFileDetail
          file={selected}
          onClose={() => setSelected(null)}
          onDelete={() => handleDelete(selected)}
          onCopyUrl={() => handleCopyUrl(selected.url)}
        />
      )}
    </div>
  );
}

function CloudThumb({
  file,
  onClick,
}: {
  file: CloudFile;
  onClick: () => void;
}) {
  const [err, setErr] = useState(false);
  // HEIC files can't be rendered in <img>, so we just show an icon
  const isHeic = /\.heic?$/i.test(file.name) || file.mime === "image/heic";
  return (
    <button
      onClick={onClick}
      className="relative aspect-square rounded-lg overflow-hidden bg-zinc-900 border border-white/10 active:scale-95 transition-transform"
    >
      {isHeic || err ? (
        <div className="size-full flex flex-col items-center justify-center p-1">
          <Aperture className="size-6 text-amber-300" />
          <span className="text-[8px] text-white/60 mt-1 truncate w-full text-center">
            {file.name.split(".").pop()?.toUpperCase()}
          </span>
        </div>
      ) : (
        <img
          src={file.url}
          alt={file.name}
          loading="lazy"
          className="size-full object-cover"
          onError={() => setErr(true)}
        />
      )}
      {file.status === "cloud" && (
        <span className="absolute top-1 left-1 px-1 rounded bg-emerald-500/80 text-[7px] font-bold text-white">
          HF
        </span>
      )}
      <span className="absolute bottom-0 inset-x-0 px-1 py-0.5 bg-black/60 text-[8px] text-white/80 truncate text-center">
        {new Date(file.createdAt).toLocaleDateString("id-ID", {
          day: "numeric",
          month: "short",
        })}
      </span>
    </button>
  );
}

function CloudFileDetail({
  file,
  onClose,
  onDelete,
  onCopyUrl,
}: {
  file: CloudFile;
  onClose: () => void;
  onDelete: () => void;
  onCopyUrl: () => void;
}) {
  const isHeic = /\.heic?$/i.test(file.name) || file.mime === "image/heic";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await onCopyUrl();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-3 bg-gradient-to-b from-black/80 to-transparent">
        <button
          onClick={onClose}
          className="size-10 rounded-full bg-black/50 flex items-center justify-center"
          aria-label="Close"
        >
          <X className="size-5 text-white" />
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
          onClick={onDelete}
          className="size-10 rounded-full bg-red-500/20 flex items-center justify-center"
          aria-label="Delete"
        >
          <Trash2 className="size-5 text-red-400" />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center px-4">
        {isHeic ? (
          <div className="text-center space-y-3">
            <div className="size-24 mx-auto rounded-2xl bg-zinc-900 flex items-center justify-center">
              <Aperture className="size-10 text-amber-300" />
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
            {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
          </button>
          <a
            href={file.url}
            target="_blank"
            rel="noopener noreferrer"
            className="size-8 rounded-lg bg-sky-500/20 text-sky-300 flex items-center justify-center"
            aria-label="Open in new tab"
          >
            <ExternalLink className="size-4" />
          </a>
          <a
            href={file.url}
            download={file.name}
            className="size-8 rounded-lg bg-amber-300/20 text-amber-300 flex items-center justify-center"
            aria-label="Download"
          >
            <Download className="size-4" />
          </a>
        </div>
      </div>
    </div>
  );
}

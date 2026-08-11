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

// ============================================================
// CloudStrip — horizontal strip showing the N most-recent files
// from the cloud (https://cloud.kangwifi.eu.org). Replaces the old
// local GalleryStrip. 100% cloud: no local blob URLs are kept
// after capture — photos go straight to cloud and are listed here.
// ============================================================

interface CloudStripProps {
  files: CloudFile[];
  loading: boolean;
  onOpen: (file: CloudFile) => void;
  onOpenCloud: () => void;
  onRefresh: () => void;
}

export function CloudStrip({
  files,
  loading,
  onOpen,
  onOpenCloud,
  onRefresh,
}: CloudStripProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar h-12">
      <button
        onClick={onOpenCloud}
        className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-sky-500/15 text-sky-300 text-[10px] font-bold flex-shrink-0 active:scale-95 transition-transform"
        aria-label="Buka cloud gallery"
      >
        <Cloud className="size-3" />
        {files.length > 0 ? files.length : "—"}
      </button>

      {loading && files.length === 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-white/40">
          <Loader2 className="size-3 animate-spin" />
          Memuat cloud…
        </div>
      )}

      {!loading && files.length === 0 && (
        <div className="text-[11px] text-white/40">
          Belum ada foto di cloud — capture untuk mulai
        </div>
      )}

      {files.slice(0, 10).map((f) => (
        <CloudStripThumb key={f.key} file={f} onClick={() => onOpen(f)} />
      ))}

      {files.length > 0 && (
        <button
          onClick={onRefresh}
          disabled={loading}
          className="size-12 rounded-lg flex-shrink-0 bg-white/5 flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
          aria-label="Refresh cloud"
        >
          <RefreshCw className={cn("size-4 text-white/60", loading && "animate-spin")} />
        </button>
      )}
    </div>
  );
}

function CloudStripThumb({
  file,
  onClick,
}: {
  file: CloudFile;
  onClick: () => void;
}) {
  const [err, setErr] = useState(false);
  const isHeic = /\.heic?$/i.test(file.name) || file.mime === "image/heic";
  const isVideo = /^video\//i.test(file.mime ?? "") || /\.(webm|mp4|mov)$/i.test(file.name);
  return (
    <button
      onClick={onClick}
      className="relative size-12 rounded-lg overflow-hidden flex-shrink-0 border border-white/20 active:scale-95 transition-transform bg-zinc-900"
      aria-label={file.name}
    >
      {isHeic || err || isVideo ? (
        <div className="size-full flex items-center justify-center">
          {isVideo ? (
            <Play className="size-4 text-white fill-white" />
          ) : (
            <Aperture className="size-4 text-amber-300" />
          )}
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
      <span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-sky-400 shadow-[0_0_4px_rgba(56,189,248,0.8)]" />
    </button>
  );
}

// ============================================================
// JustCapturedModal — shows immediately after a capture is
// processed AND uploaded to cloud. Displays the local blob
// preview (still in memory at this point), the cloud URL,
// and quick actions: share link / copy / open cloud / dismiss.
// Once dismissed, the local blob URL is revoked — no local
// gallery state remains.
// ============================================================

export interface JustCapturedInfo {
  id: string;
  previewUrl: string; // blob URL of JPEG preview (or HEIC if no preview)
  downloadUrl: string; // blob URL of HEIC file
  filename: string;
  mime: string;
  width?: number;
  height?: number;
  size: number;
  cloudUrl: string;
  cloudKey?: string;
  hfUrl?: string | null;
  kind: CaptureItem["kind"];
  burstCount?: number;
}

interface JustCapturedModalProps {
  info: JustCapturedInfo | null;
  onClose: () => void;
  onOpenCloud: () => void;
}

export function JustCapturedModal({
  info,
  onClose,
  onOpenCloud,
}: JustCapturedModalProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!info) {
      setCopied(false);
    }
  }, [info]);

  if (!info) return null;

  const isVideo = info.kind === "video";
  const isLive = info.kind === "live";

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = info.downloadUrl;
    a.download = info.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleShareFile = async () => {
    try {
      const res = await fetch(info.downloadUrl);
      const blob = await res.blob();
      const file = new File([blob], info.filename, { type: info.mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "kangwifi cam" });
      } else {
        handleDownload();
      }
    } catch {
      // user cancelled
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(info.cloudUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleShareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "kangwifi cam",
          text: "Foto dari kangwifi cam",
          url: info.cloudUrl,
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
          <div className="text-xs font-bold text-sky-300 flex items-center gap-1 justify-center">
            <Check className="size-3.5" />
            Tersimpan di Cloud
          </div>
          <div className="text-[11px] text-white/40">
            {info.width && info.height
              ? `${info.width}×${info.height} · ${formatBytes(info.size)}`
              : formatBytes(info.size)}
          </div>
        </div>
        <button
          onClick={onOpenCloud}
          className="size-10 rounded-full bg-sky-500/20 flex items-center justify-center"
          aria-label="Open cloud gallery"
        >
          <Cloud className="size-5 text-sky-300" />
        </button>
      </div>

      {/* Main preview */}
      <div className="flex-1 flex items-center justify-center px-4 relative">
        {isVideo ? (
          <video
            src={info.previewUrl}
            className="max-w-full max-h-full rounded-lg"
            controls
            autoPlay
            playsInline
            loop
          />
        ) : (
          <JustCapturedPreview info={info} />
        )}
      </div>

      {/* Cloud URL panel */}
      <div className="px-4 py-3 bg-sky-950/60 border-t border-sky-800/50 backdrop-blur-md">
        <div className="max-w-md mx-auto space-y-2">
          <div className="flex items-center gap-2 text-sky-300 text-xs font-bold">
            <Check className="size-4" />
            Berhasil di-upload ke cloud
          </div>
          <div className="flex items-center gap-1.5">
            <input
              readOnly
              value={info.cloudUrl}
              className="flex-1 px-2.5 py-1.5 bg-black/40 rounded-lg text-[11px] text-white/90 font-mono border border-sky-800/50"
            />
            <button
              onClick={handleCopyLink}
              className="size-8 rounded-lg bg-sky-500/20 text-sky-300 flex items-center justify-center active:scale-95"
              aria-label="Copy link"
            >
              {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
            </button>
            <a
              href={info.cloudUrl}
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

      {/* Bottom actions */}
      <div className="px-6 pt-4 pb-[max(env(safe-area-inset-bottom),2rem)] bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex items-center justify-center gap-2">
          <Button
            onClick={handleShareFile}
            variant="secondary"
            className="flex-1 max-w-[110px] bg-zinc-800 text-white hover:bg-zinc-700 border-0"
          >
            <Share2 className="size-4" />
            Share
          </Button>
          <Button
            onClick={handleDownload}
            className="flex-1 max-w-[140px] bg-amber-300 text-black hover:bg-amber-200"
          >
            <Download className="size-4" />
            Unduh
          </Button>
          <Button
            onClick={onClose}
            className="flex-1 max-w-[140px] bg-sky-500 text-white hover:bg-sky-400"
          >
            <Check className="size-4" />
            Selesai
          </Button>
        </div>
      </div>
    </div>
  );
}

function JustCapturedPreview({ info }: { info: JustCapturedInfo }) {
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
      src={info.previewUrl}
      alt={info.filename}
      className="max-w-full max-h-full object-contain rounded-lg"
      onError={() => setErr(true)}
    />
  );
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
              Capture foto untuk langsung upload ke cloud.
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
  const isVideo = /^video\//i.test(file.mime ?? "") || /\.(webm|mp4|mov)$/i.test(file.name);
  return (
    <button
      onClick={onClick}
      className="relative aspect-square rounded-lg overflow-hidden bg-zinc-900 border border-white/10 active:scale-95 transition-transform"
    >
      {isHeic || isVideo || err ? (
        <div className="size-full flex flex-col items-center justify-center p-1">
          {isVideo ? (
            <Play className="size-6 text-white fill-white" />
          ) : (
            <Aperture className="size-6 text-amber-300" />
          )}
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
  const isVideo = /^video\//i.test(file.mime ?? "") || /\.(webm|mp4|mov)$/i.test(file.name);
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

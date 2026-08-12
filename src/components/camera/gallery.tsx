"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { CaptureItem, CloudFile } from "./types";
import {
  formatBytes,
  listCloudImagesWithLocalFallback,
  deleteCloudFile,
  getLocalBlobUrl,
  isLocalFileUrl,
  parseLocalFileId,
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

/**
 * Hook that resolves a CloudFile's display URL.
 *
 * For cloud files: returns file.url directly (a real https URL).
 * For local-only files (url starts with "local:"): loads the previewBlob
 * from IndexedDB and returns a blob: URL. The blob URL is revoked on
 * unmount or when the file changes.
 *
 * Returns { url, loading } — caller should show a placeholder while loading.
 */
function useFileUrl(file: CloudFile): { url: string | null; loading: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Revoke any previous blob URL
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setLoading(true);
    setUrl(null);

    async function resolve() {
      if (isLocalFileUrl(file.url)) {
        const localId = parseLocalFileId(file.url);
        if (!localId) {
          if (!cancelled) setLoading(false);
          return;
        }
        const blobUrl = await getLocalBlobUrl(localId, "preview");
        if (cancelled) {
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          return;
        }
        if (blobUrl) blobUrlRef.current = blobUrl;
        setUrl(blobUrl);
      } else {
        setUrl(file.url);
      }
      setLoading(false);
    }

    resolve();

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [file.url]);

  return { url, loading };
}

function CloudStripThumb({
  file,
  onClick,
}: {
  file: CloudFile;
  onClick: () => void;
}) {
  const { url, loading } = useFileUrl(file);
  const [err, setErr] = useState(false);
  const isHeic = /\.heic?$/i.test(file.name) || file.mime === "image/heic";
  const isVideo = /^video\//i.test(file.mime ?? "") || /\.(webm|mp4|mov)$/i.test(file.name);
  const isLocal = isLocalFileUrl(file.url);
  return (
    <button
      onClick={onClick}
      className="relative size-12 rounded-lg overflow-hidden flex-shrink-0 border border-white/20 active:scale-95 transition-transform bg-zinc-900"
      aria-label={file.name}
    >
      {isHeic || err || isVideo || loading || !url ? (
        <div className="size-full flex items-center justify-center">
          {isVideo ? (
            <Play className="size-4 text-white fill-white" />
          ) : (
            <Aperture className="size-4 text-amber-300" />
          )}
        </div>
      ) : (
        <img
          src={url}
          alt={file.name}
          loading="lazy"
          className="size-full object-cover"
          onError={() => setErr(true)}
        />
      )}
      <span
        className={cn(
          "absolute top-0.5 right-0.5 size-2 rounded-full shadow-[0_0_4px_rgba(56,189,248,0.8)]",
          isLocal ? "bg-amber-400" : "bg-sky-400",
        )}
        title={isLocal ? "Tersimpan lokal" : "Tersimpan di cloud"}
      />
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
  /** Public cloud URL — undefined when cloud upload failed (local-only). */
  cloudUrl?: string;
  cloudKey?: string;
  hfUrl?: string | null;
  /** True if cloud upload succeeded; false if local-only. */
  cloudUploaded: boolean;
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
    if (!info.cloudUrl) return;
    try {
      await navigator.clipboard.writeText(info.cloudUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleShareLink = async () => {
    if (!info.cloudUrl) {
      // No cloud link — fall back to sharing the file directly
      handleShareFile();
      return;
    }
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

  const isCloudUploaded = info.cloudUploaded && !!info.cloudUrl;

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
          {isCloudUploaded ? (
            <div className="text-xs font-bold text-sky-300 flex items-center gap-1 justify-center">
              <Check className="size-3.5" />
              Tersimpan di Cloud
            </div>
          ) : (
            <div className="text-xs font-bold text-amber-300 flex items-center gap-1 justify-center">
              <Check className="size-3.5" />
              Tersimpan Lokal
            </div>
          )}
          <div className="text-[11px] text-white/40">
            {info.width && info.height
              ? `${info.width}×${info.height} · ${formatBytes(info.size)}`
              : formatBytes(info.size)}
          </div>
        </div>
        <button
          onClick={onOpenCloud}
          className={cn(
            "size-10 rounded-full flex items-center justify-center",
            isCloudUploaded ? "bg-sky-500/20" : "bg-amber-500/20",
          )}
          aria-label="Open gallery"
        >
          <Cloud className={cn("size-5", isCloudUploaded ? "text-sky-300" : "text-amber-300")} />
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

      {/* Cloud URL panel — only show when cloud upload succeeded */}
      {isCloudUploaded ? (
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
      ) : (
        // Local-only panel — shown when cloud upload failed
        <div className="px-4 py-3 bg-amber-950/60 border-t border-amber-800/50 backdrop-blur-md">
          <div className="max-w-md mx-auto space-y-2">
            <div className="flex items-center gap-2 text-amber-300 text-xs font-bold">
              <Cloud className="size-4" />
              Cloud sedang offline
            </div>
            <p className="text-[11px] text-amber-200/80 leading-relaxed">
              Foto disimpan lokal di perangkat ini. Tetap bisa diunduh atau
              dibagikan. Akan otomatis tersinkron ke cloud saat koneksi pulih.
            </p>
          </div>
        </div>
      )}

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
    const result = await listCloudImagesWithLocalFallback();
    setLoading(false);
    if (!result.success || !result.files) {
      setError(result.error ?? "Gagal memuat cloud");
      return;
    }
    setFiles(result.files);
    if (result.source === "local") {
      console.info(
        "[gallery] cloud unreachable — showing local IndexedDB gallery",
        result.error ? `(${result.error})` : "",
      );
    }
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
  const { url, loading } = useFileUrl(file);
  const [err, setErr] = useState(false);
  // HEIC files can't be rendered in <img>, so we just show an icon.
  // But local HEIC records DO have a previewBlob (JPEG) — so we can still
  // render a thumbnail via the useFileUrl hook (which uses previewBlob).
  // Only treat as "no-preview HEIC" when it's a cloud HEIC (no preview URL).
  const isHeic = /\.heic?$/i.test(file.name) || file.mime === "image/heic";
  const isVideo = /^video\//i.test(file.mime ?? "") || /\.(webm|mp4|mov)$/i.test(file.name);
  const isLocal = isLocalFileUrl(file.url);
  // For local HEIC files, we DO have a JPEG preview via useFileUrl.
  // For cloud HEIC files, we can't render them in <img>.
  const showHeicIcon = isHeic && !isLocal;
  return (
    <button
      onClick={onClick}
      className="relative aspect-square rounded-lg overflow-hidden bg-zinc-900 border border-white/10 active:scale-95 transition-transform"
    >
      {showHeicIcon || isVideo || err || loading || !url ? (
        <div className="size-full flex flex-col items-center justify-center p-1">
          {isVideo ? (
            <Play className="size-6 text-white fill-white" />
          ) : loading ? (
            <Loader2 className="size-5 text-white/40 animate-spin" />
          ) : (
            <Aperture className="size-6 text-amber-300" />
          )}
          <span className="text-[8px] text-white/60 mt-1 truncate w-full text-center">
            {file.name.split(".").pop()?.toUpperCase()}
          </span>
        </div>
      ) : (
        <img
          src={url}
          alt={file.name}
          loading="lazy"
          className="size-full object-cover"
          onError={() => setErr(true)}
        />
      )}
      {file.status === "cloud" && !isLocal && (
        <span className="absolute top-1 left-1 px-1 rounded bg-emerald-500/80 text-[7px] font-bold text-white">
          HF
        </span>
      )}
      {isLocal && (
        <span className="absolute top-1 left-1 px-1 rounded bg-amber-500/80 text-[7px] font-bold text-white">
          LOKAL
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
  const isLocal = isLocalFileUrl(file.url);
  const [copied, setCopied] = useState(false);
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [fullLoading, setFullLoading] = useState(true);
  const fullUrlRef = useRef<string | null>(null);

  // Load the full-blob URL for preview & download. For cloud files,
  // this is just file.url. For local files, we fetch the full blob from IDB.
  useEffect(() => {
    let cancelled = false;
    if (fullUrlRef.current) {
      URL.revokeObjectURL(fullUrlRef.current);
      fullUrlRef.current = null;
    }
    setFullLoading(true);
    setFullUrl(null);

    async function resolveFull() {
      if (isLocal) {
        const localId = parseLocalFileId(file.url);
        if (!localId) {
          if (!cancelled) setFullLoading(false);
          return;
        }
        const blobUrl = await getLocalBlobUrl(localId, "full");
        if (cancelled) {
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          return;
        }
        if (blobUrl) fullUrlRef.current = blobUrl;
        setFullUrl(blobUrl);
      } else {
        setFullUrl(file.url);
      }
      setFullLoading(false);
    }

    resolveFull();

    return () => {
      cancelled = true;
      if (fullUrlRef.current) {
        URL.revokeObjectURL(fullUrlRef.current);
        fullUrlRef.current = null;
      }
    };
  }, [file.url, isLocal]);

  const copy = async () => {
    await onCopyUrl();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownload = () => {
    if (!fullUrl) return;
    const a = document.createElement("a");
    a.href = fullUrl;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleShare = async () => {
    if (!fullUrl) return;
    try {
      const res = await fetch(fullUrl);
      const blob = await res.blob();
      const f = new File([blob], file.name, { type: file.mime ?? "application/octet-stream" });
      if (navigator.canShare && navigator.canShare({ files: [f] })) {
        await navigator.share({ files: [f], title: "kangwifi cam" });
      } else {
        handleDownload();
      }
    } catch {
      // user cancelled
    }
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
        {fullLoading ? (
          <div className="flex items-center gap-2 text-white/60 text-sm">
            <Loader2 className="size-5 animate-spin" />
            Memuat…
          </div>
        ) : isVideo ? (
          <video
            src={fullUrl ?? undefined}
            className="max-w-full max-h-full rounded-lg"
            controls
            playsInline
          />
        ) : isHeic && !isLocal ? (
          // Cloud HEIC files can't be previewed in browser <img>
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
            src={fullUrl ?? undefined}
            alt={file.name}
            className="max-w-full max-h-full object-contain rounded-lg"
          />
        )}
      </div>

      <div className="px-4 py-3 bg-zinc-950/80 border-t border-zinc-800 space-y-2">
        {isLocal ? (
          // Local-only file: no public URL — show download/share instead
          <div className="flex items-center gap-2">
            <div className="flex-1 px-2.5 py-1.5 bg-amber-500/10 rounded-lg text-[11px] text-amber-300 font-mono border border-amber-800/50 truncate">
              Tersimpan lokal di perangkat ini
            </div>
            <button
              onClick={handleShare}
              disabled={!fullUrl}
              className="size-8 rounded-lg bg-sky-500/20 text-sky-300 flex items-center justify-center disabled:opacity-50"
              aria-label="Share"
            >
              <Share2 className="size-4" />
            </button>
            <button
              onClick={handleDownload}
              disabled={!fullUrl}
              className="size-8 rounded-lg bg-amber-300/20 text-amber-300 flex items-center justify-center disabled:opacity-50"
              aria-label="Download"
            >
              <Download className="size-4" />
            </button>
          </div>
        ) : (
          // Cloud file: show URL + copy/open/download
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
            <button
              onClick={handleDownload}
              className="size-8 rounded-lg bg-amber-300/20 text-amber-300 flex items-center justify-center"
              aria-label="Download"
            >
              <Download className="size-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

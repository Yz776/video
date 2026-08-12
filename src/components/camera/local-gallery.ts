/**
 * IndexedDB-backed local gallery store.
 *
 * Why IndexedDB instead of localStorage?
 *   - localStorage is synchronous and caps at ~5MB per origin — not enough
 *     for storing image/video blobs (a single HEIC can be 2-5MB, a 10s
 *     video clip easily 20MB+).
 *   - IndexedDB is asynchronous, can store Blobs directly (no base64 round-trip
 *     that doubles size), and has per-origin quota in the hundreds of MB
 *     to multiple GB range depending on browser.
 *
 * Storage layout:
 *   DB: "kangwifi-cam"
 *   Object store: "gallery" (keyPath: "id")
 *     Record shape: LocalGalleryRecord (see below)
 *
 * Each record stores:
 *   - id:           unique per capture (uuid)
 *   - deviceId:     which device captured this (for per-device filtering)
 *   - kind:         "photo" | "video" | "live"
 *   - mime:         mime type of the main file
 *   - filename:     original filename
 *   - width/height: dimensions
 *   - size:         byte size of main blob
 *   - blob:          main file blob (HEIC photo or MP4 video)
 *   - previewBlob:   JPEG preview blob (photos only, null for videos)
 *   - cloudUrl:     public cloud URL after upload (null if upload failed)
 *   - cloudKey:     cloud file key (for delete)
 *   - hfUrl:        HuggingFace mirror URL (if any)
 *   - cloudStatus:  "uploaded" | "local_only" | "pending"
 *   - createdAt:    unix ms timestamp
 *
 * The cloud URL is stored so that if the cloud is reachable later, the
 * user can still share/download via the cloud link; but if cloud is down,
 * the local blob is used for preview/share instead.
 */

const DB_NAME = "kangwifi-cam";
const DB_VERSION = 1;
const STORE_NAME = "gallery";

export type CloudStatus = "uploaded" | "local_only" | "pending";
export type CaptureKind = "photo" | "video" | "live";

export interface LocalGalleryRecord {
  id: string;
  deviceId: string;
  kind: CaptureKind;
  mime: string;
  filename: string;
  width?: number;
  height?: number;
  size: number;
  blob: Blob;
  previewBlob: Blob | null;
  cloudUrl: string | null;
  cloudKey: string | null;
  hfUrl: string | null;
  cloudStatus: CloudStatus;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open (or create) the IndexedDB database.
 * Cached as a singleton — opening a new connection per request is wasteful
 * and can hit browser connection limits.
 */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable in this environment"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        // Index by deviceId for per-device filtering
        store.createIndex("deviceId", "deviceId", { unique: false });
        // Index by createdAt for sorted listing
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"));
  });

  return dbPromise;
}

/**
 * Save a capture to the local gallery.
 *
 * Called from uploadCapture() in camera-app.tsx after every successful
 * photo/video capture — regardless of whether the cloud upload succeeded
 * or failed. This ensures the user's captures are never lost even if the
 * cloud goes down.
 *
 * If a record with the same id already exists, it will be overwritten.
 */
export async function saveToLocalGallery(
  record: LocalGalleryRecord,
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error("IDB put failed"));
    });
  } catch (err) {
    // Don't throw — saving to local gallery is best-effort.
    // If IDB is full or unavailable, the capture still succeeds via cloud.
    console.warn("[local-gallery] save failed:", err);
  }
}

/**
 * List all local gallery records for a specific device, newest first.
 *
 * Used by listCloudImages() as a fallback when the cloud is unreachable,
 * and as the primary source when cloud.kangwifi.eu.org is in 403 mode.
 */
export async function listLocalGallery(
  deviceId: string,
): Promise<LocalGalleryRecord[]> {
  try {
    const db = await openDb();
    return await new Promise<LocalGalleryRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const idx = store.index("deviceId");
      const req = idx.getAll(IDBKeyRange.only(deviceId));
      req.onsuccess = () => {
        const records = (req.result as LocalGalleryRecord[]) ?? [];
        // Sort by createdAt descending (newest first)
        records.sort((a, b) => b.createdAt - a.createdAt);
        resolve(records);
      };
      req.onerror = () => reject(req.error ?? new Error("IDB getAll failed"));
    });
  } catch (err) {
    console.warn("[local-gallery] list failed:", err);
    return [];
  }
}

/**
 * Get a single record by id (for detail view / share).
 */
export async function getLocalGalleryRecord(
  id: string,
): Promise<LocalGalleryRecord | null> {
  try {
    const db = await openDb();
    return await new Promise<LocalGalleryRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve((req.result as LocalGalleryRecord) ?? null);
      req.onerror = () => reject(req.error ?? new Error("IDB get failed"));
    });
  } catch (err) {
    console.warn("[local-gallery] get failed:", err);
    return null;
  }
}

/**
 * Delete a record by id. Also returns the deleted record so the caller
 * can revoke any blob URLs that were created from it.
 */
export async function deleteFromLocalGallery(
  id: string,
): Promise<LocalGalleryRecord | null> {
  try {
    const db = await openDb();
    const existing = await getLocalGalleryRecord(id);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error("IDB delete failed"));
    });
    return existing;
  } catch (err) {
    console.warn("[local-gallery] delete failed:", err);
    return null;
  }
}

/**
 * Update an existing record (partial update via merge).
 * Used to set cloudUrl/cloudKey after a delayed upload succeeds, or to
 * mark a record as "uploaded" after a retry.
 */
export async function updateLocalGalleryRecord(
  id: string,
  patch: Partial<LocalGalleryRecord>,
): Promise<void> {
  try {
    const existing = await getLocalGalleryRecord(id);
    if (!existing) return;
    const updated: LocalGalleryRecord = { ...existing, ...patch };
    await saveToLocalGallery(updated);
  } catch (err) {
    console.warn("[local-gallery] update failed:", err);
  }
}

/**
 * Approximate storage usage. Returns { usageBytes, quotaBytes } in bytes.
 * Useful for showing a "storage full" warning before the user captures
 * a large video that would fail to save.
 *
 * Returns zeros if the Storage API is unavailable (older browsers).
 */
export async function getLocalGalleryStorageEstimate(): Promise<{
  usageBytes: number;
  quotaBytes: number;
}> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return { usageBytes: 0, quotaBytes: 0 };
  }
  try {
    const est = await navigator.storage.estimate();
    return {
      usageBytes: est.usage ?? 0,
      quotaBytes: est.quota ?? 0,
    };
  } catch {
    return { usageBytes: 0, quotaBytes: 0 };
  }
}

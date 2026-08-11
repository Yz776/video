import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CLOUD_BASE = "https://cloud.kangwifi.eu.org";

/**
 * List files from cloud. Optional ?prefix= filter to only return
 * files matching a prefix (e.g. "kangwifi-").
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const prefix = url.searchParams.get("prefix") ?? "";
    const onlyImages = url.searchParams.get("images") === "1";

    const res = await fetch(`${CLOUD_BASE}/files`, {
      // No cache — we want fresh list every time
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: `Cloud error ${res.status}` },
        { status: 502 },
      );
    }
    const data = await res.json();
    let files = data.files ?? [];
    if (prefix) {
      files = files.filter((f: { name?: string; key?: string }) =>
        (f.name ?? f.key ?? "").startsWith(prefix),
      );
    }
    if (onlyImages) {
      files = files.filter((f: { mime?: string; name?: string }) => {
        const mime = f.mime ?? "";
        const name = f.name ?? "";
        return (
          mime.startsWith("image/") ||
          /\.(heic|heif|jpg|jpeg|png|webp|gif)$/i.test(name)
        );
      });
    }
    return NextResponse.json({
      success: true,
      files,
      total: files.length,
      totalSize: data.total_size ?? 0,
      totalSizeHuman: data.total_size_human ?? "0 B",
    });
  } catch (err) {
    console.error("[/api/cloud-list] Error:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

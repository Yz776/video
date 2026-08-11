import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CLOUD_BASE = "https://cloud.kangwifi.eu.org";

/**
 * Delete a file from cloud by key.
 */
export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (!key) {
      return NextResponse.json(
        { success: false, error: "Missing key parameter" },
        { status: 400 },
      );
    }

    const res = await fetch(
      `${CLOUD_BASE}/file/${encodeURIComponent(key)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return NextResponse.json(
        { success: false, error: `Cloud error ${res.status}: ${txt.slice(0, 200)}` },
        { status: 502 },
      );
    }
    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ success: true, deleted: data.deleted ?? true });
  } catch (err) {
    console.error("[/api/cloud-delete] Error:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

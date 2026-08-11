import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CLOUD_BASE = "https://cloud.kangwifi.eu.org";

/**
 * Proxy upload to https://cloud.kangwifi.eu.org/upload
 *
 * Why a proxy instead of client-side fetch?
 *   1. CORS — the cloud server may not send Access-Control-Allow-Origin
 *      for our app origin, so browser fetch would be blocked.
 *   2. The cloud server is a public file host with no auth — we don't
 *      need to leak any credentials to the client.
 *
 * Returns: { success, url, key, name, size, hf_url }
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json(
        { success: false, error: "No file provided" },
        { status: 400 },
      );
    }

    // Forward to cloud
    const fd = new FormData();
    fd.append("file", file, file.name);

    const res = await fetch(`${CLOUD_BASE}/upload`, {
      method: "POST",
      body: fd,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "Upload failed");
      return NextResponse.json(
        { success: false, error: `Cloud error ${res.status}: ${txt.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    const uploaded = data.uploaded?.[0];
    if (!uploaded) {
      return NextResponse.json(
        { success: false, error: "Cloud returned no uploaded file" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      key: uploaded.key,
      name: uploaded.name,
      url: uploaded.url ?? `${CLOUD_BASE}/file/${encodeURIComponent(uploaded.key)}`,
      hfUrl: uploaded.hf_url ?? null,
      size: uploaded.size,
      sizeHuman: uploaded.size_human,
      status: uploaded.status,
      cloudPage: `${CLOUD_BASE}/`,
    });
  } catch (err) {
    console.error("[/api/cloud-upload] Error:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

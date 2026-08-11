// Test the /api/process endpoint with a synthetic image
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

(async () => {
  // 1. Generate a test image (1280x720 gradient with some detail)
  const testBuf = await sharp({
    create: {
      width: 1280,
      height: 720,
      channels: 3,
      background: { r: 50, g: 80, b: 140 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#FF6B6B"/>
                <stop offset="50%" stop-color="#FFD93D"/>
                <stop offset="100%" stop-color="#6BCB77"/>
              </linearGradient>
            </defs>
            <rect width="1280" height="720" fill="url(#g)"/>
            <circle cx="640" cy="360" r="180" fill="white" opacity="0.8"/>
            <text x="640" y="370" font-size="80" font-family="sans-serif" text-anchor="middle" fill="black" font-weight="bold">HEIC TEST</text>
          </svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();

  // 2. Send to API
  const form = new FormData();
  form.append("file", new Blob([testBuf], { type: "image/jpeg" }), "test.jpg");
  form.append("upscale", "2");
  form.append("quality", "95");
  form.append("sharpen", "1");
  form.append("enhance", "1");
  form.append("preview", "1");

  console.log("Sending 1280x720 JPEG to /api/process...");
  const t0 = Date.now();
  const res = await fetch("http://localhost:3000/api/process", {
    method: "POST",
    body: form,
  });
  const dt = Date.now() - t0;

  console.log(`Status: ${res.status} (${dt}ms)`);
  if (!res.ok) {
    console.error("Body:", await res.text());
    process.exit(1);
  }

  const data = await res.json();
  console.log("Response metadata:", {
    width: data.width,
    height: data.height,
    originalWidth: data.originalWidth,
    originalHeight: data.originalHeight,
    heicBytes: data.heic ? Math.round(data.heic.length * 0.75) : 0,
    previewBytes: data.preview ? Math.round(data.preview.length * 0.75) : 0,
  });

  // 3. Save outputs for inspection
  const outDir = "/home/z/my-project/download";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "test-output.heic"),
    Buffer.from(data.heic, "base64"),
  );
  fs.writeFileSync(
    path.join(outDir, "test-preview.jpg"),
    Buffer.from(data.preview, "base64"),
  );
  console.log(`\nSaved: ${outDir}/test-output.heic (HEIC super HD)`);
  console.log(`Saved: ${outDir}/test-preview.jpg (JPEG preview)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

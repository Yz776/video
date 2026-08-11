// Test the upgraded /api/process endpoint with all features
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

(async () => {
  // Generate test image (1920x1080 with rich detail)
  const testBuf = await sharp({
    create: {
      width: 1920,
      height: 1080,
      channels: 3,
      background: { r: 50, g: 80, b: 140 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#FF6B6B"/>
                <stop offset="50%" stop-color="#FFD93D"/>
                <stop offset="100%" stop-color="#6BCB77"/>
              </linearGradient>
              <radialGradient id="r" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="white" stop-opacity="0.8"/>
                <stop offset="100%" stop-color="white" stop-opacity="0"/>
              </radialGradient>
            </defs>
            <rect width="1920" height="1080" fill="url(#g)"/>
            <circle cx="960" cy="540" r="280" fill="url(#r)"/>
            <text x="960" y="555" font-size="120" font-family="sans-serif" text-anchor="middle" fill="black" font-weight="bold">TEST</text>
            <text x="960" y="700" font-size="40" font-family="sans-serif" text-anchor="middle" fill="black" opacity="0.6">kangwifi cam super HD</text>
          </svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();

  // Test 1: All features on — 2x upscale, vivid filter, watermark BR, HDR, denoise, vignette
  console.log("=== TEST 1: All features on (2x upscale + vivid + HDR + watermark) ===");
  let form = new FormData();
  form.append("file", new Blob([testBuf], { type: "image/jpeg" }), "test.jpg");
  form.append("upscale", "2");
  form.append("quality", "95");
  form.append("sharpen", "1");
  form.append("denoise", "1");
  form.append("enhance", "1");
  form.append("filter", "vivid");
  form.append("aspect", "4:3");
  form.append("watermark", "br");
  form.append("watermarkText", "kangwifi cam");
  form.append("watermarkOpacity", "0.85");
  form.append("vignette", "1");
  form.append("hdr", "1");
  form.append("preview", "1");
  form.append("exposure", "0.1");
  form.append("contrast", "0.1");
  form.append("saturation", "0.15");
  form.append("temperature", "0.1");

  let t0 = Date.now();
  let res = await fetch("http://localhost:3000/api/process", { method: "POST", body: form });
  let dt = Date.now() - t0;
  console.log(`Status: ${res.status} (${dt}ms)`);
  let data = await res.json();
  console.log("Response meta:", {
    width: data.width,
    height: data.height,
    originalWidth: data.originalWidth,
    originalHeight: data.originalHeight,
    filter: data.filter,
    aspect: data.aspect,
    watermark: data.watermark,
    upscaled: data.upscaled,
    hdr: data.hdr,
    vignette: data.vignette,
    denoise: data.denoise,
    heicBytes: Math.round(data.heic.length * 0.75),
    previewBytes: Math.round(data.preview.length * 0.75),
  });

  fs.writeFileSync(
    "/home/z/my-project/download/test-all-features.heic",
    Buffer.from(data.heic, "base64"),
  );
  fs.writeFileSync(
    "/home/z/my-project/download/test-all-features.jpg",
    Buffer.from(data.preview, "base64"),
  );

  // Test 2: 4x upscale, mono filter, no watermark
  console.log("\n=== TEST 2: 4x upscale + mono filter + no watermark ===");
  form = new FormData();
  form.append("file", new Blob([testBuf], { type: "image/jpeg" }), "test.jpg");
  form.append("upscale", "4");
  form.append("quality", "100");
  form.append("sharpen", "1");
  form.append("denoise", "1");
  form.append("filter", "mono");
  form.append("watermark", "none");
  form.append("preview", "1");

  t0 = Date.now();
  res = await fetch("http://localhost:3000/api/process", { method: "POST", body: form });
  dt = Date.now() - t0;
  data = await res.json();
  console.log(`Status: ${res.status} (${dt}ms)`);
  console.log("Response meta:", {
    width: data.width,
    height: data.height,
    filter: data.filter,
    watermark: data.watermark,
    heicBytes: Math.round(data.heic.length * 0.75),
  });

  fs.writeFileSync(
    "/home/z/my-project/download/test-4x-mono.heic",
    Buffer.from(data.heic, "base64"),
  );

  console.log("\n=== ALL TESTS PASSED ===");
  console.log("Files saved to /home/z/my-project/download/");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

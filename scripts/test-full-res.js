// Test at full resolution (bypass preview downscale) + test 1x vs 2x
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

async function processFull(label, sourcePath, upscale) {
  const srcBuf = fs.readFileSync(sourcePath);
  const fd = new FormData();
  const blob = new Blob([srcBuf], { type: "image/jpeg" });
  fd.append("file", blob, "photo.jpg");
  fd.append("upscale", String(upscale));
  fd.append("quality", "98");
  fd.append("sharpen", "1");
  fd.append("denoise", "1");
  fd.append("enhance", "1");
  fd.append("filter", "none");
  fd.append("aspect", "free");
  fd.append("preview", "1");

  const t0 = Date.now();
  const res = await fetch("http://localhost:3000/api/process", {
    method: "POST",
    body: fd,
  });
  const elapsed = Date.now() - t0;
  if (!res.ok) throw new Error(`FAIL: HTTP ${res.status}`);
  const data = await res.json();
  console.log(`[${label}] ${elapsed}ms — ${data.width}x${data.height}`);

  // Decode HEIC and re-encode as full-resolution JPEG for VLM inspection
  const heicBuf = Buffer.from(data.heic, "base64");
  // Sharp can decode HEIC if libheif is installed
  let fullJpeg;
  try {
    fullJpeg = await sharp(heicBuf)
      .jpeg({ quality: 95, mozjpeg: true })
      .toBuffer();
  } catch (e) {
    console.log(`[${label}] Could not decode HEIC: ${e.message}`);
    // Fall back to preview
    fullJpeg = Buffer.from(data.preview, "base64");
  }
  const outPath = path.join("/home/z/my-project/scripts", `full-${label}.jpg`);
  fs.writeFileSync(outPath, fullJpeg);
  console.log(`[${label}] Full JPEG: ${outPath} (${(fullJpeg.length/1024).toFixed(1)} KB)`);
}

async function main() {
  console.log("=== Full-Resolution Test ===\n");
  // Test 1x (no upscale) — should be clean since no amplification
  await processFull("1x", "/home/z/my-project/scripts/real-clean-src.jpg", 1);
  // Test 2x
  await processFull("2x", "/home/z/my-project/scripts/real-clean-src.jpg", 2);
}

main().catch(e => { console.error(e); process.exit(1); });

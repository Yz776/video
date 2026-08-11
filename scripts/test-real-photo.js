// Test with a REAL photo from the project
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

async function processRealPhoto(label, sourcePath, upscale, extraParams = {}) {
  const srcBuf = fs.readFileSync(sourcePath);
  const meta = await sharp(srcBuf).metadata();
  console.log(`\n[${label}] Source: ${meta.width}x${meta.height}, ${(srcBuf.length/1024).toFixed(1)} KB`);

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
  for (const [k, v] of Object.entries(extraParams)) {
    fd.append(k, String(v));
  }

  const t0 = Date.now();
  const res = await fetch("http://localhost:3000/api/process", {
    method: "POST",
    body: fd,
  });
  const elapsed = Date.now() - t0;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FAIL [${label}]: HTTP ${res.status} - ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  console.log(`[${label}] OK in ${elapsed}ms — ${data.width}x${data.height}`);

  const previewBuf = Buffer.from(data.preview, "base64");
  const outPath = path.join("/home/z/my-project/scripts", `real-${label}.jpg`);
  fs.writeFileSync(outPath, previewBuf);
  console.log(`[${label}] Preview: ${outPath} (${(previewBuf.length/1024).toFixed(1)} KB)`);

  const heicBytes = Buffer.from(data.heic, "base64");
  console.log(`[${label}] HEIC: ${(heicBytes.length/1024).toFixed(1)} KB`);
  
  return { ...data, elapsed, previewPath: outPath };
}

async function main() {
  console.log("=== Real Photo Quality Test ===\n");
  
  // Process the real portrait photo at 2x
  await processRealPhoto("2x", "/home/z/my-project/scripts/test-real.jpg", 2);
  
  // Save a copy of the source for comparison
  const srcBuf = fs.readFileSync("/home/z/my-project/scripts/test-real.jpg");
  fs.writeFileSync("/home/z/my-project/scripts/real-source.jpg", srcBuf);
  console.log("\nSource saved to: /home/z/my-project/scripts/real-source.jpg");
}

main().catch(e => { console.error(e); process.exit(1); });

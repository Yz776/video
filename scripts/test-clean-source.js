// Test pipeline with a clean source (re-encoded at high quality)
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

async function main() {
  // Re-encode source at very high quality to simulate clean camera capture
  const srcBuf = fs.readFileSync("/home/z/my-project/scripts/test-real.jpg");
  const cleanBuf = await sharp(srcBuf)
    .jpeg({ quality: 100, mozjpeg: true })
    .toBuffer();
  fs.writeFileSync("/home/z/my-project/scripts/real-clean-src.jpg", cleanBuf);
  console.log(`Clean source: ${cleanBuf.length/1024} KB (was ${srcBuf.length/1024} KB)`);

  // Process clean source at 2x
  const fd = new FormData();
  const blob = new Blob([cleanBuf], { type: "image/jpeg" });
  fd.append("file", blob, "photo.jpg");
  fd.append("upscale", "2");
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FAIL: HTTP ${res.status} - ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  console.log(`2x upscale: ${elapsed}ms — ${data.width}x${data.height}`);

  const previewBuf = Buffer.from(data.preview, "base64");
  const outPath = "/home/z/my-project/scripts/real-clean-2x.jpg";
  fs.writeFileSync(outPath, previewBuf);
  console.log(`Preview: ${outPath} (${(previewBuf.length/1024).toFixed(1)} KB)`);
  console.log(`HEIC: ${(Buffer.from(data.heic, "base64").length/1024).toFixed(1)} KB`);
}

main().catch(e => { console.error(e); process.exit(1); });

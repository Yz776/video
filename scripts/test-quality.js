// End-to-end quality test: send a real test image to API, compare old vs new pipeline visually
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

/**
 * Make a test image with fine detail that's prone to "pecah" artifacts:
 * - High-frequency diagonal stripes
 * - Sharp edges (geometric shapes)
 * - Smooth gradient (to test for blocking artifacts)
 * - Text-like patterns
 */
async function makeDetailedTestImage(w, h) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#1e3a8a"/>
        <stop offset="50%" stop-color="#f59e0b"/>
        <stop offset="100%" stop-color="#dc2626"/>
      </linearGradient>
      <pattern id="stripes" x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="#fff"/>
        <rect width="3" height="3" fill="#000"/>
        <rect x="3" y="3" width="3" height="3" fill="#000"/>
      </pattern>
      <pattern id="dots" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
        <rect width="4" height="4" fill="#fff"/>
        <circle cx="2" cy="2" r="1" fill="#000"/>
      </pattern>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#bg)"/>
    
    <!-- Top-left: fine stripes -->
    <rect x="0" y="0" width="${w/2}" height="${h/2}" fill="url(#stripes)" opacity="0.8"/>
    
    <!-- Top-right: dots pattern -->
    <rect x="${w/2}" y="0" width="${w/2}" height="${h/2}" fill="url(#dots)" opacity="0.8"/>
    
    <!-- Bottom-left: smooth gradient (testing for blocking artifacts) -->
    <defs>
      <radialGradient id="smooth" cx="25%" cy="75%" r="40%">
        <stop offset="0%" stop-color="#fef3c7"/>
        <stop offset="50%" stop-color="#f59e0b"/>
        <stop offset="100%" stop-color="#7c2d12"/>
      </radialGradient>
    </defs>
    <rect x="0" y="${h/2}" width="${w/2}" height="${h/2}" fill="url(#smooth)"/>
    
    <!-- Bottom-right: geometric shapes with sharp edges -->
    <rect x="${w/2}" y="${h/2}" width="${w/2}" height="${h/2}" fill="#0f172a"/>
    <circle cx="${w*0.75}" cy="${h*0.75}" r="${Math.min(w,h)*0.15}" fill="#fff" stroke="#000" stroke-width="2"/>
    <rect x="${w*0.6}" y="${h*0.6}" width="${w*0.1}" height="${h*0.1}" fill="#ef4444"/>
    <polygon points="${w*0.65},${h*0.85} ${w*0.75},${h*0.85} ${w*0.7},${h*0.7}" fill="#22c55e"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

async function processImage(label, upscale, extraParams = {}) {
  // Create a small source image (simulates camera capture)
  const srcBuf = await makeDetailedTestImage(960, 540); // 540p source
  console.log(`\n[${label}] Source image: 960x540, ${srcBuf.length} bytes`);

  const fd = new FormData();
  const blob = new Blob([srcBuf], { type: "image/jpeg" });
  fd.append("file", blob, "test.jpg");
  fd.append("upscale", String(upscale));
  fd.append("quality", "98");
  fd.append("sharpen", "1");
  fd.append("denoise", "1");
  fd.append("enhance", "1");
  fd.append("filter", "none");
  fd.append("aspect", "free");
  fd.append("preview", "1");
  fd.append("exposure", "0");
  fd.append("contrast", "0");
  fd.append("saturation", "0");
  fd.append("temperature", "0");
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
  console.log(`[${label}] OK in ${elapsed}ms — ${data.width}x${data.height}, upscaled=${data.upscaled}`);

  // Save the preview JPEG for VLM inspection
  const previewBuf = Buffer.from(data.preview, "base64");
  const outPath = path.join("/home/z/my-project/scripts", `quality-${label}.jpg`);
  fs.writeFileSync(outPath, previewBuf);
  console.log(`[${label}] Preview saved: ${outPath} (${(previewBuf.length/1024).toFixed(1)} KB)`);

  // Also save the HEIC file size for comparison
  const heicBytes = Buffer.from(data.heic, "base64");
  console.log(`[${label}] HEIC size: ${(heicBytes.length/1024).toFixed(1)} KB`);

  return { ...data, heicSize: heicBytes.length, previewSize: previewBuf.length, elapsed };
}

async function main() {
  console.log("=== Quality Comparison Test ===\n");

  // Test new pipeline at various upscale factors
  const results = [];
  
  results.push({ label: "2x", data: await processImage("2x", 2) });
  results.push({ label: "4x", data: await processImage("4x", 4) });
  results.push({ label: "1x", data: await processImage("1x", 1) });

  console.log("\n=== Summary ===");
  console.log("Label | Out Dim    | HEIC KB | Prev KB | Time ms");
  console.log("------|------------|---------|---------|--------");
  for (const r of results) {
    console.log(
      `${r.label.padEnd(5)} | ${String(r.data.width + "x" + r.data.height).padEnd(10)} | ` +
      `${(r.data.heicSize/1024).toFixed(1).padStart(7)} | ` +
      `${(r.data.previewSize/1024).toFixed(1).padStart(7)} | ` +
      `${String(r.data.elapsed).padStart(6)}`
    );
  }
}

main().catch(e => { console.error(e); process.exit(1); });

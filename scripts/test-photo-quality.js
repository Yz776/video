// Realistic photo test — no synthetic patterns, just photo-like content
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

/**
 * Make a photo-realistic test image: landscape with sky, mountains, sun.
 * No pathological high-frequency patterns that would exaggerate artifacts.
 */
async function makeRealisticPhoto(w, h) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <!-- Sky gradient: blue to lighter blue near horizon -->
      <linearGradient id="sky" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#1e40af"/>
        <stop offset="50%" stop-color="#3b82f6"/>
        <stop offset="100%" stop-color="#fde68a"/>
      </linearGradient>
      <!-- Sun glow -->
      <radialGradient id="sun" cx="75%" cy="30%" r="20%">
        <stop offset="0%" stop-color="#fffbeb" stop-opacity="1"/>
        <stop offset="40%" stop-color="#fcd34d" stop-opacity="0.8"/>
        <stop offset="100%" stop-color="#fcd34d" stop-opacity="0"/>
      </radialGradient>
      <!-- Mountain back layer -->
      <linearGradient id="mtnBack" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#6366f1" stop-opacity="0.6"/>
        <stop offset="100%" stop-color="#1e1b4b" stop-opacity="0.8"/>
      </linearGradient>
      <!-- Mountain front layer -->
      <linearGradient id="mtnFront" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#4338ca"/>
        <stop offset="100%" stop-color="#0f172a"/>
      </linearGradient>
      <!-- Ground -->
      <linearGradient id="ground" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#16a34a"/>
        <stop offset="100%" stop-color="#14532d"/>
      </linearGradient>
    </defs>

    <!-- Sky -->
    <rect width="${w}" height="${h*0.65}" fill="url(#sky)"/>
    <!-- Sun -->
    <rect width="${w}" height="${h*0.65}" fill="url(#sun)"/>
    
    <!-- Back mountains (jagged peaks) -->
    <path d="M 0 ${h*0.55} L ${w*0.15} ${h*0.35} L ${w*0.3} ${h*0.5} L ${w*0.45} ${h*0.3} L ${w*0.6} ${h*0.45} L ${w*0.75} ${h*0.32} L ${w*0.9} ${h*0.5} L ${w} ${h*0.4} L ${w} ${h*0.65} L 0 ${h*0.65} Z" fill="url(#mtnBack)"/>
    
    <!-- Front mountains -->
    <path d="M 0 ${h*0.7} L ${w*0.1} ${h*0.55} L ${w*0.25} ${h*0.65} L ${w*0.4} ${h*0.5} L ${w*0.55} ${h*0.6} L ${w*0.7} ${h*0.48} L ${w*0.85} ${h*0.62} L ${w} ${h*0.55} L ${w} ${h} L 0 ${h} Z" fill="url(#mtnFront)"/>
    
    <!-- Ground -->
    <rect y="${h*0.85}" width="${w}" height="${h*0.15}" fill="url(#ground)"/>
    
    <!-- A few clouds (soft ellipses) -->
    <ellipse cx="${w*0.2}" cy="${h*0.15}" rx="${w*0.08}" ry="${h*0.03}" fill="#ffffff" opacity="0.7"/>
    <ellipse cx="${w*0.25}" cy="${h*0.17}" rx="${w*0.06}" ry="${h*0.025}" fill="#ffffff" opacity="0.6"/>
    <ellipse cx="${w*0.5}" cy="${h*0.1}" rx="${w*0.1}" ry="${h*0.035}" fill="#ffffff" opacity="0.8"/>
    <ellipse cx="${w*0.55}" cy="${h*0.12}" rx="${w*0.08}" ry="${h*0.03}" fill="#ffffff" opacity="0.7"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();
}

async function processImage(label, upscale, extraParams = {}) {
  // Source: 960x540 (typical camera-capture resolution for testing)
  const srcBuf = await makeRealisticPhoto(960, 540);
  console.log(`\n[${label}] Source: 960x540, ${srcBuf.length} bytes`);

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

  // Save preview
  const previewBuf = Buffer.from(data.preview, "base64");
  const outPath = path.join("/home/z/my-project/scripts", `photo-${label}.jpg`);
  fs.writeFileSync(outPath, previewBuf);
  console.log(`[${label}] Preview: ${outPath} (${(previewBuf.length/1024).toFixed(1)} KB)`);

  // Save source for comparison
  const srcPath = path.join("/home/z/my-project/scripts", `photo-${label}-src.jpg`);
  fs.writeFileSync(srcPath, srcBuf);

  const heicBytes = Buffer.from(data.heic, "base64");
  console.log(`[${label}] HEIC: ${(heicBytes.length/1024).toFixed(1)} KB`);
  
  return { ...data, elapsed };
}

async function main() {
  console.log("=== Photo-Realistic Quality Test ===\n");

  // Test the new pipeline at 2x and 4x
  await processImage("2x-new", 2);
  await processImage("4x-new", 4);
}

main().catch(e => { console.error(e); process.exit(1); });

// End-to-end test: send a real image to the API and verify the watermark renders correctly
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

async function makeTestPhoto(w, h) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="sky" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#FF6B6B"/>
        <stop offset="50%" stop-color="#FFD93D"/>
        <stop offset="100%" stop-color="#1A535C"/>
      </linearGradient>
      <radialGradient id="sun" cx="50%" cy="40%" r="30%">
        <stop offset="0%" stop-color="#FFF" stop-opacity="0.9"/>
        <stop offset="100%" stop-color="#FFF" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#sky)"/>
    <rect width="${w}" height="${h}" fill="url(#sun)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();
}

async function main() {
  // 1. Create a test photo
  const photoBuf = await makeTestPhoto(1920, 1080);
  console.log("Test photo created:", photoBuf.length, "bytes");

  // 2. Test each watermark position via the API
  const positions = ["bl", "br", "tl", "tr", "c"];
  for (const pos of positions) {
    const fd = new FormData();
    const blob = new Blob([photoBuf], { type: "image/jpeg" });
    fd.append("file", blob, "test.jpg");
    fd.append("upscale", "1");        // No upscale (faster test)
    fd.append("quality", "95");
    fd.append("sharpen", "0");
    fd.append("enhance", "0");
    fd.append("filter", "none");
    fd.append("aspect", "free");
    fd.append("watermark", pos);
    fd.append("watermarkText", "kangwifi cam");
    fd.append("watermarkOpacity", "1");
    fd.append("preview", "1");
    fd.append("exposure", "0");
    fd.append("contrast", "0");
    fd.append("saturation", "0");
    fd.append("temperature", "0");

    console.log(`\n--- Testing position: ${pos} ---`);
    const t0 = Date.now();
    const res = await fetch("http://localhost:3000/api/process", {
      method: "POST",
      body: fd,
    });
    const elapsed = Date.now() - t0;
    if (!res.ok) {
      console.error(`FAIL [${pos}]: HTTP ${res.status}`);
      const text = await res.text();
      console.error(text.slice(0, 500));
      continue;
    }
    const data = await res.json();
    console.log(`OK [${pos}] in ${elapsed}ms — ${data.width}x${data.height}, watermark=${data.watermark}`);

    // Save the preview (JPEG) so we can visually inspect
    const previewBytes = Buffer.from(data.preview, "base64");
    const outPath = path.join("/home/z/my-project/scripts", `api-wm-${pos}.jpg`);
    fs.writeFileSync(outPath, previewBytes);
    console.log(`  Preview saved: ${outPath}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

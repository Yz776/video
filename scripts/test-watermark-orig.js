// Test ORIGINAL watermark on bright photo to find the actual user-visible bug
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// EXACT copy of the ORIGINAL buildWatermarkSvg from route.ts (current code)
function buildWatermarkSvgOriginal(opts) {
  const { width, height, position, text, opacity } = opts;
  if (position === "none" || !text.trim()) return Buffer.alloc(0);

  const fontSize = Math.max(28, Math.min(96, Math.round(width / 32)));
  const iconSize = Math.round(fontSize * 1.1);
  const pad = Math.round(fontSize * 0.8);

  let x = pad;
  let y = height - pad;
  let anchor = "start";
  let iconX = pad;
  switch (position) {
    case "bl":
      x = pad; y = height - pad; anchor = "start"; iconX = pad; break;
    case "br":
      x = width - pad; y = height - pad; anchor = "end"; iconX = width - pad - iconSize; break;
    case "tl":
      x = pad; y = pad + fontSize; anchor = "start"; iconX = pad; break;
    case "tr":
      x = width - pad; y = pad + fontSize; anchor = "end"; iconX = width - pad - iconSize; break;
    case "c":
      x = width / 2; y = height / 2; anchor = "middle"; iconX = width / 2 - iconSize / 2; break;
  }

  const textX = position === "bl" || position === "tl"
    ? x + iconSize + pad * 0.4
    : position === "br" || position === "tr"
      ? x - iconSize - pad * 0.4
      : x;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="ds" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${Math.max(1, fontSize / 18)}"/>
      <feOffset dx="0" dy="${Math.max(1, fontSize / 24)}" result="o"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.7"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <linearGradient id="ic" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FCD34D"/>
      <stop offset="100%" stop-color="#F59E0B"/>
    </linearGradient>
  </defs>
  <g opacity="${opacity}" filter="url(#ds)">
    <g transform="translate(${iconX}, ${y - iconSize})">
      <rect width="${iconSize}" height="${iconSize}" rx="${iconSize * 0.22}" fill="url(#ic)"/>
      <text x="${iconSize / 2}" y="${iconSize * 0.7}" font-family="Inter, Arial, sans-serif" font-size="${iconSize * 0.55}" font-weight="900" text-anchor="middle" fill="#000">K</text>
    </g>
    <text x="${textX}" y="${y - iconSize * 0.18}" font-family="Inter, Arial, sans-serif" font-size="${fontSize}" font-weight="800" text-anchor="${anchor}" fill="#ffffff" letter-spacing="${Math.max(0.5, fontSize / 36)}">${escapeXml(text)}</text>
  </g>
</svg>`;
  return Buffer.from(svg);
}

async function makePhotoBg(w, h) {
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
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  // Use a typical photo size: 1920x1080
  const width = 1920;
  const height = 1080;
  const bg = await makePhotoBg(width, height);

  const positions = ["bl", "br", "tl", "tr", "c"];
  for (const pos of positions) {
    const wm = buildWatermarkSvgOriginal({
      width, height, position: pos,
      text: "kangwifi cam", opacity: 0.85
    });
    const out = await sharp(bg).composite([{ input: wm, blend: "over" }]).png().toBuffer();
    const outPath = path.join("/home/z/my-project/scripts", `wm-orig-${pos}.png`);
    fs.writeFileSync(outPath, out);
    console.log(`Wrote ${outPath}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

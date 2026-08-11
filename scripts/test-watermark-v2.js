// Test watermark on a real-photo-like vibrant background
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

function escapeXml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---- NEW improved watermark implementation ----
function buildWatermarkSvgNew(opts) {
  const { width, height, position, text, opacity, scale = 1 } = opts;
  if (position === "none" || !text.trim()) return Buffer.alloc(0);

  // Scale font relative to image size, capped to keep sensible
  const baseFont = Math.max(24, Math.min(96, Math.round(width / 32)));
  const fontSize = Math.round(baseFont * scale);
  const iconSize = Math.round(fontSize * 1.05);
  const pad = Math.round(fontSize * 0.7);
  const gap = Math.round(fontSize * 0.35);

  // Layout: total width = icon + gap + text width (estimated)
  // Estimate text width: 0.55 * fontSize * text.length (rough)
  const textWidthEst = Math.round(text.length * fontSize * 0.52);
  const blockW = iconSize + gap + textWidthEst;
  const blockH = iconSize;

  // Pill background (semi-transparent dark for legibility)
  const pillPadX = Math.round(fontSize * 0.5);
  const pillPadY = Math.round(fontSize * 0.35);
  const pillW = blockW + pillPadX * 2;
  const pillH = blockH + pillPadY * 2;
  const pillRx = Math.round(pillH / 2);

  let blockX, blockY; // top-left of the icon-text block
  let pillX, pillY;
  let iconX, iconY;
  let textX, textY;
  let anchor = "start";
  let stackVertical = false;

  switch (position) {
    case "bl":
      blockX = pad;
      blockY = height - pad - blockH;
      anchor = "start";
      break;
    case "br":
      blockX = width - pad - blockW;
      blockY = height - pad - blockH;
      anchor = "start"; // icon first, then text — consistent orientation
      break;
    case "tl":
      blockX = pad;
      blockY = pad;
      anchor = "start";
      break;
    case "tr":
      blockX = width - pad - blockW;
      blockY = pad;
      anchor = "start";
      break;
    case "c":
      // Stack vertically: icon above text
      stackVertical = true;
      blockX = width / 2 - Math.max(iconSize, textWidthEst) / 2;
      blockY = height / 2 - (iconSize + gap + fontSize) / 2;
      anchor = "middle";
      break;
  }

  if (stackVertical) {
    // Center: icon on top, text below
    const cx = width / 2;
    iconX = cx - iconSize / 2;
    iconY = blockY;
    textX = cx;
    textY = blockY + iconSize + gap + fontSize * 0.8;
    // No pill for center (looks cleaner)
    pillX = 0; pillY = 0;
  } else {
    // Corner: icon then text horizontally
    iconX = blockX;
    iconY = blockY;
    textX = blockX + iconSize + gap;
    textY = blockY + iconSize * 0.78; // baseline aligned with icon center-ish
    pillX = blockX - pillPadX;
    pillY = blockY - pillPadY;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="ds" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${Math.max(1.2, fontSize / 14)}"/>
      <feOffset dx="0" dy="${Math.max(1, fontSize / 20)}" result="o"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.55"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <linearGradient id="ic" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FCD34D"/>
      <stop offset="100%" stop-color="#F59E0B"/>
    </linearGradient>
    <linearGradient id="pill" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.35"/>
    </linearGradient>
  </defs>
  <g opacity="${opacity}">
    ${!stackVertical ? `<rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillRx}" fill="url(#pill)"/>` : ""}
    <g filter="url(#ds)">
      <g transform="translate(${iconX}, ${iconY})">
        <rect width="${iconSize}" height="${iconSize}" rx="${iconSize * 0.22}" fill="url(#ic)"/>
        <text x="${iconSize / 2}" y="${iconSize * 0.7}" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="${iconSize * 0.58}" font-weight="900" text-anchor="middle" fill="#0b0b0b">K</text>
      </g>
      <text x="${textX}" y="${textY}" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="${fontSize}" font-weight="800" text-anchor="${anchor}" fill="#ffffff" letter-spacing="${Math.max(0.5, fontSize / 40)}">${escapeXml(text)}</text>
    </g>
  </g>
</svg>`;
  return Buffer.from(svg);
}

async function makePhotoBg(w, h) {
  // Make a vibrant multi-color gradient that mimics a real photo
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
  const width = 3840;
  const height = 2160;
  const bg = await makePhotoBg(width, height);

  const positions = ["bl", "br", "tl", "tr", "c"];
  for (const pos of positions) {
    const wm = buildWatermarkSvgNew({
      width, height, position: pos,
      text: "kangwifi cam", opacity: 1.0, scale: 1
    });
    const out = await sharp(bg).composite([{ input: wm, blend: "over" }]).png().toBuffer();
    const outPath = path.join("/home/z/my-project/scripts", `wm-new-${pos}.png`);
    fs.writeFileSync(outPath, out);
    console.log(`Wrote ${outPath}`);
  }

  // Also test smaller scale (preview-sized)
  const pW = 1600, pH = 900;
  const bgSmall = await makePhotoBg(pW, pH);
  const wmSmall = buildWatermarkSvgNew({
    width: pW, height: pH, position: "br",
    text: "kangwifi cam", opacity: 1.0, scale: 1
  });
  const outSmall = await sharp(bgSmall).composite([{ input: wmSmall, blend: "over" }]).png().toBuffer();
  fs.writeFileSync(path.join("/home/z/my-project/scripts", "wm-new-br-small.png"), outSmall);
  console.log("Wrote small preview test");
}

main().catch(e => { console.error(e); process.exit(1); });

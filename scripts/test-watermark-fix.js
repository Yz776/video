// Test the FIXED watermark implementation
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// EXACT copy of the FIXED buildWatermarkSvg from route.ts
function buildWatermarkSvgFixed(opts) {
  const { width, height, position, text, opacity } = opts;
  if (position === "none" || !text.trim()) return Buffer.alloc(0);

  const fontSize = Math.max(28, Math.min(96, Math.round(width / 32)));
  const iconSize = Math.round(fontSize * 1.1);
  const pad = Math.round(fontSize * 0.8);
  const gap = Math.round(fontSize * 0.35);

  const FONT_FAMILY = "DejaVu Sans, Liberation Sans, Arial, Helvetica, sans-serif";

  let iconX = pad;
  let iconY = height - pad - iconSize;
  let textX = pad;
  let textY = height - pad;
  let anchor = "start";

  switch (position) {
    case "bl": {
      iconX = pad;
      iconY = height - pad - iconSize;
      textX = iconX + iconSize + gap;
      textY = iconY + iconSize * 0.78;
      anchor = "start";
      break;
    }
    case "br": {
      iconX = width - pad - iconSize;
      iconY = height - pad - iconSize;
      textX = iconX - gap;
      textY = iconY + iconSize * 0.78;
      anchor = "end";
      break;
    }
    case "tl": {
      iconX = pad;
      iconY = pad;
      textX = iconX + iconSize + gap;
      textY = iconY + iconSize * 0.78;
      anchor = "start";
      break;
    }
    case "tr": {
      iconX = width - pad - iconSize;
      iconY = pad;
      textX = iconX - gap;
      textY = iconY + iconSize * 0.78;
      anchor = "end";
      break;
    }
    case "c": {
      const totalH = iconSize + gap + fontSize;
      const top = height / 2 - totalH / 2;
      iconX = width / 2 - iconSize / 2;
      iconY = top;
      textX = width / 2;
      textY = top + iconSize + gap + fontSize * 0.78;
      anchor = "middle";
      break;
    }
    case "none":
      return Buffer.alloc(0);
  }

  const shadowStd = Math.max(1.5, fontSize / 12);
  const shadowDy = Math.max(1, fontSize / 20);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="wmDs" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${shadowStd}"/>
      <feOffset dx="0" dy="${shadowDy}" result="o"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.55"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <linearGradient id="wmIc" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FCD34D"/>
      <stop offset="100%" stop-color="#F59E0B"/>
    </linearGradient>
  </defs>
  <g opacity="${opacity}" filter="url(#wmDs)">
    <g transform="translate(${iconX}, ${iconY})">
      <rect width="${iconSize}" height="${iconSize}" rx="${iconSize * 0.22}" fill="url(#wmIc)"/>
      <text x="${iconSize / 2}" y="${iconSize * 0.7}" font-family="${FONT_FAMILY}" font-size="${iconSize * 0.58}" font-weight="900" text-anchor="middle" fill="#0b0b0b">K</text>
    </g>
    <text x="${textX}" y="${textY}" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="800" text-anchor="${anchor}" fill="#ffffff" letter-spacing="${Math.max(0.5, fontSize / 40)}">${escapeXml(text)}</text>
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
  // Test at multiple sizes
  const sizes = [
    { w: 3840, h: 2160, label: "4k" },     // 4K landscape
    { w: 1920, h: 1080, label: "fhd" },    // Full HD landscape
    { w: 1080, h: 1920, label: "portrait" }, // Portrait
    { w: 1600, h: 900, label: "preview" },  // Preview size
  ];

  for (const { w, h, label } of sizes) {
    const bg = await makePhotoBg(w, h);
    const positions = ["bl", "br", "tl", "tr", "c"];
    for (const pos of positions) {
      const wm = buildWatermarkSvgFixed({
        width: w, height: h, position: pos,
        text: "kangwifi cam", opacity: 0.9
      });
      const out = await sharp(bg).composite([{ input: wm, blend: "over" }]).png().toBuffer();
      const outPath = path.join("/home/z/my-project/scripts", `wm-fix-${label}-${pos}.png`);
      fs.writeFileSync(outPath, out);
    }
    console.log(`Done: ${label} (${w}x${h})`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

// Generate proper PNG icons for PWA installability
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#000000"/>
      <stop offset="100%" stop-color="#1a1a1a"/>
    </linearGradient>
    <linearGradient id="lens" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FCD34D"/>
      <stop offset="100%" stop-color="#F59E0B"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <!-- Camera body -->
  <rect x="96" y="128" width="320" height="256" rx="36" fill="none" stroke="#FFFFFF" stroke-width="20"/>
  <!-- Viewfinder bump -->
  <rect x="180" y="92" width="80" height="40" rx="12" fill="#FFFFFF"/>
  <!-- Lens outer ring -->
  <circle cx="256" cy="256" r="92" fill="none" stroke="url(#lens)" stroke-width="20"/>
  <!-- Lens inner -->
  <circle cx="256" cy="256" r="40" fill="url(#lens)"/>
  <!-- Flash dot -->
  <circle cx="372" cy="168" r="14" fill="#FCD34D"/>
</svg>`;

const MASKABLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#000000"/>
      <stop offset="100%" stop-color="#1a1a1a"/>
    </linearGradient>
    <linearGradient id="lens" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FCD34D"/>
      <stop offset="100%" stop-color="#F59E0B"/>
    </linearGradient>
  </defs>
  <!-- Full bleed background for maskable safe zone -->
  <rect width="512" height="512" fill="url(#bg)"/>
  <!-- All content within 80% safe zone (40-472) -->
  <rect x="116" y="148" width="280" height="216" rx="32" fill="none" stroke="#FFFFFF" stroke-width="16"/>
  <rect x="196" y="116" width="64" height="32" rx="10" fill="#FFFFFF"/>
  <circle cx="256" cy="256" r="76" fill="none" stroke="url(#lens)" stroke-width="16"/>
  <circle cx="256" cy="256" r="32" fill="url(#lens)"/>
  <circle cx="356" cy="180" r="10" fill="#FCD34D"/>
</svg>`;

async function main() {
  const pubDir = "/home/z/my-project/public";

  // 192, 512 standard PNG icons
  await sharp(Buffer.from(ICON_SVG)).resize(192, 192).png().toFile(path.join(pubDir, "icon-192.png"));
  await sharp(Buffer.from(ICON_SVG)).resize(512, 512).png().toFile(path.join(pubDir, "icon-512.png"));

  // Maskable variants (Android adaptive icons)
  await sharp(Buffer.from(MASKABLE_SVG)).resize(192, 192).png().toFile(path.join(pubDir, "icon-192-maskable.png"));
  await sharp(Buffer.from(MASKABLE_SVG)).resize(512, 512).png().toFile(path.join(pubDir, "icon-512-maskable.png"));

  // Apple touch icon (180x180, square no transparency for iOS)
  const APPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="#000000"/>
    <rect x="96" y="128" width="320" height="256" rx="36" fill="none" stroke="#FFFFFF" stroke-width="20"/>
    <rect x="180" y="92" width="80" height="40" rx="12" fill="#FFFFFF"/>
    <circle cx="256" cy="256" r="76" fill="none" stroke="#FCD34D" stroke-width="20"/>
    <circle cx="256" cy="256" r="32" fill="#FCD34D"/>
    <circle cx="372" cy="168" r="14" fill="#FCD34D"/>
  </svg>`;
  await sharp(Buffer.from(APPLE_SVG)).resize(180, 180).png().toFile(path.join(pubDir, "apple-touch-icon.png"));

  // Favicons
  await sharp(Buffer.from(ICON_SVG)).resize(32, 32).png().toFile(path.join(pubDir, "favicon-32.png"));
  await sharp(Buffer.from(ICON_SVG)).resize(16, 16).png().toFile(path.join(pubDir, "favicon-16.png"));

  console.log("All icons generated:");
  for (const f of fs.readdirSync(pubDir)) {
    if (f.endsWith(".png")) {
      const stat = fs.statSync(path.join(pubDir, f));
      console.log(`  ${f}: ${stat.size} bytes`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });

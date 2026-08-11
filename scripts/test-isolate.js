// Isolate which filter introduces "pecah" artifacts
const sharp = require("sharp");
const fs = require("fs");

async function saveVariant(label, pipeline) {
  const out = await pipeline.jpeg({ quality: 98, mozjpeg: true }).toBuffer();
  const path = `/home/z/my-project/scripts/variant-${label}.jpg`;
  fs.writeFileSync(path, out);
  console.log(`[${label}] ${(out.length/1024).toFixed(1)} KB — ${path}`);
  return path;
}

async function main() {
  const srcBuf = fs.readFileSync("/home/z/my-project/scripts/real-clean-src.jpg");
  const meta = await sharp(srcBuf).metadata();
  const tw = meta.width * 2, th = meta.height * 2;
  
  const base = () => sharp(srcBuf, { failOn: "none" }).rotate();
  const upscale = (p) => p.resize({ width: tw, height: th, fit: "fill", kernel: "lanczos3" });

  console.log("Source: " + meta.width + "x" + meta.height);
  console.log("\n=== Isolation test ===\n");

  // A: Plain upscale only (baseline — confirmed clean)
  await saveVariant("A-plain", upscale(base()));

  // B: + median(1) only
  await saveVariant("B-median", upscale(base().median(1)));

  // C: + blur(0.3) only
  await saveVariant("C-blur", upscale(base().blur(0.3)));

  // D: + median + blur (pre-denoise combo)
  await saveVariant("D-denoise", upscale(base().median(1).blur(0.3)));

  // E: + CLAHE only (after plain upscale)
  await saveVariant("E-clahe", upscale(base()).clahe({ width: 5, height: 5, maxSlope: 3 }));

  // F: + sharpen only
  await saveVariant("F-sharpen", upscale(base()).sharpen({ sigma: 0.6, m1: 0.5, m2: 0.2, x1: 0.8, y2: 2 }));

  // G: + gamma only
  await saveVariant("G-gamma", upscale(base()).gamma(1.02));

  // H: Full pipeline (current — produces artifacts per VLM)
  await saveVariant("H-full", 
    upscale(base().median(1).blur(0.3))
      .clahe({ width: 5, height: 5, maxSlope: 3 })
      .modulate({ brightness: 1.02, saturation: 1.06 })
      .linear(1.04, -5)
      .gamma(1.02)
      .sharpen({ sigma: 0.6, m1: 0.5, m2: 0.2, x1: 0.8, y2: 2 })
  );

  // I: Denoise + upscale + gamma (NO clahe, NO sharpen)
  await saveVariant("I-simple", 
    upscale(base().median(1).blur(0.3)).gamma(1.02)
  );
}

main().catch(e => { console.error(e); process.exit(1); });

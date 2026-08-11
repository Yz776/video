// Direct sharp test — same pipeline but no HEIC, just JPEG output
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

async function main() {
  const srcBuf = fs.readFileSync("/home/z/my-project/scripts/real-clean-src.jpg");
  const meta = await sharp(srcBuf).metadata();
  console.log(`Source: ${meta.width}x${meta.height}`);

  const targetW = meta.width * 2;
  const targetH = meta.height * 2;
  console.log(`Target: ${targetW}x${targetH}`);

  // Replicate the API pipeline EXACTLY but output JPEG instead of HEIC
  const out = await sharp(srcBuf, { failOn: "none" })
    .rotate()
    // Pre-denoise
    .median(1)
    .blur(0.3)
    // Upscale
    .resize({
      width: targetW,
      height: targetH,
      fit: "fill",
      kernel: "lanczos3",
      withoutEnlargement: false,
      withoutReduction: false,
    })
    // CLAHE
    .clahe({ width: 5, height: 5, maxSlope: 3 })
    // Enhance
    .modulate({ brightness: 1.02, saturation: 1.06 })
    .linear(1.04, -5)
    // Gamma
    .gamma(1.02)
    // Final sharpen
    .sharpen({ sigma: 0.6, m1: 0.5, m2: 0.2, x1: 0.8, y2: 2 })
    // Output as high-quality JPEG
    .jpeg({ quality: 98, mozjpeg: true })
    .toBuffer();

  const outPath = "/home/z/my-project/scripts/direct-sharp-2x.jpg";
  fs.writeFileSync(outPath, out);
  console.log(`Direct sharp output: ${outPath} (${(out.length/1024).toFixed(1)} KB)`);
  
  // Also test WITHOUT sharpen to see if sharpen is the issue
  const outNoSharpen = await sharp(srcBuf, { failOn: "none" })
    .rotate()
    .median(1)
    .blur(0.3)
    .resize({
      width: targetW,
      height: targetH,
      fit: "fill",
      kernel: "lanczos3",
    })
    .clahe({ width: 5, height: 5, maxSlope: 3 })
    .modulate({ brightness: 1.02, saturation: 1.06 })
    .linear(1.04, -5)
    .gamma(1.02)
    .jpeg({ quality: 98, mozjpeg: true })
    .toBuffer();
  
  const noSharpenPath = "/home/z/my-project/scripts/direct-sharp-2x-nosharpen.jpg";
  fs.writeFileSync(noSharpenPath, outNoSharpen);
  console.log(`No-sharpen output: ${noSharpenPath} (${(outNoSharpen.length/1024).toFixed(1)} KB)`);

  // Test plain upscale (no filters at all) for baseline
  const outPlain = await sharp(srcBuf, { failOn: "none" })
    .rotate()
    .resize({
      width: targetW,
      height: targetH,
      fit: "fill",
      kernel: "lanczos3",
    })
    .jpeg({ quality: 98, mozjpeg: true })
    .toBuffer();
  
  const plainPath = "/home/z/my-project/scripts/direct-sharp-2x-plain.jpg";
  fs.writeFileSync(plainPath, outPlain);
  console.log(`Plain upscale (no filters): ${plainPath} (${(outPlain.length/1024).toFixed(1)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });

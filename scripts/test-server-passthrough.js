// test-server-passthrough.js — E2E test of /api/process: passthrough (processed=1)
// and legacy full-pipeline paths, against a running dev server on :3000.
// Zero-dep except sharp (already in the project) for building the test JPEG
// and validating the returned HEIC.
const sharp = require("sharp");

const BASE = "http://localhost:3000/api/process";

async function makeTestJpeg(w, h) {
  // colorful 4-quadrant image so a black/empty encode is obvious
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="50%" height="50%" fill="#e01818"/>
    <rect x="50%" width="50%" height="50%" fill="#18b818"/>
    <rect y="50%" width="50%" height="50%" fill="#1840e0"/>
    <rect x="50%" y="50%" width="50%" height="50%" fill="#f0f0f0"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 97 }).toBuffer();
}

async function post(form) {
  const res = await fetch(BASE, { method: "POST", body: form });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text: text.slice(0, 300) };
}

async function statsOf(buf, label) {
  const meta = await sharp(buf).metadata();
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0;
  const n = info.width * info.height;
  const ch = info.channels;
  for (let i = 0; i < n; i++) { r += data[i*ch]; g += data[i*ch+1]; b += data[i*ch+2]; }
  const mean = [Math.round(r/n), Math.round(g/n), Math.round(b/n)];
  const ok = mean[0] + mean[1] + mean[2] > 60;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: format=${meta.format} ${meta.width}x${meta.height} mean=${mean.join(",")} bytes=${buf.length}`);
  return ok;
}

(async () => {
  let fails = 0;

  // 1. passthrough — what the WebGL client sends after GPU processing
  {
    const jpeg = await makeTestJpeg(1200, 900);
    const fd = new FormData();
    fd.append("file", new Blob([jpeg], { type: "image/jpeg" }), "processed.jpg");
    fd.append("processed", "1");
    fd.append("quality", "92");
    const { status, json, text } = await post(fd);
    if (status !== 200 || !json || !json.heic) {
      console.log("FAIL passthrough HTTP", status, text); fails++;
    } else {
      const bin = Buffer.from(json.heic, "base64");
      const ftf = bin.slice(4, 12).toString("ascii"); // should contain 'ftyp'
      const ok = await statsOf(bin, "passthrough HEIC");
      console.log(`     ftyp box: ${JSON.stringify(ftf)}`);
      if (!ok || !ftf.includes("ftyp")) fails++;
    }
  }

  // 2. legacy full pipeline (fallback path must be unbroken)
  {
    const jpeg = await makeTestJpeg(1200, 900);
    const fd = new FormData();
    fd.append("file", new Blob([jpeg], { type: "image/jpeg" }), "capture.jpg");
    fd.append("upscale", "2");
    fd.append("quality", "92");
    fd.append("sharpen", "1");
    fd.append("denoise", "1");
    fd.append("enhance", "1");
    fd.append("filter", "none");
    fd.append("aspect", "free");
    fd.append("vignette", "0");
    fd.append("hdr", "0");
    fd.append("night", "0");
    fd.append("preview", "1");
    fd.append("exposure", "0"); fd.append("contrast", "0");
    fd.append("saturation", "0"); fd.append("temperature", "0");
    const { status, json, text } = await post(fd);
    if (status !== 200 || !json || !json.heic) {
      console.log("FAIL legacy HTTP", status, text); fails++;
    } else {
      const bin = Buffer.from(json.heic, "base64");
      const ok = await statsOf(bin, "legacy HEIC (2x)");
      const prevOk = json.preview ? await statsOf(Buffer.from(json.preview, "base64"), "legacy preview JPEG") : false;
      if (!ok || !prevOk) fails++;
    }
  }

  // 3. legacy night mode variant
  {
    const jpeg = await makeTestJpeg(1200, 900);
    const fd = new FormData();
    fd.append("file", new Blob([jpeg], { type: "image/jpeg" }), "capture.jpg");
    fd.append("upscale", "1"); fd.append("quality", "92");
    fd.append("sharpen", "1"); fd.append("denoise", "1"); fd.append("enhance", "1");
    fd.append("filter", "none"); fd.append("aspect", "free");
    fd.append("vignette", "0"); fd.append("hdr", "0"); fd.append("night", "1");
    fd.append("preview", "1");
    fd.append("exposure", "0"); fd.append("contrast", "0");
    fd.append("saturation", "0"); fd.append("temperature", "0");
    const { status, json } = await post(fd);
    if (status !== 200 || !json || !json.heic) { console.log("FAIL night HTTP", status); fails++; }
    else {
      const ok = await statsOf(Buffer.from(json.heic, "base64"), "legacy HEIC night");
      if (!ok) fails++;
    }
  }

  console.log(fails === 0 ? "\nALL SERVER TESTS PASSED" : `\n${fails} SERVER TEST(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error("FATAL", e); process.exit(1); });

/**
 * Unit tests for the pure math of the WebGL pipeline (no GPU needed).
 * Run with: bun scripts/test-webgl-math.ts
 */
import {
 lanczos3,
 lanczosWeights,
 buildScaleSteps,
 cropUV,
} from "../src/components/camera/webgl/processor";
import {
 computeCropBox,
 fitTargetSize,
} from "../src/components/camera/webgl/geometry";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
 if (!cond) {
  failures++;
  console.error(`FAIL: ${name} ${extra}`);
 } else {
  console.log(`ok: ${name}`);
 }
}

// ---- lanczos kernel ----
check("L3(0) === 1", lanczos3(0) === 1);
check("L3(±1) === 0 (sinc zeros)", Math.abs(lanczos3(1)) < 1e-12 && Math.abs(lanczos3(-1)) < 1e-12);
check("L3(±3) === 0 (support edge)", lanczos3(3) === 0 && lanczos3(-3) === 0);
 check("L3(2.5) small positive sidelobe", lanczos3(2.5) > 0 && lanczos3(2.5) < 0.05);

// ---- weights for 2× upscale (13 taps) ----
{
 const { wts, offs } = lanczosWeights(2, 13);
 const sum = wts.reduce((a, b) => a + b, 0);
 check("2x weights sum ≈ 1", Math.abs(sum - 1) < 1e-9, `sum=${sum}`);
 check("2x offsets centered", offs[6] === 0 && offs[0] === -6 && offs[12] === 6);
 let sym = true;
 for (let i = 0; i < 13; i++) if (Math.abs(wts[i] - wts[12 - i]) > 1e-15) sym = false;
 check("2x weights symmetric", sym);
 // At factor 2, taps at ±6 map to source distance ±3 → zero weight
 check("2x outer taps are zero", wts[0] === 0 && wts[12] === 0);
 check("2x center tap dominant", Math.max(...wts) === wts[6] && wts[6] < 1);
}

// ---- weights for exact 2x: should act like nearest with ringing OK ----
{
 const { wts } = lanczosWeights(2, 13);
 // known lanczos3 @ factor 2 sample pattern: weights at k=0:1, ±1:0, ±2: -0.0732? (sin-based) — just check nonzero count
 const nonzero = wts.filter((w) => Math.abs(w) > 1e-9).length;
 check("2x kernel has multiple lobes", nonzero >= 7, `nonzero=${nonzero}`);
}

// ---- weights for downscale half ----
{
 const { wts } = lanczosWeights(0.5, 13);
 const sum = wts.reduce((a, b) => a + b, 0);
 check("0.5x weights sum ≈ 1", Math.abs(sum - 1) < 1e-9);
 const nonzero = wts.filter((w) => Math.abs(w) > 1e-9).length;
 check("0.5x kernel narrow (few taps)", nonzero <= 5, `nonzero=${nonzero}`);
}

// ---- scale steps ----
{
 const up = buildScaleSteps(4032, 3024, 8000, 6000, "upscale");
 check("4032→8000 single ≤2x step", up.length === 1 && up[0][0] === 8000, JSON.stringify(up));
 const up4 = buildScaleSteps(4032, 3024, 16128, 12096, "upscale");
 check("4032→16128 doubles once", up4.length === 2 && up4[0][0] === 8064, JSON.stringify(up4));
 const down = buildScaleSteps(8000, 6000, 1600, 1200, "downscale");
 check("8000→1600 halves", down.length === 3 && down[0][0] === 4000 && down[1][0] === 2000, JSON.stringify(down));
 check("last step exact target", down[down.length - 1][0] === 1600);
 const none = buildScaleSteps(1600, 1200, 1600, 1200, "upscale");
 check("same size → no steps", none.length === 0);
}

// ---- crop UV (flip-Y aware) ----
{
 const uv = cropUV({ left: 504, top: 0, width: 3024, height: 3024 }, 4032, 3024);
 check("crop uv scale x", Math.abs(uv.sx - 3024 / 4032) < 1e-9);
 check("crop uv sy 1 (full height)", Math.abs(uv.sy - 1) < 1e-9);
 check("crop oy 0", Math.abs(uv.oy - 0) < 1e-9);
 check("crop ox", Math.abs(uv.ox - 504 / 4032) < 1e-9);
 const uv2 = cropUV({ left: 0, top: 504, width: 4032, height: 3024 }, 4032, 4032);
 check("crop oy flip-Y aware", Math.abs(uv2.oy - (1 - (504 + 3024) / 4032)) < 1e-9);
}

// ---- crop box ----
{
 const c = computeCropBox(4032, 3024, "1:1");
 check("1:1 from 4:3 → square", c.width === 3024 && c.height === 3024 && c.left === 504 && c.top === 0);
 const f = computeCropBox(4032, 3024, "free");
 check("free → identity", f.width === 4032 && f.height === 3024 && f.left === 0);
 const a = computeCropBox(4032, 3024, "4:3");
 check("already 4:3 → identity", a.width === 4032 && a.height === 3024);
}

// ---- target size clamping ----
{
 // 8192 GPU: 2× from 4032×3024 → 8064>8000 clamp
 const [w, h] = fitTargetSize(4032, 3024, 2, 8000, 40_000_000, 8192);
 check("2× clamps to 8000 side", Math.max(w, h) <= 8000, `${w}×${h}`);
 check("2× clamps to ≤40MP", w * h <= 40_000_000, `${w * h}`);
 // mid-range 4096 GPU: source itself fits, upscale clamps hard
 const [mw, mh] = fitTargetSize(4032, 3024, 4, 4096, 16_000_000, 4096);
 check("mid-range clamp", Math.max(mw, mh) <= 4096 && mw * mh <= 16_000_000, `${mw}×${mh}`);
 // upscale 1 keeps size
 const [ow, oh] = fitTargetSize(1920, 1080, 1, 8000, 40_000_000, 8192);
 check("upscale 1 keeps dims", ow === 1920 && oh === 1080);
}

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

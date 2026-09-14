/**
 * WebGLImageProcessor — the client-side (GPU) super-HD photo pipeline.
 *
 * Replaces the old "upload JPEG → sharp does everything on the server"
 * flow for every step that matters visually:
 *
 *   decode → aspect crop → bilateral denoise (kills sensor noise + JPEG
 *   8×8 DCT blocks before upscale) → Lanczos3 separable upscale (exact
 *   kernel weights, multi-pass for >2×) → auto-exposure histogram →
 *   grade (filter presets / night mode / exposure / WB / vignette) →
 *   wide-radius local contrast (HDR-style, halo-clamped, NO CLAHE) →
 *   micro-sharpen (thresholded, so noise isn't amplified) → JPEG encode.
 *
 * The server is then asked ONLY to convert JPEG → HEIC (AV1), which is
 * what HEIC needs and what browsers can't produce natively. That keeps
 * network payloads small and processing essentially instant on device.
 *
 * All passes run in gamma space (like the old sharp pipeline), which is
 * why the established "jernih" look carries over exactly.
 */

import {
  createContext,
  createTextureFromSource,
  createFBO,
  destroyFBO,
  pixelBudget,
  type GLContextInfo,
  type FBO,
} from "./gl-core";
import { Program } from "./program";
import {
  VERT_QUAD,
  FRAG_COPY,
  FRAG_BILATERAL,
  FRAG_RESAMPLE,
  FRAG_GAUSS,
  FRAG_LOCAL_CONTRAST,
  FRAG_SHARPEN,
  FRAG_GRADE,
  FILTER_TO_INT,
} from "./shaders";
import { computeCropBox, fitTargetSize, type AspectRatio } from "./geometry";

export interface CapturePipelineOptions {
  upscale: 1 | 2 | 4;
  aspect: AspectRatio;
  denoise: boolean;
  sharpen: boolean;
  enhance: boolean;
  hdr: boolean;
  /** "Mode Malam" — low-light enhancement */
  nightMode: boolean;
  vignette: boolean;
  filter: string;
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
}

export interface ProcessResult {
  /** JPEG blob (q≈0.97) of the final processed image */
  blob: Blob;
  /** small JPEG preview (max side ~1600) */
  previewBlob: Blob;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

export interface DeviceInfo {
  supported: boolean;
  maxTextureSize: number;
  renderer: string | null;
  maxSide: number;
  maxPixels: number;
}

const RESAMPLE_TAPS = 13;

let cachedInfo: DeviceInfo | null = null;

/**
 * One-time capability probe — creates a 1×1 canvas + context and throws
 * it away immediately. Result is cached.
 */
export function detectWebGL(): DeviceInfo {
  if (cachedInfo) return cachedInfo;
  if (typeof window === "undefined") {
    cachedInfo = {
      supported: false,
      maxTextureSize: 0,
      renderer: null,
      maxSide: 0,
      maxPixels: 0,
    };
    return cachedInfo;
  }
  let info: DeviceInfo = {
    supported: false,
    maxTextureSize: 0,
    renderer: null,
    maxSide: 0,
    maxPixels: 0,
  };
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = createContext(canvas);
    if (ctx) {
      const budget = pixelBudget(ctx.maxTextureSize);
      info = {
        supported: true,
        maxTextureSize: ctx.maxTextureSize,
        renderer: ctx.renderer,
        maxSide: budget.maxSide,
        maxPixels: budget.maxPixels,
      };
      ctx.gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    /* probe failed → server fallback */
  }
  cachedInfo = info;
  return info;
}

interface Stage {
  tex: WebGLTexture;
  w: number;
  h: number;
  /** FBO owning tex; null → tex is the raw source upload */
  fbo: FBO | null;
}

export class WebGLImageProcessor {
  private gl: WebGLRenderingContext;
  private quad: WebGLBuffer;
  private copy: Program;
  private bilateral: Program;
  private resample: Program;
  private gauss: Program;
  private localContrast: Program;
  private sharpen: Program;
  private grade: Program;
  private canvas: HTMLCanvasElement;
  private info: DeviceInfo;
  private statsBuf = new Uint8Array(128 * 192 * 4);
  disposed = false;

  constructor() {
    const probe = detectWebGL();
    if (!probe.supported) throw new Error("WebGL not supported");
    this.info = probe;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1;
    this.canvas.height = 1;
    // preserveDrawingBuffer so canvas.toBlob() sees the last frame
    const ctx: GLContextInfo | null = createContext(this.canvas, {
      preserveDrawingBuffer: true,
    });
    if (!ctx) throw new Error("WebGL context unavailable");
    this.gl = ctx.gl;
    const quad = ctx.gl.createBuffer();
    if (!quad) throw new Error("no buffer");
    this.quad = quad;
    ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, quad);
    ctx.gl.bufferData(
      ctx.gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      ctx.gl.STATIC_DRAW,
    );
    this.copy = new Program(ctx.gl, VERT_QUAD, FRAG_COPY);
    this.bilateral = new Program(ctx.gl, VERT_QUAD, FRAG_BILATERAL);
    this.resample = new Program(ctx.gl, VERT_QUAD, FRAG_RESAMPLE);
    this.gauss = new Program(ctx.gl, VERT_QUAD, FRAG_GAUSS);
    this.localContrast = new Program(ctx.gl, VERT_QUAD, FRAG_LOCAL_CONTRAST);
    this.sharpen = new Program(ctx.gl, VERT_QUAD, FRAG_SHARPEN);
    this.grade = new Program(ctx.gl, VERT_QUAD, FRAG_GRADE);
  }

  get renderer(): string | null {
    return this.info.renderer;
  }

  /**
   * true when a source image of this size can be processed on this GPU
   * without risking texture-limit failures or OOM.
   */
  canProcess(width: number, height: number): boolean {
    return (
      !this.disposed &&
      width <= this.info.maxTextureSize &&
      height <= this.info.maxTextureSize
    );
  }

  /**
   * Full pipeline. Returns JPEG + preview JPEG blobs. Throws on any GL
   * failure — callers must catch and fall back to the server pipeline.
   */
  async process(
    source: ImageBitmap | HTMLCanvasElement,
    o: CapturePipelineOptions,
  ): Promise<ProcessResult> {
    const gl = this.gl;
    if (this.disposed || gl.isContextLost()) throw new Error("GL context lost");
    const srcW = source.width;
    const srcH = source.height;
    if (!srcW || !srcH) throw new Error("empty source bitmap");

    const upload = createTextureFromSource(gl, source);
    if (!upload) throw new Error("source upload failed");

    let cur: Stage = { tex: upload, w: srcW, h: srcH, fbo: null };
    try {
      // ---- 1. aspect crop + bilateral denoise (single pass) ----
      const crop = computeCropBox(cur.w, cur.h, o.aspect);
      const cropChanged = crop.width !== cur.w || crop.height !== cur.h;
      const doDenoise = o.denoise || o.upscale > 1 || o.nightMode;
      if (doDenoise || cropChanged) {
        const uv = cropUV(crop, srcW, srcH);
        const fbo = this.makeFBO(crop.width, crop.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
        if (doDenoise) {
          this.bilateral.f("u_sigmaS", o.nightMode ? 2.1 : 1.7);
          this.bilateral.f("u_sigmaR", o.nightMode ? 0.055 : 0.08);
          this.bilateral.f("u_strength", o.nightMode ? 0.92 : 0.8);
          this.bilateral.v2("u_texel", 1 / cur.w, 1 / cur.h);
          this.bilateral.uvTransform(uv.sx, uv.sy, uv.ox, uv.oy);
          if (!this.bilateral.draw(cur.tex, crop.width, crop.height, this.quad))
            throw new Error("bilateral pass failed");
        } else {
          this.copy.uvTransform(uv.sx, uv.sy, uv.ox, uv.oy);
          if (!this.copy.draw(cur.tex, crop.width, crop.height, this.quad))
            throw new Error("crop pass failed");
        }
        cur = this.advance(cur, { tex: fbo.tex, w: crop.width, h: crop.height, fbo });
      }

      // ---- 2. Lanczos upscale (multi-pass, budget-clamped) ----
      const [targetW, targetH] = fitTargetSize(
        cur.w,
        cur.h,
        o.upscale,
        this.info.maxSide,
        this.info.maxPixels,
        this.info.maxTextureSize,
      );
      if (targetW > cur.w || targetH > cur.h) {
        const before = cur;
        cur = this.resampleTo(cur, targetW, targetH, "upscale");
        if (cur !== before && before.fbo) destroyFBO(gl, before.fbo);
      }

      // ---- 3. auto-exposure from a tiny histogram (enhance) ----
      let autoGain = 1.0;
      if (o.enhance) {
        try {
          autoGain = this.computeAutoGain(cur);
        } catch {
          autoGain = 1.0;
        }
      }

      // ---- 4. grade (filters, night mode, manual adjustments, vignette) ----
      {
        const fbo = this.makeFBO(cur.w, cur.h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
        this.applyGradeUniforms(o, autoGain, cur.w / cur.h);
        this.grade.uvTransform(1, 1, 0, 0);
        if (!this.grade.draw(cur.tex, cur.w, cur.h, this.quad))
          throw new Error("grade pass failed");
        cur = this.advance(cur, { tex: fbo.tex, w: cur.w, h: cur.h, fbo });
      }

      // ---- 5. wide local contrast for HDR / night ----
      if (o.hdr || o.nightMode) {
        cur = this.localContrastPass(cur, o.hdr, o.nightMode);
      }

      // ---- 6. final micro-sharpen ----
      if (o.sharpen) {
        const fbo = this.makeFBO(cur.w, cur.h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
        this.sharpen.v2("u_texel", 1 / cur.w, 1 / cur.h);
        this.sharpen.f("u_amount", o.nightMode ? 0.75 : 0.9);
        this.sharpen.f("u_threshold", 0.004);
        this.sharpen.f("u_limit", 0.06);
        this.sharpen.uvTransform(1, 1, 0, 0);
        if (!this.sharpen.draw(cur.tex, cur.w, cur.h, this.quad))
          throw new Error("sharpen pass failed");
        cur = this.advance(cur, { tex: fbo.tex, w: cur.w, h: cur.h, fbo });
      }

      // ---- 7. preview JPEG (small, via the same resample chain) ----
      const prevMax = 1600;
      const ps = Math.min(1, prevMax / Math.max(cur.w, cur.h));
      const pw = Math.max(2, Math.round(cur.w * ps));
      const ph = Math.max(2, Math.round(cur.h * ps));
      let previewBlob: Blob;
      if (pw < cur.w) {
        const pv = this.resampleTo(cur, pw, ph, "downscale");
        previewBlob = await this.blitToBlob(pv.tex, pv.w, pv.h, "image/jpeg", 0.95);
        if (pv.fbo && pv.fbo !== cur.fbo) destroyFBO(gl, pv.fbo);
      } else {
        previewBlob = await this.blitToBlob(cur.tex, cur.w, cur.h, "image/jpeg", 0.95);
      }

      // ---- 8. final JPEG ----
      const blob = await this.blitToBlob(cur.tex, cur.w, cur.h, "image/jpeg", 0.97);

      return {
        blob,
        previewBlob,
        width: cur.w,
        height: cur.h,
        originalWidth: srcW,
        originalHeight: srcH,
      };
    } finally {
      // Always release GPU memory — even on mid-pipeline failure. All FBOs
      // are tracked in ownedFbos; double-delete is a WebGL no-op, so this
      // sweep is safe together with the per-pass destroys above.
      if (cur.fbo) destroyFBO(gl, cur.fbo);
      for (const f of this.ownedFbos) destroyFBO(gl, f);
      this.ownedFbos = [];
      try {
        gl.deleteTexture(upload);
      } catch {
        /* context lost */
      }
      try {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } catch {
        /* context lost — nothing to clean */
      }
    }
  }

  // ============ internals ============

  private makeFBO(w: number, h: number): FBO {
    const fbo = createFBO(this.gl, w, h);
    if (!fbo) throw new Error(`FBO alloc failed ${w}×${h}`);
    this.ownedFbos.push(fbo);
    return fbo;
  }

  /**
   * Every FBO this processor ever created. WebGL makes double-deletion a
   * documented no-op, so the finally-block sweep guarantees the GPU
   * memory of ANY pipeline (including one that threw mid-way) is freed.
   */
  private ownedFbos: FBO[] = [];

  /** destroy the previous stage's FBO (the upload texture has none). */
  private advance(_prev: Stage, next: Stage): Stage {
    if (_prev.fbo) destroyFBO(this.gl, _prev.fbo);
    return next;
  }

  private applyGradeUniforms(
    o: CapturePipelineOptions,
    autoGain: number,
    aspect: number,
  ) {
    const p = this.grade;
    p.f("u_exposure", o.exposure);
    p.f("u_contrast", o.contrast);
    p.f("u_saturation", o.saturation);
    p.f("u_temperature", o.temperature);
    p.f("u_autoGain", autoGain);
    p.f("u_gamma", 1.02);
    p.f("u_tone", o.hdr ? 0.3 : o.nightMode ? 0.24 : o.enhance ? 0.12 : 0);
    p.f("u_vig", o.vignette ? 1 : 0);
    p.f("u_aspect", aspect);
    p.i("u_filter", FILTER_TO_INT[o.filter] ?? 0);
    p.f("u_night", o.nightMode ? 1 : 0);
  }

  /**
   * Downscale current texture to ~128px wide, readPixels, compute
   * luminance mean; return gain that nudges toward mid-bright. Clamped
   * conservatively so the camera's own metering is only gently assisted.
   */
  private computeAutoGain(cur: Stage): number {
    const gl = this.gl;
    const dw = 128;
    const dh = Math.min(192, Math.max(16, Math.round((dw * cur.h) / cur.w)));
    const small = this.resampleTo(cur, dw, dh, "downscale");
    // small.fbo may be null only if cur is already 128×dh (never in practice)
    const fbo = small.fbo ?? cur.fbo;
    if (!fbo) return 1.0;
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
      gl.readPixels(0, 0, dw, dh, gl.RGBA, gl.UNSIGNED_BYTE, this.statsBuf);
      let sum = 0;
      const n = dw * dh;
      for (let i = 0; i < n; i++) {
        const r = this.statsBuf[i * 4] / 255;
        const g = this.statsBuf[i * 4 + 1] / 255;
        const b = this.statsBuf[i * 4 + 2] / 255;
        sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      const mean = sum / Math.max(1, n);
      let gain = 1.0;
      if (mean > 0.03 && mean < 0.95) {
        gain = Math.min(1.28, Math.max(0.85, (0.42 / mean) * 0.92));
        if (gain > 0.94 && gain < 1.06) gain = 1.0;
      }
      return gain;
    } finally {
      if (small.fbo && small.fbo !== cur.fbo) destroyFBO(gl, small.fbo);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  /**
   * Separable resampling cur → (w,h). Chains intermediate steps so a
   * single pass never scales by more than ~2× (kernel support stays
   * exact). The returned stage owns its FBO (fbo != null).
   */
  private resampleTo(
    cur: Stage,
    w: number,
    h: number,
    mode: "upscale" | "downscale",
  ): Stage {
    const gl = this.gl;
    let tex = cur.tex;
    let cw = cur.w;
    let ch = cur.h;
    let prevFbo: FBO | null = null; // previous INTERMEDIATE fbo (destroyed once superseded)
    const steps = buildScaleSteps(cw, ch, w, h, mode);
    for (const [nw, nh] of steps) {
      const factor = nw / cw;
      const { wts, offs } = lanczosWeights(factor, RESAMPLE_TAPS);
      const hfbo = this.makeFBO(nw, nh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, hfbo.fb);
      this.resample.v2("u_dir", 1, 0);
      this.resample.v2("u_texel", 1 / nw, 1 / nh);
      this.resample.floatArray("u_w", wts);
      this.resample.floatArray("u_off", offs);
      this.resample.uvTransform(1, 1, 0, 0);
      if (!this.resample.draw(tex, nw, nh, this.quad)) {
        destroyFBO(gl, hfbo);
        throw new Error("resample H failed");
      }
      const vfbo = this.makeFBO(nw, nh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, vfbo.fb);
      this.resample.v2("u_dir", 0, 1);
      this.resample.v2("u_texel", 1 / nw, 1 / nh);
      this.resample.floatArray("u_w", wts);
      this.resample.floatArray("u_off", offs);
      this.resample.uvTransform(1, 1, 0, 0);
      if (!this.resample.draw(hfbo.tex, nw, nh, this.quad)) {
        destroyFBO(gl, hfbo);
        destroyFBO(gl, vfbo);
        throw new Error("resample V failed");
      }
      destroyFBO(gl, hfbo);
      if (prevFbo) destroyFBO(gl, prevFbo);
      prevFbo = vfbo;
      tex = vfbo.tex;
      cw = nw;
      ch = nh;
    }
    // NOTE: resampleTo never destroys the INPUT stage's FBO — callers still
    // need the input texture (e.g. the local-contrast combine reads it).
    if (steps.length === 0) return cur; // alias — caller keeps ownership
    return { tex, w: cw, h: ch, fbo: prevFbo };
  }

  /**
   * HDR/night local contrast: quarter-res gaussian base + halo-limited
   * unsharp on luma. Mirrors the server's "HDR local contrast" toggle
   * but without CLAHE (the artifact source).
   */
  private localContrastPass(cur: Stage, hdr: boolean, night: boolean): Stage {
    const gl = this.gl;
    const qw = Math.max(4, cur.w >> 2);
    const qh = Math.max(4, cur.h >> 2);
    const q = this.resampleTo(cur, qw, qh, "downscale");
    let qfbo: FBO;
    if (q.fbo && q.fbo !== cur.fbo) {
      qfbo = q.fbo;
    } else {
      // defensive: (never in practice) copy into a fresh quarter FBO
      qfbo = this.makeFBO(qw, qh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, qfbo.fb);
      this.copy.uvTransform(1, 1, 0, 0);
      if (!this.copy.draw(q.tex, qw, qh, this.quad)) {
        destroyFBO(gl, qfbo);
        throw new Error("quarter copy failed");
      }
    }
    try {
      const b = this.makeFBO(qw, qh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb);
      this.gauss.v2("u_dir", 1, 0);
      this.gauss.v2("u_texel", 1 / qw, 1 / qh);
      this.gauss.uvTransform(1, 1, 0, 0);
      if (!this.gauss.draw(qfbo.tex, qw, qh, this.quad)) {
        destroyFBO(gl, b);
        throw new Error("gauss H failed");
      }
      const b2 = this.makeFBO(qw, qh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, b2.fb);
      this.gauss.v2("u_dir", 0, 1);
      this.gauss.v2("u_texel", 1 / qw, 1 / qh);
      this.gauss.uvTransform(1, 1, 0, 0);
      if (!this.gauss.draw(b.tex, qw, qh, this.quad)) {
        destroyFBO(gl, b);
        destroyFBO(gl, b2);
        throw new Error("gauss V failed");
      }
      destroyFBO(gl, b);
      if (q.fbo && q.fbo !== cur.fbo) destroyFBO(gl, q.fbo);

      const out = this.makeFBO(cur.w, cur.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb);
      this.localContrast.f("u_amount", night ? 0.42 : hdr ? 0.34 : 0.22);
      this.localContrast.f("u_limit", night ? 0.055 : 0.065);
      this.localContrast.uvTransform(1, 1, 0, 0);
      // u_src = cur.tex (unit 0, LINEAR-upsampled quarter in unit 1)
      if (!this.localContrast.draw2(cur.tex, b2.tex, cur.w, cur.h, this.quad)) {
        destroyFBO(gl, out);
        destroyFBO(gl, b2);
        throw new Error("local contrast pass failed");
      }
      destroyFBO(gl, b2);
      if (cur.fbo) destroyFBO(gl, cur.fbo);
      return { tex: out.tex, w: cur.w, h: cur.h, fbo: out };
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  /**
   * Copy a texture into the canvas and await a JPEG blob. The canvas is
   * resized first, so callers can produce several blobs from different
   * sizes without extra GPU memory.
   */
  private blitToBlob(
    tex: WebGLTexture,
    w: number,
    h: number,
    mime: string,
    quality: number,
  ): Promise<Blob> {
    const gl = this.gl;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.copy.uvTransform(1, 1, 0, 0);
    if (!this.copy.draw(tex, w, h, this.quad)) throw new Error("blit failed");
    return new Promise((resolve, reject) => {
      this.canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        mime,
        quality,
      );
    });
  }

  dispose() {
    this.disposed = true;
    try {
      this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      /* nothing to do */
    }
  }
}

// ============================================================
// pure helpers (exported for unit tests)
// ============================================================

/**
 * UV rectangle for cropping a (left,top,width,height) region out of a
 * srcW×srcH texture. Accounts for UNPACK_FLIP_Y_WEBGL (v axis inverted).
 */
export function cropUV(
  crop: { left: number; top: number; width: number; height: number },
  srcW: number,
  srcH: number,
): { sx: number; sy: number; ox: number; oy: number } {
  const sx = crop.width / srcW;
  const sy = crop.height / srcH;
  const ox = crop.left / srcW;
  const oy = 1 - (crop.top + crop.height) / srcH;
  return { sx, sy, ox, oy };
}

/** Lanczos3 kernel value. */
export function lanczos3(x: number): number {
  if (x === 0) return 1;
  const ax = Math.abs(x);
  if (ax >= 3) return 0;
  const pix = Math.PI * x;
  return (Math.sin(pix) / pix) * (Math.sin(pix / 3) / (pix / 3));
}

/**
 * CPU-computed weights for the 13-tap shader.
 * `factor` = dest/source. Offsets are in DEST pixels; weights evaluate
 * the kernel at the corresponding SOURCE-pixel distance (offset / factor).
 */
export function lanczosWeights(
  factor: number,
  taps: number,
): { wts: number[]; offs: number[] } {
  const srcPerDest = 1 / factor;
  const half = (taps - 1) / 2;
  const wts: number[] = [];
  const offs: number[] = [];
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const off = i - half;
    const w = lanczos3(off * srcPerDest);
    wts.push(w);
    offs.push(off);
    sum += w;
  }
  if (sum !== 0 && Math.abs(sum - 1) > 1e-4) {
    for (let i = 0; i < taps; i++) wts[i] /= sum;
  }
  return { wts, offs };
}

/**
 * Intermediate sizes between (w0,h0) and (w1,h1). Aspect-preserving
 * (intermediate heights derive from the SOURCE ratio; the final step is
 * exactly the requested target). Each step scales by at most ~2×.
 */
export function buildScaleSteps(
  w0: number,
  h0: number,
  w1: number,
  h1: number,
  mode: "upscale" | "downscale",
): Array<[number, number]> {
  const steps: Array<[number, number]> = [];
  if (w1 === w0 && h1 === h0) return steps;
  const ratio = h0 / w0;
  let cw = w0;
  let ch = h0;
  if (mode === "upscale") {
    while (cw * 2 < w1) {
      cw = cw * 2;
      ch = Math.max(2, Math.round(cw * ratio));
      steps.push([cw, ch]);
    }
  } else {
    while (cw / 2 > w1) {
      cw = Math.max(w1, Math.floor(cw / 2));
      ch = Math.max(2, Math.round(cw * ratio));
      steps.push([cw, ch]);
    }
  }
  if (cw !== w1 || ch !== h1) steps.push([w1, h1]);
  return steps;
}

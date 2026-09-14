/**
 * WebGLPreviewRenderer — live viewfinder rendered through the SAME grade
 * shader the capture pipeline uses (FRAG_GRADE + VERT_QUAD), so what you
 * see is genuinely what you get: filters, night mode, exposure/contrast/
 * saturation/temperature and vignette all appear in the preview in real
 * time at 60 fps (one texture upload + one fragment pass per frame).
 *
 * If WebGL is unavailable or the context is lost, `onFallback` fires and
 * the app shows the plain <video> element instead — never a crash, never
 * a black screen.
 */

import { createContext, type GLContextInfo } from "./gl-core";
import { Program } from "./program";
import { VERT_QUAD, FRAG_GRADE, FILTER_TO_INT } from "./shaders";
import type { CapturePipelineOptions } from "./processor";

export interface PreviewSettings {
 filter: string;
 nightMode: boolean;
 hdr: boolean;
 enhance: boolean;
 exposure: number;
 contrast: number;
 saturation: number;
 temperature: number;
 vignette: boolean;
 facing: "environment" | "user";
}

export class WebGLPreviewRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private quad: WebGLBuffer;
  private grade: Program;
  private tex: WebGLTexture;
  private raf = 0;
  private running = false;
  private video: HTMLVideoElement | null = null;
  private settings: PreviewSettings = {
    filter: "none",
    nightMode: false,
    hdr: false,
    enhance: false,
    exposure: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
   vignette: false,
   facing: "environment",
  };
private lost = false;

constructor(
    canvas: HTMLCanvasElement,
    private onFallback: () => void,
  ) {
    this.canvas = canvas;
    const ctx: GLContextInfo | null = createContext(canvas, {
      // capture-from-preview is not needed; the photo path uses its own
      // full-res processor. But readback is used by our test harness.
      preserveDrawingBuffer: true,
    });
    if (!ctx) throw new Error("no webgl for preview");
    this.gl = ctx.gl;
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
      this.stop();
      this.onFallback();
    });
    const quad = this.gl.createBuffer();
    if (!quad) throw new Error("no buffer");
    this.quad = quad;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, quad);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      this.gl.STATIC_DRAW,
    );
    this.grade = new Program(this.gl, VERT_QUAD, FRAG_GRADE);
    const tex = this.gl.createTexture();
    if (!tex) throw new Error("no texture");
    this.tex = tex;
    this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      1,
      1,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
}

setSettings(s: PreviewSettings) {
    this.settings = s;
  }

  attach(video: HTMLVideoElement) {
    this.video = video;
  }

  start() {
    if (this.running || this.lost) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.renderFrame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private renderFrame() {
    const video = this.video;
    const gl = this.gl;
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    if (gl.isContextLost()) return;

    // Resize drawing buffer to match CSS size (DPR capped at 2)
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = this.canvas.clientWidth || 1;
    const cssH = this.canvas.clientHeight || 1;
    const bw = Math.max(2, Math.round(cssW * dpr));
    const bh = Math.max(2, Math.round(cssH * dpr));
    if (this.canvas.width !== bw) this.canvas.width = bw;
    if (this.canvas.height !== bh) this.canvas.height = bh;

    try {
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } catch {
      return; // video frame not uploadable right now — skip frame
    }

    // object-cover UV: scale the unit quad to center-crop the video
    const s = this.settings;
    const videoAspect = video.videoWidth / video.videoHeight;
    const canvasAspect = bw / bh;
    let sx = 1;
    let sy = 1;
    if (videoAspect > canvasAspect) {
      sx = canvasAspect / videoAspect;
    } else {
      sy = videoAspect / canvasAspect;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.applyGrade(s, bw / bh);
    this.grade.uvTransform(sx, sy, (1 - sx) / 2, (1 - sy) / 2);
    const flip = s.facing === "user" ? 1 : 0;
    this.grade.flip(flip, 0);
    if (!this.grade.draw(this.tex, bw, bh, this.quad)) {
      // A failed draw on the visible framebuffer → degrade to <video>
      this.stop();
      this.onFallback();
    }
  }

  private applyGrade(s: PreviewSettings, aspect: number) {
    const p = this.grade;
    p.f("u_exposure", s.exposure);
    p.f("u_contrast", s.contrast);
    p.f("u_saturation", s.saturation);
    p.f("u_temperature", s.temperature);
    p.f("u_autoGain", 1);
    p.f("u_gamma", 1.02);
    p.f("u_tone", s.hdr ? 0.3 : s.nightMode ? 0.24 : s.enhance ? 0.12 : 0);
    p.f("u_vig", s.vignette ? 1 : 0);
    p.f("u_aspect", aspect);
    p.i("u_filter", FILTER_TO_INT[s.filter] ?? 0);
    p.f("u_night", s.nightMode ? 1 : 0);
  }

  dispose() {
    this.stop();
    try {
      this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      /* already gone */
    }
  }
}

/**
 * Low-level WebGL helpers shared by the photo processor and the live
 * viewfinder renderer.
 *
 * Design goals:
 * - Works on WebGL1 (GLES 2.0 / GLSL ES 1.00) AND WebGL2 — every shader in
 *   shaders.ts is written in ES 1.00 syntax, which both contexts accept.
 *   This maximizes device coverage (old Android WebViews, Safari iOS 12).
 * - Never throws from inside a render: every helper returns null/false and
 *   the caller falls back (to the server pipeline or the plain <video>
 *   element). "Zero crash" is more important than "zero feature".
 * - Tracks a per-pixel memory budget so we never allocate textures that
 *   OOM a mid-range phone (which would kill the tab mid-capture).
 */

export interface GLContextInfo {
  gl: WebGLRenderingContext;
  /** true when a WebGL2 context was obtained (better float handling) */
  webgl2: boolean;
  /** MAX_TEXTURE_SIZE — the largest square texture this GPU can allocate */
  maxTextureSize: number;
  /** renderer string from WEBGL_debug_renderer_info (may be null) */
  renderer: string | null;
}

export function createContext(
  canvas: HTMLCanvasElement,
  opts: { preserveDrawingBuffer?: boolean } = {},
): GLContextInfo | null {
  const attrs: WebGLContextAttributes = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    powerPreference: "high-performance",
    failIfMajorPerformanceCaveat: false,
  };
  let gl: WebGLRenderingContext | null = null;
  let webgl2 = false;
  try {
    gl = canvas.getContext("webgl2", attrs) as WebGLRenderingContext | null;
    if (gl) webgl2 = true;
  } catch {
    gl = null;
  }
  if (!gl) {
    try {
      gl =
        (canvas.getContext("webgl", attrs) as WebGLRenderingContext | null) ||
        (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    } catch {
      gl = null;
    }
  }
  if (!gl) return null;

  let renderer: string | null = null;
  try {
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (dbg) {
      renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "");
    }
  } catch {
    /* not exposed — fine */
  }

  let maxTextureSize = 2048;
  try {
    maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 2048;
  } catch {
    /* keep conservative default */
  }

  // Unpack from <img>/<video>/ImageBitmap top-down so we don't have to
  // flip UVs in every shader.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

  return { gl, webgl2, maxTextureSize, renderer };
}

export function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("[gl] shader compile failed:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function linkProgram(
  gl: WebGLRenderingContext,
  vsSource: string,
  fsSource: string,
): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "a_pos");
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("[gl] program link failed:", gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

/** Fullscreen quad (-1..1) in a shared buffer. VAO not needed on ES 2.0. */
export function createQuadBuffer(gl: WebGLRenderingContext): WebGLBuffer | null {
  const buf = gl.createBuffer();
  if (!buf) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  return buf;
}

export function createTexture(
  gl: WebGLRenderingContext,
  width: number,
  height: number,
): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  // Clamp + LINEAR is what we want for image ops; no mipmaps needed.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** Texture bound with LINEAR filtering for a source that's already uploaded. */
export function createTextureFromSource(
  gl: WebGLRenderingContext,
  source: TexImageSource,
): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  } catch (e) {
    console.warn("[gl] texture upload failed:", e);
    gl.deleteTexture(tex);
    return null;
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export interface FBO {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
}

export function createFBO(
  gl: WebGLRenderingContext,
  width: number,
  height: number,
): FBO | null {
  const tex = createTexture(gl, width, height);
  if (!tex) return null;
  const fb = gl.createFramebuffer();
  if (!fb) {
    gl.deleteTexture(tex);
    return null;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    console.warn("[gl] FBO incomplete:", status);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
    return null;
  }
  return { fb, tex, width, height };
}

export function destroyFBO(gl: WebGLRenderingContext, fbo: FBO | null) {
  if (!fbo) return;
  try {
    gl.deleteFramebuffer(fbo.fb);
    gl.deleteTexture(fbo.tex);
  } catch {
    /* context may already be lost — nothing to clean */
  }
}

/**
 * Bind a program + the quad attribute + the source texture, and draw once.
 * All our passes share this pattern.
 */
export function drawPass(
  gl: WebGLRenderingContext,
  prog: WebGLProgram,
  quad: WebGLBuffer,
  tex: WebGLTexture,
  viewportW: number,
  viewportH: number,
): boolean {
  gl.getError(); // clear any sticky error from an earlier call
  gl.viewport(0, 0, viewportW, viewportH);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const uTex = gl.getUniformLocation(prog, "u_tex");
  if (uTex) gl.uniform1i(uTex, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return gl.getError() === gl.NO_ERROR;
}

/**
 * Total-pixel budget for full-res processing textures, derived from the
 * GPU's max texture size. Each RGBA8 pixel is 4 bytes; we keep at most
 * ~2 full-res textures alive at once (~256 MB worst case on high-end),
 * so we cap working resolution accordingly:
 *
 * - maxTextureSize >= 8192 (flagship Adreno/Mali): allow up to 40 MP
 *   (e.g. 7400×5400) — effectively the same ceiling the old server's
 *   MAX_SIDE=8000 clamp produced, without risking a 192MB texture pair.
 * - maxTextureSize >= 4096 (mid-range): 16 MP (e.g. 4096×3900 max side 4096).
 * - smaller: 6 MP.
 */
export function pixelBudget(maxTextureSize: number): {
 maxSide: number;
 maxPixels: number;
} {
 if (maxTextureSize >= 8192) return { maxSide: 8000, maxPixels: 40_000_000 };
 if (maxTextureSize >= 4096) return { maxSide: 4096, maxPixels: 16_000_000 };
 return { maxSide: 3072, maxPixels: 6_000_000 };
}

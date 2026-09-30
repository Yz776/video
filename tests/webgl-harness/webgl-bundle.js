// src/components/camera/webgl/gl-core.ts
function createContext(canvas, opts = {}) {
  const attrs = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    powerPreference: "high-performance",
    failIfMajorPerformanceCaveat: false
  };
  let gl = null;
  let webgl2 = false;
  try {
    gl = canvas.getContext("webgl2", attrs);
    if (gl) webgl2 = true;
  } catch {
    gl = null;
  }
  if (!gl) {
    try {
      gl = canvas.getContext("webgl", attrs) || canvas.getContext("experimental-webgl");
    } catch {
      gl = null;
    }
  }
  if (!gl) return null;
  let renderer = null;
  try {
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (dbg) {
      renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "");
    }
  } catch {
  }
  let maxTextureSize = 2048;
  try {
    maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 2048;
  } catch {
  }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  return { gl, webgl2, maxTextureSize, renderer };
}
function compileShader(gl, type, source) {
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
function linkProgram(gl, vsSource, fsSource) {
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
function createTexture(gl, width, height) {
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
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}
function createTextureFromSource(gl, source) {
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
function createFBO(gl, width, height) {
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
function destroyFBO(gl, fbo) {
  if (!fbo) return;
  try {
    gl.deleteFramebuffer(fbo.fb);
    gl.deleteTexture(fbo.tex);
  } catch {
  }
}
function drawPass(gl, prog, quad, tex, viewportW, viewportH) {
  gl.getError();
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
function pixelBudget(maxTextureSize) {
  if (maxTextureSize >= 8192) return { maxSide: 8e3, maxPixels: 4e7 };
  if (maxTextureSize >= 4096) return { maxSide: 4096, maxPixels: 16e6 };
  return { maxSide: 3072, maxPixels: 6e6 };
}

// src/components/camera/webgl/program.ts
var Program = class {
  constructor(gl, vsSource, fsSource) {
    this.gl = gl;
    this.locs = /* @__PURE__ */ new Map();
    const p = linkProgram(gl, vsSource, fsSource);
    if (!p) throw new Error("shader link failed");
    this.prog = p;
  }
  /**
   * CRITICAL: gl.uniform* applies to whatever program is CURRENTLY in use —
   * setting uniforms before useProgram() silently fails (GL_INVALID_OPERATION,
   * uniform keeps its default) and the render comes out as a solid color
   * sampled from texel (0,0). Every setter therefore binds the program first.
   */
  use() {
    this.gl.useProgram(this.prog);
  }
  loc(name) {
    this.use();
    if (!this.locs.has(name)) {
      this.locs.set(name, this.gl.getUniformLocation(this.prog, name));
    }
    return this.locs.get(name) ?? null;
  }
  f(name, v) {
    this.use();
    const l = this.loc(name);
    if (l) this.gl.uniform1f(l, v);
  }
  i(name, v) {
    this.use();
    const l = this.loc(name);
    if (l) this.gl.uniform1i(l, v);
  }
  v2(name, x, y) {
    this.use();
    const l = this.loc(name);
    if (l) this.gl.uniform2f(l, x, y);
  }
  /** uv crop transform for the quad vertex shader */
  uvTransform(scaleX, scaleY, offX, offY) {
    this.v2("u_uvScale", scaleX, scaleY);
    this.v2("u_uvOffset", offX, offY);
  }
  flip(x, y) {
    this.v2("u_flip", x, y);
  }
  floatArray(name, arr) {
    this.use();
    const l = this.loc(name);
    if (l) this.gl.uniform1fv(l, arr);
  }
  draw(tex, w, h, quad) {
    this.use();
    return drawPass(this.gl, this.prog, quad, tex, w, h);
  }
  /** draw with a second texture bound to unit 1 */
  draw2(tex0, tex1, w, h, quad) {
    const gl = this.gl;
    gl.getError();
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex0);
    this.i("u_tex", 0);
    const uSrc = this.loc("u_src");
    if (uSrc) gl.uniform1i(uSrc, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex1);
    this.i("u_blur", 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
    return gl.getError() === gl.NO_ERROR;
  }
};

// src/components/camera/webgl/shaders.ts
var PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;
var VERT_QUAD = `
attribute vec2 a_pos;
varying vec2 v_uv;
uniform vec2 u_uvScale;
uniform vec2 u_uvOffset;
uniform vec2 u_flip;
void main() {
  vec2 uv = a_pos * 0.5 + 0.5;
  uv = uv * u_uvScale + u_uvOffset;
  uv.x = mix(uv.x, 1.0 - uv.x, u_flip.x);
  uv.y = mix(uv.y, 1.0 - uv.y, u_flip.y);
  v_uv = uv;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;
var FRAG_COPY = `
${PRECISION}
varying vec2 v_uv;
uniform sampler2D u_tex;
void main() {
  gl_FragColor = vec4(texture2D(u_tex, v_uv).rgb, 1.0);
}
`;
var FRAG_BILATERAL = `
${PRECISION}
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;      // 1.0 / texture size
uniform float u_sigmaS;    // spatial sigma (pixels)
uniform float u_sigmaR;    // range sigma (luma 0..1)
uniform float u_strength;  // 0..1 blend with original (1 = full denoise)

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec4 src = texture2D(u_tex, v_uv);
  float cL = luma(src.rgb);
  vec3 sum = src.rgb;
  float wsum = 1.0;
  float s2 = 2.0 * u_sigmaS * u_sigmaS;
  float r2 = 2.0 * u_sigmaR * u_sigmaR + 1e-6;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      if (x == 0 && y == 0) continue;
      vec2 uv = v_uv + vec2(float(x), float(y)) * u_texel;
      vec3 c = texture2D(u_tex, uv).rgb;
      float dl = luma(c) - cL;
      float ws = exp(-float(x * x + y * y) / s2);
      float wr = exp(-dl * dl / r2);
      float w = ws * wr;
      sum += c * w;
      wsum += w;
    }
  }
  vec3 den = sum / wsum;
  gl_FragColor = vec4(mix(src.rgb, den, u_strength), 1.0);
}
`;
var FRAG_RESAMPLE = `
${PRECISION}
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_dir;
uniform vec2 u_texel;
uniform float u_w[13];
uniform float u_off[13];

void main() {
  vec3 acc = vec3(0.0);
  float tw = 0.0;
  for (int i = 0; i < 13; i++) {
    vec2 uv = v_uv + u_dir * u_off[i] * u_texel;
    acc += texture2D(u_tex, uv).rgb * u_w[i];
    tw += u_w[i];
  }
  gl_FragColor = vec4(acc / max(tw, 1e-6), 1.0);
}
`;
var FRAG_GAUSS = `
${PRECISION}
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_dir;
uniform vec2 u_texel;
const float W0 = 0.2270270270;
const float W1 = 0.1945945946;
const float W2 = 0.1216216216;
const float W3 = 0.0540540541;
const float W4 = 0.0162162162;
void main() {
  vec3 c = texture2D(u_tex, v_uv).rgb * W0;
  c += (texture2D(u_tex, v_uv + u_dir * 1.0 * u_texel).rgb +
        texture2D(u_tex, v_uv - u_dir * 1.0 * u_texel).rgb) * W1;
  c += (texture2D(u_tex, v_uv + u_dir * 2.0 * u_texel).rgb +
        texture2D(u_tex, v_uv - u_dir * 2.0 * u_texel).rgb) * W2;
  c += (texture2D(u_tex, v_uv + u_dir * 3.0 * u_texel).rgb +
        texture2D(u_tex, v_uv - u_dir * 3.0 * u_texel).rgb) * W3;
  c += (texture2D(u_tex, v_uv + u_dir * 4.0 * u_texel).rgb +
        texture2D(u_tex, v_uv - u_dir * 4.0 * u_texel).rgb) * W4;
  gl_FragColor = vec4(c, 1.0);
}
`;
var FRAG_LOCAL_CONTRAST = `
${PRECISION}
varying vec2 v_uv;
uniform sampler2D u_src;   // full-res graded image (unit 0)
uniform sampler2D u_blur;  // quarter-res gaussian base (unit 1) \u2014 LINEAR-upsampled
uniform float u_amount;
uniform float u_limit;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec3 c = texture2D(u_src, v_uv).rgb;
  float lb = luma(texture2D(u_blur, v_uv).rgb);
  float ls = luma(c);
  float d = (ls - lb) * u_amount;
  d = clamp(d, -u_limit, u_limit);
  // suppress halos near clipping blacks/whites
  float guard = smoothstep(0.0, 0.08, ls) * (1.0 - smoothstep(0.90, 1.0, ls));
  d *= guard;
  vec3 outc = (c - vec3(ls)) + vec3(clamp(ls + d, 0.0, 1.0));
  gl_FragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
}
`;
var FRAG_SHARPEN = `
${PRECISION}
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_amount;
uniform float u_threshold;
uniform float u_limit;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec3 c = texture2D(u_tex, v_uv).rgb;
  vec3 sum = texture2D(u_tex, v_uv + vec2(-1.0, -1.0) * u_texel).rgb +
             texture2D(u_tex, v_uv + vec2( 0.0, -1.0) * u_texel).rgb +
             texture2D(u_tex, v_uv + vec2( 1.0, -1.0) * u_texel).rgb +
             texture2D(u_tex, v_uv + vec2(-1.0,  0.0) * u_texel).rgb +
             c +
             texture2D(u_tex, v_uv + vec2( 1.0,  0.0) * u_texel).rgb +
             texture2D(u_tex, v_uv + vec2(-1.0,  1.0) * u_texel).rgb +
             texture2D(u_tex, v_uv + vec2( 0.0,  1.0) * u_texel).rgb +
             texture2D(u_tex, v_uv + vec2( 1.0,  1.0) * u_texel).rgb;
  vec3 g = sum / 9.0;
  float ls = luma(c);
  float lg = luma(g);
  float d = ls - lg;
  float ad = abs(d);
  if (ad > u_threshold) {
    // soft-knee response: linear below the limit, saturating above
    d = sign(d) * (1.0 - exp(-ad / u_limit)) * u_limit;
    d *= u_amount;
  } else {
    d = 0.0;
  }
  vec3 outc = (c - vec3(ls)) + vec3(clamp(ls + d, 0.0, 1.0));
  gl_FragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
}
`;
var FRAG_GRADE = `
${PRECISION}
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_exposure;   // -1..1 (EV-ish, mapped like server: 2^(x*0.35))
uniform float u_contrast;   // -1..1
uniform float u_saturation; // -1..1
uniform float u_temperature;// -1..1 (warm..cool)
uniform float u_autoGain;   // 1.0 = neutral (from histogram auto-enhance)
uniform float u_gamma;      // exponent applied as pow(c, 1/gamma)
uniform float u_tone;       // filmic rolloff strength 0..1
uniform float u_vig;        // vignette amount 0..1
uniform float u_aspect;     // width/height of this pass
uniform int u_filter;       // see FILTER_* below
uniform float u_night;      // 0 or 1 night mode

const int FILTER_NONE = 0;
const int FILTER_VIVID = 1;
const int FILTER_MONO = 2;
const int FILTER_WARM = 3;
const int FILTER_COOL = 4;
const int FILTER_CINEMA = 5;
const int FILTER_NIGHT = 6;
const int FILTER_VINTAGE = 7;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 satMul(vec3 c, float s) {
  float l = luma(c);
  return mix(vec3(l), c, s);
}
vec3 linMulAdd(vec3 c, float mul, float add255) {
  return max(vec3(0.0), c * mul + vec3(add255 / 255.0));
}

vec3 filmic(vec3 x) {
  // gentle ACES-like shoulder, only rolloffs highlights, keeps midtones
  vec3 a = x * (2.51 * x + 0.03);
  vec3 b = x * (2.43 * x + 0.59) + 0.14;
  return clamp(a / b, 0.0, 1.0);
}

void main() {
  vec3 c = texture2D(u_tex, v_uv).rgb;
  float l;

  // --- exposure + auto gain ---
  c *= pow(2.0, u_exposure * 0.35) * u_autoGain;

  // --- contrast (around mid-grey, like sharp linear()) ---
  c = (c - 0.5) * (1.0 + u_contrast * 0.4) + 0.5;

  // --- temperature: warm (t>0) pushes R up / B down, cool (t<0) the inverse
  c.r *= 1.0 + u_temperature * 0.08;
  c.b *= 1.0 - u_temperature * 0.08;
  c.g *= 1.0 - abs(u_temperature) * 0.04;

  // --- user saturation (mono override keeps it 0 like the server) ---
  float userSat = (u_filter == FILTER_MONO) ? 0.0 : (1.0 + u_saturation * 0.5);
  c = satMul(c, userSat);

  // --- filter presets (mirror the server's modulate/tint/linear chains) ---
  if (u_filter == FILTER_VIVID) {
    c = satMul(c, 1.35);
    c = linMulAdd(c * 1.04, 1.08, -8.0);
  } else if (u_filter == FILTER_MONO) {
    l = luma(c);
    c = linMulAdd(vec3(l), 1.10, -10.0);
  } else if (u_filter == FILTER_WARM) {
    c = satMul(c, 1.15) * 1.03;
    c.r *= 1.0; c.g *= 0.90; c.b *= 0.80;
  } else if (u_filter == FILTER_COOL) {
    c = satMul(c, 1.10) * 1.02;
    c.r *= 0.86; c.g *= 0.93; c.b *= 1.0;
  } else if (u_filter == FILTER_CINEMA) {
    c = satMul(c, 1.2);
    c *= 0.98;
    c = linMulAdd(c, 1.12, -12.0);
    c.r *= 1.0; c.g *= 0.882; c.b *= 0.784;
  } else if (u_filter == FILTER_NIGHT) {
    c *= 1.18;
    c = satMul(c, 0.9);
    c = linMulAdd(c, 1.15, -18.0);
  } else if (u_filter == FILTER_VINTAGE) {
    c = satMul(c, 0.85);
    c *= 1.05;
    c.r *= 1.0; c.g *= 0.863; c.b *= 0.667;
    c = linMulAdd(c, 0.95, 8.0);
  }

  // --- NIGHT MODE (u_night): low-light enhancement ---
  if (u_night > 0.5) {
    // Lift shadows with a squared falloff: boosts dark pixels, leaves
    // highlights alone \u2192 the classic "mode malam" clean brightness.
    l = luma(c);
    float lift = (1.0 - l) * (1.0 - l);
    c += vec3(0.10, 0.11, 0.13) * lift * lift;
    // Neutralize green/orange sodium-streetlight cast slightly.
    c = satMul(c, 0.94);
    // Gamma lift for perceived clarity in the darks.
    c = pow(max(c, vec3(0.0)), vec3(1.0 / 1.08));
  }

  // --- auto-enhance look (like server: modest brightness/sat + linear lift)
  if (u_autoGain != 1.0) {
    c = satMul(c, 1.02);
    c = linMulAdd(c, 1.02, -2.0);
  }

  // --- gamma ---
  c = pow(max(c, vec3(0.0)), vec3(1.0 / u_gamma));

  // --- filmic rolloff (tone) ---
  if (u_tone > 0.001) {
    c = mix(c, filmic(c), u_tone);
  }

  // --- vignette ---
  if (u_vig > 0.001) {
    vec2 d = (v_uv - 0.5) * vec2(u_aspect, 1.0);
    float r = length(d) / length(vec2(u_aspect, 1.0) * 0.5);
    float v = smoothstep(0.65, 1.0, r);
    c *= (1.0 - 0.45 * v * u_vig);
  }

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
var FILTER_TO_INT = {
  none: 0,
  vivid: 1,
  mono: 2,
  warm: 3,
  cool: 4,
  cinema: 5,
  night: 6,
  vintage: 7
};

// src/components/camera/webgl/geometry.ts
function aspectRatioValue(a) {
  switch (a) {
    case "1:1":
      return 1;
    case "4:3":
      return 4 / 3;
    case "16:9":
      return 16 / 9;
    case "3:4":
      return 3 / 4;
    default:
      return null;
  }
}
function computeCropBox(w, h, aspect) {
  const ar = aspectRatioValue(aspect);
  if (ar == null) return { left: 0, top: 0, width: w, height: h };
  const current = w / h;
  if (Math.abs(current - ar) < 0.01) {
    return { left: 0, top: 0, width: w, height: h };
  }
  if (current > ar) {
    const newW = Math.round(h * ar);
    const left = Math.round((w - newW) / 2);
    return { left, top: 0, width: newW, height: h };
  }
  const newH = Math.round(w / ar);
  const top = Math.round((h - newH) / 2);
  return { left: 0, top, width: w, height: newH };
}
function fitTargetSize(srcW, srcH, upscale, maxSide, maxPixels, maxTextureSize) {
  const capSide = Math.min(maxSide, maxTextureSize);
  let w = srcW * upscale;
  let h = srcH * upscale;
  if (Math.max(w, h) > capSide) {
    const s = capSide / Math.max(w, h);
    w *= s;
    h *= s;
  }
  const px = w * h;
  if (px > maxPixels) {
    const s = Math.sqrt(maxPixels / px);
    w *= s;
    h *= s;
  }
  w = Math.round(Math.min(w, capSide));
  h = Math.round(Math.min(h, capSide));
  return [Math.max(2, w), Math.max(2, h)];
}

// src/components/camera/webgl/processor.ts
var RESAMPLE_TAPS = 13;
var cachedInfo = null;
function detectWebGL() {
  if (cachedInfo) return cachedInfo;
  if (typeof window === "undefined") {
    cachedInfo = {
      supported: false,
      maxTextureSize: 0,
      renderer: null,
      maxSide: 0,
      maxPixels: 0
    };
    return cachedInfo;
  }
  let info = {
    supported: false,
    maxTextureSize: 0,
    renderer: null,
    maxSide: 0,
    maxPixels: 0
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
        maxPixels: budget.maxPixels
      };
      ctx.gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
  }
  cachedInfo = info;
  return info;
}
var WebGLImageProcessor = class {
  constructor() {
    this.statsBuf = new Uint8Array(128 * 192 * 4);
    this.disposed = false;
    /**
     * Every FBO this processor ever created. WebGL makes double-deletion a
     * documented no-op, so the finally-block sweep guarantees the GPU
     * memory of ANY pipeline (including one that threw mid-way) is freed.
     */
    this.ownedFbos = [];
    const probe = detectWebGL();
    if (!probe.supported) throw new Error("WebGL not supported");
    this.info = probe;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1;
    this.canvas.height = 1;
    const ctx = createContext(this.canvas, {
      preserveDrawingBuffer: true
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
      ctx.gl.STATIC_DRAW
    );
    this.copy = new Program(ctx.gl, VERT_QUAD, FRAG_COPY);
    this.bilateral = new Program(ctx.gl, VERT_QUAD, FRAG_BILATERAL);
    this.resample = new Program(ctx.gl, VERT_QUAD, FRAG_RESAMPLE);
    this.gauss = new Program(ctx.gl, VERT_QUAD, FRAG_GAUSS);
    this.localContrast = new Program(ctx.gl, VERT_QUAD, FRAG_LOCAL_CONTRAST);
    this.sharpen = new Program(ctx.gl, VERT_QUAD, FRAG_SHARPEN);
    this.grade = new Program(ctx.gl, VERT_QUAD, FRAG_GRADE);
  }
  get renderer() {
    return this.info.renderer;
  }
  /**
   * true when a source image of this size can be processed on this GPU
   * without risking texture-limit failures or OOM.
   */
  canProcess(width, height) {
    return !this.disposed && width <= this.info.maxTextureSize && height <= this.info.maxTextureSize;
  }
  /**
   * Full pipeline. Returns JPEG + preview JPEG blobs. Throws on any GL
   * failure — callers must catch and fall back to the server pipeline.
   */
  async process(source, o) {
    const gl = this.gl;
    if (this.disposed || gl.isContextLost()) throw new Error("GL context lost");
    const srcW = source.width;
    const srcH = source.height;
    if (!srcW || !srcH) throw new Error("empty source bitmap");
    const upload = createTextureFromSource(gl, source);
    if (!upload) throw new Error("source upload failed");
    let cur = { tex: upload, w: srcW, h: srcH, fbo: null };
    try {
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
      const [targetW, targetH] = fitTargetSize(
        cur.w,
        cur.h,
        o.upscale,
        this.info.maxSide,
        this.info.maxPixels,
        this.info.maxTextureSize
      );
      if (targetW > cur.w || targetH > cur.h) {
        const before = cur;
        cur = this.resampleTo(cur, targetW, targetH, "upscale");
        if (cur !== before && before.fbo) destroyFBO(gl, before.fbo);
      }
      let autoGain = 1;
      if (o.enhance) {
        try {
          autoGain = this.computeAutoGain(cur);
        } catch {
          autoGain = 1;
        }
      }
      {
        const fbo = this.makeFBO(cur.w, cur.h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
        this.applyGradeUniforms(o, autoGain, cur.w / cur.h);
        this.grade.uvTransform(1, 1, 0, 0);
        if (!this.grade.draw(cur.tex, cur.w, cur.h, this.quad))
          throw new Error("grade pass failed");
        cur = this.advance(cur, { tex: fbo.tex, w: cur.w, h: cur.h, fbo });
      }
      if (o.hdr || o.nightMode) {
        cur = this.localContrastPass(cur, o.hdr, o.nightMode);
      }
      if (o.sharpen) {
        const fbo = this.makeFBO(cur.w, cur.h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
        this.sharpen.v2("u_texel", 1 / cur.w, 1 / cur.h);
        this.sharpen.f("u_amount", o.nightMode ? 0.75 : 0.9);
        this.sharpen.f("u_threshold", 4e-3);
        this.sharpen.f("u_limit", 0.06);
        this.sharpen.uvTransform(1, 1, 0, 0);
        if (!this.sharpen.draw(cur.tex, cur.w, cur.h, this.quad))
          throw new Error("sharpen pass failed");
        cur = this.advance(cur, { tex: fbo.tex, w: cur.w, h: cur.h, fbo });
      }
      const prevMax = 1600;
      const ps = Math.min(1, prevMax / Math.max(cur.w, cur.h));
      const pw = Math.max(2, Math.round(cur.w * ps));
      const ph = Math.max(2, Math.round(cur.h * ps));
      let previewBlob;
      if (pw < cur.w) {
        const pv = this.resampleTo(cur, pw, ph, "downscale");
        previewBlob = await this.blitToBlob(pv.tex, pv.w, pv.h, "image/jpeg", 0.95);
        if (pv.fbo && pv.fbo !== cur.fbo) destroyFBO(gl, pv.fbo);
      } else {
        previewBlob = await this.blitToBlob(cur.tex, cur.w, cur.h, "image/jpeg", 0.95);
      }
      const blob = await this.blitToBlob(cur.tex, cur.w, cur.h, "image/jpeg", 0.97);
      return {
        blob,
        previewBlob,
        width: cur.w,
        height: cur.h,
        originalWidth: srcW,
        originalHeight: srcH
      };
    } finally {
      if (cur.fbo) destroyFBO(gl, cur.fbo);
      for (const f of this.ownedFbos) destroyFBO(gl, f);
      this.ownedFbos = [];
      try {
        gl.deleteTexture(upload);
      } catch {
      }
      try {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } catch {
      }
    }
  }
  // ============ internals ============
  makeFBO(w, h) {
    const fbo = createFBO(this.gl, w, h);
    if (!fbo) throw new Error(`FBO alloc failed ${w}\xD7${h}`);
    this.ownedFbos.push(fbo);
    return fbo;
  }
  /** destroy the previous stage's FBO (the upload texture has none). */
  advance(_prev, next) {
    if (_prev.fbo) destroyFBO(this.gl, _prev.fbo);
    return next;
  }
  applyGradeUniforms(o, autoGain, aspect) {
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
  computeAutoGain(cur) {
    const gl = this.gl;
    const dw = 128;
    const dh = Math.min(192, Math.max(16, Math.round(dw * cur.h / cur.w)));
    const small = this.resampleTo(cur, dw, dh, "downscale");
    const fbo = small.fbo ?? cur.fbo;
    if (!fbo) return 1;
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
      let gain = 1;
      if (mean > 0.03 && mean < 0.95) {
        gain = Math.min(1.28, Math.max(0.85, 0.42 / mean * 0.92));
        if (gain > 0.94 && gain < 1.06) gain = 1;
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
  resampleTo(cur, w, h, mode) {
    const gl = this.gl;
    let tex = cur.tex;
    let cw = cur.w;
    let ch = cur.h;
    let prevFbo = null;
    const steps = buildScaleSteps(cw, ch, w, h, mode);
    for (const [nw, nh] of steps) {
      const factorX = nw / cw;
      const factorY = nh / ch;
      const { wts: wx, offs: ox } = lanczosWeights(factorX, RESAMPLE_TAPS);
      const { wts: wy, offs: oy } = lanczosWeights(factorY, RESAMPLE_TAPS);
      const hfbo = this.makeFBO(nw, ch);
      gl.bindFramebuffer(gl.FRAMEBUFFER, hfbo.fb);
      this.resample.v2("u_dir", 1, 0);
      this.resample.v2("u_texel", 1 / nw, 1 / ch);
      this.resample.floatArray("u_w", wx);
      this.resample.floatArray("u_off", ox);
      this.resample.uvTransform(1, 1, 0, 0);
      if (!this.resample.draw(tex, nw, ch, this.quad)) {
        destroyFBO(gl, hfbo);
        throw new Error("resample H failed");
      }
      const vfbo = this.makeFBO(nw, nh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, vfbo.fb);
      this.resample.v2("u_dir", 0, 1);
      this.resample.v2("u_texel", 1 / nw, 1 / nh);
      this.resample.floatArray("u_w", wy);
      this.resample.floatArray("u_off", oy);
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
    if (steps.length === 0) return cur;
    return { tex, w: cw, h: ch, fbo: prevFbo };
  }
  /**
   * HDR/night local contrast: quarter-res gaussian base + halo-limited
   * unsharp on luma. Mirrors the server's "HDR local contrast" toggle
   * but without CLAHE (the artifact source).
   */
  localContrastPass(cur, hdr, night) {
    const gl = this.gl;
    const qw = Math.max(4, cur.w >> 2);
    const qh = Math.max(4, cur.h >> 2);
    const q = this.resampleTo(cur, qw, qh, "downscale");
    let qfbo;
    if (q.fbo && q.fbo !== cur.fbo) {
      qfbo = q.fbo;
    } else {
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
  blitToBlob(tex, w, h, mime, quality) {
    const gl = this.gl;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.copy.uvTransform(1, 1, 0, 0);
    if (!this.copy.draw(tex, w, h, this.quad)) throw new Error("blit failed");
    return new Promise((resolve, reject) => {
      this.canvas.toBlob(
        (b) => b ? resolve(b) : reject(new Error("toBlob failed")),
        mime,
        quality
      );
    });
  }
  dispose() {
    this.disposed = true;
    try {
      this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
    }
  }
};
function cropUV(crop, srcW, srcH) {
  const sx = crop.width / srcW;
  const sy = crop.height / srcH;
  const ox = crop.left / srcW;
  const oy = 1 - (crop.top + crop.height) / srcH;
  return { sx, sy, ox, oy };
}
function lanczos3(x) {
  if (x === 0) return 1;
  const ax = Math.abs(x);
  if (ax >= 3) return 0;
  const pix = Math.PI * x;
  return Math.sin(pix) / pix * (Math.sin(pix / 3) / (pix / 3));
}
function lanczosWeights(factor, taps) {
  const srcPerDest = 1 / factor;
  const half = (taps - 1) / 2;
  const wts = [];
  const offs = [];
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
function buildScaleSteps(w0, h0, w1, h1, mode) {
  const steps = [];
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
export {
  WebGLImageProcessor,
  buildScaleSteps,
  cropUV,
  detectWebGL,
  lanczos3,
  lanczosWeights
};

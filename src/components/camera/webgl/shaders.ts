/**
 * GLSL ES 1.00 fragment shaders for the WebGL camera pipeline.
 *
 * Written for the lowest common denominator (WebGL1 / GLES2) so the same
 * source runs on WebGL2 contexts too. All shaders use the `#ifdef
 * GL_FRAGMENT_PRECISION_HIGH` guard for GPUs without highp in the fragment
 * stage (very old devices) and gracefully fall back to mediump.
 *
 * Color math is done in *gamma space* (values as stored in the JPEG),
 * matching the previous server-side sharp pipeline's behavior so results
 * look consistent with the established "kangwifi cam" rendering style.
 */

const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

/**
 * Fullscreen-quad vertex shader.
 *
 * u_uvScale/u_uvOffset map the quad to a sub-rectangle of the source
 * texture (used for aspect cropping and for the preview's object-cover).
 * u_flip mirrors the sampling per-axis (selfie viewfinder).
 */
export const VERT_QUAD = `
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

/** Simple copy — used as last output blit. */
export const FRAG_COPY = `
${PRECISION}
varying vec2 v_uv;
uniform sampler2D u_tex;
void main() {
  gl_FragColor = vec4(texture2D(u_tex, v_uv).rgb, 1.0);
}
`;

/**
 * Edge-preserving bilateral denoise (5×5 window, luma-weighted).
 *
 * Kills sensor noise and JPEG 8×8 DCT block boundaries WITHOUT blurring
 * real edges — critical for the "no pecah-pecah" upscale: any block
 * boundary left in the source gets magnified into a visible grid by
 * lanczos. Because the range weight uses luma distance, flat noisy
 * regions smooth hard while edges (big luma step) stay crisp.
 *
 * u_sigmaR controls the range (intensity) sigma — night mode lowers the
 * effective denoise radius differently via u_strength.
 */
export const FRAG_BILATERAL = `
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

/**
 * Separable resampling (upscale/downscale). Weights come from the CPU:
 * lanczos3 evaluated at each tap's distance in SOURCE pixels, which keeps
 * the shader a dumb 13-tap dot product and makes the kernel exact for any
 * scale factor. For downscaling the CPU halves the image until the factor
 * is <= 2.3, so 13 taps (radius 6) always covers the 3-source-px support.
 *
 * u_dir = (1,0) horizontal / (0,1) vertical. u_texel in DEST space.
 */
export const FRAG_RESAMPLE = `
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

/**
 * Separable gaussian blur (9 taps). Used on the quarter-res base image
 * for the HDR-style local contrast pass, so it's very cheap.
 */
export const FRAG_GAUSS = `
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

/**
 * HDR-style local contrast ("clairvoyance" light).
 *
 * Adds (luma - blurred luma) back to the image — an unsharp mask on a
 * WIDE radius, i.e. adaptive local tone mapping without CLAHE's block
 * artifacts (CLAHE was the #1 source of "pecah" in the old pipeline).
 *
 * Two anti-halo safeguards:
 * 1. `d` is clamped to u_limit so a hard edge can't get a bright/dark
 *    band wider than u_limit (the "pecah" look).
 * 2. The boost is modulated down near pure black & pure white
 *    (smoothstep), so skies and shadows don't get banding.
 * Correction applied in LUMA only so color isn't distorted.
 */
export const FRAG_LOCAL_CONTRAST = `
${PRECISION}
varying vec2 v_uv;
uniform sampler2D u_src;   // full-res graded image (unit 0)
uniform sampler2D u_blur;  // quarter-res gaussian base (unit 1) — LINEAR-upsampled
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

/**
 * Final micro-sharpen: 3×3 gaussian base, luma unsharp with a small
 * threshold (noise isn't amplified) and a hard limit (no edge halos).
 * sigma ≈ 1px — hits fine detail only, "jernih" without "tajam palsu".
 */
export const FRAG_SHARPEN = `
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

/**
 * The grade pass — everything artistic in one shader (and the SAME shader
 * runs in the live viewfinder for WYSIWYG preview):
 *
 *  exposure (EV), contrast, saturation, temperature (WB),
 *  filter preset (uniform u_filter), night mode (u_night),
 *  auto-gain from the luminance histogram (u_autoGain),
 *  gentle filmic highlight rolloff (u_tone), vignette, gamma.
 *
 * Mapping is kept close to the old sharp server pipeline
 * (modulate/linear/tint semantics) so existing looks carry over.
 */
export const FRAG_GRADE = `
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
    // highlights alone → the classic "mode malam" clean brightness.
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

export const FILTER_TO_INT: Record<string, number> = {
  none: 0,
  vivid: 1,
  mono: 2,
  warm: 3,
  cool: 4,
  cinema: 5,
  night: 6,
  vintage: 7,
};

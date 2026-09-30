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
function createQuadBuffer(gl) {
  const buf = gl.createBuffer();
  if (!buf) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );
  return buf;
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
export {
  compileShader,
  createContext,
  createFBO,
  createQuadBuffer,
  createTexture,
  createTextureFromSource,
  destroyFBO,
  drawPass,
  linkProgram,
  pixelBudget
};

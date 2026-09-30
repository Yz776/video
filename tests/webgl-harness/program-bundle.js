// src/components/camera/webgl/gl-core.ts
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
export {
  Program
};

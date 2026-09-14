/**
 * Thin WebGLProgram wrapper with cached uniform locations.
 * Used by both the photo processor and the live viewfinder.
 */
import { linkProgram, drawPass } from "./gl-core";

export class Program {
  readonly prog: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private gl: WebGLRenderingContext,
    vsSource: string,
    fsSource: string,
  ) {
    const p = linkProgram(gl, vsSource, fsSource);
    if (!p) throw new Error("shader link failed");
    this.prog = p;
  }

  loc(name: string): WebGLUniformLocation | null {
    if (!this.locs.has(name)) {
      this.locs.set(name, this.gl.getUniformLocation(this.prog, name));
    }
    return this.locs.get(name) ?? null;
  }

  f(name: string, v: number) {
    const l = this.loc(name);
    if (l) this.gl.uniform1f(l, v);
  }
  i(name: string, v: number) {
    const l = this.loc(name);
    if (l) this.gl.uniform1i(l, v);
  }
  v2(name: string, x: number, y: number) {
    const l = this.loc(name);
    if (l) this.gl.uniform2f(l, x, y);
  }
  /** uv crop transform for the quad vertex shader */
  uvTransform(scaleX: number, scaleY: number, offX: number, offY: number) {
    this.v2("u_uvScale", scaleX, scaleY);
    this.v2("u_uvOffset", offX, offY);
  }
  flip(x: number, y: number) {
    this.v2("u_flip", x, y);
  }
  floatArray(name: string, arr: number[]) {
    const l = this.loc(name);
    if (l) {
      if (name.startsWith("u_w")) this.gl.uniform1fv(l, arr);
      else this.gl.uniform1fv(l, arr);
    }
  }
  draw(tex: WebGLTexture, w: number, h: number, quad: WebGLBuffer) {
    return drawPass(this.gl, this.prog, quad, tex, w, h);
  }
  /** draw with a second texture bound to unit 1 */
  draw2(tex0: WebGLTexture, tex1: WebGLTexture, w: number, h: number, quad: WebGLBuffer) {
    const gl = this.gl;
    gl.getError(); // clear sticky errors
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
}

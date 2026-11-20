/**
 * WebGL CRT post-process. Owner: Starbuck.
 * Takes the low-res scene canvas as a NEAREST texture and draws it, at full display size, with barrel
 * curvature, scanlines, chromatic aberration, a cheap bloom, vignette, grain and a tiny flicker.
 * With `enabled = false` the same pass is a plain nearest-neighbour blit.
 *
 * The pass owns a PRIVATE, detached WebGL canvas and never touches the display canvas. The renderer keeps
 * the display canvas as a 2D context and copies `pass.canvas` onto it. That keeps the 2D fallback
 * unconditional: a shader that fails to compile or link, a GPU that refuses a context, or a context lost
 * mid-game all just drop back to the plain 2D blit, because a canvas that already has a WebGL context
 * would return null from getContext('2d') (the black-screen bug from the render-ui review gate).
 *
 * The barrel warp is mirrored on the CPU by `warpUv` so hitTest maps pointer -> scene pixel exactly.
 */
import type { CrtParams } from './types';

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_src;
uniform float u_time;
uniform float u_enabled;
uniform float u_scan;
uniform float u_curv;
uniform float u_vig;
uniform float u_ca;
uniform float u_noise;
uniform float u_bloom;

vec2 warp(vec2 uv) {
  vec2 c = uv * 2.0 - 1.0;
  float k = 0.11 * u_curv;
  c = c * (1.0 + k * dot(c, c)) / (1.0 + k);
  return c * 0.5 + 0.5;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 tap(vec2 uv) { return texture2D(u_tex, uv).rgb; }

void main() {
  if (u_enabled < 0.5) {
    gl_FragColor = vec4(tap(v_uv), 1.0);
    return;
  }
  vec2 uv = warp(v_uv);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  // Chromatic aberration, radial, measured in scene pixels.
  vec2 dir = (uv - 0.5);
  vec2 off = dir * (u_ca / u_src) * 2.0;
  vec3 col;
  col.r = tap(uv + off).r;
  col.g = tap(uv).g;
  col.b = tap(uv - off).b;

  // Cheap bloom: 8 taps at ~1.5 scene px, keep only the bright part.
  vec2 px = 1.5 / u_src;
  vec3 b = tap(uv + vec2(px.x, 0.0)) + tap(uv - vec2(px.x, 0.0)) + tap(uv + vec2(0.0, px.y)) + tap(uv - vec2(0.0, px.y))
         + tap(uv + px) + tap(uv - px) + tap(uv + vec2(px.x, -px.y)) + tap(uv + vec2(-px.x, px.y));
  b /= 8.0;
  col += max(b - 0.55, 0.0) * u_bloom;

  // Scanlines: darken between scene rows.
  float row = fract(uv.y * u_src.y);
  float line = sin(row * 3.14159);
  col *= mix(1.0, 0.55 + 0.45 * line, u_scan);
  // Faint aperture grille.
  float colx = fract(uv.x * u_src.x * 3.0);
  col *= 1.0 - 0.06 * u_scan * step(0.66, colx);
  col *= 1.0 + 0.18 * u_scan; // compensate brightness loss

  // Vignette.
  vec2 q = uv * (1.0 - uv.yx);
  float vig = pow(clamp(q.x * q.y * 15.0, 0.0, 1.0), 0.35 * u_vig);
  col *= vig;

  // Grain + flicker (time is frozen to 0 under reduced motion).
  float n = hash(v_uv * u_src * 3.0 + fract(u_time * 0.001) * 91.0) - 0.5;
  col += n * 0.07 * u_noise;
  col *= 1.0 + 0.012 * sin(u_time * 0.06) * u_noise;

  gl_FragColor = vec4(col, 1.0);
}`;

/** CPU mirror of the shader's barrel warp (screen uv -> scene uv). */
export function warpUv(u: number, v: number, curvature: number): [number, number] {
  const cx = u * 2 - 1;
  const cy = v * 2 - 1;
  const k = 0.11 * curvature;
  const m = (1 + k * (cx * cx + cy * cy)) / (1 + k);
  return [(cx * m + 1) / 2, (cy * m + 1) / 2];
}

export interface CrtPass {
  /** The pass's own (detached) output canvas. Copy it to the display after `render`, in the same task. */
  readonly canvas: HTMLCanvasElement;
  /** Draw the scene into `canvas`. `pulse` (0..1) temporarily boosts the effect. Returns false if nothing was drawn. */
  render(scene: HTMLCanvasElement, params: CrtParams, timeMs: number, pulse: number): boolean;
  resize(width: number, height: number): void;
  /** True while the WebGL context is lost (or was restored but could not be re-initialised). */
  isLost(): boolean;
  /** Free GPU resources and release the context (WEBGL_lose_context). */
  destroy(): void;
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn('[crt] shader compile failed', gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function loseContext(gl: WebGLRenderingContext): void {
  try {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // Already lost or extension unavailable: the canvas is detached, so GC reclaims it anyway.
  }
}

/**
 * Returns null when WebGL is unavailable or the shaders do not compile/link; the caller keeps its 2D blit.
 * `doc` is injectable for tests; defaults to the global document.
 */
export function createCrtPass(doc: Document = document): CrtPass | null {
  const canvas = doc.createElement('canvas');
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  } catch (e) {
    console.warn('[crt] WebGL unavailable', e);
  }
  if (!gl) return null;
  const g = gl;

  let lost = false;
  let prog: WebGLProgram | null = null;
  let tex: WebGLTexture | null = null;
  let buf: WebGLBuffer | null = null;
  const loc: Record<string, WebGLUniformLocation | null> = {};

  const init = (): boolean => {
    prog = null;
    const vs = compile(g, g.VERTEX_SHADER, VERT);
    const fs = compile(g, g.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    const p = g.createProgram();
    if (!p) return false;
    g.attachShader(p, vs);
    g.attachShader(p, fs);
    g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) {
      console.warn('[crt] link failed', g.getProgramInfoLog(p));
      g.deleteProgram(p);
      return false;
    }
    g.useProgram(p);
    buf = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, buf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), g.STATIC_DRAW);
    const aPos = g.getAttribLocation(p, 'a_pos');
    g.enableVertexAttribArray(aPos);
    g.vertexAttribPointer(aPos, 2, g.FLOAT, false, 0, 0);
    tex = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, tex);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    for (const n of ['u_tex', 'u_src', 'u_time', 'u_enabled', 'u_scan', 'u_curv', 'u_vig', 'u_ca', 'u_noise', 'u_bloom']) {
      loc[n] = g.getUniformLocation(p, n);
    }
    g.uniform1i(loc['u_tex'] ?? null, 0);
    prog = p;
    return true;
  };

  if (!init()) {
    loseContext(g);
    return null;
  }

  const onLost = (e: Event): void => {
    e.preventDefault(); // allow webglcontextrestored
    lost = true;
    prog = null;
  };
  const onRestored = (): void => {
    lost = !init();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    canvas,
    render(scene, params, timeMs, pulse) {
      if (lost || !prog || g.isContextLost()) return false;
      g.viewport(0, 0, g.drawingBufferWidth, g.drawingBufferHeight);
      g.bindTexture(g.TEXTURE_2D, tex);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, scene);
      const p = Math.max(0, Math.min(1, pulse));
      g.uniform2f(loc['u_src'] ?? null, scene.width, scene.height);
      g.uniform1f(loc['u_time'] ?? null, timeMs);
      g.uniform1f(loc['u_enabled'] ?? null, params.enabled ? 1 : 0);
      g.uniform1f(loc['u_scan'] ?? null, Math.min(1, params.scanlineIntensity + p * 0.3));
      g.uniform1f(loc['u_curv'] ?? null, params.curvature);
      g.uniform1f(loc['u_vig'] ?? null, params.vignette + p * 0.6);
      g.uniform1f(loc['u_ca'] ?? null, params.chromaticAberration + p * 2.5);
      g.uniform1f(loc['u_noise'] ?? null, params.noise + p * 0.5);
      g.uniform1f(loc['u_bloom'] ?? null, 0.9 + p * 1.2);
      g.drawArrays(g.TRIANGLES, 0, 6);
      return true;
    },
    resize(width, height) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    },
    isLost: () => lost || g.isContextLost(),
    destroy() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      if (!g.isContextLost()) {
        if (tex) g.deleteTexture(tex);
        if (buf) g.deleteBuffer(buf);
        if (prog) g.deleteProgram(prog);
      }
      tex = null;
      buf = null;
      prog = null;
      lost = true;
      loseContext(g);
    },
  };
}

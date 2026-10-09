/**
 * Meniscus: type floating in a pool of water. The water comes from the Tide case on work.draindk.tech (Oliver Kure
 * Olsen, 2026): the wave equation on a grid for the pointer's ripples, twelve wind-wave trains on top, sunlight bent
 * by the surface onto a tiled floor where it focuses into caustics (1/det of the refraction map's Jacobian), sky on
 * the slopes, glints.
 *
 * The type enters as a mask, painted whenever anything in it moves (red: the letters; green: calm light behind
 * running text). The simulation reads it two ways: the water under a letter is pressed flat, and where a letter moves
 * it pushes the water, up ahead of it and down behind it, through a wide blur of the mask, so the wake is long smooth
 * swell rather than grain. (Reflecting ripples off the letters' edges was tried and dropped: a moving edge feeds the
 * grid's finest waves, which the caustics show as grain.) The floor takes each letter's shadow, ringed by the light
 * its edges focus, and the surface shows a thin line of sky where the water climbs a letter.
 *
 * Capped at 60 fps, fewer pixels when a device can't keep up, one still frame when motion is off.
 */

const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const PACK = `
vec2 pack16(float v) { v = floor(clamp(v * 0.5 + 0.5, 0.0, 1.0) * 65535.0 + 0.5); float hi = floor(v / 256.0); return vec2(hi, v - hi * 256.0) / 255.0; }
float unpack16(vec2 b) { return (floor(b.x * 255.0 + 0.5) * 256.0 + floor(b.y * 255.0 + 0.5)) / 65535.0 * 2.0 - 1.0; }`;

// State access: float textures where the GPU can render to them, else 16-bit fixed point packed into RGBA8.
const STATE = `
#ifdef FLOAT_SIM
vec2 rd(sampler2D t, vec2 q) { return texture(t, q).rg; }
vec4 wr(vec2 s) { return vec4(s, 0.0, 1.0); }
#else
${PACK}
const float RANGE = 0.25;
vec2 rd(sampler2D t, vec2 q) { vec4 s = texture(t, q); return vec2(unpack16(s.rg), unpack16(s.ba)) * RANGE; }
vec4 wr(vec2 s) { return vec4(pack16(s.x / RANGE), pack16(s.y / RANGE)); }
#endif`;

// One step of the wave equation (height, velocity) with the type in it; up to eight drops a frame, each a smooth bump.
const SIM = `
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D state; uniform vec2 texel; uniform float aspect; uniform vec4 drops[8]; uniform int ndrops;
uniform sampler2D mask; uniform sampler2D maskPrev; uniform float push;
${STATE}
void main() {
  vec2 s = rd(state, uv);
  vec2 dx = vec2(texel.x, 0.0), dy = vec2(0.0, texel.y);
  float avg = (rd(state, uv + dx).x + rd(state, uv - dx).x + rd(state, uv + dy).x + rd(state, uv - dy).x) * 0.25;
  float m = textureLod(mask, uv, 1.6).r;
  s.y += (avg - s.x) * 2.0;
  s.y *= 0.985;
  s.x += s.y;
  s.x += (avg - s.x) * 0.035;
  s.x *= 0.998;
  s *= 1.0 - m * 0.3;                                   // under a letter the water is pressed flat, so its footprint leaves no grain
  s.x += clamp((textureLod(mask, uv, 3.4).r - textureLod(maskPrev, uv, 3.4).r) * push, -0.002, 0.002);   // smoothed: no grid-sized waves
  for (int i = 0; i < 8; i++) {
    if (i >= ndrops) break;
    vec4 d = drops[i];
    float r = length((uv - d.xy) * vec2(aspect, 1.0)) / d.z;
    if (r < 1.0) s.x += (cos(r * 3.14159265) * 0.5 + 0.5) * d.w;
  }
  o = wr(s);
}`;

// The ripples' slope and curvature on the grid itself, in units of screen height.
const RIP = `
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D state; uniform vec2 texel; uniform float aspect;
${STATE}
float h(vec2 q) {
  float v = rd(state, q).x;
#ifndef FLOAT_SIM
  v = sign(v) * max(0.0, abs(v) - 0.00003);
#endif
  return v;
}
void main() {
  float c = h(uv), l = h(uv - vec2(texel.x, 0.0)), r = h(uv + vec2(texel.x, 0.0)), d = h(uv - vec2(0.0, texel.y)), u = h(uv + vec2(0.0, texel.y));
  vec2 e = vec2(texel.x * aspect, texel.y);
  vec2 g = vec2(r - l, u - d) / (2.0 * e);
  vec2 hh = vec2((r + l - 2.0 * c) / (e.x * e.x), (u + d - 2.0 * c) / (e.y * e.y));
#ifdef FLOAT_SIM
  o = vec4(g, hh);
#else
  o = vec4(clamp(g * 0.05 + 0.5, 0.0, 1.0), clamp(hh * 0.0012 + 0.5, 0.0, 1.0));
#endif
}`;

// The whole surface: ripples (interpolated) plus wind waves (exact). Out: slope (rg) and the light focused onto the floor (b).
const SURF = `
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D rip; uniform float aspect; uniform float time; uniform vec4 wv[12]; uniform float wsp[12];
void main() {
  vec4 r = texture(rip, uv);
#ifdef FLOAT_SIM
  vec2 g = r.xy * 1.4, hh = r.zw * 1.4;
#else
  vec2 g = (r.xy - 0.5) / 0.05 * 1.4, hh = (r.zw - 0.5) / 0.0012 * 1.4;
#endif
  float hxy = 0.0;
  vec2 p = vec2(uv.x * aspect, uv.y);
  for (int i = 0; i < 12; i++) {
    vec4 w = wv[i];
    float ph = dot(w.xy, p) * w.z - time * wsp[i];
    float s = sin(ph), c = cos(ph), hk = -w.w * s * w.z * w.z;
    g += w.w * c * w.z * w.xy;
    hh += hk * w.xy * w.xy;
    hxy += hk * w.x * w.y;
  }
  const float D = 0.1;
  float det = (1.0 + D * hh.x) * (1.0 + D * hh.y) - D * D * hxy * hxy;
  float light = 1.0 / max(abs(det), 0.12);
#ifdef FLOAT_SIM
  o = vec4(g, light, 1.0);
#else
  o = vec4(clamp(g * 0.08 + 0.5, 0.0, 1.0), clamp(light / 10.0, 0.0, 1.0), 1.0);
#endif
}`;

const FINAL = `
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D surf; uniform sampler2D floorTex; uniform sampler2D mask; uniform vec2 res; uniform float aspect; uniform float time;
uniform vec2 throwTo;                          // where the type's shadow falls on the floor (uv), from the type's size
const vec3 WATER = vec3(0.322, 0.682, 0.929);   // #52aeed, Tide's 17.4° water
const vec3 SUN = vec3(1.0, 0.985, 0.94);
const vec3 SKY = vec3(0.94, 0.975, 1.0);
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec4 s = texture(surf, uv);
#ifdef FLOAT_SIM
  vec2 g = s.xy; float light = s.z;
#else
  vec2 g = (s.xy - 0.5) / 0.08; float light = s.z * 10.0;
#endif
  vec3 N = normalize(vec3(-g * 0.35, 1.0));
  vec2 asp = vec2(aspect, 1.0);
  // The floor, seen through the surface.
  vec2 fuv = uv - g * 0.012 / asp;
  vec3 floorC = texture(floorTex, fuv).rgb;
  // The type's shadow on the floor (the sun is up and to the left), softer than the letter; around it, the light the
  // letters' edges focus. Calmer light behind the running text, so it reads.
  float sh = textureLod(mask, fuv - throwTo, 2.2).r, ring = textureLod(mask, fuv - throwTo, 3.4).r;
  float shade = min(1.0, sh) * 0.62;
  float halo = smoothstep(0.03, 0.17, ring) * (1.0 - smoothstep(0.17, 0.45, ring)) * (1.0 - sh);
  float calm = textureLod(mask, uv, 3.5).g;
  vec3 col = floorC * mix(vec3(1.0), WATER, 0.62);
  float caus = smoothstep(1.1, 3.6, light) * (1.0 - calm * 0.65);
  col += SUN * (caus * 0.4 + (light - 1.0) * 0.04) * (1.0 - min(1.0, shade * 1.6));
  col *= 1.0 - shade * 0.42;
  col += SUN * halo * 0.3;
  // The surface: sky on steep slopes, a line of sky where the water climbs a letter, glints where a slope catches the sun.
  float slope = length(g * 0.35);
  col = mix(col, SKY, clamp(slope * slope * 0.6 * (1.0 - calm * 0.5), 0.0, 0.3));
  float rim = clamp(textureLod(mask, uv, 1.1).r - textureLod(mask, uv, 0.0).r, 0.0, 1.0);
  col = mix(col, SKY, rim * 0.3);
  vec3 Hv = normalize(vec3(-0.05, 0.07, 1.0));
  col += SUN * pow(max(dot(N, Hv), 0.0), 9000.0) * 0.9 * (1.0 - calm) * (1.0 - shade);
  // Vignette, and a little grain against banding.
  vec2 v = uv - 0.5; col *= 1.0 - dot(v, v) * 0.22;
  col += (hash(uv * res + fract(time * 7.0)) - 0.5) * 0.016;
  o = vec4(col, 1.0);
}`;

/** Paints the type's mask (red: letters, green: calm) for a viewport (CSS px) at the canvas's resolution; false when
 *  nothing in it changed since the last paint. */
export type Paint = (g: CanvasRenderingContext2D, cw: number, ch: number, W: number, H: number) => boolean;
export type Water = {
  resize: () => void;
  pointer: (x: number, y: number, kind: "move" | "down") => void;
  /** How far the type's shadow falls (CSS px, right and down); it scales with the type, not the screen. */
  shadow: (dx: number, dy: number) => void;
  /** A splash at a point (CSS px): a word landing, a letter typed. */
  splash: (x: number, y: number, size: number, strength: number) => void;
  play: (on: boolean) => void;
  visible: (on: boolean) => void;
  dispose: () => void;
};

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
function program(gl: WebGL2RenderingContext, frag: string, float = false): Prog {
  frag = "#version 300 es\n" + (float ? "#define FLOAT_SIM 1\n" : "") + frag;
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(p, 0, "p"); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  const cache: Record<string, WebGLUniformLocation | null> = {};
  const u = new Proxy(cache, { get: (t, k: string) => (k in t ? t[k] : (t[k] = gl.getUniformLocation(p, k))) });
  return { p, u };
}

type Target = { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number };
function target(gl: WebGL2RenderingContext, w: number, h: number, filter: number, fmt: "rgba8" | "rg32f" | "rgba16f"): Target {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (fmt === "rg32f") gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, w, h, 0, gl.RG, gl.FLOAT, null);
  else if (fmt === "rgba16f") gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fb, w, h };
}

// Tide's twelve wind-wave trains, mostly from the south-west, a quarter of the screen height down to a twenty-fifth.
const WAVES = (() => {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const v = new Float32Array(48), sp = new Float32Array(12);
  for (let i = 0; i < 12; i++) {
    const a = 0.7 + (rnd() - 0.5) * 2.4, len = 0.25 * Math.pow(0.85, i), k = (2 * Math.PI) / len;
    const steep = 0.042 - i * 0.0018;
    v.set([Math.cos(a), Math.sin(a), k, (steep / k) * (0.75 + rnd() * 0.5)], i * 4);
    sp[i] = Math.sqrt(9.8 * k) * 0.045 * (0.8 + rnd() * 0.4);
  }
  return { v, sp };
})();

/** Tide's bath floor: pale blue and faint tiles. */
function paintFloor(w: number, h: number, scale: number) {
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const g = c.getContext("2d")!;
  g.scale(scale, scale);
  const grd = g.createLinearGradient(0, 0, w * 0.5, h);
  grd.addColorStop(0, "#c2e7fc"); grd.addColorStop(1, "#a9d9f7");
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  const tile = Math.max(48, Math.min(w, h) / 10);
  g.strokeStyle = "rgba(255,255,255,.2)"; g.lineWidth = 1.25;
  for (let x = (w % tile) / 2; x < w; x += tile) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (let y = (h % tile) / 2; y < h; y += tile) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  return c;
}

export type WaterOptions = {
  /** Called after each frame is drawn (a frame meter can hook in here). */
  onFrame?: (now: number) => void;
};

/** The water on a canvas that fills its box. `paint` draws the type's mask (see Paint). Null without WebGL2. */
export function createWater(canvas: HTMLCanvasElement, paint: Paint, opts: WaterOptions = {}): Water | null {
  const ctx = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance" });
  if (!ctx) return null;
  const gl: WebGL2RenderingContext = ctx;
  const float = !!gl.getExtension("EXT_color_buffer_float");
  let sim: Prog, rip: Prog, surf: Prog, fin: Prog;
  try { sim = program(gl, SIM, float); rip = program(gl, RIP, float); surf = program(gl, SURF, float); fin = program(gl, FINAL, float); }
  catch (e) { console.warn("Meniscus:", e); return null; }
  canvas.dataset.sim = float ? "float" : "packed";

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const floorTex = gl.createTexture()!;
  // the type's mask, at twice the ripple grid; two textures, so the simulation sees how it moved since the last frame
  const maskCv = document.createElement("canvas"), mg = maskCv.getContext("2d")!;
  const masks = [gl.createTexture()!, gl.createTexture()!];
  let cur = 0, prevMask = masks[0];

  let W = 1, H = 1, aspect = 1, dprCap = 1.75, castX = 16, castY = 24;
  let A = target(gl, 2, 2, gl.NEAREST, "rgba8"), B = target(gl, 2, 2, gl.NEAREST, "rgba8"), R = target(gl, 2, 2, gl.LINEAR, "rgba8"), S = target(gl, 2, 2, gl.LINEAR, "rgba8");
  const drops: number[][] = [];
  let last: { x: number; y: number; t: number } | null = null;
  let raf = 0, wanted = false, running = false, visible = true, time = 4, prev = 0;

  const zero = (t: Target) => {   // packed zero is 32768 = (128, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    if (float) gl.clearColor(0, 0, 0, 1); else gl.clearColor(128 / 255, 0, 128 / 255, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  // Repaint the mask when anything in it moved; the simulation then compares it with the last one.
  function syncMask(force = false) {
    prevMask = masks[cur];
    if (!paint(mg, maskCv.width, maskCv.height, W, H) && !force) return;
    cur ^= 1;
    gl.bindTexture(gl.TEXTURE_2D, masks[cur]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCv);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, rect.width); H = Math.max(1, rect.height); aspect = W / H;
    const dpr = Math.min(window.devicePixelRatio || 1, W * H > 1.5e6 ? 1.25 : dprCap);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    // a finer grid than Tide's (320 cells on the long side), so the water parts around a letter's strokes
    const long = 320, sw = Math.round(W >= H ? long : long * aspect), sh = Math.round(W >= H ? long / aspect : long);
    for (const t of [A, B, R, S]) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    A = target(gl, sw, sh, gl.NEAREST, float ? "rg32f" : "rgba8"); B = target(gl, sw, sh, gl.NEAREST, float ? "rg32f" : "rgba8");
    R = target(gl, sw, sh, gl.LINEAR, float ? "rgba16f" : "rgba8"); S = target(gl, sw * 2, sh * 2, gl.LINEAR, float ? "rgba16f" : "rgba8");
    zero(A); zero(B);
    maskCv.width = sw * 2; maskCv.height = sh * 2;
    for (const m of masks) {
      gl.bindTexture(gl.TEXTURE_2D, m);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, maskCv.width, maskCv.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    syncMask(true); prevMask = masks[cur];
    const floor = paintFloor(W, H, Math.min(dpr, 1.5));
    gl.bindTexture(gl.TEXTURE_2D, floorTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, floor);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    // three drops so a still frame isn't glassy
    for (let i = 0; i < 3; i++) drops.push([0.18 + i * 0.3, 0.25 + (i % 2) * 0.4, 0.045, 0.06]);
    for (let i = 0; i < 40; i++) step(1 / 60);
    draw();
  };

  const pass = (p: Prog, t: Target | null) => {
    gl.useProgram(p.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
    gl.viewport(0, 0, t ? t.w : canvas.width, t ? t.h : canvas.height);
  };
  const bind = (unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit); };

  function step(dt: number) {
    syncMask();
    pass(sim, B);
    gl.uniform2f(sim.u.texel, 1 / A.w, 1 / A.h); gl.uniform1f(sim.u.aspect, aspect);
    const n = Math.min(8, drops.length), arr = new Float32Array(32);
    for (let i = 0; i < n; i++) arr.set(drops[i], i * 4);
    drops.splice(0, n);
    gl.uniform4fv(sim.u.drops, arr); gl.uniform1i(sim.u.ndrops, n);
    gl.uniform1f(sim.u.push, 0.006);
    bind(0, A.tex, sim.u.state); bind(1, masks[cur], sim.u.mask); bind(2, prevMask, sim.u.maskPrev);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [A, B] = [B, A];
  }

  function draw() {
    pass(rip, R);
    gl.uniform2f(rip.u.texel, 1 / A.w, 1 / A.h); gl.uniform1f(rip.u.aspect, aspect);
    bind(0, A.tex, rip.u.state);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    pass(surf, S);
    bind(0, R.tex, surf.u.rip);
    gl.uniform1f(surf.u.aspect, aspect); gl.uniform1f(surf.u.time, time);
    gl.uniform4fv(surf.u.wv, WAVES.v); gl.uniform1fv(surf.u.wsp, WAVES.sp);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    pass(fin, null);
    bind(0, S.tex, fin.u.surf); bind(1, floorTex, fin.u.floorTex); bind(2, masks[cur], fin.u.mask);
    gl.uniform2f(fin.u.res, canvas.width, canvas.height); gl.uniform1f(fin.u.aspect, aspect); gl.uniform1f(fin.u.time, time);
    gl.uniform2f(fin.u.throwTo, castX / W, -castY / H);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // A device that can't keep up gets fewer pixels (the canvas only, the simulation keeps its grid): after 45 slow
  // frames in a row, a fifth fewer, down to one pixel per CSS pixel.
  let slow = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (prev && now - prev < 1000 / 62) return;          // 60 fps at most
    const dt = Math.min(0.05, prev ? (now - prev) / 1000 : 1 / 60);
    slow = prev && now - prev > 24 ? slow + 1 : Math.max(0, slow - 1);
    if (slow > 45 && dprCap > 1) {
      slow = 0; dprCap = Math.max(1, dprCap * 0.8);
      const dpr = Math.min(window.devicePixelRatio || 1, W * H > 1.5e6 ? 1.25 : dprCap);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    prev = now; time += dt;
    step(dt); draw();
    opts.onFrame?.(now);
  };
  const sync = () => {
    const go = wanted && visible;
    if (go === running) return;
    running = go; cancelAnimationFrame(raf); prev = 0;
    if (go) raf = requestAnimationFrame(frame);
  };
  // when nothing runs (motion off), a moved word still shows: one frame, on the next animation frame
  let pending = 0;
  const redraw = () => {
    if (running || pending || !visible) return;
    pending = requestAnimationFrame(() => { pending = 0; syncMask(); draw(); });
  };

  const lost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(raf); running = false; wanted = false; canvas.dataset.gl = "lost"; };
  canvas.addEventListener("webglcontextlost", lost);

  resize();
  return {
    resize,
    pointer(x, y, kind) {
      if (!running) { redraw(); return; }
      const u = x / W, v = 1 - y / H, now = performance.now();
      if (kind === "down") drops.push([u, v, 0.04, 0.1]);
      else if (last && now - last.t < 200) {
        const dist = Math.hypot((u - last.x) * aspect, v - last.y), dt = Math.max(8, now - last.t);
        const n = Math.min(4, Math.ceil(dist / 0.012));
        for (let i = 1; i <= n; i++) drops.push([last.x + ((u - last.x) * i) / n, last.y + ((v - last.y) * i) / n, 0.026, Math.min(0.05, (dist / dt) * 2.2)]);
      }
      last = { x: u, y: v, t: now };
    },
    shadow(dx, dy) { castX = dx; castY = dy; redraw(); },
    splash(x, y, size, strength) { if (running) drops.push([x / W, 1 - y / H, size / H, strength]); else redraw(); },
    play(on) { wanted = on; sync(); if (!on) redraw(); },
    visible(on) { if (on === visible) return; visible = on; sync(); if (on) redraw(); },
    dispose() { cancelAnimationFrame(raf); cancelAnimationFrame(pending); canvas.removeEventListener("webglcontextlost", lost); gl.getExtension("WEBGL_lose_context")?.loseContext(); },
  };
}

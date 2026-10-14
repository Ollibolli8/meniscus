/**
 * Meniscus: type floating in a pool of water. The water comes from the Tide case on work.draindk.tech (Oliver Kure
 * Olsen, 2026): the wave equation on a grid for the pointer's ripples, twelve wind-wave trains on top, sunlight bent
 * by the surface onto a tiled floor where it focuses into caustics (the inverse of the refraction map's Jacobian), sky
 * on the slopes, glints.
 *
 * The caustics are drawn forwards: the surface is a mesh, each vertex moved to where the light through it lands on the
 * floor, and each triangle's light is how much it shrank on the way (after Evan Wallace's WebGL Water, 2011). So light
 * lands where it really lands, folds add up, and it is drawn once per colour: water bends red least, so red lands a
 * little short of blue and the brightest lines carry a red and a blue edge. The floor slopes from a shallow end (top
 * left) to a deep end (bottom right), and its depth sets everything the light does on it: sharp lines in the
 * shallows, broad ones blurred by the sun's disc in the deep, bluer water as it deepens, tiles that converge a little
 * (the view is from above the pool's middle), and a letter's shadow that falls further off and softer.
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

const VERT = `
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

// The pool. Its depth is kept as the refraction's reach D, in screen heights (the floor's depth times 1 - 1/n: how far
// light lands per unit of the surface's slope), from the shallow end (top left) to the deep end (bottom right); MID is
// the middle, under the word. Water's index for red, green and blue light is about 1.331, 1.333 and 1.337, so the reach
// per colour scales by (1 - 1/n) / (1 - 1/n_green). True to life (SPREAD 1) the colours land a tenth of a pixel apart,
// so SPREAD widens the difference until the fringe shows. The slope and light maps reach MARGIN past each edge of the
// screen, for the light that lands from outside it and the deep end's floor, which looks smaller.
const MARGIN = 0.08;
const POOL = `
const float SHALLOW = 0.09, DEEP = 0.2, MID = 0.145, PERSP = 0.6, BLUR = 4.5, SPREAD = 14.0, M = ${MARGIN};
const vec3 FOCUS = 1.0 + (vec3(0.99549, 1.0, 1.00899) - 1.0) * SPREAD;
float depth(vec2 uv, float aspect) {
  vec2 a = vec2(aspect, -1.0);
  return mix(SHALLOW, DEEP, smoothstep(0.1, 0.9, dot(vec2(uv.x * aspect, uv.y - 1.0), a) / dot(a, a)));
}
vec2 toLight(vec2 uv) { return (uv + M) / (1.0 + 2.0 * M); }`;

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

// The ripples' slope on the grid itself.
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
  float l = h(uv - vec2(texel.x, 0.0)), r = h(uv + vec2(texel.x, 0.0)), d = h(uv - vec2(0.0, texel.y)), u = h(uv + vec2(0.0, texel.y));
  vec2 e = vec2(texel.x * aspect, texel.y);
  vec2 g = vec2(r - l, u - d) / (2.0 * e);
#ifdef FLOAT_SIM
  o = vec4(g, 0.0, 1.0);
#else
  o = vec4(clamp(g * 0.05 + 0.5, 0.0, 1.0), 0.0, 1.0);
#endif
}`;

// The whole surface's slope: ripples (interpolated) plus wind waves (exact), reaching M past the screen like the light.
const SURF = `
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D rip; uniform float aspect; uniform float time; uniform vec4 wv[12]; uniform float wsp[12];
${POOL}
void main() {
  vec2 at = uv * (1.0 + 2.0 * M) - M;
  vec4 r = texture(rip, at);
#ifdef FLOAT_SIM
  vec2 g = r.xy * 1.4;
#else
  vec2 g = (r.xy - 0.5) / 0.05 * 1.4;
#endif
  vec2 p = vec2(at.x * aspect, at.y);
  for (int i = 0; i < 12; i++) {
    vec4 w = wv[i];
    g += w.w * cos(dot(w.xy, p) * w.z - time * wsp[i]) * w.z * w.xy;
  }
#ifdef FLOAT_SIM
  o = vec4(g, 0.0, 1.0);
#else
  o = vec4(clamp(g * 0.08 + 0.5, 0.0, 1.0), 0.0, 1.0);
#endif
}`;

// The sunlight on the floor, drawn forwards: the surface as a mesh of cols x rows cells reaching M past the screen,
// each vertex moved to where the light through it lands (D times the slope, so further where the floor is deeper),
// once per colour (the instance). A triangle's light is its area on the surface over its area on the floor (the
// inverse of the refraction map's Jacobian), capped by the sun's disc: the deeper the floor, the wider the disc's
// image, so the lower the cap. Added up, so overlapping folds add.
const CAUS_VERT = `
precision highp float;
uniform sampler2D surf; uniform float aspect; uniform int cols; uniform vec2 cell;
out vec2 from; out float peak; flat out int ch;
${POOL}
vec2 slope(vec2 q) {
  vec4 s = textureLod(surf, q, 0.0);
#ifdef FLOAT_SIM
  return s.xy;
#else
  return (s.xy - 0.5) / 0.08;
#endif
}
void main() {
  ch = gl_InstanceID;
  vec2 p = vec2(gl_VertexID % (cols + 1), gl_VertexID / (cols + 1)) * cell - M;
  // Ripples finer than the sun's disc blurs on the floor don't show there, so the light follows a smoothed slope,
  // smoother in the deep (the surface itself keeps every ripple). A smooth kernel, not a mip: a mip's bilinear kinks
  // would show in the light as a grid.
  float z = depth(p, aspect), deep = (z - SHALLOW) / (DEEP - SHALLOW);
  vec2 q = toLight(p), t = (1.25 + deep) / vec2(textureSize(surf, 0));
  vec2 g = slope(q) * 0.36 + (slope(q + t) + slope(q - t) + slope(q + vec2(t.x, -t.y)) + slope(q + vec2(-t.x, t.y))) * 0.16;
  from = p;
  peak = 1.0 / mix(0.12, 0.45, deep);
  gl_Position = vec4(toLight(p + z * FOCUS[ch] * g / vec2(aspect, 1.0)) * 2.0 - 1.0, 0.0, 1.0);
}`;
const CAUS = `
precision highp float;
in vec2 from; in float peak; flat in int ch;
out vec4 o;
uniform vec2 size;
${POOL}
void main() {
  vec2 a = dFdx(from) * size / (1.0 + 2.0 * M), b = dFdy(from) * size / (1.0 + 2.0 * M);
  vec4 c = vec4(equal(ivec4(ch), ivec4(0, 1, 2, 3))) * min(abs(a.x * b.y - a.y * b.x), peak);
#ifdef FLOAT_SIM
  o = c;
#else
  o = c / 10.0;
#endif
}`;

const FINAL = `
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D surf; uniform sampler2D lightTex; uniform sampler2D mask; uniform vec2 res; uniform vec2 css; uniform float aspect; uniform float time;
uniform vec2 throwTo;                          // where the type's shadow falls on the floor at the middle depth (uv), from the type's size
const vec3 WATER = vec3(0.322, 0.682, 0.929);   // #52aeed, Tide's 17.4° water
const vec3 SUN = vec3(1.0, 0.985, 0.94);
const vec3 SKY = vec3(0.94, 0.975, 1.0);
const vec3 TILE_A = vec3(0.761, 0.906, 0.988), TILE_B = vec3(0.663, 0.851, 0.969);   // #c2e7fc to #a9d9f7
${POOL}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// The light on the floor, blurred by r of its texels: the middle and six taps round it, each from a mip as wide as
// the gap between taps, so a bright point spreads into a disc rather than seven dots.
vec3 floorLight(vec2 uv, float r) {
  float lod = max(0.0, log2(r) - 0.5);
  vec2 t = r * 0.75 / vec2(textureSize(lightTex, 0));
  vec3 c = textureLod(lightTex, uv, lod).rgb;
  for (int i = 0; i < 6; i++) {
    float a = float(i) * 1.0472 + 0.3;
    c += textureLod(lightTex, uv + vec2(cos(a), sin(a)) * t, lod).rgb;
  }
  return c / 7.0;
}
// How much of a pixel one set of grout lines (1.25 CSS px wide) covers: a box filter over the pixel's footprint, so the
// lines stay clean where they converge and where the surface bends them.
float grout(float x, float tile, float fw) {
  float d = abs(x - tile * floor(x / tile + 0.5));
  return clamp(min(d + fw * 0.5, 0.625) - max(d - fw * 0.5, -0.625), 0.0, fw) / fw;
}
void main() {
  float D = depth(uv, aspect), k = D / MID;     // the floor's depth here, and relative to the middle
  vec4 s = texture(surf, toLight(uv));
#ifdef FLOAT_SIM
  vec2 g = s.xy;
#else
  vec2 g = (s.xy - 0.5) / 0.08;
#endif
  vec3 N = normalize(vec3(-g * 0.35, 1.0));
  vec2 asp = vec2(aspect, 1.0);
  // The floor, seen through the surface from above the pool's middle: deeper floor looks a little smaller, and the
  // surface's slope shifts it further. F is the floor point in screen heights from the middle.
  vec2 F = (uv - 0.5) * asp * (1.0 + D * PERSP) - g * 0.012 * k;
  vec2 fuv = F / asp + 0.5;
  // The light there, softened more the deeper the floor.
  vec3 light = floorLight(toLight(fuv), 1.5 + BLUR * (D - SHALLOW) / (DEEP - SHALLOW));
#ifndef FLOAT_SIM
  light *= 10.0;
#endif
  // Tide's bath floor, pale blue and faint tiles, laid in CSS px so that at the middle depth it meets the screen.
  vec2 P = vec2(F.x, -F.y) / (1.0 + MID * PERSP) * css.y + css * 0.5;
  vec2 ga = vec2(css.x * 0.5, css.y);
  vec3 floorC = mix(TILE_A, TILE_B, clamp(dot(P, ga) / dot(ga, ga), 0.0, 1.0));
  float tile = max(48.0, min(css.x, css.y) / 10.0);
  vec2 q = P - mod(css, tile) * 0.5, fw = max(fwidth(P), vec2(1e-3));
  floorC = mix(floorC, vec3(1.0), 0.2 * grout(q.x, tile, fw.x));
  floorC = mix(floorC, vec3(1.0), 0.2 * grout(q.y, tile, fw.y));
  // The type's shadow on the floor (the sun is up and to the left), softer than the letter, and further off and
  // softer still where the floor is deeper; around it, the light the letters' edges focus. Calmer light behind the
  // running text, so it reads.
  vec2 at = fuv - throwTo * k;
  float sh = textureLod(mask, at, 2.2 + log2(k)).r, ring = textureLod(mask, at, 3.4 + log2(k)).r;
  float shade = min(1.0, sh) * 0.62;
  float halo = smoothstep(0.03, 0.17, ring) * (1.0 - smoothstep(0.17, 0.45, ring)) * (1.0 - sh);
  float calm = textureLod(mask, uv, 3.5).g;
  // Light that crosses more water is bluer and dimmer (Beer–Lambert): Tide's tint at the middle depth, stronger in
  // the deep end, on the floor and on the light that reaches it.
  vec3 tint = mix(vec3(1.0), WATER, 0.62), T = pow(tint, vec3(k * k));
  vec3 col = floorC * T;
  vec3 caus = smoothstep(1.1, 3.6, light) * (1.0 - calm * 0.65);
  col += SUN * T / tint * (caus * 0.4 + (light - 1.0) * 0.04) * (1.0 - min(1.0, shade * 1.6));
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
function program(gl: WebGL2RenderingContext, frag: string, float = false, vert = VERT): Prog {
  const head = "#version 300 es\n" + (float ? "#define FLOAT_SIM 1\n" : "");
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, head + vert)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, head + frag));
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
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.NEAREST ? gl.NEAREST : gl.LINEAR);
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
  let sim: Prog, rip: Prog, surf: Prog, caus: Prog, fin: Prog;
  try {
    sim = program(gl, SIM, float); rip = program(gl, RIP, float); surf = program(gl, SURF, float);
    caus = program(gl, CAUS, float, CAUS_VERT); fin = program(gl, FINAL, float);
  }
  catch (e) { console.warn("Meniscus:", e); return null; }
  canvas.dataset.sim = float ? "float" : "packed";

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  // the caustics' mesh: only indices (the vertex shader places each vertex from its number), in a vertex array of its own
  const mesh = { vao: gl.createVertexArray()!, ibo: gl.createBuffer()!, cols: 1, rows: 1, n: 0 };
  // the type's mask, at twice the ripple grid; two textures, so the simulation sees how it moved since the last frame
  const maskCv = document.createElement("canvas"), mg = maskCv.getContext("2d")!;
  const masks = [gl.createTexture()!, gl.createTexture()!];
  let cur = 0, prevMask = masks[0];

  let W = 1, H = 1, aspect = 1, dprCap = 1.75, castX = 16, castY = 24;
  let A = target(gl, 2, 2, gl.NEAREST, "rgba8"), B = target(gl, 2, 2, gl.NEAREST, "rgba8"), R = target(gl, 2, 2, gl.LINEAR, "rgba8"), S = target(gl, 2, 2, gl.LINEAR, "rgba8");
  let L = target(gl, 2, 2, gl.LINEAR, "rgba8");
  // The light is added up with multisampling, then resolved into L: a fold squeezes triangles thinner than a texel,
  // and a few samples per texel turn their hit-or-miss into the right share (no speckle, no coloured grain).
  const lightFmt = float ? gl.RGBA16F : gl.RGBA8;
  const samples = Math.min(8, Math.max(0, ...(gl.getInternalformatParameter(gl.RENDERBUFFER, lightFmt, gl.SAMPLES) as Int32Array ?? [0])));
  const ms = { fb: gl.createFramebuffer()!, rb: gl.createRenderbuffer()!, w: 2, h: 2 };
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
    for (const t of [A, B, R, S, L]) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    A = target(gl, sw, sh, gl.NEAREST, float ? "rg32f" : "rgba8"); B = target(gl, sw, sh, gl.NEAREST, float ? "rg32f" : "rgba8");
    // the surface's slope and the floor's light, at twice the grid and reaching MARGIN past each edge; a mesh cell per
    // 2x2 texels
    const lw = Math.round(sw * 2 * (1 + 2 * MARGIN)), lh = Math.round(sh * 2 * (1 + 2 * MARGIN));
    R = target(gl, sw, sh, gl.LINEAR, float ? "rgba16f" : "rgba8"); S = target(gl, lw, lh, gl.LINEAR, float ? "rgba16f" : "rgba8");
    L = target(gl, lw, lh, gl.LINEAR_MIPMAP_LINEAR, float ? "rgba16f" : "rgba8");
    if (samples) {
      ms.w = lw; ms.h = lh;
      gl.bindRenderbuffer(gl.RENDERBUFFER, ms.rb); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, lightFmt, lw, lh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, ms.fb); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, ms.rb);
    }
    mesh.cols = Math.round(lw / 2); mesh.rows = Math.round(lh / 2);
    const idx = new Uint32Array(mesh.cols * mesh.rows * 6);
    for (let y = 0, k = 0; y < mesh.rows; y++) for (let x = 0; x < mesh.cols; x++, k += 6) {
      const i = y * (mesh.cols + 1) + x, j = i + mesh.cols + 1;
      idx[k] = i; idx[k + 1] = i + 1; idx[k + 2] = j; idx[k + 3] = i + 1; idx[k + 4] = j + 1; idx[k + 5] = j;
    }
    mesh.n = idx.length;
    gl.bindVertexArray(mesh.vao); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
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
    // three drops so a still frame isn't glassy
    for (let i = 0; i < 3; i++) drops.push([0.18 + i * 0.3, 0.25 + (i % 2) * 0.4, 0.045, 0.06]);
    for (let i = 0; i < 40; i++) step(1 / 60);
    draw();
  };

  const pass = (p: Prog, t: { fb: WebGLFramebuffer; w: number; h: number } | null) => {
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
    // the sunlight through it, added up on the floor, once per colour
    pass(caus, samples ? ms : L);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    bind(0, S.tex, caus.u.surf);
    gl.uniform1f(caus.u.aspect, aspect); gl.uniform1i(caus.u.cols, mesh.cols);
    gl.uniform2f(caus.u.cell, (1 + 2 * MARGIN) / mesh.cols, (1 + 2 * MARGIN) / mesh.rows); gl.uniform2f(caus.u.size, L.w, L.h);
    gl.bindVertexArray(mesh.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, mesh.n, gl.UNSIGNED_INT, 0, 3);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    if (samples) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, ms.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, L.fb);
      gl.blitFramebuffer(0, 0, L.w, L.h, 0, 0, L.w, L.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    pass(fin, null);
    bind(1, L.tex, fin.u.lightTex);
    gl.generateMipmap(gl.TEXTURE_2D);
    bind(0, S.tex, fin.u.surf); bind(2, masks[cur], fin.u.mask);
    gl.uniform2f(fin.u.res, canvas.width, canvas.height); gl.uniform2f(fin.u.css, W, H); gl.uniform1f(fin.u.aspect, aspect); gl.uniform1f(fin.u.time, time);
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

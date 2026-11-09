var Se=`
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;var fe=`
const float SHALLOW = 0.09, DEEP = 0.2, MID = 0.145, PERSP = 0.6, BLUR = 4.5, SPREAD = 14.0, M = ${.08};
const vec3 FOCUS = 1.0 + (vec3(0.99549, 1.0, 1.00899) - 1.0) * SPREAD;
float depth(vec2 uv, float aspect) {
  vec2 a = vec2(aspect, -1.0);
  return mix(SHALLOW, DEEP, smoothstep(0.1, 0.9, dot(vec2(uv.x * aspect, uv.y - 1.0), a) / dot(a, a)));
}
vec2 toLight(vec2 uv) { return (uv + M) / (1.0 + 2.0 * M); }`,_e=`
vec2 pack16(float v) { v = floor(clamp(v * 0.5 + 0.5, 0.0, 1.0) * 65535.0 + 0.5); float hi = floor(v / 256.0); return vec2(hi, v - hi * 256.0) / 255.0; }
float unpack16(vec2 b) { return (floor(b.x * 255.0 + 0.5) * 256.0 + floor(b.y * 255.0 + 0.5)) / 65535.0 * 2.0 - 1.0; }`,Ae=`
#ifdef FLOAT_SIM
vec2 rd(sampler2D t, vec2 q) { return texture(t, q).rg; }
vec4 wr(vec2 s) { return vec4(s, 0.0, 1.0); }
#else
${_e}
const float RANGE = 0.25;
vec2 rd(sampler2D t, vec2 q) { vec4 s = texture(t, q); return vec2(unpack16(s.rg), unpack16(s.ba)) * RANGE; }
vec4 wr(vec2 s) { return vec4(pack16(s.x / RANGE), pack16(s.y / RANGE)); }
#endif`,Ue=`
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D state; uniform vec2 texel; uniform float aspect; uniform vec4 drops[8]; uniform int ndrops;
uniform sampler2D mask; uniform sampler2D maskPrev; uniform float push;
${Ae}
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
}`,De=`
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D state; uniform vec2 texel; uniform float aspect;
${Ae}
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
}`,Ie=`
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D rip; uniform float aspect; uniform float time; uniform vec4 wv[12]; uniform float wsp[12];
${fe}
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
}`,Pe=`
precision highp float;
uniform sampler2D surf; uniform float aspect; uniform int cols; uniform vec2 cell;
out vec2 from; out float peak; flat out int ch;
${fe}
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
}`,Ce=`
precision highp float;
in vec2 from; in float peak; flat in int ch;
out vec4 o;
uniform vec2 size;
${fe}
void main() {
  vec2 a = dFdx(from) * size / (1.0 + 2.0 * M), b = dFdy(from) * size / (1.0 + 2.0 * M);
  vec4 c = vec4(equal(ivec4(ch), ivec4(0, 1, 2, 3))) * min(abs(a.x * b.y - a.y * b.x), peak);
#ifdef FLOAT_SIM
  o = c;
#else
  o = c / 10.0;
#endif
}`,Be=`
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D surf; uniform sampler2D lightTex; uniform sampler2D mask; uniform vec2 res; uniform vec2 css; uniform float aspect; uniform float time;
uniform vec2 throwTo;                          // where the type's shadow falls on the floor at the middle depth (uv), from the type's size
// Framed: the pool's box in the canvas (uv, x0 y0 x1 y1), its corner radius (pool CSS px), CSS px per canvas pixel,
// how far its light reaches past the frame (pool heights), and the page round it.
uniform float framed; uniform vec4 box; uniform float radius; uniform float px; uniform float spill; uniform sampler2D page;
const vec3 WATER = vec3(0.322, 0.682, 0.929);   // #52aeed, Tide's 17.4\xB0 water
const vec3 SUN = vec3(1.0, 0.985, 0.94);
const vec3 SKY = vec3(0.94, 0.975, 1.0);
const vec3 TILE_A = vec3(0.761, 0.906, 0.988), TILE_B = vec3(0.663, 0.851, 0.969);   // #c2e7fc to #a9d9f7
${fe}
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
vec3 pool(vec2 uv) {
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
  // Light that crosses more water is bluer and dimmer (Beer\u2013Lambert): Tide's tint at the middle depth, stronger in
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
  return col;
}
// Round a framed pool: the page, lit by the light the pool throws onto it, as a lit pool throws its light onto the
// walls round it. A point of the page gets the floor's light from further in the further out it is (thrown outwards
// from the middle), so the net of light widens, softens and fades as it travels. It lights what is on the page (a
// picture brightens) and the air over it a little (the dark ground glows), and fades out before the canvas's edge.
vec3 around(vec2 cuv, vec2 puv) {
  vec3 bg = texture(page, cuv).rgb;
  vec2 n = puv * 2.0 - 1.0;
  vec2 a = pow(abs(n), vec2(6.0));
  float k = max(1.0, pow(a.x + a.y, 1.0 / 6.0));      // about 1 on the rim, more outside (round at the corners)
  vec2 q = clamp(n / (k * k) * 0.5 + 0.5, 0.0, 1.0);
  float d = length((puv - clamp(puv, 0.0, 1.0)) * vec2(aspect, 1.0));   // pool heights past the rim
  vec3 l = floorLight(toLight(q), 1.5 + d * 34.0);
#ifndef FLOAT_SIM
  l *= 10.0;
#endif
  vec2 e = min(cuv, 1.0 - cuv) * css / (box.zw - box.xy);              // CSS px to the canvas's edge
  float fall = (spill > 0.0 ? exp(-d / spill) : 0.0) / (k * k) * smoothstep(0.0, 26.0, min(e.x, e.y));
  vec3 lit = SUN * mix(vec3(1.0), WATER, 0.45) * (smoothstep(0.9, 3.0, l) * 0.9 + 0.12) * fall;
  return bg * (1.0 + lit * 2.5) + lit * 0.26;
}
void main() {
  if (framed < 0.5) { o = vec4(pool(uv), 1.0); return; }
  vec2 puv = (uv - box.xy) / (box.zw - box.xy);
  // how far inside the pool's rounded rim this pixel is (CSS px, negative inside), for its edge and its meniscus
  vec2 hp = css * 0.5, qd = abs((puv - 0.5) * css) - hp + radius;
  float sd = length(max(qd, 0.0)) + min(max(qd.x, qd.y), 0.0) - radius;
  vec3 col = pool(puv);
  // the meniscus: the water climbs the wall, and the climb catches the sky in a thin bright line along the rim
  col = mix(col, SKY, 0.5 * exp(min(sd, 0.0) / 1.4) * (1.0 - smoothstep(0.0, 1.0, sd)));
  float inside = clamp(0.5 - sd / px, 0.0, 1.0);
  o = vec4(mix(around(uv, puv), col, inside), 1.0);
}`;function se(n,f,d=!1,s=Se){let e=`#version 300 es
`+(d?`#define FLOAT_SIM 1
`:""),p=(u,t)=>{let l=n.createShader(u);if(n.shaderSource(l,t),n.compileShader(l),!n.getShaderParameter(l,n.COMPILE_STATUS))throw new Error(n.getShaderInfoLog(l)??"shader");return l},m=n.createProgram();if(n.attachShader(m,p(n.VERTEX_SHADER,e+s)),n.attachShader(m,p(n.FRAGMENT_SHADER,e+f)),n.bindAttribLocation(m,0,"p"),n.linkProgram(m),!n.getProgramParameter(m,n.LINK_STATUS))throw new Error(n.getProgramInfoLog(m)??"link");let y={},i=new Proxy(y,{get:(u,t)=>t in u?u[t]:u[t]=n.getUniformLocation(m,t)});return{p:m,u:i}}function $(n,f,d,s,e){let p=n.createTexture();n.bindTexture(n.TEXTURE_2D,p),e==="rg32f"?n.texImage2D(n.TEXTURE_2D,0,n.RG32F,f,d,0,n.RG,n.FLOAT,null):e==="rgba16f"?n.texImage2D(n.TEXTURE_2D,0,n.RGBA16F,f,d,0,n.RGBA,n.HALF_FLOAT,null):n.texImage2D(n.TEXTURE_2D,0,n.RGBA8,f,d,0,n.RGBA,n.UNSIGNED_BYTE,null),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,s),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,s===n.NEAREST?n.NEAREST:n.LINEAR),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,n.CLAMP_TO_EDGE);let m=n.createFramebuffer();return n.bindFramebuffer(n.FRAMEBUFFER,m),n.framebufferTexture2D(n.FRAMEBUFFER,n.COLOR_ATTACHMENT0,n.TEXTURE_2D,p,0),{tex:p,fb:m,w:f,h:d}}var Re=(()=>{let n=11,f=()=>(n=n*16807%2147483647)/2147483647,d=new Float32Array(48),s=new Float32Array(12);for(let e=0;e<12;e++){let p=.7+(f()-.5)*2.4,m=.25*Math.pow(.85,e),y=2*Math.PI/m,i=.042-e*.0018;d.set([Math.cos(p),Math.sin(p),y,i/y*(.75+f()*.5)],e*4),s[e]=Math.sqrt(9.8*y)*.045*(.8+f()*.4)}return{v:d,sp:s}})();function ye(n,f,d={}){let s=n.getContext("webgl2",{antialias:!1,alpha:!1,depth:!1,stencil:!1,powerPreference:"high-performance"});if(!s)return null;let e=s,p=!!e.getExtension("EXT_color_buffer_float"),m,y,i,u,t;try{m=se(e,Ue,p),y=se(e,De,p),i=se(e,Ie,p),u=se(e,Ce,p,Pe),t=se(e,Be,p)}catch(a){return console.warn("Meniscus:",a),null}n.dataset.sim=p?"float":"packed";let l=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,l),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0);let h={vao:e.createVertexArray(),ibo:e.createBuffer(),cols:1,rows:1,n:0},b=document.createElement("canvas"),R=b.getContext("2d"),E=[e.createTexture(),e.createTexture()],A=0,v=E[0],x=1,g=1,S=1,B=1,D=1,Y=1.75,H=16,le=24,L=d.frame,K=e.createTexture();e.bindTexture(e.TEXTURE_2D,K),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,1,1,0,e.RGBA,e.UNSIGNED_BYTE,new Uint8Array([0,0,0,255])),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE);let oe=a=>{e.bindTexture(e.TEXTURE_2D,K),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!0),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,a),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!1)};d.source&&oe(d.source);let M={now:L?d.spill??.14:0,from:0,to:0,t0:0,ms:0},_=$(e,2,2,e.NEAREST,"rgba8"),N=$(e,2,2,e.NEAREST,"rgba8"),J=$(e,2,2,e.LINEAR,"rgba8"),j=$(e,2,2,e.LINEAR,"rgba8"),U=$(e,2,2,e.LINEAR,"rgba8"),re=p?e.RGBA16F:e.RGBA8,Z=Math.min(8,Math.max(0,...e.getInternalformatParameter(e.RENDERBUFFER,re,e.SAMPLES)??[0])),O={fb:e.createFramebuffer(),rb:e.createRenderbuffer(),w:2,h:2},o=[],r=null,P=0,k=!1,W=!1,ee=!0,I=4,G=0,ne=0,xe=a=>{e.bindFramebuffer(e.FRAMEBUFFER,a.fb),p?e.clearColor(0,0,0,1):e.clearColor(128/255,0,128/255,0),e.clear(e.COLOR_BUFFER_BIT)};function de(a=!1){v=E[A],!(!f(R,b.width,b.height,x,g)&&!a)&&(A^=1,e.bindTexture(e.TEXTURE_2D,E[A]),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!0),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,b),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!1),e.generateMipmap(e.TEXTURE_2D))}let be=()=>{let a=n.getBoundingClientRect();S=Math.max(1,a.width),B=Math.max(1,a.height),x=L?Math.max(1,S*(L[2]-L[0])):S,g=L?Math.max(1,B*(L[3]-L[1])):B,D=x/g;let c=Math.min(window.devicePixelRatio||1,S*B>15e5?1.25:Y);n.width=Math.round(S*c),n.height=Math.round(B*c);let F=320,T=Math.round(x>=g?F:F*D),X=Math.round(x>=g?F/D:F);for(let w of[_,N,J,j,U])e.deleteTexture(w.tex),e.deleteFramebuffer(w.fb);_=$(e,T,X,e.NEAREST,p?"rg32f":"rgba8"),N=$(e,T,X,e.NEAREST,p?"rg32f":"rgba8");let V=Math.round(T*2*(1+2*.08)),Q=Math.round(X*2*(1+2*.08));J=$(e,T,X,e.LINEAR,p?"rgba16f":"rgba8"),j=$(e,V,Q,e.LINEAR,p?"rgba16f":"rgba8"),U=$(e,V,Q,e.LINEAR_MIPMAP_LINEAR,p?"rgba16f":"rgba8"),Z&&(O.w=V,O.h=Q,e.bindRenderbuffer(e.RENDERBUFFER,O.rb),e.renderbufferStorageMultisample(e.RENDERBUFFER,Z,re,V,Q),e.bindFramebuffer(e.FRAMEBUFFER,O.fb),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.RENDERBUFFER,O.rb)),h.cols=Math.round(V/2),h.rows=Math.round(Q/2);let q=new Uint32Array(h.cols*h.rows*6);for(let w=0,C=0;w<h.rows;w++)for(let he=0;he<h.cols;he++,C+=6){let ue=w*(h.cols+1)+he,ve=ue+h.cols+1;q[C]=ue,q[C+1]=ue+1,q[C+2]=ve,q[C+3]=ue+1,q[C+4]=ve+1,q[C+5]=ve}h.n=q.length,e.bindVertexArray(h.vao),e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,h.ibo),e.bufferData(e.ELEMENT_ARRAY_BUFFER,q,e.STATIC_DRAW),e.bindVertexArray(null),xe(_),xe(N),b.width=T*2,b.height=X*2;for(let w of E)e.bindTexture(e.TEXTURE_2D,w),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,b.width,b.height,0,e.RGBA,e.UNSIGNED_BYTE,null),e.generateMipmap(e.TEXTURE_2D),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR_MIPMAP_LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE);de(!0),v=E[A];for(let w=0;w<3;w++)o.push([.18+w*.3,.25+w%2*.4,.045,.06]);for(let w=0;w<40;w++)Ee(1/60);pe()},ae=(a,c)=>{e.useProgram(a.p),e.bindFramebuffer(e.FRAMEBUFFER,c?c.fb:null),e.viewport(0,0,c?c.w:n.width,c?c.h:n.height)},z=(a,c,F)=>{e.activeTexture(e.TEXTURE0+a),e.bindTexture(e.TEXTURE_2D,c),e.uniform1i(F,a)};function Ee(a){de(),ae(m,N),e.uniform2f(m.u.texel,1/_.w,1/_.h),e.uniform1f(m.u.aspect,D);let c=Math.min(8,o.length),F=new Float32Array(32);for(let T=0;T<c;T++)F.set(o[T],T*4);o.splice(0,c),e.uniform4fv(m.u.drops,F),e.uniform1i(m.u.ndrops,c),e.uniform1f(m.u.push,.006),z(0,_.tex,m.u.state),z(1,E[A],m.u.mask),z(2,v,m.u.maskPrev),e.drawArrays(e.TRIANGLE_STRIP,0,4),[_,N]=[N,_]}function pe(){ae(y,J),e.uniform2f(y.u.texel,1/_.w,1/_.h),e.uniform1f(y.u.aspect,D),z(0,_.tex,y.u.state),e.drawArrays(e.TRIANGLE_STRIP,0,4),ae(i,j),z(0,J.tex,i.u.rip),e.uniform1f(i.u.aspect,D),e.uniform1f(i.u.time,I),e.uniform4fv(i.u.wv,Re.v),e.uniform1fv(i.u.wsp,Re.sp),e.drawArrays(e.TRIANGLE_STRIP,0,4),ae(u,Z?O:U),e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT),e.enable(e.BLEND),e.blendFunc(e.ONE,e.ONE),z(0,j.tex,u.u.surf),e.uniform1f(u.u.aspect,D),e.uniform1i(u.u.cols,h.cols),e.uniform2f(u.u.cell,(1+2*.08)/h.cols,(1+2*.08)/h.rows),e.uniform2f(u.u.size,U.w,U.h),e.bindVertexArray(h.vao),e.drawElementsInstanced(e.TRIANGLES,h.n,e.UNSIGNED_INT,0,3),e.bindVertexArray(null),e.disable(e.BLEND),Z&&(e.bindFramebuffer(e.READ_FRAMEBUFFER,O.fb),e.bindFramebuffer(e.DRAW_FRAMEBUFFER,U.fb),e.blitFramebuffer(0,0,U.w,U.h,0,0,U.w,U.h,e.COLOR_BUFFER_BIT,e.NEAREST)),ae(t,null),z(1,U.tex,t.u.lightTex),e.generateMipmap(e.TEXTURE_2D),z(0,j.tex,t.u.surf),z(2,E[A],t.u.mask),z(3,K,t.u.page);let a=n.width/S;if(e.uniform2f(t.u.res,x*a,g*a),e.uniform2f(t.u.css,x,g),e.uniform1f(t.u.aspect,D),e.uniform1f(t.u.time,I),e.uniform2f(t.u.throwTo,H/x,-le/g),e.uniform1f(t.u.framed,L?1:0),L){if(e.uniform4f(t.u.box,L[0],1-L[3],L[2],1-L[1]),e.uniform1f(t.u.radius,Math.min(d.radius??0,x/2,g/2)),e.uniform1f(t.u.px,1/a),M.ms){let c=Math.min(1,(performance.now()-M.t0)/M.ms);M.now=M.from+(M.to-M.from)*(c<.5?2*c*c:1-2*(1-c)*(1-c)),c>=1&&(M.ms=0)}e.uniform1f(t.u.spill,M.now)}e.drawArrays(e.TRIANGLE_STRIP,0,4)}let ie=0,ge=a=>{P=requestAnimationFrame(ge);let c=a-ne;if(ne&&c<1e3/60-3)return;ne=ne&&c<1e3/30?ne+1e3/60:a;let F=Math.min(.05,G?(a-G)/1e3:1/60);if(ie=G&&a-G>24?ie+1:Math.max(0,ie-1),ie>45&&Y>1){ie=0,Y=Math.max(1,Y*.8);let T=Math.min(window.devicePixelRatio||1,S*B>15e5?1.25:Y);n.width=Math.round(S*T),n.height=Math.round(B*T)}G=a,I+=F,Ee(F),pe(),d.onFrame?.(a)},Te=()=>{let a=k&&ee;a!==W&&(W=a,cancelAnimationFrame(P),G=ne=0,a&&(P=requestAnimationFrame(ge)))},ce=0,te=()=>{W||ce||!ee||(ce=requestAnimationFrame(()=>{ce=0,de(),pe()}))},we=a=>{a.preventDefault(),cancelAnimationFrame(P),W=!1,k=!1,n.dataset.gl="lost"};return n.addEventListener("webglcontextlost",we),be(),{resize:be,pointer(a,c,F){if(!W){te();return}let T=a/x,X=1-c/g,V=performance.now();if(F==="down")o.push([T,X,.04,.1]);else if(r&&V-r.t<200){let Q=Math.hypot((T-r.x)*D,X-r.y),q=Math.max(8,V-r.t),w=Math.min(4,Math.ceil(Q/.012));for(let C=1;C<=w;C++)o.push([r.x+(T-r.x)*C/w,r.y+(X-r.y)*C/w,.026,Math.min(.05,Q/q*2.2)])}r={x:T,y:X,t:V}},shadow(a,c){H=a,le=c,te()},splash(a,c,F,T){W?o.push([a/x,1-c/g,F/g,T]):te()},play(a){k=a,Te(),a||te()},visible(a){a!==ee&&(ee=a,Te(),a&&te())},setSpill(a,c=0){if(!W||c<=0){M.now=a,M.ms=0,te();return}Object.assign(M,{from:M.now,to:a,t0:performance.now(),ms:c})},setSource(a){oe(a),te()},dispose(){cancelAnimationFrame(P),cancelAnimationFrame(ce),n.removeEventListener("webglcontextlost",we),e.deleteTexture(K),e.getExtension("WEBGL_lose_context")?.loseContext()}}}function Le(){let n=null,f=null,d=null,s=null,e=!1,p=()=>{if(n)return;n=new AudioContext;let i=n.createDynamicsCompressor();i.threshold.value=-18,i.ratio.value=4,f=n.createGain(),f.gain.value=.6,f.connect(i),i.connect(n.destination),d=n.createBuffer(1,n.sampleRate*2,n.sampleRate);let u=d.getChannelData(0);for(let R=0;R<u.length;R++)u[R]=Math.random()*2-1;let t=n.createBufferSource();t.buffer=d,t.loop=!0;let l=n.createBiquadFilter();l.type="lowpass",l.frequency.value=500,l.Q.value=.7;let h=n.createGain();h.gain.value=0;let b=n.createStereoPanner();t.connect(l),l.connect(h),h.connect(b),b.connect(f),t.start(),s={src:t,gain:h,pan:b,filter:l}},m=(i,u,t,l)=>{if(!n||!f)return;let h=Math.min(4e3,3260/t),b=n.createOscillator(),R=n.createGain(),E=n.createStereoPanner();b.type="sine",b.frequency.setValueAtTime(h,i),b.frequency.exponentialRampToValueAtTime(h*1.4,i+.05);let A=.02+t*.012;R.gain.setValueAtTime(0,i),R.gain.linearRampToValueAtTime(l,i+.003),R.gain.exponentialRampToValueAtTime(1e-4,i+A*4),E.pan.value=Math.max(-1,Math.min(1,u*2-1))*.7,b.connect(R),R.connect(E),E.connect(f),b.start(i),b.stop(i+A*4+.02)},y=(i,u,t,l,h,b)=>{if(!n||!f||!d)return;let R=n.createBufferSource();R.buffer=d;let E=n.createBiquadFilter();E.type="bandpass",E.frequency.value=t,E.Q.value=l;let A=n.createGain(),v=n.createStereoPanner();A.gain.setValueAtTime(h,i),A.gain.exponentialRampToValueAtTime(1e-4,i+b),v.pan.value=Math.max(-1,Math.min(1,u*2-1))*.7,R.connect(E),E.connect(A),A.connect(v),v.connect(f),R.start(i,Math.random()*1.5,b+.02)};return{get on(){return e},enable(i){e=i,i?(p(),n?.resume()):s&&n&&s.gain.gain.setTargetAtTime(0,n.currentTime,.05)},drop(i,u=.5){if(!e||!n)return;let t=n.currentTime+.005;y(t,i,3500,1.2,.05+u*.05,.02),m(t+.008,i,1.4+u*2.6+Math.random()*.6,.18+u*.12)},splash(i){if(!e||!n)return;let u=n.currentTime+.005;y(u,i,1800,.8,.16,.12);for(let t=0;t<3;t++)m(u+.012+Math.random()*.06,i+(Math.random()-.5)*.08,1.2+Math.random()*3.5,.08+Math.random()*.08)},wake(i,u){if(!e||!n||!s)return;let t=n.currentTime,l=Math.min(1,i/1.5);s.gain.gain.setTargetAtTime(l*.22,t,.08),s.filter.frequency.setTargetAtTime(350+l*700,t,.1),s.pan.pan.setTargetAtTime(Math.max(-1,Math.min(1,u*2-1))*.6,t,.1)},dispose(){s?.src.stop(),n?.close(),n=null}}}function Me(n){let{host:f,canvas:d,word:s}=n,e=n.font??'"Albert Sans Variable", "Albert Sans", system-ui, sans-serif',p=n.weight??800,m=n.tracking??-.045,y=n.max??12,i=!!n.still,u=s.textContent??"",t={x:0,y:0,vx:0,vy:0,r:0,size:100,text:u,t:0,bob:0},l=null,h=[],b=0,R="",E=0,A=0,v=f.getBoundingClientRect(),x=null,g=Le();s.style.font=`${p} 100px/1 ${e}`,s.style.letterSpacing=`${m}em`;let S=document.createElement("canvas").getContext("2d"),B=()=>{S.font=`${p} ${t.size}px ${e}`;let o=S.measureText("Hg");b=(t.size-(o.fontBoundingBoxAscent+o.fontBoundingBoxDescent))/2+o.fontBoundingBoxAscent,x?.shadow(t.size*.09,t.size*.14)},D=()=>{S.font=`${p} 100px ${e}`,S.letterSpacing=`${m*100}px`;let o=Math.max(1,S.measureText(t.text||"M").width)/100,r=Math.round(Math.min(v.width*.86/o,v.height*.26,260));r!==t.size&&(t.size=r,s.style.fontSize=`${r}px`,B())},Y=()=>{v=f.getBoundingClientRect(),D(),t.x||(t.x=v.width*.5,t.y=v.height*(v.width<700?.42:.46)),t.x=Math.min(Math.max(t.x,0),v.width),t.y=Math.min(Math.max(t.y,0),v.height),h=Array.from(f.querySelectorAll("[data-calm]")).map(o=>{let r=o.getBoundingClientRect();return{x:r.left-v.left,y:r.top-v.top,w:r.width,h:r.height}}),B(),R=""},H=()=>{s.style.transform=`translate3d(${t.x.toFixed(2)}px, ${(t.y+t.bob).toFixed(2)}px, 0) translate(-50%, -50%) rotate(${t.r.toFixed(4)}rad)`},le=(o,r,P,k)=>{let W=`${r}x${P}|${t.text}|${t.x.toFixed(1)}|${(t.y+t.bob).toFixed(1)}|${t.r.toFixed(3)}|${t.size}|${h.length}`;if(W===R)return!1;R=W,o.setTransform(1,0,0,1,0,0),o.globalCompositeOperation="source-over",o.fillStyle="#000",o.fillRect(0,0,r,P),o.globalCompositeOperation="lighter";let ee=r/k;o.setTransform(ee,0,0,ee,0,0),o.fillStyle="#00ff00";for(let G of h)o.beginPath(),o.roundRect(G.x-12,G.y-10,G.w+24,G.h+20,14),o.fill();let I=o;return I.font=`${p} ${t.size}px ${e}`,I.letterSpacing=`${(m*t.size).toFixed(2)}px`,I.textAlign="center",I.textBaseline="alphabetic",I.fillStyle="#ff0000",I.translate(t.x,t.y+t.bob),I.rotate(t.r),I.fillText(t.text,0,b-t.size/2),I.letterSpacing="0px",!0},L=o=>{E=requestAnimationFrame(L);let r=Math.min(.05,A?(o-A)/1e3:1/60);if(A=o,i){t.bob=0;return}if(t.t+=r,l)t.vx+=((l.tx-t.x)*140-t.vx*18)*r,t.vy+=((l.ty-t.y)*140-t.vy*18)*r;else{let k=Math.exp(-r*4.5);t.vx*=k,t.vy*=k}t.x+=t.vx*r,t.y+=t.vy*r,(t.x<0||t.x>v.width)&&(t.x=Math.min(Math.max(t.x,0),v.width),t.vx*=-.4),(t.y<0||t.y>v.height)&&(t.y=Math.min(Math.max(t.y,0),v.height),t.vy*=-.4);let P=Math.max(-.22,Math.min(.22,t.vx*45e-5));t.r+=(P+Math.sin(t.t*.9)*.012-t.r)*Math.min(1,r*6),t.bob=Math.sin(t.t*1.1)*t.size*.005,H(),g.on&&g.wake(Math.hypot(t.vx,t.vy)/Math.max(1,v.width),t.x/Math.max(1,v.width))},K=o=>{let r=f.getBoundingClientRect();return{x:o.clientX-r.left,y:o.clientY-r.top}},oe=o=>{if(o.button!==0||document.activeElement===s)return;let r=K(o);l={id:o.pointerId,dx:r.x-t.x,dy:r.y-t.y,tx:t.x,ty:t.y,moved:!1,x0:r.x,y0:r.y},s.setPointerCapture(o.pointerId),o.preventDefault()},M=o=>{let r=K(o);if(l&&o.pointerId===l.id){l.tx=r.x-l.dx,l.ty=r.y-l.dy,Math.hypot(r.x-l.x0,r.y-l.y0)>5&&(l.moved=!0),i&&(t.x=l.tx,t.y=l.ty,H(),x?.pointer(r.x,r.y,"move"));return}x?.pointer(r.x,r.y,"move")},_=()=>{let o=document.createRange();o.selectNodeContents(s),o.collapse(!1),getSelection()?.removeAllRanges(),getSelection()?.addRange(o)},N=o=>{if(!l||o.pointerId!==l.id)return;let r=!l.moved;l=null,r&&(s.focus(),_())},J=o=>{if(o.target===s||o.target?.closest?.("button, a, input"))return;let r=K(o);x?.pointer(r.x,r.y,"down"),g.drop(r.x/v.width,.6)},j=()=>{let o=(s.textContent??"").replace(/\s+/g," ");o.length>y&&(o=o.slice(0,y),s.textContent=o,_());let r=o.length>t.text.length;if(t.text=o,D(),r){let P=s.getBoundingClientRect(),k=P.right-f.getBoundingClientRect().left-t.size*.25;x?.splash(k,t.y,t.size*.5,.08),g.splash(k/v.width)}i&&H()},U=o=>{(o.key==="Enter"||o.key==="Escape")&&(o.preventDefault(),s.blur())},re=()=>{(s.textContent??"").trim()||(s.textContent=u,t.text=u,D())},Z=()=>{Y(),H(),x?.resize()},O=()=>x?.visible(!document.hidden);return Y(),H(),s.addEventListener("pointerdown",oe),window.addEventListener("pointermove",M,{passive:!0}),window.addEventListener("pointerup",N),window.addEventListener("pointercancel",N),window.addEventListener("pointerdown",J,{passive:!0}),s.addEventListener("input",j),s.addEventListener("keydown",U),s.addEventListener("blur",re),window.addEventListener("resize",Z),document.addEventListener("visibilitychange",O),E=requestAnimationFrame(L),x=ye(d,le,n.water),f.dataset.gl=x?"on":"off",B(),x?.play(!i),{water:x,sound:g,setStill(o){i=o,x?.play(!o),o&&(H(),g.wake(0,.5))},setSound(o){g.enable(o)},dispose(){cancelAnimationFrame(E),s.removeEventListener("pointerdown",oe),window.removeEventListener("pointermove",M),window.removeEventListener("pointerup",N),window.removeEventListener("pointercancel",N),window.removeEventListener("pointerdown",J),s.removeEventListener("input",j),s.removeEventListener("keydown",U),s.removeEventListener("blur",re),window.removeEventListener("resize",Z),document.removeEventListener("visibilitychange",O),x?.dispose(),x=null,g.dispose()}}}var me=document.getElementById("pool"),Fe=matchMedia("(prefers-reduced-motion: reduce)");document.fonts.load('800 100px "Albert Sans Variable"').then(()=>{let n=Me({host:me,canvas:me.querySelector("canvas"),word:me.querySelector(".mn-word"),still:Fe.matches});Fe.addEventListener("change",d=>n.setStill(d.matches));let f=me.querySelector(".mn-sound");f.addEventListener("click",()=>{let d=!n.sound.on;n.setSound(d),f.setAttribute("aria-pressed",String(d)),f.textContent=d?"Sound on":"Sound off"})});

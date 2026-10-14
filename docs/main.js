var we=`
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;var le=`
const float SHALLOW = 0.09, DEEP = 0.2, MID = 0.145, PERSP = 0.6, BLUR = 4.5, SPREAD = 14.0, M = ${.08};
const vec3 FOCUS = 1.0 + (vec3(0.99549, 1.0, 1.00899) - 1.0) * SPREAD;
float depth(vec2 uv, float aspect) {
  vec2 a = vec2(aspect, -1.0);
  return mix(SHALLOW, DEEP, smoothstep(0.1, 0.9, dot(vec2(uv.x * aspect, uv.y - 1.0), a) / dot(a, a)));
}
vec2 toLight(vec2 uv) { return (uv + M) / (1.0 + 2.0 * M); }`,Ae=`
vec2 pack16(float v) { v = floor(clamp(v * 0.5 + 0.5, 0.0, 1.0) * 65535.0 + 0.5); float hi = floor(v / 256.0); return vec2(hi, v - hi * 256.0) / 255.0; }
float unpack16(vec2 b) { return (floor(b.x * 255.0 + 0.5) * 256.0 + floor(b.y * 255.0 + 0.5)) / 65535.0 * 2.0 - 1.0; }`,xe=`
#ifdef FLOAT_SIM
vec2 rd(sampler2D t, vec2 q) { return texture(t, q).rg; }
vec4 wr(vec2 s) { return vec4(s, 0.0, 1.0); }
#else
${Ae}
const float RANGE = 0.25;
vec2 rd(sampler2D t, vec2 q) { vec4 s = texture(t, q); return vec2(unpack16(s.rg), unpack16(s.ba)) * RANGE; }
vec4 wr(vec2 s) { return vec4(pack16(s.x / RANGE), pack16(s.y / RANGE)); }
#endif`,Re=`
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D state; uniform vec2 texel; uniform float aspect; uniform vec4 drops[8]; uniform int ndrops;
uniform sampler2D mask; uniform sampler2D maskPrev; uniform float push;
${xe}
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
}`,ye=`
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D state; uniform vec2 texel; uniform float aspect;
${xe}
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
}`,Le=`
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D rip; uniform float aspect; uniform float time; uniform vec4 wv[12]; uniform float wsp[12];
${le}
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
}`,Me=`
precision highp float;
uniform sampler2D surf; uniform float aspect; uniform int cols; uniform vec2 cell;
out vec2 from; out float peak; flat out int ch;
${le}
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
}`,Fe=`
precision highp float;
in vec2 from; in float peak; flat in int ch;
out vec4 o;
uniform vec2 size;
${le}
void main() {
  vec2 a = dFdx(from) * size / (1.0 + 2.0 * M), b = dFdy(from) * size / (1.0 + 2.0 * M);
  vec4 c = vec4(equal(ivec4(ch), ivec4(0, 1, 2, 3))) * min(abs(a.x * b.y - a.y * b.x), peak);
#ifdef FLOAT_SIM
  o = c;
#else
  o = c / 10.0;
#endif
}`,Se=`
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D surf; uniform sampler2D lightTex; uniform sampler2D mask; uniform vec2 res; uniform vec2 css; uniform float aspect; uniform float time;
uniform vec2 throwTo;                          // where the type's shadow falls on the floor at the middle depth (uv), from the type's size
const vec3 WATER = vec3(0.322, 0.682, 0.929);   // #52aeed, Tide's 17.4\xB0 water
const vec3 SUN = vec3(1.0, 0.985, 0.94);
const vec3 SKY = vec3(0.94, 0.975, 1.0);
const vec3 TILE_A = vec3(0.761, 0.906, 0.988), TILE_B = vec3(0.663, 0.851, 0.969);   // #c2e7fc to #a9d9f7
${le}
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
  o = vec4(col, 1.0);
}`;function ae(t,f,v=!1,i=we){let e=`#version 300 es
`+(v?`#define FLOAT_SIM 1
`:""),d=(c,n)=>{let s=t.createShader(c);if(t.shaderSource(s,n),t.compileShader(s),!t.getShaderParameter(s,t.COMPILE_STATUS))throw new Error(t.getShaderInfoLog(s)??"shader");return s},u=t.createProgram();if(t.attachShader(u,d(t.VERTEX_SHADER,e+i)),t.attachShader(u,d(t.FRAGMENT_SHADER,e+f)),t.bindAttribLocation(u,0,"p"),t.linkProgram(u),!t.getProgramParameter(u,t.LINK_STATUS))throw new Error(t.getProgramInfoLog(u)??"link");let L={},a=new Proxy(L,{get:(c,n)=>n in c?c[n]:c[n]=t.getUniformLocation(u,n)});return{p:u,u:a}}function k(t,f,v,i,e){let d=t.createTexture();t.bindTexture(t.TEXTURE_2D,d),e==="rg32f"?t.texImage2D(t.TEXTURE_2D,0,t.RG32F,f,v,0,t.RG,t.FLOAT,null):e==="rgba16f"?t.texImage2D(t.TEXTURE_2D,0,t.RGBA16F,f,v,0,t.RGBA,t.HALF_FLOAT,null):t.texImage2D(t.TEXTURE_2D,0,t.RGBA8,f,v,0,t.RGBA,t.UNSIGNED_BYTE,null),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,i),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,i===t.NEAREST?t.NEAREST:t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE);let u=t.createFramebuffer();return t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,d,0),{tex:d,fb:u,w:f,h:v}}var ve=(()=>{let t=11,f=()=>(t=t*16807%2147483647)/2147483647,v=new Float32Array(48),i=new Float32Array(12);for(let e=0;e<12;e++){let d=.7+(f()-.5)*2.4,u=.25*Math.pow(.85,e),L=2*Math.PI/u,a=.042-e*.0018;v.set([Math.cos(d),Math.sin(d),L,a/L*(.75+f()*.5)],e*4),i[e]=Math.sqrt(9.8*L)*.045*(.8+f()*.4)}return{v,sp:i}})();function be(t,f,v={}){let i=t.getContext("webgl2",{antialias:!1,alpha:!1,depth:!1,stencil:!1,powerPreference:"high-performance"});if(!i)return null;let e=i,d=!!e.getExtension("EXT_color_buffer_float"),u,L,a,c,n;try{u=ae(e,Re,d),L=ae(e,ye,d),a=ae(e,Le,d),c=ae(e,Fe,d,Me),n=ae(e,Se,d)}catch(l){return console.warn("Meniscus:",l),null}t.dataset.sim=d?"float":"packed";let s=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,s),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0);let m={vao:e.createVertexArray(),ibo:e.createBuffer(),cols:1,rows:1,n:0},x=document.createElement("canvas"),w=x.getContext("2d"),g=[e.createTexture(),e.createTexture()],R=0,p=g[0],h=1,E=1,S=1,G=1.75,J=16,ee=24,y=k(e,2,2,e.NEAREST,"rgba8"),X=k(e,2,2,e.NEAREST,"rgba8"),Y=k(e,2,2,e.LINEAR,"rgba8"),O=k(e,2,2,e.LINEAR,"rgba8"),_=k(e,2,2,e.LINEAR,"rgba8"),te=d?e.RGBA16F:e.RGBA8,K=Math.min(8,Math.max(0,...e.getInternalformatParameter(e.RENDERBUFFER,te,e.SAMPLES)??[0])),D={fb:e.createFramebuffer(),rb:e.createRenderbuffer(),w:2,h:2},C=[],U=null,$=0,Z=!1,z=!1,Q=!0,o=4,r=0,W=l=>{e.bindFramebuffer(e.FRAMEBUFFER,l.fb),d?e.clearColor(0,0,0,1):e.clearColor(128/255,0,128/255,0),e.clear(e.COLOR_BUFFER_BIT)};function I(l=!1){p=g[R],!(!f(w,x.width,x.height,h,E)&&!l)&&(R^=1,e.bindTexture(e.TEXTURE_2D,g[R]),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!0),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,x),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!1),e.generateMipmap(e.TEXTURE_2D))}let ne=()=>{let l=t.getBoundingClientRect();h=Math.max(1,l.width),E=Math.max(1,l.height),S=h/E;let b=Math.min(window.devicePixelRatio||1,h*E>15e5?1.25:G);t.width=Math.round(h*b),t.height=Math.round(E*b);let F=320,M=Math.round(h>=E?F:F*S),B=Math.round(h>=E?F/S:F);for(let T of[y,X,Y,O,_])e.deleteTexture(T.tex),e.deleteFramebuffer(T.fb);y=k(e,M,B,e.NEAREST,d?"rg32f":"rgba8"),X=k(e,M,B,e.NEAREST,d?"rg32f":"rgba8");let q=Math.round(M*2*(1+2*.08)),H=Math.round(B*2*(1+2*.08));Y=k(e,M,B,e.LINEAR,d?"rgba16f":"rgba8"),O=k(e,q,H,e.LINEAR,d?"rgba16f":"rgba8"),_=k(e,q,H,e.LINEAR_MIPMAP_LINEAR,d?"rgba16f":"rgba8"),K&&(D.w=q,D.h=H,e.bindRenderbuffer(e.RENDERBUFFER,D.rb),e.renderbufferStorageMultisample(e.RENDERBUFFER,K,te,q,H),e.bindFramebuffer(e.FRAMEBUFFER,D.fb),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.RENDERBUFFER,D.rb)),m.cols=Math.round(q/2),m.rows=Math.round(H/2);let N=new Uint32Array(m.cols*m.rows*6);for(let T=0,P=0;T<m.rows;T++)for(let fe=0;fe<m.cols;fe++,P+=6){let se=T*(m.cols+1)+fe,de=se+m.cols+1;N[P]=se,N[P+1]=se+1,N[P+2]=de,N[P+3]=se+1,N[P+4]=de+1,N[P+5]=de}m.n=N.length,e.bindVertexArray(m.vao),e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,m.ibo),e.bufferData(e.ELEMENT_ARRAY_BUFFER,N,e.STATIC_DRAW),e.bindVertexArray(null),W(y),W(X),x.width=M*2,x.height=B*2;for(let T of g)e.bindTexture(e.TEXTURE_2D,T),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,x.width,x.height,0,e.RGBA,e.UNSIGNED_BYTE,null),e.generateMipmap(e.TEXTURE_2D),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR_MIPMAP_LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE);I(!0),p=g[R];for(let T=0;T<3;T++)C.push([.18+T*.3,.25+T%2*.4,.045,.06]);for(let T=0;T<40;T++)j(1/60);ue()},V=(l,b)=>{e.useProgram(l.p),e.bindFramebuffer(e.FRAMEBUFFER,b?b.fb:null),e.viewport(0,0,b?b.w:t.width,b?b.h:t.height)},A=(l,b,F)=>{e.activeTexture(e.TEXTURE0+l),e.bindTexture(e.TEXTURE_2D,b),e.uniform1i(F,l)};function j(l){I(),V(u,X),e.uniform2f(u.u.texel,1/y.w,1/y.h),e.uniform1f(u.u.aspect,S);let b=Math.min(8,C.length),F=new Float32Array(32);for(let M=0;M<b;M++)F.set(C[M],M*4);C.splice(0,b),e.uniform4fv(u.u.drops,F),e.uniform1i(u.u.ndrops,b),e.uniform1f(u.u.push,.006),A(0,y.tex,u.u.state),A(1,g[R],u.u.mask),A(2,p,u.u.maskPrev),e.drawArrays(e.TRIANGLE_STRIP,0,4),[y,X]=[X,y]}function ue(){V(L,Y),e.uniform2f(L.u.texel,1/y.w,1/y.h),e.uniform1f(L.u.aspect,S),A(0,y.tex,L.u.state),e.drawArrays(e.TRIANGLE_STRIP,0,4),V(a,O),A(0,Y.tex,a.u.rip),e.uniform1f(a.u.aspect,S),e.uniform1f(a.u.time,o),e.uniform4fv(a.u.wv,ve.v),e.uniform1fv(a.u.wsp,ve.sp),e.drawArrays(e.TRIANGLE_STRIP,0,4),V(c,K?D:_),e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT),e.enable(e.BLEND),e.blendFunc(e.ONE,e.ONE),A(0,O.tex,c.u.surf),e.uniform1f(c.u.aspect,S),e.uniform1i(c.u.cols,m.cols),e.uniform2f(c.u.cell,(1+2*.08)/m.cols,(1+2*.08)/m.rows),e.uniform2f(c.u.size,_.w,_.h),e.bindVertexArray(m.vao),e.drawElementsInstanced(e.TRIANGLES,m.n,e.UNSIGNED_INT,0,3),e.bindVertexArray(null),e.disable(e.BLEND),K&&(e.bindFramebuffer(e.READ_FRAMEBUFFER,D.fb),e.bindFramebuffer(e.DRAW_FRAMEBUFFER,_.fb),e.blitFramebuffer(0,0,_.w,_.h,0,0,_.w,_.h,e.COLOR_BUFFER_BIT,e.NEAREST)),V(n,null),A(1,_.tex,n.u.lightTex),e.generateMipmap(e.TEXTURE_2D),A(0,O.tex,n.u.surf),A(2,g[R],n.u.mask),e.uniform2f(n.u.res,t.width,t.height),e.uniform2f(n.u.css,h,E),e.uniform1f(n.u.aspect,S),e.uniform1f(n.u.time,o),e.uniform2f(n.u.throwTo,J/h,-ee/E),e.drawArrays(e.TRIANGLE_STRIP,0,4)}let oe=0,me=l=>{if($=requestAnimationFrame(me),r&&l-r<1e3/62)return;let b=Math.min(.05,r?(l-r)/1e3:1/60);if(oe=r&&l-r>24?oe+1:Math.max(0,oe-1),oe>45&&G>1){oe=0,G=Math.max(1,G*.8);let F=Math.min(window.devicePixelRatio||1,h*E>15e5?1.25:G);t.width=Math.round(h*F),t.height=Math.round(E*F)}r=l,o+=b,j(b),ue(),v.onFrame?.(l)},pe=()=>{let l=Z&&Q;l!==z&&(z=l,cancelAnimationFrame($),r=0,l&&($=requestAnimationFrame(me)))},ie=0,re=()=>{z||ie||!Q||(ie=requestAnimationFrame(()=>{ie=0,I(),ue()}))},he=l=>{l.preventDefault(),cancelAnimationFrame($),z=!1,Z=!1,t.dataset.gl="lost"};return t.addEventListener("webglcontextlost",he),ne(),{resize:ne,pointer(l,b,F){if(!z){re();return}let M=l/h,B=1-b/E,q=performance.now();if(F==="down")C.push([M,B,.04,.1]);else if(U&&q-U.t<200){let H=Math.hypot((M-U.x)*S,B-U.y),N=Math.max(8,q-U.t),T=Math.min(4,Math.ceil(H/.012));for(let P=1;P<=T;P++)C.push([U.x+(M-U.x)*P/T,U.y+(B-U.y)*P/T,.026,Math.min(.05,H/N*2.2)])}U={x:M,y:B,t:q}},shadow(l,b){J=l,ee=b,re()},splash(l,b,F,M){z?C.push([l/h,1-b/E,F/E,M]):re()},play(l){Z=l,pe(),l||re()},visible(l){l!==Q&&(Q=l,pe(),l&&re())},dispose(){cancelAnimationFrame($),cancelAnimationFrame(ie),t.removeEventListener("webglcontextlost",he),e.getExtension("WEBGL_lose_context")?.loseContext()}}}function Ee(){let t=null,f=null,v=null,i=null,e=!1,d=()=>{if(t)return;t=new AudioContext;let a=t.createDynamicsCompressor();a.threshold.value=-18,a.ratio.value=4,f=t.createGain(),f.gain.value=.6,f.connect(a),a.connect(t.destination),v=t.createBuffer(1,t.sampleRate*2,t.sampleRate);let c=v.getChannelData(0);for(let w=0;w<c.length;w++)c[w]=Math.random()*2-1;let n=t.createBufferSource();n.buffer=v,n.loop=!0;let s=t.createBiquadFilter();s.type="lowpass",s.frequency.value=500,s.Q.value=.7;let m=t.createGain();m.gain.value=0;let x=t.createStereoPanner();n.connect(s),s.connect(m),m.connect(x),x.connect(f),n.start(),i={src:n,gain:m,pan:x,filter:s}},u=(a,c,n,s)=>{if(!t||!f)return;let m=Math.min(4e3,3260/n),x=t.createOscillator(),w=t.createGain(),g=t.createStereoPanner();x.type="sine",x.frequency.setValueAtTime(m,a),x.frequency.exponentialRampToValueAtTime(m*1.4,a+.05);let R=.02+n*.012;w.gain.setValueAtTime(0,a),w.gain.linearRampToValueAtTime(s,a+.003),w.gain.exponentialRampToValueAtTime(1e-4,a+R*4),g.pan.value=Math.max(-1,Math.min(1,c*2-1))*.7,x.connect(w),w.connect(g),g.connect(f),x.start(a),x.stop(a+R*4+.02)},L=(a,c,n,s,m,x)=>{if(!t||!f||!v)return;let w=t.createBufferSource();w.buffer=v;let g=t.createBiquadFilter();g.type="bandpass",g.frequency.value=n,g.Q.value=s;let R=t.createGain(),p=t.createStereoPanner();R.gain.setValueAtTime(m,a),R.gain.exponentialRampToValueAtTime(1e-4,a+x),p.pan.value=Math.max(-1,Math.min(1,c*2-1))*.7,w.connect(g),g.connect(R),R.connect(p),p.connect(f),w.start(a,Math.random()*1.5,x+.02)};return{get on(){return e},enable(a){e=a,a?(d(),t?.resume()):i&&t&&i.gain.gain.setTargetAtTime(0,t.currentTime,.05)},drop(a,c=.5){if(!e||!t)return;let n=t.currentTime+.005;L(n,a,3500,1.2,.05+c*.05,.02),u(n+.008,a,1.4+c*2.6+Math.random()*.6,.18+c*.12)},splash(a){if(!e||!t)return;let c=t.currentTime+.005;L(c,a,1800,.8,.16,.12);for(let n=0;n<3;n++)u(c+.012+Math.random()*.06,a+(Math.random()-.5)*.08,1.2+Math.random()*3.5,.08+Math.random()*.08)},wake(a,c){if(!e||!t||!i)return;let n=t.currentTime,s=Math.min(1,a/1.5);i.gain.gain.setTargetAtTime(s*.22,n,.08),i.filter.frequency.setTargetAtTime(350+s*700,n,.1),i.pan.pan.setTargetAtTime(Math.max(-1,Math.min(1,c*2-1))*.6,n,.1)},dispose(){i?.src.stop(),t?.close(),t=null}}}function ge(t){let{host:f,canvas:v,word:i}=t,e=t.font??'"Albert Sans Variable", "Albert Sans", system-ui, sans-serif',d=t.weight??800,u=t.tracking??-.045,L=t.max??12,a=!!t.still,c=i.textContent??"",n={x:0,y:0,vx:0,vy:0,r:0,size:100,text:c,t:0,bob:0},s=null,m=[],x=0,w="",g=0,R=0,p=f.getBoundingClientRect(),h=null,E=Ee();i.style.font=`${d} 100px/1 ${e}`,i.style.letterSpacing=`${u}em`;let S=document.createElement("canvas").getContext("2d"),G=()=>{S.font=`${d} ${n.size}px ${e}`;let o=S.measureText("Hg");x=(n.size-(o.fontBoundingBoxAscent+o.fontBoundingBoxDescent))/2+o.fontBoundingBoxAscent,h?.shadow(n.size*.09,n.size*.14)},J=()=>{S.font=`${d} 100px ${e}`,S.letterSpacing=`${u*100}px`;let o=Math.max(1,S.measureText(n.text||"M").width)/100,r=Math.round(Math.min(p.width*.86/o,p.height*.26,260));r!==n.size&&(n.size=r,i.style.fontSize=`${r}px`,G())},ee=()=>{p=f.getBoundingClientRect(),J(),n.x||(n.x=p.width*.5,n.y=p.height*(p.width<700?.42:.46)),n.x=Math.min(Math.max(n.x,0),p.width),n.y=Math.min(Math.max(n.y,0),p.height),m=Array.from(f.querySelectorAll("[data-calm]")).map(o=>{let r=o.getBoundingClientRect();return{x:r.left-p.left,y:r.top-p.top,w:r.width,h:r.height}}),G(),w=""},y=()=>{i.style.transform=`translate3d(${n.x.toFixed(2)}px, ${(n.y+n.bob).toFixed(2)}px, 0) translate(-50%, -50%) rotate(${n.r.toFixed(4)}rad)`},X=(o,r,W,I)=>{let ne=`${r}x${W}|${n.text}|${n.x.toFixed(1)}|${(n.y+n.bob).toFixed(1)}|${n.r.toFixed(3)}|${n.size}|${m.length}`;if(ne===w)return!1;w=ne,o.setTransform(1,0,0,1,0,0),o.globalCompositeOperation="source-over",o.fillStyle="#000",o.fillRect(0,0,r,W),o.globalCompositeOperation="lighter";let V=r/I;o.setTransform(V,0,0,V,0,0),o.fillStyle="#00ff00";for(let j of m)o.beginPath(),o.roundRect(j.x-12,j.y-10,j.w+24,j.h+20,14),o.fill();let A=o;return A.font=`${d} ${n.size}px ${e}`,A.letterSpacing=`${(u*n.size).toFixed(2)}px`,A.textAlign="center",A.textBaseline="alphabetic",A.fillStyle="#ff0000",A.translate(n.x,n.y+n.bob),A.rotate(n.r),A.fillText(n.text,0,x-n.size/2),A.letterSpacing="0px",!0},Y=o=>{g=requestAnimationFrame(Y);let r=Math.min(.05,R?(o-R)/1e3:1/60);if(R=o,a){n.bob=0;return}if(n.t+=r,s)n.vx+=((s.tx-n.x)*140-n.vx*18)*r,n.vy+=((s.ty-n.y)*140-n.vy*18)*r;else{let I=Math.exp(-r*4.5);n.vx*=I,n.vy*=I}n.x+=n.vx*r,n.y+=n.vy*r,(n.x<0||n.x>p.width)&&(n.x=Math.min(Math.max(n.x,0),p.width),n.vx*=-.4),(n.y<0||n.y>p.height)&&(n.y=Math.min(Math.max(n.y,0),p.height),n.vy*=-.4);let W=Math.max(-.22,Math.min(.22,n.vx*45e-5));n.r+=(W+Math.sin(n.t*.9)*.012-n.r)*Math.min(1,r*6),n.bob=Math.sin(n.t*1.1)*n.size*.005,y(),E.on&&E.wake(Math.hypot(n.vx,n.vy)/Math.max(1,p.width),n.x/Math.max(1,p.width))},O=o=>({x:o.clientX-p.left,y:o.clientY-p.top}),_=o=>{if(o.button!==0||document.activeElement===i)return;let r=O(o);s={id:o.pointerId,dx:r.x-n.x,dy:r.y-n.y,tx:n.x,ty:n.y,moved:!1,x0:r.x,y0:r.y},i.setPointerCapture(o.pointerId),o.preventDefault()},te=o=>{let r=O(o);if(s&&o.pointerId===s.id){s.tx=r.x-s.dx,s.ty=r.y-s.dy,Math.hypot(r.x-s.x0,r.y-s.y0)>5&&(s.moved=!0),a&&(n.x=s.tx,n.y=s.ty,y(),h?.pointer(r.x,r.y,"move"));return}h?.pointer(r.x,r.y,"move")},K=()=>{let o=document.createRange();o.selectNodeContents(i),o.collapse(!1),getSelection()?.removeAllRanges(),getSelection()?.addRange(o)},D=o=>{if(!s||o.pointerId!==s.id)return;let r=!s.moved;s=null,r&&(i.focus(),K())},C=o=>{if(o.target===i||o.target?.closest?.("button, a, input"))return;let r=O(o);h?.pointer(r.x,r.y,"down"),E.drop(r.x/p.width,.6)},U=()=>{let o=(i.textContent??"").replace(/\s+/g," ");o.length>L&&(o=o.slice(0,L),i.textContent=o,K());let r=o.length>n.text.length;if(n.text=o,J(),r){let W=i.getBoundingClientRect(),I=W.right-p.left-n.size*.25;h?.splash(I,n.y,n.size*.5,.08),E.splash(I/p.width)}a&&y()},$=o=>{(o.key==="Enter"||o.key==="Escape")&&(o.preventDefault(),i.blur())},Z=()=>{(i.textContent??"").trim()||(i.textContent=c,n.text=c,J())},z=()=>{ee(),y(),h?.resize()},Q=()=>h?.visible(!document.hidden);return ee(),y(),i.addEventListener("pointerdown",_),window.addEventListener("pointermove",te,{passive:!0}),window.addEventListener("pointerup",D),window.addEventListener("pointercancel",D),window.addEventListener("pointerdown",C,{passive:!0}),i.addEventListener("input",U),i.addEventListener("keydown",$),i.addEventListener("blur",Z),window.addEventListener("resize",z),document.addEventListener("visibilitychange",Q),g=requestAnimationFrame(Y),h=be(v,X,t.water),f.dataset.gl=h?"on":"off",G(),h?.play(!a),{water:h,sound:E,setStill(o){a=o,h?.play(!o),o&&(y(),E.wake(0,.5))},setSound(o){E.enable(o)},dispose(){cancelAnimationFrame(g),i.removeEventListener("pointerdown",_),window.removeEventListener("pointermove",te),window.removeEventListener("pointerup",D),window.removeEventListener("pointercancel",D),window.removeEventListener("pointerdown",C),i.removeEventListener("input",U),i.removeEventListener("keydown",$),i.removeEventListener("blur",Z),window.removeEventListener("resize",z),document.removeEventListener("visibilitychange",Q),h?.dispose(),h=null,E.dispose()}}}var ce=document.getElementById("pool"),Te=matchMedia("(prefers-reduced-motion: reduce)");document.fonts.load('800 100px "Albert Sans Variable"').then(()=>{let t=ge({host:ce,canvas:ce.querySelector("canvas"),word:ce.querySelector(".mn-word"),still:Te.matches});Te.addEventListener("change",v=>t.setStill(v.matches));let f=ce.querySelector(".mn-sound");f.addEventListener("click",()=>{let v=!t.sound.on;t.setSound(v),f.setAttribute("aria-pressed",String(v)),f.textContent=v?"Sound on":"Sound off"})});

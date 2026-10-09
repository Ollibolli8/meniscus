var de=`#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`,pe=`
vec2 pack16(float v) { v = floor(clamp(v * 0.5 + 0.5, 0.0, 1.0) * 65535.0 + 0.5); float hi = floor(v / 256.0); return vec2(hi, v - hi * 256.0) / 255.0; }
float unpack16(vec2 b) { return (floor(b.x * 255.0 + 0.5) * 256.0 + floor(b.y * 255.0 + 0.5)) / 65535.0 * 2.0 - 1.0; }`,se=`
#ifdef FLOAT_SIM
vec2 rd(sampler2D t, vec2 q) { return texture(t, q).rg; }
vec4 wr(vec2 s) { return vec4(s, 0.0, 1.0); }
#else
${pe}
const float RANGE = 0.25;
vec2 rd(sampler2D t, vec2 q) { vec4 s = texture(t, q); return vec2(unpack16(s.rg), unpack16(s.ba)) * RANGE; }
vec4 wr(vec2 s) { return vec4(pack16(s.x / RANGE), pack16(s.y / RANGE)); }
#endif`,he=`
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D state; uniform vec2 texel; uniform float aspect; uniform vec4 drops[8]; uniform int ndrops;
uniform sampler2D mask; uniform sampler2D maskPrev; uniform float push;
${se}
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
}`,xe=`
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D state; uniform vec2 texel; uniform float aspect;
${se}
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
}`,ve=`
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
}`,be=`
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D surf; uniform sampler2D floorTex; uniform sampler2D mask; uniform vec2 res; uniform float aspect; uniform float time;
uniform vec2 throwTo;                          // where the type's shadow falls on the floor (uv), from the type's size
const vec3 WATER = vec3(0.322, 0.682, 0.929);   // #52aeed, Tide's 17.4\xB0 water
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
}`;function ne(t,s,d=!1){s=`#version 300 es
`+(d?`#define FLOAT_SIM 1
`:"")+s;let a=(f,i)=>{let m=t.createShader(f);if(t.shaderSource(m,i),t.compileShader(m),!t.getShaderParameter(m,t.COMPILE_STATUS))throw new Error(t.getShaderInfoLog(m)??"shader");return m},e=t.createProgram();if(t.attachShader(e,a(t.VERTEX_SHADER,de)),t.attachShader(e,a(t.FRAGMENT_SHADER,s)),t.bindAttribLocation(e,0,"p"),t.linkProgram(e),!t.getProgramParameter(e,t.LINK_STATUS))throw new Error(t.getProgramInfoLog(e)??"link");let p={},h=new Proxy(p,{get:(f,i)=>i in f?f[i]:f[i]=t.getUniformLocation(e,i)});return{p:e,u:h}}function z(t,s,d,a,e){let p=t.createTexture();t.bindTexture(t.TEXTURE_2D,p),e==="rg32f"?t.texImage2D(t.TEXTURE_2D,0,t.RG32F,s,d,0,t.RG,t.FLOAT,null):e==="rgba16f"?t.texImage2D(t.TEXTURE_2D,0,t.RGBA16F,s,d,0,t.RGBA,t.HALF_FLOAT,null):t.texImage2D(t.TEXTURE_2D,0,t.RGBA8,s,d,0,t.RGBA,t.UNSIGNED_BYTE,null),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,a),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,a),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE);let h=t.createFramebuffer();return t.bindFramebuffer(t.FRAMEBUFFER,h),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,p,0),{tex:p,fb:h,w:s,h:d}}var ie=(()=>{let t=11,s=()=>(t=t*16807%2147483647)/2147483647,d=new Float32Array(48),a=new Float32Array(12);for(let e=0;e<12;e++){let p=.7+(s()-.5)*2.4,h=.25*Math.pow(.85,e),f=2*Math.PI/h,i=.042-e*.0018;d.set([Math.cos(p),Math.sin(p),f,i/f*(.75+s()*.5)],e*4),a[e]=Math.sqrt(9.8*f)*.045*(.8+s()*.4)}return{v:d,sp:a}})();function Ee(t,s,d){let a=document.createElement("canvas");a.width=Math.round(t*d),a.height=Math.round(s*d);let e=a.getContext("2d");e.scale(d,d);let p=e.createLinearGradient(0,0,t*.5,s);p.addColorStop(0,"#c2e7fc"),p.addColorStop(1,"#a9d9f7"),e.fillStyle=p,e.fillRect(0,0,t,s);let h=Math.max(48,Math.min(t,s)/10);e.strokeStyle="rgba(255,255,255,.2)",e.lineWidth=1.25;for(let f=t%h/2;f<t;f+=h)e.beginPath(),e.moveTo(f,0),e.lineTo(f,s),e.stroke();for(let f=s%h/2;f<s;f+=h)e.beginPath(),e.moveTo(0,f),e.lineTo(t,f),e.stroke();return a}function le(t,s,d={}){let a=t.getContext("webgl2",{antialias:!1,alpha:!1,depth:!1,stencil:!1,powerPreference:"high-performance"});if(!a)return null;let e=a,p=!!e.getExtension("EXT_color_buffer_float"),h,f,i,m;try{h=ne(e,he,p),f=ne(e,xe,p),i=ne(e,ve,p),m=ne(e,be,p)}catch(c){return console.warn("Meniscus:",c),null}t.dataset.sim=p?"float":"packed";let n=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,n),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0);let u=e.createTexture(),E=document.createElement("canvas"),g=E.getContext("2d"),v=[e.createTexture(),e.createTexture()],T=0,A=v[0],l=1,x=1,y=1,F=1.75,$=16,q=24,_=z(e,2,2,e.NEAREST,"rgba8"),L=z(e,2,2,e.NEAREST,"rgba8"),V=z(e,2,2,e.LINEAR,"rgba8"),W=z(e,2,2,e.LINEAR,"rgba8"),P=[],U=null,N=0,H=!1,D=!1,O=!0,Y=4,C=0,Q=c=>{e.bindFramebuffer(e.FRAMEBUFFER,c.fb),p?e.clearColor(0,0,0,1):e.clearColor(128/255,0,128/255,0),e.clear(e.COLOR_BUFFER_BIT)};function K(c=!1){A=v[T],!(!s(g,E.width,E.height,l,x)&&!c)&&(T^=1,e.bindTexture(e.TEXTURE_2D,v[T]),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!0),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,E),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!1),e.generateMipmap(e.TEXTURE_2D))}let j=()=>{let c=t.getBoundingClientRect();l=Math.max(1,c.width),x=Math.max(1,c.height),y=l/x;let b=Math.min(window.devicePixelRatio||1,l*x>15e5?1.25:F);t.width=Math.round(l*b),t.height=Math.round(x*b);let R=320,w=Math.round(l>=x?R:R*y),k=Math.round(l>=x?R/y:R);for(let M of[_,L,V,W])e.deleteTexture(M.tex),e.deleteFramebuffer(M.fb);_=z(e,w,k,e.NEAREST,p?"rg32f":"rgba8"),L=z(e,w,k,e.NEAREST,p?"rg32f":"rgba8"),V=z(e,w,k,e.LINEAR,p?"rgba16f":"rgba8"),W=z(e,w*2,k*2,e.LINEAR,p?"rgba16f":"rgba8"),Q(_),Q(L),E.width=w*2,E.height=k*2;for(let M of v)e.bindTexture(e.TEXTURE_2D,M),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,E.width,E.height,0,e.RGBA,e.UNSIGNED_BYTE,null),e.generateMipmap(e.TEXTURE_2D),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR_MIPMAP_LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE);K(!0),A=v[T];let ee=Ee(l,x,Math.min(b,1.5));e.bindTexture(e.TEXTURE_2D,u),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!0),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,ee),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!1),e.generateMipmap(e.TEXTURE_2D),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR_MIPMAP_LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.MIRRORED_REPEAT),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.MIRRORED_REPEAT);for(let M=0;M<3;M++)P.push([.18+M*.3,.25+M%2*.4,.045,.06]);for(let M=0;M<40;M++)B(1/60);I()},r=(c,b)=>{e.useProgram(c.p),e.bindFramebuffer(e.FRAMEBUFFER,b?b.fb:null),e.viewport(0,0,b?b.w:t.width,b?b.h:t.height)},o=(c,b,R)=>{e.activeTexture(e.TEXTURE0+c),e.bindTexture(e.TEXTURE_2D,b),e.uniform1i(R,c)};function B(c){K(),r(h,L),e.uniform2f(h.u.texel,1/_.w,1/_.h),e.uniform1f(h.u.aspect,y);let b=Math.min(8,P.length),R=new Float32Array(32);for(let w=0;w<b;w++)R.set(P[w],w*4);P.splice(0,b),e.uniform4fv(h.u.drops,R),e.uniform1i(h.u.ndrops,b),e.uniform1f(h.u.push,.006),o(0,_.tex,h.u.state),o(1,v[T],h.u.mask),o(2,A,h.u.maskPrev),e.drawArrays(e.TRIANGLE_STRIP,0,4),[_,L]=[L,_]}function I(){r(f,V),e.uniform2f(f.u.texel,1/_.w,1/_.h),e.uniform1f(f.u.aspect,y),o(0,_.tex,f.u.state),e.drawArrays(e.TRIANGLE_STRIP,0,4),r(i,W),o(0,V.tex,i.u.rip),e.uniform1f(i.u.aspect,y),e.uniform1f(i.u.time,Y),e.uniform4fv(i.u.wv,ie.v),e.uniform1fv(i.u.wsp,ie.sp),e.drawArrays(e.TRIANGLE_STRIP,0,4),r(m,null),o(0,W.tex,m.u.surf),o(1,u,m.u.floorTex),o(2,v[T],m.u.mask),e.uniform2f(m.u.res,t.width,t.height),e.uniform1f(m.u.aspect,y),e.uniform1f(m.u.time,Y),e.uniform2f(m.u.throwTo,$/l,-q/x),e.drawArrays(e.TRIANGLE_STRIP,0,4)}let X=0,J=c=>{if(N=requestAnimationFrame(J),C&&c-C<1e3/62)return;let b=Math.min(.05,C?(c-C)/1e3:1/60);if(X=C&&c-C>24?X+1:Math.max(0,X-1),X>45&&F>1){X=0,F=Math.max(1,F*.8);let R=Math.min(window.devicePixelRatio||1,l*x>15e5?1.25:F);t.width=Math.round(l*R),t.height=Math.round(x*R)}C=c,Y+=b,B(b),I(),d.onFrame?.(c)},S=()=>{let c=H&&O;c!==D&&(D=c,cancelAnimationFrame(N),C=0,c&&(N=requestAnimationFrame(J)))},G=0,Z=()=>{D||G||!O||(G=requestAnimationFrame(()=>{G=0,K(),I()}))},ae=c=>{c.preventDefault(),cancelAnimationFrame(N),D=!1,H=!1,t.dataset.gl="lost"};return t.addEventListener("webglcontextlost",ae),j(),{resize:j,pointer(c,b,R){if(!D){Z();return}let w=c/l,k=1-b/x,ee=performance.now();if(R==="down")P.push([w,k,.04,.1]);else if(U&&ee-U.t<200){let M=Math.hypot((w-U.x)*y,k-U.y),fe=Math.max(8,ee-U.t),oe=Math.min(4,Math.ceil(M/.012));for(let te=1;te<=oe;te++)P.push([U.x+(w-U.x)*te/oe,U.y+(k-U.y)*te/oe,.026,Math.min(.05,M/fe*2.2)])}U={x:w,y:k,t:ee}},shadow(c,b){$=c,q=b,Z()},splash(c,b,R,w){D?P.push([c/l,1-b/x,R/x,w]):Z()},play(c){H=c,S(),c||Z()},visible(c){c!==O&&(O=c,S(),c&&Z())},dispose(){cancelAnimationFrame(N),cancelAnimationFrame(G),t.removeEventListener("webglcontextlost",ae),e.getExtension("WEBGL_lose_context")?.loseContext()}}}function ce(){let t=null,s=null,d=null,a=null,e=!1,p=()=>{if(t)return;t=new AudioContext;let i=t.createDynamicsCompressor();i.threshold.value=-18,i.ratio.value=4,s=t.createGain(),s.gain.value=.6,s.connect(i),i.connect(t.destination),d=t.createBuffer(1,t.sampleRate*2,t.sampleRate);let m=d.getChannelData(0);for(let v=0;v<m.length;v++)m[v]=Math.random()*2-1;let n=t.createBufferSource();n.buffer=d,n.loop=!0;let u=t.createBiquadFilter();u.type="lowpass",u.frequency.value=500,u.Q.value=.7;let E=t.createGain();E.gain.value=0;let g=t.createStereoPanner();n.connect(u),u.connect(E),E.connect(g),g.connect(s),n.start(),a={src:n,gain:E,pan:g,filter:u}},h=(i,m,n,u)=>{if(!t||!s)return;let E=Math.min(4e3,3260/n),g=t.createOscillator(),v=t.createGain(),T=t.createStereoPanner();g.type="sine",g.frequency.setValueAtTime(E,i),g.frequency.exponentialRampToValueAtTime(E*1.4,i+.05);let A=.02+n*.012;v.gain.setValueAtTime(0,i),v.gain.linearRampToValueAtTime(u,i+.003),v.gain.exponentialRampToValueAtTime(1e-4,i+A*4),T.pan.value=Math.max(-1,Math.min(1,m*2-1))*.7,g.connect(v),v.connect(T),T.connect(s),g.start(i),g.stop(i+A*4+.02)},f=(i,m,n,u,E,g)=>{if(!t||!s||!d)return;let v=t.createBufferSource();v.buffer=d;let T=t.createBiquadFilter();T.type="bandpass",T.frequency.value=n,T.Q.value=u;let A=t.createGain(),l=t.createStereoPanner();A.gain.setValueAtTime(E,i),A.gain.exponentialRampToValueAtTime(1e-4,i+g),l.pan.value=Math.max(-1,Math.min(1,m*2-1))*.7,v.connect(T),T.connect(A),A.connect(l),l.connect(s),v.start(i,Math.random()*1.5,g+.02)};return{get on(){return e},enable(i){e=i,i?(p(),t?.resume()):a&&t&&a.gain.gain.setTargetAtTime(0,t.currentTime,.05)},drop(i,m=.5){if(!e||!t)return;let n=t.currentTime+.005;f(n,i,3500,1.2,.05+m*.05,.02),h(n+.008,i,1.4+m*2.6+Math.random()*.6,.18+m*.12)},splash(i){if(!e||!t)return;let m=t.currentTime+.005;f(m,i,1800,.8,.16,.12);for(let n=0;n<3;n++)h(m+.012+Math.random()*.06,i+(Math.random()-.5)*.08,1.2+Math.random()*3.5,.08+Math.random()*.08)},wake(i,m){if(!e||!t||!a)return;let n=t.currentTime,u=Math.min(1,i/1.5);a.gain.gain.setTargetAtTime(u*.22,n,.08),a.filter.frequency.setTargetAtTime(350+u*700,n,.1),a.pan.pan.setTargetAtTime(Math.max(-1,Math.min(1,m*2-1))*.6,n,.1)},dispose(){a?.src.stop(),t?.close(),t=null}}}function ue(t){let{host:s,canvas:d,word:a}=t,e=t.font??'"Albert Sans Variable", "Albert Sans", system-ui, sans-serif',p=t.weight??800,h=t.tracking??-.045,f=t.max??12,i=!!t.still,m=a.textContent??"",n={x:0,y:0,vx:0,vy:0,r:0,size:100,text:m,t:0,bob:0},u=null,E=[],g=0,v="",T=0,A=0,l=s.getBoundingClientRect(),x=null,y=ce();a.style.font=`${p} 100px/1 ${e}`,a.style.letterSpacing=`${h}em`;let F=document.createElement("canvas").getContext("2d"),$=()=>{F.font=`${p} ${n.size}px ${e}`;let r=F.measureText("Hg");g=(n.size-(r.fontBoundingBoxAscent+r.fontBoundingBoxDescent))/2+r.fontBoundingBoxAscent,x?.shadow(n.size*.09,n.size*.14)},q=()=>{F.font=`${p} 100px ${e}`,F.letterSpacing=`${h*100}px`;let r=Math.max(1,F.measureText(n.text||"M").width)/100,o=Math.round(Math.min(l.width*.86/r,l.height*.26,260));o!==n.size&&(n.size=o,a.style.fontSize=`${o}px`,$())},_=()=>{l=s.getBoundingClientRect(),q(),n.x||(n.x=l.width*.5,n.y=l.height*(l.width<700?.42:.46)),n.x=Math.min(Math.max(n.x,0),l.width),n.y=Math.min(Math.max(n.y,0),l.height),E=Array.from(s.querySelectorAll("[data-calm]")).map(r=>{let o=r.getBoundingClientRect();return{x:o.left-l.left,y:o.top-l.top,w:o.width,h:o.height}}),$(),v=""},L=()=>{a.style.transform=`translate3d(${n.x.toFixed(2)}px, ${(n.y+n.bob).toFixed(2)}px, 0) translate(-50%, -50%) rotate(${n.r.toFixed(4)}rad)`},V=(r,o,B,I)=>{let X=`${o}x${B}|${n.text}|${n.x.toFixed(1)}|${(n.y+n.bob).toFixed(1)}|${n.r.toFixed(3)}|${n.size}|${E.length}`;if(X===v)return!1;v=X,r.setTransform(1,0,0,1,0,0),r.globalCompositeOperation="source-over",r.fillStyle="#000",r.fillRect(0,0,o,B),r.globalCompositeOperation="lighter";let J=o/I;r.setTransform(J,0,0,J,0,0),r.fillStyle="#00ff00";for(let G of E)r.beginPath(),r.roundRect(G.x-12,G.y-10,G.w+24,G.h+20,14),r.fill();let S=r;return S.font=`${p} ${n.size}px ${e}`,S.letterSpacing=`${(h*n.size).toFixed(2)}px`,S.textAlign="center",S.textBaseline="alphabetic",S.fillStyle="#ff0000",S.translate(n.x,n.y+n.bob),S.rotate(n.r),S.fillText(n.text,0,g-n.size/2),S.letterSpacing="0px",!0},W=r=>{T=requestAnimationFrame(W);let o=Math.min(.05,A?(r-A)/1e3:1/60);if(A=r,i){n.bob=0;return}if(n.t+=o,u)n.vx+=((u.tx-n.x)*140-n.vx*18)*o,n.vy+=((u.ty-n.y)*140-n.vy*18)*o;else{let I=Math.exp(-o*4.5);n.vx*=I,n.vy*=I}n.x+=n.vx*o,n.y+=n.vy*o,(n.x<0||n.x>l.width)&&(n.x=Math.min(Math.max(n.x,0),l.width),n.vx*=-.4),(n.y<0||n.y>l.height)&&(n.y=Math.min(Math.max(n.y,0),l.height),n.vy*=-.4);let B=Math.max(-.22,Math.min(.22,n.vx*45e-5));n.r+=(B+Math.sin(n.t*.9)*.012-n.r)*Math.min(1,o*6),n.bob=Math.sin(n.t*1.1)*n.size*.005,L(),y.on&&y.wake(Math.hypot(n.vx,n.vy)/Math.max(1,l.width),n.x/Math.max(1,l.width))},P=r=>({x:r.clientX-l.left,y:r.clientY-l.top}),U=r=>{if(r.button!==0||document.activeElement===a)return;let o=P(r);u={id:r.pointerId,dx:o.x-n.x,dy:o.y-n.y,tx:n.x,ty:n.y,moved:!1,x0:o.x,y0:o.y},a.setPointerCapture(r.pointerId),r.preventDefault()},N=r=>{let o=P(r);if(u&&r.pointerId===u.id){u.tx=o.x-u.dx,u.ty=o.y-u.dy,Math.hypot(o.x-u.x0,o.y-u.y0)>5&&(u.moved=!0),i&&(n.x=u.tx,n.y=u.ty,L(),x?.pointer(o.x,o.y,"move"));return}x?.pointer(o.x,o.y,"move")},H=()=>{let r=document.createRange();r.selectNodeContents(a),r.collapse(!1),getSelection()?.removeAllRanges(),getSelection()?.addRange(r)},D=r=>{if(!u||r.pointerId!==u.id)return;let o=!u.moved;u=null,o&&(a.focus(),H())},O=r=>{if(r.target===a||r.target?.closest?.("button, a, input"))return;let o=P(r);x?.pointer(o.x,o.y,"down"),y.drop(o.x/l.width,.6)},Y=()=>{let r=(a.textContent??"").replace(/\s+/g," ");r.length>f&&(r=r.slice(0,f),a.textContent=r,H());let o=r.length>n.text.length;if(n.text=r,q(),o){let B=a.getBoundingClientRect(),I=B.right-l.left-n.size*.25;x?.splash(I,n.y,n.size*.5,.08),y.splash(I/l.width)}i&&L()},C=r=>{(r.key==="Enter"||r.key==="Escape")&&(r.preventDefault(),a.blur())},Q=()=>{(a.textContent??"").trim()||(a.textContent=m,n.text=m,q())},K=()=>{_(),L(),x?.resize()},j=()=>x?.visible(!document.hidden);return _(),L(),a.addEventListener("pointerdown",U),window.addEventListener("pointermove",N,{passive:!0}),window.addEventListener("pointerup",D),window.addEventListener("pointercancel",D),window.addEventListener("pointerdown",O,{passive:!0}),a.addEventListener("input",Y),a.addEventListener("keydown",C),a.addEventListener("blur",Q),window.addEventListener("resize",K),document.addEventListener("visibilitychange",j),T=requestAnimationFrame(W),x=le(d,V,t.water),s.dataset.gl=x?"on":"off",$(),x?.play(!i),{water:x,sound:y,setStill(r){i=r,x?.play(!r),r&&(L(),y.wake(0,.5))},setSound(r){y.enable(r)},dispose(){cancelAnimationFrame(T),a.removeEventListener("pointerdown",U),window.removeEventListener("pointermove",N),window.removeEventListener("pointerup",D),window.removeEventListener("pointercancel",D),window.removeEventListener("pointerdown",O),a.removeEventListener("input",Y),a.removeEventListener("keydown",C),a.removeEventListener("blur",Q),window.removeEventListener("resize",K),document.removeEventListener("visibilitychange",j),x?.dispose(),x=null,y.dispose()}}}var re=document.getElementById("pool"),me=matchMedia("(prefers-reduced-motion: reduce)");document.fonts.load('800 100px "Albert Sans Variable"').then(()=>{let t=ue({host:re,canvas:re.querySelector("canvas"),word:re.querySelector(".mn-word"),still:me.matches});me.addEventListener("change",d=>t.setStill(d.matches));let s=re.querySelector(".mn-sound");s.addEventListener("click",()=>{let d=!t.sound.on;t.setSound(d),s.setAttribute("aria-pressed",String(d)),s.textContent=d?"Sound on":"Sound off"})});

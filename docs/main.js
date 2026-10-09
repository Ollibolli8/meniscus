var fe=`#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`,de=`
vec2 pack16(float v) { v = floor(clamp(v * 0.5 + 0.5, 0.0, 1.0) * 65535.0 + 0.5); float hi = floor(v / 256.0); return vec2(hi, v - hi * 256.0) / 255.0; }
float unpack16(vec2 b) { return (floor(b.x * 255.0 + 0.5) * 256.0 + floor(b.y * 255.0 + 0.5)) / 65535.0 * 2.0 - 1.0; }`,se=`
#ifdef FLOAT_SIM
vec2 rd(sampler2D t, vec2 q) { return texture(t, q).rg; }
vec4 wr(vec2 s) { return vec4(s, 0.0, 1.0); }
#else
${de}
const float RANGE = 0.25;
vec2 rd(sampler2D t, vec2 q) { vec4 s = texture(t, q); return vec2(unpack16(s.rg), unpack16(s.ba)) * RANGE; }
vec4 wr(vec2 s) { return vec4(pack16(s.x / RANGE), pack16(s.y / RANGE)); }
#endif`,pe=`
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
}`,he=`
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
}`,ve=`
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
}`;function ne(t,l,v=!1){l=`#version 300 es
`+(v?`#define FLOAT_SIM 1
`:"")+l;let i=(m,p)=>{let h=t.createShader(m);if(t.shaderSource(h,p),t.compileShader(h),!t.getShaderParameter(h,t.COMPILE_STATUS))throw new Error(t.getShaderInfoLog(h)??"shader");return h},e=t.createProgram();if(t.attachShader(e,i(t.VERTEX_SHADER,fe)),t.attachShader(e,i(t.FRAGMENT_SHADER,l)),t.bindAttribLocation(e,0,"p"),t.linkProgram(e),!t.getProgramParameter(e,t.LINK_STATUS))throw new Error(t.getProgramInfoLog(e)??"link");let u={},f=new Proxy(u,{get:(m,p)=>p in m?m[p]:m[p]=t.getUniformLocation(e,p)});return{p:e,u:f}}function N(t,l,v,i,e){let u=t.createTexture();t.bindTexture(t.TEXTURE_2D,u),e==="rg32f"?t.texImage2D(t.TEXTURE_2D,0,t.RG32F,l,v,0,t.RG,t.FLOAT,null):e==="rgba16f"?t.texImage2D(t.TEXTURE_2D,0,t.RGBA16F,l,v,0,t.RGBA,t.HALF_FLOAT,null):t.texImage2D(t.TEXTURE_2D,0,t.RGBA8,l,v,0,t.RGBA,t.UNSIGNED_BYTE,null),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,i),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,i),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE);let f=t.createFramebuffer();return t.bindFramebuffer(t.FRAMEBUFFER,f),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,u,0),{tex:u,fb:f,w:l,h:v}}var ae=(()=>{let t=11,l=()=>(t=t*16807%2147483647)/2147483647,v=new Float32Array(48),i=new Float32Array(12);for(let e=0;e<12;e++){let u=.7+(l()-.5)*2.4,f=.25*Math.pow(.85,e),m=2*Math.PI/f,p=.042-e*.0018;v.set([Math.cos(u),Math.sin(u),m,p/m*(.75+l()*.5)],e*4),i[e]=Math.sqrt(9.8*m)*.045*(.8+l()*.4)}return{v,sp:i}})();function Ee(t,l,v){let i=document.createElement("canvas");i.width=Math.round(t*v),i.height=Math.round(l*v);let e=i.getContext("2d");e.scale(v,v);let u=e.createLinearGradient(0,0,t*.5,l);u.addColorStop(0,"#c2e7fc"),u.addColorStop(1,"#a9d9f7"),e.fillStyle=u,e.fillRect(0,0,t,l);let f=Math.max(48,Math.min(t,l)/10);e.strokeStyle="rgba(255,255,255,.2)",e.lineWidth=1.25;for(let m=t%f/2;m<t;m+=f)e.beginPath(),e.moveTo(m,0),e.lineTo(m,l),e.stroke();for(let m=l%f/2;m<l;m+=f)e.beginPath(),e.moveTo(0,m),e.lineTo(t,m),e.stroke();return i}function le(t,l,v={}){let i=t.getContext("webgl2",{antialias:!1,alpha:!1,depth:!1,stencil:!1,powerPreference:"high-performance"});if(!i)return null;let e=i,u=!!e.getExtension("EXT_color_buffer_float"),f,m,p,h;try{f=ne(e,pe,u),m=ne(e,xe,u),p=ne(e,he,u),h=ne(e,ve,u)}catch(a){return console.warn("Meniscus:",a),null}t.dataset.sim=u?"float":"packed";let n=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,n),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0);let x=e.createTexture(),A=document.createElement("canvas"),Z=A.getContext("2d"),L=[e.createTexture(),e.createTexture()],M=0,X=L[0],s=1,c=1,y=1,D=1.75,q=16,V=24,E=N(e,2,2,e.NEAREST,"rgba8"),I=N(e,2,2,e.NEAREST,"rgba8"),z=N(e,2,2,e.LINEAR,"rgba8"),C=N(e,2,2,e.LINEAR,"rgba8"),F=[],R=null,k=0,B=!1,S=!1,W=!0,H=4,U=0,j=a=>{e.bindFramebuffer(e.FRAMEBUFFER,a.fb),u?e.clearColor(0,0,0,1):e.clearColor(128/255,0,128/255,0),e.clear(e.COLOR_BUFFER_BIT)};function Y(a=!1){X=L[M],!(!l(Z,A.width,A.height,s,c)&&!a)&&(M^=1,e.bindTexture(e.TEXTURE_2D,L[M]),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!0),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,A),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!1),e.generateMipmap(e.TEXTURE_2D))}let r=()=>{let a=t.getBoundingClientRect();s=Math.max(1,a.width),c=Math.max(1,a.height),y=s/c;let d=Math.min(window.devicePixelRatio||1,s*c>15e5?1.25:D);t.width=Math.round(s*d),t.height=Math.round(c*d);let T=320,b=Math.round(s>=c?T:T*y),P=Math.round(s>=c?T/y:T);for(let w of[E,I,z,C])e.deleteTexture(w.tex),e.deleteFramebuffer(w.fb);E=N(e,b,P,e.NEAREST,u?"rg32f":"rgba8"),I=N(e,b,P,e.NEAREST,u?"rg32f":"rgba8"),z=N(e,b,P,e.LINEAR,u?"rgba16f":"rgba8"),C=N(e,b*2,P*2,e.LINEAR,u?"rgba16f":"rgba8"),j(E),j(I),A.width=b*2,A.height=P*2;for(let w of L)e.bindTexture(e.TEXTURE_2D,w),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,A.width,A.height,0,e.RGBA,e.UNSIGNED_BYTE,null),e.generateMipmap(e.TEXTURE_2D),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR_MIPMAP_LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE);Y(!0),X=L[M];let Q=Ee(s,c,Math.min(d,1.5));e.bindTexture(e.TEXTURE_2D,x),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!0),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,Q),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!1),e.generateMipmap(e.TEXTURE_2D),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR_MIPMAP_LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.MIRRORED_REPEAT),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.MIRRORED_REPEAT);for(let w=0;w<3;w++)F.push([.18+w*.3,.25+w%2*.4,.045,.06]);for(let w=0;w<40;w++)O(1/60);K()},o=(a,d)=>{e.useProgram(a.p),e.bindFramebuffer(e.FRAMEBUFFER,d?d.fb:null),e.viewport(0,0,d?d.w:t.width,d?d.h:t.height)},g=(a,d,T)=>{e.activeTexture(e.TEXTURE0+a),e.bindTexture(e.TEXTURE_2D,d),e.uniform1i(T,a)};function O(a){Y(),o(f,I),e.uniform2f(f.u.texel,1/E.w,1/E.h),e.uniform1f(f.u.aspect,y);let d=Math.min(8,F.length),T=new Float32Array(32);for(let b=0;b<d;b++)T.set(F[b],b*4);F.splice(0,d),e.uniform4fv(f.u.drops,T),e.uniform1i(f.u.ndrops,d),e.uniform1f(f.u.push,.006),g(0,E.tex,f.u.state),g(1,L[M],f.u.mask),g(2,X,f.u.maskPrev),e.drawArrays(e.TRIANGLE_STRIP,0,4),[E,I]=[I,E]}function K(){o(m,z),e.uniform2f(m.u.texel,1/E.w,1/E.h),e.uniform1f(m.u.aspect,y),g(0,E.tex,m.u.state),e.drawArrays(e.TRIANGLE_STRIP,0,4),o(p,C),g(0,z.tex,p.u.rip),e.uniform1f(p.u.aspect,y),e.uniform1f(p.u.time,H),e.uniform4fv(p.u.wv,ae.v),e.uniform1fv(p.u.wsp,ae.sp),e.drawArrays(e.TRIANGLE_STRIP,0,4),o(h,null),g(0,C.tex,h.u.surf),g(1,x,h.u.floorTex),g(2,L[M],h.u.mask),e.uniform2f(h.u.res,t.width,t.height),e.uniform1f(h.u.aspect,y),e.uniform1f(h.u.time,H),e.uniform2f(h.u.throwTo,q/s,-V/c),e.drawArrays(e.TRIANGLE_STRIP,0,4)}let G=0,_=a=>{if(k=requestAnimationFrame(_),U&&a-U<1e3/62)return;let d=Math.min(.05,U?(a-U)/1e3:1/60);if(G=U&&a-U>24?G+1:Math.max(0,G-1),G>45&&D>1){G=0,D=Math.max(1,D*.8);let T=Math.min(window.devicePixelRatio||1,s*c>15e5?1.25:D);t.width=Math.round(s*T),t.height=Math.round(c*T)}U=a,H+=d,O(d),K(),v.onFrame?.(a)},$=()=>{let a=B&&W;a!==S&&(S=a,cancelAnimationFrame(k),U=0,a&&(k=requestAnimationFrame(_)))},ee=0,J=()=>{S||ee||!W||(ee=requestAnimationFrame(()=>{ee=0,Y(),K()}))},ie=a=>{a.preventDefault(),cancelAnimationFrame(k),S=!1,B=!1,t.dataset.gl="lost"};return t.addEventListener("webglcontextlost",ie),r(),{resize:r,pointer(a,d,T){if(!S){J();return}let b=a/s,P=1-d/c,Q=performance.now();if(T==="down")F.push([b,P,.04,.1]);else if(R&&Q-R.t<200){let w=Math.hypot((b-R.x)*y,P-R.y),me=Math.max(8,Q-R.t),re=Math.min(4,Math.ceil(w/.012));for(let te=1;te<=re;te++)F.push([R.x+(b-R.x)*te/re,R.y+(P-R.y)*te/re,.026,Math.min(.05,w/me*2.2)])}R={x:b,y:P,t:Q}},shadow(a,d){q=a,V=d,J()},splash(a,d,T,b){S?F.push([a/s,1-d/c,T/c,b]):J()},play(a){B=a,$(),a||J()},visible(a){a!==W&&(W=a,$(),a&&J())},dispose(){cancelAnimationFrame(k),cancelAnimationFrame(ee),t.removeEventListener("webglcontextlost",ie),e.getExtension("WEBGL_lose_context")?.loseContext()}}}function ce(t){let{host:l,canvas:v,word:i}=t,e=t.font??'"Albert Sans Variable", "Albert Sans", system-ui, sans-serif',u=t.weight??800,f=t.tracking??-.045,m=t.max??12,p=!!t.still,h=i.textContent??"",n={x:0,y:0,vx:0,vy:0,r:0,size:100,text:h,t:0,bob:0},x=null,A=[],Z=0,L="",M=0,X=0,s=l.getBoundingClientRect(),c=null;i.style.font=`${u} 100px/1 ${e}`,i.style.letterSpacing=`${f}em`;let y=document.createElement("canvas").getContext("2d"),D=()=>{y.font=`${u} ${n.size}px ${e}`;let r=y.measureText("Hg");Z=(n.size-(r.fontBoundingBoxAscent+r.fontBoundingBoxDescent))/2+r.fontBoundingBoxAscent,c?.shadow(n.size*.09,n.size*.14)},q=()=>{y.font=`${u} 100px ${e}`,y.letterSpacing=`${f*100}px`;let r=Math.max(1,y.measureText(n.text||"M").width)/100,o=Math.round(Math.min(s.width*.86/r,s.height*.26,260));o!==n.size&&(n.size=o,i.style.fontSize=`${o}px`,D())},V=()=>{s=l.getBoundingClientRect(),q(),n.x||(n.x=s.width*.5,n.y=s.height*(s.width<700?.42:.46)),n.x=Math.min(Math.max(n.x,0),s.width),n.y=Math.min(Math.max(n.y,0),s.height),A=Array.from(l.querySelectorAll("[data-calm]")).map(r=>{let o=r.getBoundingClientRect();return{x:o.left-s.left,y:o.top-s.top,w:o.width,h:o.height}}),D(),L=""},E=()=>{i.style.transform=`translate3d(${n.x.toFixed(2)}px, ${(n.y+n.bob).toFixed(2)}px, 0) translate(-50%, -50%) rotate(${n.r.toFixed(4)}rad)`},I=(r,o,g,O)=>{let K=`${o}x${g}|${n.text}|${n.x.toFixed(1)}|${(n.y+n.bob).toFixed(1)}|${n.r.toFixed(3)}|${n.size}|${A.length}`;if(K===L)return!1;L=K,r.setTransform(1,0,0,1,0,0),r.globalCompositeOperation="source-over",r.fillStyle="#000",r.fillRect(0,0,o,g),r.globalCompositeOperation="lighter";let G=o/O;r.setTransform(G,0,0,G,0,0),r.fillStyle="#00ff00";for(let $ of A)r.beginPath(),r.roundRect($.x-12,$.y-10,$.w+24,$.h+20,14),r.fill();let _=r;return _.font=`${u} ${n.size}px ${e}`,_.letterSpacing=`${(f*n.size).toFixed(2)}px`,_.textAlign="center",_.textBaseline="alphabetic",_.fillStyle="#ff0000",_.translate(n.x,n.y+n.bob),_.rotate(n.r),_.fillText(n.text,0,Z-n.size/2),_.letterSpacing="0px",!0},z=r=>{M=requestAnimationFrame(z);let o=Math.min(.05,X?(r-X)/1e3:1/60);if(X=r,p){n.bob=0;return}if(n.t+=o,x)n.vx+=((x.tx-n.x)*140-n.vx*18)*o,n.vy+=((x.ty-n.y)*140-n.vy*18)*o;else{let O=Math.exp(-o*4.5);n.vx*=O,n.vy*=O}n.x+=n.vx*o,n.y+=n.vy*o,(n.x<0||n.x>s.width)&&(n.x=Math.min(Math.max(n.x,0),s.width),n.vx*=-.4),(n.y<0||n.y>s.height)&&(n.y=Math.min(Math.max(n.y,0),s.height),n.vy*=-.4);let g=Math.max(-.22,Math.min(.22,n.vx*45e-5));n.r+=(g+Math.sin(n.t*.9)*.012-n.r)*Math.min(1,o*6),n.bob=Math.sin(n.t*1.1)*n.size*.005,E()},C=r=>({x:r.clientX-s.left,y:r.clientY-s.top}),F=r=>{if(r.button!==0||document.activeElement===i)return;let o=C(r);x={id:r.pointerId,dx:o.x-n.x,dy:o.y-n.y,tx:n.x,ty:n.y,moved:!1,x0:o.x,y0:o.y},i.setPointerCapture(r.pointerId),r.preventDefault()},R=r=>{let o=C(r);if(x&&r.pointerId===x.id){x.tx=o.x-x.dx,x.ty=o.y-x.dy,Math.hypot(o.x-x.x0,o.y-x.y0)>5&&(x.moved=!0),p&&(n.x=x.tx,n.y=x.ty,E(),c?.pointer(o.x,o.y,"move"));return}c?.pointer(o.x,o.y,"move")},k=()=>{let r=document.createRange();r.selectNodeContents(i),r.collapse(!1),getSelection()?.removeAllRanges(),getSelection()?.addRange(r)},B=r=>{if(!x||r.pointerId!==x.id)return;let o=!x.moved;x=null,o&&(i.focus(),k())},S=r=>{if(r.target!==i){let o=C(r);c?.pointer(o.x,o.y,"down")}},W=()=>{let r=(i.textContent??"").replace(/\s+/g," ");r.length>m&&(r=r.slice(0,m),i.textContent=r,k());let o=r.length>n.text.length;if(n.text=r,q(),o){let g=i.getBoundingClientRect();c?.splash(g.right-s.left-n.size*.25,n.y,n.size*.5,.08)}p&&E()},H=r=>{(r.key==="Enter"||r.key==="Escape")&&(r.preventDefault(),i.blur())},U=()=>{(i.textContent??"").trim()||(i.textContent=h,n.text=h,q())},j=()=>{V(),E(),c?.resize()},Y=()=>c?.visible(!document.hidden);return V(),E(),i.addEventListener("pointerdown",F),window.addEventListener("pointermove",R,{passive:!0}),window.addEventListener("pointerup",B),window.addEventListener("pointercancel",B),window.addEventListener("pointerdown",S,{passive:!0}),i.addEventListener("input",W),i.addEventListener("keydown",H),i.addEventListener("blur",U),window.addEventListener("resize",j),document.addEventListener("visibilitychange",Y),M=requestAnimationFrame(z),c=le(v,I,t.water),l.dataset.gl=c?"on":"off",D(),c?.play(!p),{water:c,setStill(r){p=r,c?.play(!r),r&&E()},dispose(){cancelAnimationFrame(M),i.removeEventListener("pointerdown",F),window.removeEventListener("pointermove",R),window.removeEventListener("pointerup",B),window.removeEventListener("pointercancel",B),window.removeEventListener("pointerdown",S),i.removeEventListener("input",W),i.removeEventListener("keydown",H),i.removeEventListener("blur",U),window.removeEventListener("resize",j),document.removeEventListener("visibilitychange",Y),c?.dispose(),c=null}}}var oe=document.getElementById("pool"),ue=matchMedia("(prefers-reduced-motion: reduce)");document.fonts.load('800 100px "Albert Sans Variable"').then(()=>{let t=ce({host:oe,canvas:oe.querySelector("canvas"),word:oe.querySelector(".mn-word"),still:ue.matches});ue.addEventListener("change",l=>t.setStill(l.matches))});

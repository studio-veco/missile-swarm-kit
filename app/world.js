// 背景：まっしろの惑星（真下）、星空、遠くの惑星、ゲームの軌道の輪
import * as THREE from '../vendor/three.module.js';
import { PLANET_R, PLANET_C } from './sim.js';

// 太陽：低く、-Z（最後に戦闘機が向かう方）
export const SUN_DIR = new THREE.Vector3(-0.32, 0.24, -0.92).normalize();
export const SUN_COL = new THREE.Color(1.0, 0.95, 0.88);
const PC = new THREE.Vector3(...PLANET_C);

export const NOISE_GLSL = /* glsl */`
float hash13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i), hash13(i+vec3(1,0,0)), f.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), f.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
`;

export function makeWorld(scene, terrain, opts = {}) {
  const g = new THREE.Group();
  scene.add(g);

  // ---- 空（星と大気のにじみ）：巨大な球の内側 ----
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uSun: { value: SUN_DIR }, uPC: { value: PC }, uR: { value: PLANET_R }, uMap: { value: 0 } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vDir;
      void main(){ vDir = normalize(position); vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv;
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uSun, uPC; uniform float uR, uMap;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main(){
        #include <logdepthbuf_fragment>
        vec3 d = normalize(vDir);
        vec3 cp = cameraPosition;
        vec3 oc = uPC - cp;
        float tc = dot(oc, d);
        float h = length(oc - d*tc);            // 視線が星の中心に一番近づく距離
        float alt = length(cp - uPC) - uR;
        // 大気の縁の光：視線が星にいちばん近づく高さで決める。カメラの水平面より上を向く視線はカメラの高さが最も近く、
        // 仰角とともになめらかに薄れる（以前は水平面で光が切れ、地平の手前に平らな帯ができていた）
        float Hs = 9000.0 + alt*0.6;
        float up = clamp(-dot(d, normalize(oc)), 0.0, 1.0);
        float rim = tc > 0.0 ? exp(-max(h - uR, 0.0)/Hs) : exp(-max(alt, 0.0)/Hs)*pow(1.0 - up, 7.0);
        // 宇宙の地色：ほぼ黒、すこし紺
        vec3 col = vec3(0.004, 0.006, 0.016);
        // 淡い星雲（大きな濃淡）
        float neb = fbm3(d*2.2 + 3.0);
        col += vec3(0.020, 0.010, 0.040) * smoothstep(0.45, 0.85, neb);
        col += vec3(0.000, 0.018, 0.030) * smoothstep(0.55, 0.9, fbm3(d*3.1 - 7.0));
        // 地平の大気（白〜水色、太陽側は少し暖かく）
        float sunSide = clamp(0.5 + 0.5*dot(d, uSun), 0.0, 1.0);
        vec3 atm = mix(vec3(0.55, 0.72, 1.0), vec3(1.0, 0.86, 0.80), pow(sunSide, 3.0));
        col += atm * rim * 0.62 * (1.0 - 0.97*uMap);
        // 太陽
        float sd = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.94, 0.85) * (pow(sd, 2400.0)*22.0 + pow(sd, 120.0)*0.35 + pow(sd, 12.0)*0.04);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4.0e6, 64, 32), skyMat);
  sky.frustumCulled = false; sky.renderOrder = -10;
  g.add(sky);

  // ---- 星（点） ----
  {
    const N = 7000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N);
    let a = 7;
    const r = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
    for (let i = 0; i < N; i++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const R = 3.6e6;
      pos.set([Math.cos(th) * s * R, u * R, Math.sin(th) * s * R], i * 3);
      const b = Math.pow(r(), 6) * 2.2 + 0.15, hue = r();
      const c = hue < 0.15 ? [1.0, 0.75, 0.85] : hue < 0.35 ? [0.7, 0.9, 1.0] : [1, 1, 1];
      col.set(c.map((x) => x * b), i * 3);
      sz[i] = 1.0 + Math.pow(r(), 8) * 3.0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sz, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uPx: { value: 1 } },
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 color; attribute float size; varying vec3 vC; uniform float uPx;
        void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = size*uPx*1.6;
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        varying vec3 vC;
        void main(){
          #include <logdepthbuf_fragment>
          vec2 q = gl_PointCoord*2.0-1.0; float d = dot(q,q); if (d > 1.0) discard;
          gl_FragColor = vec4(vC*exp(-d*4.0), 1.0);
        }`,
    });
    const stars = new THREE.Points(geo, mat);
    stars.frustumCulled = false; stars.renderOrder = -9;
    stars.userData.mat = mat;
    g.add(stars);
    g.userData.stars = stars;
  }

  // ---- 遠くの惑星（ゲームの紫の縞の星・青い星・輪の星） ----
  const farPlanet = (dir, dist, rad, kind) => {
    const m = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: SUN_DIR }, uKind: { value: kind } },
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vN, vP; varying vec3 vW;
        void main(){ vN = normalize(mat3(modelMatrix)*normal); vP = position; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w;
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uSun; uniform float uKind; varying vec3 vN, vP, vW;
        ${NOISE_GLSL}
        void main(){
          #include <logdepthbuf_fragment>
          vec3 n = normalize(vN), v = normalize(cameraPosition - vW);
          float lam = max(dot(n, uSun), 0.0);
          float lat = normalize(vP).y;
          vec3 base;
          if (uKind < 0.5) { // 紫の縞
            float b = sin(lat*26.0 + fbm3(normalize(vP)*4.0)*3.0);
            base = mix(vec3(0.36, 0.22, 0.78), vec3(0.62, 0.42, 0.95), 0.5+0.5*b);
            base = mix(base, vec3(0.20, 0.12, 0.50), smoothstep(0.7, 1.0, abs(lat)));
          } else if (uKind < 1.5) { // 青
            float c = fbm3(normalize(vP)*5.0);
            base = mix(vec3(0.18, 0.42, 0.85), vec3(0.75, 0.88, 1.0), smoothstep(0.5, 0.7, c));
          } else { // 白い小さな星
            base = vec3(0.92, 0.94, 1.0);
          }
          float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
          vec3 col = base * (lam*1.1 + 0.03) + vec3(0.5,0.6,1.0)*rim*0.35*(0.3+lam);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const s = new THREE.Mesh(new THREE.SphereGeometry(rad, 96, 48), m);
    s.position.copy(PC).addScaledVector(dir.clone().normalize(), dist);
    s.frustumCulled = false; s.renderOrder = -8;
    g.add(s);
    return s;
  };
  farPlanet(new THREE.Vector3(0.55, 0.62, 0.55), 1.9e6, 2.6e5, 0);
  farPlanet(new THREE.Vector3(-0.7, 0.45, 0.25), 1.6e6, 0.9e5, 1);
  farPlanet(new THREE.Vector3(0.2, 0.55, -0.85), 2.2e6, 0.5e5, 2);
  farPlanet(new THREE.Vector3(-0.15, 0.85, 0.4), 1.2e6, 0.35e5, 1);

  // ---- 軌道の輪（ゲームの水色・緑の線）：白い星のまわりを大きく回る ----
  const ringMat = (col) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uCol: { value: new THREE.Color(col) } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv; varying vec3 vW;
      void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w;
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uCol; varying vec2 vUv; varying vec3 vW;
      void main(){
        #include <logdepthbuf_fragment>
        float e = 1.0 - abs(vUv.y*2.0-1.0);
        float dash = 0.75 + 0.25*step(0.5, fract(vUv.x*180.0));
        gl_FragColor = vec4(uCol * pow(e, 2.0) * dash * 1.4, 1.0);
      }`,
  });
  const orbit = (radius, width, tiltX, tiltZ, col) => {
    const geo = new THREE.RingGeometry(radius - width / 2, radius + width / 2, 720, 1);
    // RingGeometry の uv を「周（x）・幅（y）」に直す
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      uv.setXY(i, (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1, (Math.hypot(x, y) - (radius - width / 2)) / width);
    }
    const m = new THREE.Mesh(geo, ringMat(col));
    m.position.copy(PC);
    m.rotation.set(Math.PI / 2 + tiltX, 0, tiltZ);
    m.frustumCulled = false; m.renderOrder = -7;
    g.add(m);
  };
  orbit(1.15e5, 260, 0.32, 0.18, 0x27d6ff);
  orbit(1.42e5, 300, -0.22, -0.35, 0x37f59a);
  orbit(1.85e5, 380, 0.55, 0.62, 0x27d6ff);
  orbit(0.92e5, 200, -0.48, 0.9, 0x9a7dff);

  // ---- まっしろの惑星と、谷の地形 ----
  // 同じ陰影を 2 つで使う：惑星（球、地形の四角の中は捨てる）と地形（高さの格子のメッシュ）。uMap で地形図の見た目へ
  const T = terrain;
  const NV = T.NV;
  const htTex = new THREE.DataTexture(T.H, NV, NV, THREE.RedFormat, THREE.FloatType);
  htTex.minFilter = htTex.magFilter = THREE.LinearFilter; htTex.wrapS = htTex.wrapT = THREE.ClampToEdgeWrapping; htTex.needsUpdate = true;
  const rvTex = new THREE.DataTexture(T.river, NV, NV, THREE.RGBAFormat, THREE.FloatType);
  rvTex.minFilter = rvTex.magFilter = THREE.LinearFilter; rvTex.wrapS = rvTex.wrapT = THREE.ClampToEdgeWrapping; rvTex.needsUpdate = true;
  const groundUniforms = () => ({
    uSun: { value: SUN_DIR }, uPC: { value: PC }, uR: { value: PLANET_R },
    uTime: { value: 0 }, uMap: { value: 0 },
    uImp: { value: Array.from({ length: 24 }, () => new THREE.Vector4(0, -1e7, 0, -100)) }, // xyz, t
    uShadow: { value: new THREE.Vector4(0, -1e7, 0, 0) }, // 戦闘機の影：xyz, 強さ
    uShadowDir: { value: new THREE.Vector3(0, 0, 1) },
    uHt: { value: htTex }, uRiv: { value: rvTex }, uVis: { value: null }, uHasVis: { value: 0 },
    // 格子：x = C + S·sinh(K·u)/sinh(K)（真ん中ほど細かい）
    uC: { value: new THREE.Vector2(T.cx, T.cz) }, uS: { value: T.S }, uK: { value: T.K }, uN: { value: T.N },
    // 地形図で等高線を描く四角（v2 の 16km 四方のまま）
    uMapC: { value: new THREE.Vector2(1300, -200) }, uMapH: { value: 8000 },
  });
  const groundFrag = (isTerrain) => /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uSun, uPC; uniform float uR, uTime, uMap;
      uniform vec4 uImp[24]; uniform vec4 uShadow; uniform vec3 uShadowDir;
      uniform sampler2D uHt, uRiv, uVis; uniform vec2 uC, uMapC; uniform float uS, uK, uN, uMapH, uHasVis;
      varying vec3 vW;
      ${isTerrain ? 'varying vec2 vXZ;' : ''}
      ${NOISE_GLSL}
      // 六角の格子線（ゲームの電子の地面）
      float hexLine(vec2 p){
        const vec2 s = vec2(1.0, 1.7320508);
        vec2 a = mod(p, s) - s*0.5, b = mod(p - s*0.5, s) - s*0.5;
        vec2 gv = dot(a,a) < dot(b,b) ? a : b;
        vec2 q = abs(gv);
        return 0.5 - max(dot(q, s*0.5), q.x);
      }
      vec2 tuv(vec2 xz){ vec2 u = (asinh((xz - uC)*sinh(uK)/uS)/uK + 1.0)*0.5*uN; return (u + 0.5)/(uN + 1.0); }
      // その場所の格子の細かさ（m）
      float cellAt(vec2 xz){ vec2 u = asinh((xz - uC)*sinh(uK)/uS)/uK; vec2 c = uS*uK*cosh(uK*u)/sinh(uK)*2.0/uN; return max(c.x, c.y); }
      float hAt(vec2 xz){ return texture2D(uHt, tuv(xz)).r; }
      // 太陽へ向かって地形の格子をたどる（谷の影）。0＝影
      float sunVis(vec2 xz, float h){
        vec2 sd = normalize(uSun.xz); float tanE = uSun.y/length(uSun.xz);
        // 段の縞が出ないよう、始まりを画素ごと・描くたびにずらす（1 コマ 4 回の平均でならす）
        float jit = fract(sin(dot(gl_FragCoord.xy + fract(uTime*13.7)*vec2(91.0, 37.0), vec2(12.9898, 78.233)))*43758.5453);
        float vis = 1.0, t = 3.0 + 3.0*jit;
        for (int i = 0; i < 46; i++){
          vec2 q = xz + sd*t;
          float d = h + tanE*t + 0.5 - hAt(q);
          vis = min(vis, clamp(d/(t*0.04 + 2.0) + 0.5, 0.0, 1.0));
          t *= 1.2;
          if (t > 16000.0 || vis <= 0.0) break;
        }
        return vis;
      }
      void main(){
        #include <logdepthbuf_fragment>
        vec3 nS = normalize(vW - uPC);
        vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;
        ${isTerrain ? `
        vec2 p2 = vXZ;
        vec3 sp = vW;
        float h0 = hAt(p2);
        // 格子の傾き（実際の形）＋ 近い所の細かい起伏
        float e = cellAt(p2);
        float gx = (hAt(p2 + vec2(e, 0.0)) - hAt(p2 - vec2(e, 0.0)))/(2.0*e);
        float gz = (hAt(p2 + vec2(0.0, e)) - hAt(p2 - vec2(0.0, e)))/(2.0*e);
        float fd = smoothstep(2500.0, 150.0, dist);
        vec2 ee = vec2(1.5 + dist*0.003, 0.0);
        #define DET(q) (fbm3(vec3((q)*0.02, 4.0))*7.0 + vnoise(vec3((q)*0.09, 8.0))*1.2)
        float d0 = DET(p2);
        gx += (DET(p2 + ee.xy) - d0)/ee.x*fd; gz += (DET(p2 + ee.yx) - d0)/ee.x*fd;
        vec3 tX = normalize(vec3(1.0, 0.0, 0.0) - nS*nS.x), tZ = normalize(vec3(0.0, 0.0, 1.0) - nS*nS.z);
        vec3 n = normalize(nS - tX*gx - tZ*gz);
        float slope = 1.0 - dot(n, nS);
        ` : `
        // 地形の四角の中は地形のメッシュに任せる
        vec3 sp = uPC + nS*uR;
        vec2 p2 = sp.xz;
        vec2 rel = abs(p2 - uC);
        if (rel.x < uS - 3.0 && rel.y < uS - 3.0) discard;
        float h0 = 0.0;
        vec3 n = nS;
        // 起伏（雪原のような大きなうねりと尾根）：高さの傾きで法線を曲げる
        float rf = smoothstep(30000.0, 2000.0, dist);
        vec2 e = vec2(6.0 + dist*0.004, 0.0);
        #define RID(q) (1.0 - abs(vnoise(vec3((q), 5.0))*2.0 - 1.0))
        #define HGT(q) (fbm3(vec3((q)*0.00035, 2.0))*1.0 + RID((q)*0.0011)*RID((q)*0.0011)*0.35 + fbm3(vec3((q)*0.004, 7.0))*0.18 + vnoise(vec3((q)*0.02, 9.0))*0.05*smoothstep(3000.0, 300.0, dist))
        float hh0 = HGT(p2), hx = HGT(p2 + e.xy), hz = HGT(p2 + e.yx);
        vec2 grad = vec2(hx - hh0, hz - hh0)/e.x;
        vec3 tX = normalize(vec3(1.0, 0.0, 0.0) - nS*nS.x), tZ = normalize(vec3(0.0, 0.0, 1.0) - nS*nS.z);
        n = normalize(n - (tX*grad.x + tZ*grad.y)*170.0*rf);
        float slope = 0.0;
        `}
        // 大きなうねり（白の中のごく淡い色むら）
        float big = fbm3(nS*38.0);
        float mid = fbm3(vec3(p2*0.0011, 1.0));
        vec3 alb = vec3(0.90, 0.91, 0.93);
        alb = mix(alb, vec3(0.94, 0.90, 0.95), smoothstep(0.45, 0.75, big)*0.6);
        alb = mix(alb, vec3(0.86, 0.90, 0.95), smoothstep(0.5, 0.8, mid)*0.5);
        // 細かい粒（近いと見える）
        float fine = vnoise(vec3(p2*0.09, 0.0));
        alb *= 1.0 - 0.06*fine*smoothstep(600.0, 80.0, dist);
        // 急な斜面：うす紫がかった灰の岩肌と地層の縞
        float rock = smoothstep(0.18, 0.42, slope);
        float strata = 0.5 + 0.5*sin(h0*0.22 + fbm3(vec3(p2*0.004, 3.0))*9.0);
        alb = mix(alb, vec3(0.74, 0.75, 0.81)*(0.9 + 0.12*strata), rock*0.85);
        // 六角の線（遠いほど・急な斜面ほど消す）
        float flat_ = 1.0 - rock;
        float hl = hexLine(p2/420.0);
        float lw = fwidth(p2.x/420.0)*1.2 + 0.004;
        float hexA = (1.0 - smoothstep(0.0, lw, hl)) * smoothstep(9000.0, 1500.0, dist) * flat_;
        float hl2 = hexLine(p2/60.0 + 3.1);
        float lw2 = fwidth(p2.x/60.0)*1.2 + 0.006;
        float hexB = (1.0 - smoothstep(0.0, lw2, hl2)) * smoothstep(1400.0, 200.0, dist) * flat_;
        // 光（谷の影つき）
        float vis = ${isTerrain ? '(uHasVis > 0.5 ? texture2D(uVis, tuv(p2)).r : sunVis(p2, h0 + 1.0))' : '1.0'};
        float lam = dot(n, uSun);
        float wrap = clamp((lam + 0.12)/1.12, 0.0, 1.0) * vis;
        vec3 H = normalize(uSun + V);
        float spec = pow(max(dot(n, H), 0.0), 60.0)*0.25*vis;
        // 影の中は空の青が回る
        vec3 amb = vec3(0.30, 0.34, 0.44) + vec3(0.04, 0.07, 0.14)*(1.0 - vis);
        vec3 col = alb * (vec3(1.0,0.96,0.9)*wrap*1.1 + amb) + spec*vec3(1.0,0.95,0.9)*step(0.0, lam);
        col = mix(col, col*0.75 + vec3(0.0, 0.35, 0.45)*0.55, hexA*0.55);
        col = mix(col, col*0.85 + vec3(0.0, 0.28, 0.38)*0.35, hexB*0.45);
        float water = 0.0, wMap = 0.0;
        ${isTerrain ? `
        // 川：淡い水色に白く光る流れ
        vec4 rv = texture2D(uRiv, tuv(p2));
        float rd = rv.x, rs = rv.y, rw = rv.z;
        water = 1.0 - smoothstep(rw - 1.0, rw + 1.2, rd);
        wMap = 1.0 - smoothstep(rw, rw + fwidth(rd)*1.6 + 1.0, rd);
        if (water > 0.0) {
          float sp1 = rv.w > 1.5 ? 3.0 : 4.5;
          float f1 = vnoise(vec3(rs*0.06 - uTime*sp1*0.06, rd*0.35, rv.w*7.0));
          float f2 = vnoise(vec3(rs*0.17 - uTime*sp1*0.17, rd*0.9 + 3.0, rv.w*3.0));
          float streak = smoothstep(0.55, 0.85, f1*0.6 + f2*0.5);
          vec3 R = reflect(-V, nS);
          float fres = 0.04 + 0.96*pow(1.0 - max(dot(V, nS), 0.0), 5.0);
          vec3 skyR = mix(vec3(0.62, 0.76, 1.0), vec3(0.02, 0.03, 0.07), smoothstep(0.0, 0.35, R.y - nS.y*0.0));
          vec3 wcol = vec3(0.50, 0.80, 0.96)*(0.35 + 0.65*vis)*0.95 + vec3(0.20, 0.55, 0.80)*0.30;
          wcol += vec3(0.95, 1.0, 1.0)*streak*(0.35 + 0.4*vis);
          wcol = mix(wcol, skyR, fres*0.55);
          wcol += vec3(1.0, 0.95, 0.9)*pow(max(dot(R, uSun), 0.0), 300.0)*25.0*vis;
          // 岸の白い泡
          wcol = mix(wcol, vec3(1.0), smoothstep(rw - 3.0, rw - 0.5, rd)*0.5*(0.5 + 0.5*f2));
          col = mix(col, wcol, water);
        }
        ` : ''}
        // 戦闘機の影（太陽の向きにのばしたぼかし）
        if (uShadow.w > 0.0) {
          vec3 rel = sp - uShadow.xyz;
          float along = dot(rel, uShadowDir);
          vec3 perp = rel - uShadowDir*along;
          float sh = exp(-dot(perp,perp)/(2.0*30.0) - along*along/(2.0*80.0));
          col *= 1.0 - 0.45*sh*uShadow.w*vis;
        }
        // 着弾の焦げ跡と光
        for (int i = 0; i < 24; i++) {
          vec4 im = uImp[i];
          float age = uTime - im.w;
          if (age < 0.0 || age > 40.0) continue;
          float d = length(sp - im.xyz);
          float R0 = 34.0 + 10.0*sqrt(age);
          float ring = exp(-((d - R0*0.7)/ (R0*0.35)*(d - R0*0.7)/ (R0*0.35)));
          float scorch = smoothstep(R0, R0*0.2, d);
          col *= 1.0 - 0.35*scorch*exp(-age*0.04);
          col += vec3(1.0, 0.35, 0.65)*ring*exp(-age*1.6)*3.0;
          col += vec3(1.0, 0.75, 0.55)*scorch*exp(-age*3.5)*6.0;
          // 広がる衝撃の輪
          float wu = (d - age*420.0)/30.0;
          float wave = exp(-wu*wu)*exp(-age*1.8);
          col += vec3(0.6, 0.9, 1.0)*wave*0.8;
        }
        // 空気の遠近（地平に向けて淡い水色へ）
        float camAlt = length(cameraPosition - uPC) - uR;
        float fog = 1.0 - exp(-dist/(42000.0 + camAlt*3.0));
        vec3 fogCol = mix(vec3(0.62, 0.74, 0.95), vec3(1.0, 0.88, 0.82), pow(max(dot(-V, uSun), 0.0), 4.0));
        col = mix(col, fogCol*(0.25 + 0.75*clamp(lam+0.3, 0.0, 1.0)), fog*0.85*(1.0 - uMap));
        // 地形図：紺の地に等高線（25m ごと、100m ごとに太く）、川は水色の線、1km の方眼
        if (uMap > 0.0) {
          vec3 m = vec3(0.010, 0.018, 0.034);
          float hs = clamp(dot(n, normalize(vec3(-0.45, 0.75, 0.35)))*0.5 + 0.5, 0.0, 1.0);
          m += vec3(0.02, 0.05, 0.08)*hs*hs*1.4;
          float c1 = h0/40.0, c4 = h0/200.0;
          float w1 = fwidth(c1), w4 = fwidth(c4);
          float l1 = (1.0 - smoothstep(0.0, w1*1.1, abs(fract(c1 + 0.5) - 0.5))) * (1.0 - smoothstep(0.25, 0.6, w1)) * step(2.0, h0);
          float l4 = (1.0 - smoothstep(0.0, w4*1.6, abs(fract(c4 + 0.5) - 0.5))) * (1.0 - smoothstep(0.3, 0.7, w4)) * step(2.0, h0);
          m += vec3(0.08, 0.26, 0.36)*l1*0.55 + vec3(0.30, 0.80, 1.0)*l4*0.75;
          vec2 gk = p2/1000.0;
          vec2 gw = fwidth(gk);
          vec2 gl = 1.0 - smoothstep(vec2(0.0), gw*1.2, abs(fract(gk + 0.5) - 0.5));
          m += vec3(0.05, 0.10, 0.18)*max(gl.x, gl.y);
          m = mix(m, vec3(0.20, 0.85, 1.0)*1.7, wMap);
          // 等高線の四角（16km 四方）の外は暗く沈める（離れるほど黒へ）
          vec2 ed = max(abs(p2 - uMapC) - uMapH, 0.0);
          float outQ = smoothstep(0.0, 40.0, max(ed.x, ed.y));
          vec3 mo = (vec3(0.010, 0.018, 0.034) + vec3(0.05, 0.10, 0.18)*max(gl.x, gl.y))*0.35*exp(-length(ed)/5000.0);
          m = mix(m, mo, outQ);
          col = mix(col, m, uMap);
        }
        gl_FragColor = vec4(col, 1.0);
      }`;
  const groundVert = (isTerrain) => /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vW;
      ${isTerrain ? 'attribute vec2 aXZ; varying vec2 vXZ;' : ''}
      void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; ${isTerrain ? 'vXZ = aXZ;' : ''} gl_Position = projectionMatrix*viewMatrix*w;
      #include <logdepthbuf_vertex>
      }`;
  const planetMat = new THREE.ShaderMaterial({ uniforms: groundUniforms(), vertexShader: groundVert(false), fragmentShader: groundFrag(false) });
  const pgeo = new THREE.SphereGeometry(PLANET_R, 1024, 512);
  pgeo.rotateX(Math.PI / 2); // 極を戦いの真下から外す
  const planet = new THREE.Mesh(pgeo, planetMat);
  planet.position.copy(PC);
  planet.frustumCulled = false;
  planet.renderOrder = -5;
  g.add(planet);

  // 地形のメッシュ：格子の頂点を球に沿って置き、高さの分だけ上へ
  const terrainMat = new THREE.ShaderMaterial({ uniforms: groundUniforms(), vertexShader: groundVert(true), fragmentShader: groundFrag(true) });
  terrainMat.extensions = { derivatives: true };
  const tgeo = new THREE.BufferGeometry();
  {
    // stride：格子を何本おきに使うか（画質「中」「低」は間引いて三角形を減らす。陰影は高さの画像から取るので細かさは残る）
    const st = Math.max(1, opts.stride || 1), MV = Math.floor((NV - 1) / st) + 1;
    const pos = new Float32Array(MV * MV * 3), xz = new Float32Array(MV * MV * 2);
    for (let jj = 0; jj < MV; jj++) for (let ii = 0; ii < MV; ii++) {
      const i = Math.min(NV - 1, ii * st), j = Math.min(NV - 1, jj * st);
      const k = jj * MV + ii, x = T.X[i], z = T.Z[j];
      const nx = x / PLANET_R, nz = z / PLANET_R, ny = Math.sqrt(1 - nx * nx - nz * nz);
      const r = PLANET_R + T.H[j * NV + i];
      pos[k * 3] = PC.x + nx * r; pos[k * 3 + 1] = PC.y + ny * r; pos[k * 3 + 2] = PC.z + nz * r;
      xz[k * 2] = x; xz[k * 2 + 1] = z;
    }
    const idx = new Uint32Array((MV - 1) * (MV - 1) * 6);
    let o = 0;
    for (let j = 0; j < MV - 1; j++) for (let i = 0; i < MV - 1; i++) {
      const a = j * MV + i, b = a + 1, c = a + MV, d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
    tgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    tgeo.setAttribute('aXZ', new THREE.BufferAttribute(xz, 2));
    tgeo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  const terrainMesh = new THREE.Mesh(tgeo, terrainMat);
  terrainMesh.frustumCulled = false;
  terrainMesh.renderOrder = -4;
  g.add(terrainMesh);
  const grounds = [planetMat, terrainMat];

  // 谷の影を 1 回だけ焼く：太陽も地形も動かないので、格子の各点から太陽へ光線をたどった結果を画像にしておく
  // （毎コマ 1 画素 46 回たどるのをやめる。光線は始まりをずらして 4 本、平均して縁を柔らかく）
  if (opts.renderer) {
    const R = opts.renderer, BN = opts.visSize || 1024;
    const rt = new THREE.WebGLRenderTarget(BN, BN, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    const bake = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: SUN_DIR }, uHt: { value: htTex }, uC: { value: new THREE.Vector2(T.cx, T.cz) }, uS: { value: T.S }, uK: { value: T.K }, uN: { value: T.N } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform vec3 uSun; uniform sampler2D uHt; uniform vec2 uC; uniform float uS, uK, uN; varying vec2 vUv;
        vec2 tuv(vec2 xz){ vec2 u = (asinh((xz - uC)*sinh(uK)/uS)/uK + 1.0)*0.5*uN; return (u + 0.5)/(uN + 1.0); }
        float hAt(vec2 xz){ return texture2D(uHt, tuv(xz)).r; }
        void main(){
          // この画素の格子座標 → 地表の x, z（tuv の逆）
          vec2 g = vUv*(uN + 1.0) - 0.5;
          vec2 xz = uC + uS*sinh(uK*(2.0*g/uN - 1.0))/sinh(uK);
          float h = hAt(xz) + 1.0;
          vec2 sd = normalize(uSun.xz); float tanE = uSun.y/length(uSun.xz);
          float acc = 0.0;
          for (int r = 0; r < 4; r++) {
            float vis = 1.0, t = 3.0 + 0.75*float(r);
            for (int i = 0; i < 64; i++) {
              float d = h + tanE*t + 0.5 - hAt(xz + sd*t);
              vis = min(vis, clamp(d/(t*0.04 + 2.0) + 0.5, 0.0, 1.0));
              t *= 1.15;
              if (t > 16000.0 || vis <= 0.0) break;
            }
            acc += vis;
          }
          gl_FragColor = vec4(vec3(acc*0.25), 1.0);
        }`,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bake);
    const qs = new THREE.Scene(); qs.add(quad);
    const cam = new THREE.Camera();
    const prev = R.getRenderTarget();
    R.setRenderTarget(rt); R.render(qs, cam); R.setRenderTarget(prev);
    quad.geometry.dispose(); bake.dispose();
    terrainMat.uniforms.uVis.value = rt.texture; terrainMat.uniforms.uHasVis.value = 1;
  }

  // 太陽が地形に隠れるか（CPU で格子をたどる）：戦闘機やミサイルの光に使う
  const SH = new THREE.Vector2(SUN_DIR.x, SUN_DIR.z).normalize(), TANE = SUN_DIR.y / Math.hypot(SUN_DIR.x, SUN_DIR.z);
  const sunVisAt = (p) => {
    const n = p.clone().sub(PC).normalize();
    const x = n.x * PLANET_R, z = n.z * PLANET_R, h = p.distanceTo(PC) - PLANET_R;
    let vis = 1, t = 4;
    for (let i = 0; i < 28; i++) {
      const d = h + TANE * t - T.heightAt(x + SH.x * t, z + SH.y * t);
      vis = Math.min(vis, Math.min(1, Math.max(0, d / (t * 0.035 + 1.5) + 0.5)));
      t *= 1.27;
      if (t > 4500 || vis <= 0) break;
    }
    return vis;
  };

  return {
    group: g, planet, planetMat, terrainMesh, terrainMat, skyMat, sunVisAt,
    setMap(k) { for (const m of grounds) m.uniforms.uMap.value = k; skyMat.uniforms.uMap.value = k; },
    update(t, px, impacts, jet) {
      for (const m of grounds) {
        m.uniforms.uTime.value = t;
        const arr = m.uniforms.uImp.value;
        for (let i = 0; i < arr.length; i++) {
          const e = impacts[i];
          if (e) arr[i].set(e.pos[0], e.pos[1], e.pos[2], e.t); else arr[i].set(0, -1e7, 0, -100);
        }
      }
      if (jet) {
        // 太陽と逆向きに地形へ落とす（地形の高さで 3 回詰める）
        const p = new THREE.Vector3(...jet.p);
        const n = p.clone().sub(PC).normalize();
        let s = p.clone(), hg = 0;
        for (let k = 0; k < 3; k++) {
          const ns = s.clone().sub(PC).normalize();
          hg = T.heightAt(ns.x * PLANET_R, ns.z * PLANET_R);
          const alt = p.distanceTo(PC) - PLANET_R - hg;
          s = p.clone().addScaledVector(SUN_DIR, -alt / Math.max(0.2, SUN_DIR.dot(n)));
        }
        const alt = p.distanceTo(PC) - PLANET_R - hg;
        const along = SUN_DIR.clone().addScaledVector(n, -SUN_DIR.dot(n)).normalize();
        for (const m of grounds) {
          m.uniforms.uShadow.value.set(s.x, s.y, s.z, alt < 600 ? 1 - alt / 600 : 0);
          m.uniforms.uShadowDir.value.copy(along);
        }
      }
      const st = g.userData.stars; if (st) st.userData.mat.uniforms.uPx.value = px;
    },
  };
}

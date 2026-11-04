// ミサイルの煙。全期間の軌跡を 1 つの管（インスタンス＝輪と輪の間）にしておき、時刻で「生まれてから今まで」を見せる。
// 古い煙ほど太く・薄く・漂ってちぎれる。若い所は排気で熱く光り、細い色の芯が通る（マクロスの線）。
import * as THREE from '../vendor/three.module.js';
import { DT, PLANET_C, PLANET_R, missileState } from './sim.js';
import { NOISE_GLSL } from './world.js';

const RS = 10;          // 管の周の分割
// STEP：120Hz の軌跡を何点おきに輪にするか（1＝そのまま。軽くしたい時は 2〜3）
export const MAX_AGE = 36; // 煙が残る秒

export function makeNoise3D(N = 64) {
  const d = new Uint8Array(N * N * N);
  let a = 99;
  const r = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
  const raw = new Float32Array(N * N * N);
  for (let i = 0; i < raw.length; i++) raw[i] = r();
  // 1 回ぼかして角を取る
  const id = (x, y, z) => ((z + N) % N) * N * N + ((y + N) % N) * N + ((x + N) % N);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let s = 0;
    for (let k = -1; k <= 1; k++) s += raw[id(x + k, y, z)] + raw[id(x, y + k, z)] + raw[id(x, y, z + k)];
    d[id(x, y, z)] = Math.round((s / 9) * 255);
  }
  // 平均に寄るのを広げる
  let mn = 255, mx = 0; for (const v of d) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  for (let i = 0; i < d.length; i++) d[i] = Math.round(((d[i] - mn) / (mx - mn)) * 255);
  const t = new THREE.Data3DTexture(d, N, N, N);
  t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType;
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

// 種類ごとの芯の色（ゲームの白・桃・水色・紫）
const TINT = { P: 0, C: 1, A: 2, B: 3, D: 4, E: 3, W: 2, debris: 5 };

function rng(seed) { let a = (seed * 4294967296) | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// 爆発から飛ぶ破片の細い煙（花のように広がる）
export function debrisTrails(explosions) {
  const out = [];
  for (const e of explosions) {
    if (e.type === 'split') continue;
    const r = rng(e.seed + 0.123);
    const K = e.type === 'ground' ? 7 : e.type === 'collide' ? 7 : 5;
    const up = [e.pos[0] - PLANET_C[0], e.pos[1] - PLANET_C[1], e.pos[2] - PLANET_C[2]];
    const ul = Math.hypot(...up); up[0] /= ul; up[1] /= ul; up[2] /= ul;
    for (let k = 0; k < K; k++) {
      let d = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
      const l = Math.hypot(...d) || 1; d = d.map((x) => x / l);
      if (e.type === 'ground') { const dd = d[0] * up[0] + d[1] * up[1] + d[2] * up[2]; if (dd < 0.25) d = d.map((x, i) => x + up[i] * (0.6 - dd)); }
      const sp = 70 + r() * 150;
      let v = d.map((x) => x * sp), p = e.pos.slice();
      const life = 0.9 + r() * 1.6;
      const n = Math.round(life / DT);
      const pts = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pts.set(p, i * 3);
        const drag = Math.exp(-1.5 * DT);
        v = v.map((x, j) => x * drag - up[j] * 9.8 * DT);
        p = p.map((x, j) => x + v[j] * DT);
      }
      out.push({ pts, birth: Math.round(e.t / DT), scale: 0.32 + r() * 0.15, tint: TINT.debris, mid: -1, seed: r() });
    }
  }
  return out;
}

export function makeSmoke(sim, noiseTex, STEP = 1) {
  const trails = [];
  sim.missiles.forEach((m, k) => trails.push({ pts: m.hist, birth: m.birth, scale: m.kind === 'pod' ? 1.9 : 1.0, tint: TINT[m.cls] ?? 1, mid: k, seed: (k * 0.6180339) % 1 }));
  trails.push(...debrisTrails(sim.explosions));

  // 輪を数える
  let segs = 0;
  for (const tr of trails) { const n = tr.pts.length / 3; const rings = Math.floor((n - 1) / STEP) + 1; tr.rings = rings; if (rings >= 2) segs += rings - 1; }
  const A0 = new Float32Array(segs * 4), A1 = new Float32Array(segs * 4), T0 = new Float32Array(segs * 4), T1 = new Float32Array(segs * 4);
  const N0 = new Float32Array(segs * 3), N1 = new Float32Array(segs * 3), M = new Float32Array(segs * 4);
  let s = 0;
  for (const tr of trails) {
    const P = tr.pts, n = P.length / 3, R = tr.rings;
    if (R < 2) continue;
    const idx = (k) => Math.min(n - 1, k * STEP);
    // 輪の中心・接線・弧長・平行移動の法線
    const C = [], T = [], S = [], Nn = [];
    let acc = 0;
    for (let k = 0; k < R; k++) {
      const i = idx(k);
      C.push([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    }
    for (let k = 0; k < R; k++) {
      const a = C[Math.max(0, k - 1)], b = C[Math.min(R - 1, k + 1)];
      let t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const l = Math.hypot(...t) || 1; t = t.map((x) => x / l);
      if (l < 1e-6 && k > 0) t = T[k - 1];
      T.push(t);
      if (k > 0) acc += Math.hypot(C[k][0] - C[k - 1][0], C[k][1] - C[k - 1][1], C[k][2] - C[k - 1][2]);
      S.push(acc);
    }
    // 最初の法線：接線と一番平行でない軸から
    {
      const t = T[0]; const ax = Math.abs(t[0]) < 0.6 ? [1, 0, 0] : [0, 1, 0];
      let nn = [ax[0] - t[0] * (ax[0] * t[0] + ax[1] * t[1] + ax[2] * t[2]), ax[1] - t[1] * (ax[0] * t[0] + ax[1] * t[1] + ax[2] * t[2]), ax[2] - t[2] * (ax[0] * t[0] + ax[1] * t[1] + ax[2] * t[2])];
      const l = Math.hypot(...nn); Nn.push(nn.map((x) => x / l));
      for (let k = 1; k < R; k++) {
        const p = Nn[k - 1], tk = T[k];
        const d = p[0] * tk[0] + p[1] * tk[1] + p[2] * tk[2];
        let q = [p[0] - tk[0] * d, p[1] - tk[1] * d, p[2] - tk[2] * d];
        const ql = Math.hypot(...q) || 1; Nn.push(q.map((x) => x / ql));
      }
    }
    for (let k = 0; k < R - 1; k++, s++) {
      const b0 = (tr.birth + idx(k)) * DT, b1 = (tr.birth + (k + 1 < R ? idx(k + 1) : n - 1)) * DT;
      A0.set([...C[k], b0], s * 4); A1.set([...C[k + 1], b1], s * 4);
      T0.set([...T[k], S[k]], s * 4); T1.set([...T[k + 1], S[k + 1]], s * 4);
      N0.set(Nn[k], s * 3); N1.set(Nn[k + 1], s * 3);
      M.set([tr.mid, tr.scale, tr.tint, tr.seed], s * 4);
    }
  }

  // 元の形：周 RS × 2 段
  const base = new THREE.InstancedBufferGeometry();
  const rv = [], ix = [];
  for (let v = 0; v < 2; v++) for (let j = 0; j <= RS; j++) rv.push(j, v);
  for (let j = 0; j < RS; j++) { const a = j, b = j + 1, c = RS + 1 + j, d = RS + 2 + j; ix.push(a, b, c, b, d, c); }
  base.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(rv.length / 2 * 3), 3));
  base.setAttribute('aRV', new THREE.Float32BufferAttribute(rv, 2));
  base.setIndex(ix);
  const ia = (arr, k) => new THREE.InstancedBufferAttribute(arr, k);
  base.setAttribute('iA0', ia(A0, 4)); base.setAttribute('iA1', ia(A1, 4));
  base.setAttribute('iT0', ia(T0, 4)); base.setAttribute('iT1', ia(T1, 4));
  base.setAttribute('iN0', ia(N0, 3)); base.setAttribute('iN1', ia(N1, 3));
  base.setAttribute('iM', ia(M, 4));
  base.instanceCount = segs;

  // ミサイルの今の位置（未来の輪をここへ寄せる）
  const HW = sim.missiles.length;
  const headData = new Float32Array(HW * 4);
  const heads = new THREE.DataTexture(headData, HW, 1, THREE.RGBAFormat, THREE.FloatType);
  heads.minFilter = heads.magFilter = THREE.NearestFilter;
  heads.needsUpdate = true;

  const common = {
    uTime: { value: 0 }, uMaxAge: { value: MAX_AGE }, uHeads: { value: heads }, uHeadsW: { value: HW },
    uWind: { value: new THREE.Vector3(1.6, 0.35, -0.8) },
    uNoise: { value: noiseTex },
  };
  const VERT = /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_vertex>
    attribute vec2 aRV;
    attribute vec4 iA0, iA1, iT0, iT1, iM;
    attribute vec3 iN0, iN1;
    uniform float uTime, uMaxAge, uHeadsW, uCore;
    uniform sampler2D uHeads;
    uniform vec3 uWind;
    varying vec3 vWorld, vNormal; varying float vAge, vR, vS, vSeed, vTint;
    ${NOISE_GLSL}
    void main(){
      float a0 = uTime - iA0.w;
      if (a0 < 0.0 || a0 > uMaxAge) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      bool second = aRV.y > 0.5;
      vec4 A = second ? iA1 : iA0;
      vec4 T = second ? iT1 : iT0;
      vec3 N = second ? iN1 : iN0;
      float age = uTime - A.w;
      vec3 c = A.xyz;
      if (age < 0.0) {
        if (iM.x >= 0.0) c = texture2D(uHeads, vec2((iM.x + 0.5)/uHeadsW, 0.5)).xyz; else c = iA0.xyz;
        age = 0.0;
      }
      float rs = iM.y;
      float r = uCore > 0.5 ? rs*(0.10 + 0.18*sqrt(age)) : rs*(0.28 + 2.5*sqrt(age) + 0.42*age);
      // 漂い：年とともに大きく、ゆっくりうねる
      vec3 q = A.xyz*0.0032;
      float ta = age*0.06;
      vec3 drift = (vec3(vnoise(q + vec3(0.0, ta, 0.0)), vnoise(q + vec3(5.2, 1.3 + ta, 0.0)), vnoise(q + vec3(1.7, 9.2, ta))) - 0.5) * 2.0 * pow(age, 0.85) * 2.4;
      drift += (vec3(vnoise(A.xyz*0.02 + ta*2.0), vnoise(A.xyz*0.02 + 4.0 + ta*2.0), vnoise(A.xyz*0.02 + 8.0 + ta*2.0)) - 0.5) * age * 0.9;
      c += drift + uWind*age;
      float ang = aRV.x/${RS.toFixed(1)}*6.2831853;
      vec3 B = normalize(cross(T.xyz, N));
      vec3 radial = N*cos(ang) + B*sin(ang);
      float bump = uCore > 0.5 ? 1.0 : 0.62 + 0.55*vnoise(vec3(T.w*0.075, ang*1.1, iM.w*13.0 + age*0.25)) + 0.28*vnoise(vec3(T.w*0.19, ang*2.3 + 4.0, iM.w*7.0 + age*0.4));
      vec3 p = c + radial*r*bump;
      vWorld = p; vNormal = radial; vAge = age; vR = r; vS = T.w; vSeed = iM.w; vTint = iM.z;
      gl_Position = projectionMatrix*viewMatrix*vec4(p, 1.0);
      #include <logdepthbuf_vertex>
    }`;

  const smokeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, premultipliedAlpha: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      ...common, uCore: { value: 0 },
      uSun: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color(1.0, 0.95, 0.88) },
      uAmb: { value: new THREE.Color(0.07, 0.085, 0.15) }, uBounce: { value: new THREE.Color(0.26, 0.28, 0.32) },
      uPC: { value: new THREE.Vector3(...PLANET_C) },
      uL: { value: Array.from({ length: 12 }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uLC: { value: Array.from({ length: 12 }, () => new THREE.Color(0, 0, 0)) },
      uDensity: { value: 1.0 }, uNearFade: { value: 9.0 },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      precision highp sampler3D;
      uniform sampler3D uNoise;
      uniform float uTime, uMaxAge, uDensity, uNearFade;
      uniform vec3 uSun, uSunCol, uAmb, uBounce, uPC;
      uniform vec4 uL[12]; uniform vec3 uLC[12];
      varying vec3 vWorld, vNormal; varying float vAge, vR, vS, vSeed, vTint;
      vec3 tintCol(float k){
        if (k < 0.5) return vec3(1.0, 0.30, 0.70);
        if (k < 1.5) return vec3(0.55, 0.95, 1.0);
        if (k < 2.5) return vec3(1.0, 0.40, 0.75);
        if (k < 3.5) return vec3(1.0, 0.85, 0.95);
        if (k < 4.5) return vec3(0.70, 0.50, 1.0);
        return vec3(1.0, 0.55, 0.45);
      }
      void main(){
        #include <logdepthbuf_fragment>
        vec3 V = cameraPosition - vWorld; float dc = length(V); V /= dc;
        vec3 n = normalize(vNormal);
        float ndv = abs(dot(n, V));
        vec3 np = vWorld + vec3(0.0, 0.0, vAge*1.2) + vSeed*331.0;
        float fs = 1.0/(vR*1.8 + 1.5);
        float nz = texture(uNoise, np*0.012).r*0.35 + texture(uNoise, np*fs*0.5 + 0.3).r*0.40 + texture(uNoise, np*fs*1.6 + 0.7).r*0.25;
        float tau = min(uDensity * 2.4 / pow(max(vR, 0.25), 0.8), 1.8);
        // ふちは雲のようにちぎれる（ndv＝管の中心ほど 1）
        float edge = smoothstep(0.0, 0.6, ndv - (nz - 0.45)*1.05);
        float thick = tau * pow(ndv, 0.9) * (0.2 + 1.6*nz) * edge;
        float alpha = 1.0 - exp(-thick);
        float ero = clamp(vAge/uMaxAge, 0.0, 1.0);
        alpha *= smoothstep(ero*0.9, ero*0.9 + 0.3, nz + 0.12);
        alpha *= 1.0 - smoothstep(uMaxAge*0.65, uMaxAge, vAge);
        alpha *= smoothstep(1.0, uNearFade, dc);
        if (alpha < 0.002) discard;
        vec3 up = normalize(vWorld - uPC);
        float ndl = dot(n, uSun);
        float wrap = clamp(ndl*0.75 + 0.25, 0.0, 1.0);
        // 太陽の反対側は自分の厚みで暗い（ふくらみが見える）
        wrap *= mix(1.0, 0.55, smoothstep(0.0, -0.8, ndl)*clamp(tau, 0.0, 1.0));
        float cosS = max(dot(-V, uSun), 0.0);
        float phase = pow(cosS, 10.0)*2.2 + pow(cosS, 3.0)*0.35;
        float under = clamp(-dot(n, up)*0.5 + 0.5, 0.0, 1.0);
        vec3 base = vec3(0.93, 0.94, 0.96) * mix(0.82, 1.06, nz);
        vec3 col = base * (uSunCol*wrap*1.05 + uAmb + uBounce*under);
        // 逆光：厚い所は暗く、薄い所と縁が光る
        col = mix(col, col*0.5, alpha*smoothstep(0.2, 0.9, cosS));
        col += uSunCol*phase*(1.0 - alpha*0.8)*0.6;
        // 生まれたての熱
        float hot = exp(-vAge*18.0);
        col += tintCol(vTint) * hot * 1.6 + vec3(1.0, 0.9, 0.95)*exp(-vAge*40.0)*2.5;
        // 爆発の光
        for (int i = 0; i < 12; i++) {
          vec4 L = uL[i];
          if (L.w <= 0.0) continue;
          vec3 d = L.xyz - vWorld; float dd = dot(d, d);
          col += uLC[i] * L.w / (1.0 + dd/(140.0*140.0)) * (0.55 + 0.45*dot(n, normalize(d)));
        }
        gl_FragColor = vec4(col*alpha, alpha);
      }`,
  });
  const coreMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { ...common, uCore: { value: 1 }, uGain: { value: 1 } },
    vertexShader: VERT,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uGain;
      varying vec3 vWorld, vNormal; varying float vAge, vR, vS, vSeed, vTint;
      vec3 tintCol(float k){
        if (k < 0.5) return vec3(1.0, 0.30, 0.70);
        if (k < 1.5) return vec3(0.45, 0.95, 1.0);
        if (k < 2.5) return vec3(1.0, 0.35, 0.72);
        if (k < 3.5) return vec3(1.0, 0.82, 0.95);
        if (k < 4.5) return vec3(0.68, 0.45, 1.0);
        return vec3(1.0, 0.5, 0.4);
      }
      void main(){
        #include <logdepthbuf_fragment>
        vec3 V = normalize(cameraPosition - vWorld);
        float ndv = abs(dot(normalize(vNormal), V));
        float e = exp(-vAge*3.2) * pow(ndv, 2.0) * 0.32;
        float dc = length(cameraPosition - vWorld);
        e *= smoothstep(0.5, 4.0, dc);
        gl_FragColor = vec4(tintCol(vTint) * e * 1.6 * uGain, 1.0);
      }`,
  });
  const smoke = new THREE.Mesh(base, smokeMat);
  smoke.frustumCulled = false; smoke.renderOrder = 20;
  const core = new THREE.Mesh(base, coreMat);
  core.frustumCulled = false; core.renderOrder = 21;

  return {
    smoke, core, smokeMat, coreMat, segs,
    dispose() { base.dispose(); smokeMat.dispose(); coreMat.dispose(); heads.dispose?.(); },
    update(t, sunDir) {
      smokeMat.uniforms.uTime.value = t; coreMat.uniforms.uTime.value = t;
      smokeMat.uniforms.uSun.value.copy(sunDir);
      for (let k = 0; k < sim.missiles.length; k++) {
        const m = sim.missiles[k];
        const st = missileState(m, Math.min(t, m.death * DT));
        if (st) headData.set([st.p[0], st.p[1], st.p[2], 1], k * 4);
        else headData.set([m.hist[0], m.hist[1], m.hist[2], 0], k * 4);
      }
      heads.needsUpdate = true;
    },
    setLights(list) {
      const L = smokeMat.uniforms.uL.value, C = smokeMat.uniforms.uLC.value;
      for (let i = 0; i < 12; i++) {
        const l = list[i];
        if (l) { L[i].set(l.p[0], l.p[1], l.p[2], l.i); C[i].setRGB(l.c[0], l.c[1], l.c[2]); } else L[i].w = 0;
      }
    },
  };
}

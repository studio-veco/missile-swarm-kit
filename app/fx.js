// 光と爆発：ミサイル本体と噴射、爆発（閃光・火球・輪・火花・残る煙）、アフターバーナー、翼端の雲、空気の粒
import * as THREE from '../vendor/three.module.js';
import { DT, PLANET_C, missileState, jetState } from './sim.js';
import { NOISE_GLSL } from './world.js';

function rng(seed) { let a = (seed * 4294967296) | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// ---------- 板（ビルボード）の束：光る玉・輪・筋（加算）／煙の玉（重ね塗り） ----------
class Sprites {
  constructor(max, mode, noiseTex) {
    this.max = max; this.n = 0; this.mode = mode;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.par = new Float32Array(max * 4); this.dir = new Float32Array(max * 3);
    const ia = (a, k) => { const b = new THREE.InstancedBufferAttribute(a, k); b.setUsage(THREE.DynamicDrawUsage); return b; };
    g.setAttribute('iPos', ia(this.pos, 3)); g.setAttribute('iCol', ia(this.col, 4)); g.setAttribute('iP', ia(this.par, 4)); g.setAttribute('iDir', ia(this.dir, 3));
    g.instanceCount = 0;
    this.geo = g;
    const puff = mode === 'puff';
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: puff ? THREE.CustomBlending : THREE.AdditiveBlending,
      ...(puff ? { blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, premultipliedAlpha: true } : {}),
      uniforms: { uNoise: { value: noiseTex }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uTime: { value: 0 }, uNear: { value: 1.2 } },
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 iPos, iDir; attribute vec4 iCol, iP; uniform float uNear;
        varying vec2 vC; varying vec4 vCol; varying float vKind, vSeed; varying vec3 vViewN; varying vec3 vW;
        void main(){
          vec4 mv = viewMatrix*vec4(iPos, 1.0);
          float kind = iP.w;
          vec2 c = position.xy;
          if (kind > 1.5 && kind < 2.5) {
            vec3 dv = (viewMatrix*vec4(iDir, 0.0)).xyz;
            // 筋：始点と終点を見える側（カメラの前）に収める
            vec3 p0 = mv.xyz - dv*iP.y*0.5, p1 = mv.xyz + dv*iP.y*0.5;
            float zn = -0.2;
            if (p0.z > zn && p1.z > zn) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
            if (p0.z > zn) p0 = mix(p1, p0, (p1.z - zn)/(p1.z - p0.z));
            if (p1.z > zn) p1 = mix(p0, p1, (p0.z - zn)/(p0.z - p1.z));
            vec4 a = projectionMatrix*vec4(p0, 1.0), b = projectionMatrix*vec4(p1, 1.0);
            vec2 d2 = b.xy/b.w - a.xy/a.w;
            vec2 dn = length(d2) > 1e-6 ? normalize(d2) : vec2(1.0, 0.0);
            vec2 n2 = vec2(-dn.y, dn.x);
            mv.xyz = mix(p0, p1, c.x*0.5 + 0.5) + vec3(n2*c.y*iP.x, 0.0);
          } else {
            float cr = cos(iP.z), sr = sin(iP.z);
            // 光の玉・輪は、カメラの近くでも画面の一部（奥行きの 0.3 倍まで）に収める＝画面が白く飛ばない
            float sz = kind < 1.5 ? min(iP.x, max(0.4, -mv.z)*0.3) : iP.x;
            mv.xy += vec2(c.x*cr - c.y*sr, c.x*sr + c.y*cr)*sz;
          }
          vC = c; vCol = iCol; vKind = kind; vSeed = iP.z; vW = iPos;
          // カメラのすぐ前の光は弱める（ミサイルの真後ろから撮る時に画面がつぶれない）
          if (kind < 2.5) vCol.a *= smoothstep(uNear, uNear*6.0, -(viewMatrix*vec4(iPos, 1.0)).z);
          gl_Position = projectionMatrix*mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        precision highp sampler3D;
        uniform sampler3D uNoise; uniform vec3 uSun; uniform float uTime;
        varying vec2 vC; varying vec4 vCol; varying float vKind, vSeed; varying vec3 vW;
        void main(){
          #include <logdepthbuf_fragment>
          float r2 = dot(vC, vC);
          if (vKind < 0.5) { // 光の玉
            float a = max(exp(-r2*5.0) - 0.0067, 0.0)*0.8 + exp(-r2*30.0)*1.5;
            gl_FragColor = vec4(vCol.rgb*a*vCol.a, 1.0);
          } else if (vKind < 1.5) { // 輪
            float r = sqrt(r2);
            float u1 = (r - 0.86)/0.035, u2 = (r - 0.80)/0.12;
            float a = (exp(-u1*u1) + exp(-u2*u2)*0.12) * smoothstep(1.0, 0.94, r);
            gl_FragColor = vec4(vCol.rgb*a*vCol.a, 1.0);
          } else if (vKind < 2.5) { // 筋
            float a = exp(-vC.y*vC.y*5.0) * smoothstep(-1.0, -0.2, vC.x) * (0.4 + 0.6*smoothstep(1.0, 0.2, vC.x));
            gl_FragColor = vec4(vCol.rgb*a*vCol.a, 1.0);
          } else { // 煙の玉：球のつもりで陰をつける
            if (r2 > 1.0) discard;
            vec3 nz = vec3(vC, sqrt(1.0 - r2));
            vec3 p = vec3(vC*0.9, vSeed*7.0) + vW*0.02;
            float n = texture(uNoise, p*0.35).r*0.45 + texture(uNoise, p*0.9 + 0.4).r*0.35 + texture(uNoise, p*2.3 + 0.8).r*0.2;
            float a = smoothstep(0.0, 0.55, (1.0 - r2) - (0.55 - n)*0.9) * vCol.a;
            vec3 L = normalize((viewMatrix*vec4(uSun, 0.0)).xyz);
            float lit = clamp(dot(nz, L)*0.5 + 0.55, 0.0, 1.0);
            vec3 col = vCol.rgb*(0.30 + 0.85*lit) * (0.85 + 0.3*n);
            gl_FragColor = vec4(col*a, a);
          }
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
  }
  begin() { this.n = 0; }
  // kind: 0 玉, 1 輪, 2 筋, 3 煙
  add(p, size, col, a, kind = 0, rot = 0, dir = null, len = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = p[0]; this.pos[i * 3 + 1] = p[1]; this.pos[i * 3 + 2] = p[2];
    this.col[i * 4] = col[0]; this.col[i * 4 + 1] = col[1]; this.col[i * 4 + 2] = col[2]; this.col[i * 4 + 3] = a;
    this.par[i * 4] = size; this.par[i * 4 + 1] = len; this.par[i * 4 + 2] = rot; this.par[i * 4 + 3] = kind;
    if (dir) { this.dir[i * 3] = dir[0]; this.dir[i * 3 + 1] = dir[1]; this.dir[i * 3 + 2] = dir[2]; }
  }
  end() {
    this.geo.instanceCount = this.n;
    for (const k of ['iPos', 'iCol', 'iP', 'iDir']) { const at = this.geo.attributes[k]; at.needsUpdate = true; at.clearUpdateRanges?.(); at.addUpdateRange?.(0, this.n * at.itemSize); }
  }
}

// ---------- ミサイルの形 ----------
// フィンのない細い筒：尖った長い鼻（先は暗い）→ 白い胴（桃の帯）→ 少しすぼまる尾 → 暗くくぼんだノズル。鼻が +Z
function missileGeometry(pod) {
  const L = pod ? 4.6 : 3.1, R = pod ? 0.3 : 0.1;
  const Ln = R * 7;                 // 鼻の長さ
  const pts = [];
  // 鼻（先から）
  for (let i = 0; i <= 14; i++) { const u = i / 14; pts.push(new THREE.Vector2(R * Math.pow(1 - (1 - u) * (1 - u), 0.72), L / 2 - u * Ln)); }
  // 胴 → すぼまる尾 → ノズルの縁 → くぼみ
  pts.push(new THREE.Vector2(R, -L / 2 + R * 2.2), new THREE.Vector2(R * 0.84, -L / 2), new THREE.Vector2(R * 0.62, -L / 2 + R * 0.25), new THREE.Vector2(0, -L / 2 + R * 0.25));
  const body = new THREE.LatheGeometry(pts, 24);
  body.rotateX(Math.PI / 2); // 回転体の軸（+Y＝鼻）を +Z へ
  const g = body.index ? body.toNonIndexed() : body;
  g.computeVertexNormals();
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i), r = Math.hypot(p.getX(i), p.getY(i));
    const tip = z > L / 2 - Ln * 0.38;
    const band = (z > L / 2 - Ln - R * 2.6 && z < L / 2 - Ln - R * 0.8) || (pod && Math.abs(z) < 0.25);
    const nozzle = z < -L / 2 + R * 0.3 && r < R * 0.8;
    const c = nozzle ? [0.06, 0.05, 0.07] : tip ? [0.22, 0.2, 0.24] : band ? [1.0, 0.18, 0.55] : [0.93, 0.94, 0.95];
    col.set(c, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function makeFX(sim, noiseTex, envMap, jetModel) {
  const group = new THREE.Group();
  const add = new Sprites(9000, 'add', noiseTex);
  const puffs = new Sprites(6000, 'puff', noiseTex);
  add.mesh.renderOrder = 30; puffs.mesh.renderOrder = 19;
  group.add(add.mesh, puffs.mesh);

  // ミサイル本体（インスタンス）
  const minis = sim.missiles.filter((m) => m.kind === 'mini');
  const pods = sim.missiles.filter((m) => m.kind === 'pod');
  const mmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.15, envMap, envMapIntensity: 1.0, side: THREE.DoubleSide });
  const miniMesh = new THREE.InstancedMesh(missileGeometry(false), mmat, minis.length);
  const podMesh = new THREE.InstancedMesh(missileGeometry(true), mmat, pods.length);
  miniMesh.frustumCulled = podMesh.frustumCulled = false;
  miniMesh.castShadow = true;
  group.add(miniMesh, podMesh);

  // 火球（ゆがむ球）
  const FB_MAX = 64;
  const fbGeo = new THREE.InstancedBufferGeometry().copy(new THREE.IcosahedronGeometry(1, 4));
  const fbPos = new Float32Array(FB_MAX * 4), fbDat = new Float32Array(FB_MAX * 4);
  fbGeo.setAttribute('iPos', new THREE.InstancedBufferAttribute(fbPos, 4).setUsage(THREE.DynamicDrawUsage));
  fbGeo.setAttribute('iDat', new THREE.InstancedBufferAttribute(fbDat, 4).setUsage(THREE.DynamicDrawUsage));
  fbGeo.instanceCount = 0;
  const fbMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec4 iPos, iDat; // xyz,radius / age,seed,kind,heat
      varying vec3 vN, vW; varying float vAge, vSeed, vHeat, vNz, vNear;
      ${NOISE_GLSL}
      void main(){
        vec3 n = normalize(position);
        // カメラが火球の中・すぐ脇にいる時は弱める（画面が白く飛ばない）
        vNear = smoothstep(0.9, 3.0, length(cameraPosition - iPos.xyz)/max(iPos.w, 0.5));
        float nz = fbm3(n*2.2 + iDat.y*9.0 + vec3(0.0, iDat.x*1.5, 0.0));
        vec3 p = iPos.xyz + n*iPos.w*(0.72 + 0.65*nz);
        vN = n; vW = p; vAge = iDat.x; vSeed = iDat.y; vHeat = iDat.w; vNz = nz;
        gl_Position = projectionMatrix*viewMatrix*vec4(p, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec3 vN, vW; varying float vAge, vSeed, vHeat, vNz, vNear;
      ${NOISE_GLSL}
      void main(){
        #include <logdepthbuf_fragment>
        vec3 Vd = normalize(cameraPosition - vW);
        float ndv = abs(dot(normalize(vN), Vd));
        float a = vAge;
        vec3 hot = vec3(1.0, 0.92, 0.98), pink = vec3(1.0, 0.22, 0.55), orange = vec3(1.0, 0.42, 0.12), dark = vec3(0.30, 0.06, 0.10);
        // 中心ほど熱い（白→桃）、外側と後半は橙から暗く
        float core = pow(ndv, 2.0);
        float tn = fbm3(vW*0.18 + vec3(0.0, a*3.0, vSeed*20.0));
        vec3 c = mix(pink, hot, core*exp(-a*6.0));
        c = mix(c, orange, smoothstep(0.12, 0.5, a)*(1.0 - core*0.5));
        c = mix(c, hot, smoothstep(0.6, 0.8, tn)*exp(-a*2.5));
        c = mix(c, dark, smoothstep(0.35, 0.9, a));
        float e = (exp(-a*3.0)*2.4 + 0.2) * (0.15 + 1.4*tn*vNz) * smoothstep(0.0, 0.7, ndv) * smoothstep(1.0, 0.5, a) * vHeat;
        gl_FragColor = vec4(c*e*(0.15 + 0.85*vNear), 1.0);
      }`,
  });
  const fireballs = new THREE.Mesh(fbGeo, fbMat);
  fireballs.frustumCulled = false; fireballs.renderOrder = 25;
  group.add(fireballs);

  // アフターバーナー（入れ子の円錐、ショックダイヤモンド）
  const abGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 60, true);
  abGeo.translate(0, -0.5, 0); abGeo.rotateX(-Math.PI / 2); // 0..-1 の z へ伸びる
  const abMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uThr: { value: 0 }, uTime: { value: 0 }, uLen: { value: 6 }, uR0: { value: 0.45 }, uLayer: { value: 0 } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float uLen, uR0, uLayer; varying float vZ; varying vec3 vN, vW; varying float vAng;
      void main(){
        float z = position.z; // 0..1
        float rr = uR0*(1.0 - z*0.55)*(1.0 + uLayer*0.35) * (1.0 + 0.10*sin(z*40.0));
        vec3 p = vec3(position.xy*rr, -z*uLen*(1.0 - uLayer*0.25));
        vZ = z; vAng = atan(position.y, position.x);
        vec4 w = modelMatrix*vec4(p, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*vec3(position.xy, 0.0));
        gl_Position = projectionMatrix*viewMatrix*w;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uThr, uTime, uLayer; varying float vZ, vAng; varying vec3 vN, vW;
      ${NOISE_GLSL}
      void main(){
        #include <logdepthbuf_fragment>
        float ndv = abs(dot(normalize(vN), normalize(cameraPosition - vW)));
        float ab = smoothstep(0.7, 1.0, uThr);
        float dia = pow(max(0.5 + 0.5*cos(vZ*6.2831*4.2), 0.0), 6.0) * smoothstep(0.85, 0.1, vZ) * ab;
        float flick = 0.75 + 0.5*vnoise(vec3(vZ*9.0 - uTime*38.0, vAng*2.0, uTime*13.0));
        float body = pow(1.0 - vZ, 1.6) * flick;
        vec3 core = vec3(1.0, 0.9, 1.0), mid = vec3(1.0, 0.35, 0.75), edge = vec3(0.45, 0.4, 1.0);
        vec3 c = mix(core, mid, smoothstep(0.0, 0.5, vZ + uLayer*0.3));
        c = mix(c, edge, smoothstep(0.3, 0.9, vZ));
        float e = (body*(0.3 + 0.8*ab) + dia*2.0) * pow(ndv, 1.5 + uLayer) * (0.12 + 0.5*uThr) * smoothstep(1.0, 0.7, vZ);
        gl_FragColor = vec4(c*e*(uLayer > 0.5 ? 0.45 : 1.0), 1.0);
      }`,
  });
  abMat.uniforms.uR0.value = 0.45 * (jetModel.nozzleR || 0.47) / 0.47;
  const abMat2 = abMat.clone(); abMat2.uniforms = THREE.UniformsUtils.clone(abMat.uniforms); abMat2.uniforms.uLayer.value = 1;
  // ノズルごとに入れ子の円錐を 1 組
  const ab = new THREE.Group();
  const abParts = [];
  for (const nz of (jetModel.nozzles || [jetModel.nozzle])) {
    const g = new THREE.Group();
    const ab1 = new THREE.Mesh(abGeo, abMat), ab2 = new THREE.Mesh(abGeo, abMat2);
    ab1.frustumCulled = ab2.frustumCulled = false; ab1.renderOrder = ab2.renderOrder = 26;
    g.add(ab1, ab2); g.position.copy(nz); ab.add(g); abParts.push(ab1, ab2);
  }
  jetModel.root.add(ab);

  // 翼の上の雲（高 G で出る）と、急加速の雲の円錐
  const vapMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: { uK: { value: 0 }, uTime: { value: 0 }, uSun: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vP, vW, vN;
      void main(){ vP = position; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w;
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uK, uTime; uniform vec3 uSun; varying vec3 vP, vW, vN;
      ${NOISE_GLSL}
      void main(){
        #include <logdepthbuf_fragment>
        float n = fbm3(vP*vec3(1.6, 3.0, 0.9) + vec3(0.0, 0.0, uTime*6.0));
        float ndv = abs(dot(normalize(vN), normalize(cameraPosition - vW)));
        float a = uK * smoothstep(0.35, 0.75, n) * (0.25 + 0.75*ndv) * 0.55;
        vec3 col = vec3(0.95, 0.97, 1.0) * (0.75 + 0.35*max(dot(normalize(vN), uSun), 0.0));
        gl_FragColor = vec4(col*a, a);
      }`,
  });
  const vapSheet = (() => {
    // 翼の上に薄い膜（付け根が厚い）
    const g = new THREE.BufferGeometry();
    const pos = [], idx = [];
    const S = 10, C = 8;
    const WV = jetModel.wingVapor || { x: [0.9, 4.5], le: [1.75, -0.95], te: [-3.3, -2.6], y: [0, 0] };
    for (const side of [1, -1]) {
      const b = pos.length / 3;
      for (let s = 0; s <= S; s++) for (let c = 0; c <= C; c++) {
        const u = s / S, v = c / C;
        const x = (WV.x[0] + u * (WV.x[1] - WV.x[0])) * side;
        const le = WV.le[0] + u * (WV.le[1] - WV.le[0]), te = WV.te[0] + u * (WV.te[1] - WV.te[0]);
        const z = le + (te - le) * v;
        const h = WV.y[0] + u * (WV.y[1] - WV.y[0]) + 0.06 + 0.55 * (1 - u) * Math.sin(v * Math.PI) ** 0.8;
        pos.push(x, h, z);
      }
      for (let s = 0; s < S; s++) for (let c = 0; c < C; c++) { const a = b + s * (C + 1) + c; idx.push(a, a + 1, a + C + 1, a + 1, a + C + 2, a + C + 1); }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, vapMat); m.frustumCulled = false; m.renderOrder = 27;
    return m;
  })();
  jetModel.root.add(vapSheet);
  const coneMat = vapMat.clone(); coneMat.uniforms = THREE.UniformsUtils.clone(vapMat.uniforms);
  const LK = (jetModel.length || 15.9) / 15.9;
  const coneGeo = new THREE.CylinderGeometry(1.1 * LK, 2.6 * LK, 4.2 * LK, 48, 6, true); coneGeo.rotateX(Math.PI / 2); coneGeo.translate(0, 0.05, -0.6 * LK);
  const vcone = new THREE.Mesh(coneGeo, coneMat); vcone.frustumCulled = false; vcone.renderOrder = 27;
  jetModel.root.add(vcone);

  // 翼端渦（細い白いリボン）
  const TIP_N = 90;
  const tipGeo = new THREE.BufferGeometry();
  const tipPos = new Float32Array(2 * TIP_N * 2 * 3), tipA = new Float32Array(2 * TIP_N * 2);
  tipGeo.setAttribute('position', new THREE.BufferAttribute(tipPos, 3).setUsage(THREE.DynamicDrawUsage));
  tipGeo.setAttribute('aA', new THREE.BufferAttribute(tipA, 1).setUsage(THREE.DynamicDrawUsage));
  { const idx = []; for (let w = 0; w < 2; w++) for (let i = 0; i < TIP_N - 1; i++) { const a = (w * TIP_N + i) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } tipGeo.setIndex(idx); }
  const tipMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float aA; varying float vA; varying vec2 vUv;
      void main(){ vA = aA; vUv = vec2(0.0, float(gl_VertexID % 2)); gl_Position = projectionMatrix*viewMatrix*vec4(position,1.0);
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying float vA; varying vec2 vUv;
      void main(){
        #include <logdepthbuf_fragment>
        float e = 1.0 - abs(vUv.y*2.0 - 1.0);
        float a = vA*e*e*0.8;
        gl_FragColor = vec4(vec3(0.96)*a, a);
      }`,
  });
  const tipMesh = new THREE.Mesh(tipGeo, tipMat); tipMesh.frustumCulled = false; tipMesh.renderOrder = 22;
  group.add(tipMesh);

  // 空気の粒（速さの手がかり）
  const DUST = 900;
  const dustSeeds = []; { const r = rng(0.77); for (let i = 0; i < DUST; i++) dustSeeds.push([r(), r(), r(), r()]); }

  // 爆発ごとの火花と残る煙（決まった乱数）
  const exps = sim.explosions.map((e) => {
    const r = rng(e.seed);
    const up = V(e.pos).sub(V(PLANET_C)).normalize();
    const sparks = [];
    const NS = e.type === 'split' ? 48 : 40;
    for (let k = 0; k < NS; k++) {
      let d = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
      if (e.type === 'ground' && d.dot(up) < 0.1) d.addScaledVector(up, 0.4 - d.dot(up)).normalize();
      sparks.push({ d, sp: 160 + r() * 420, life: 0.3 + r() * 0.8, w: 0.06 + r() * 0.1 });
    }
    const pf = [];
    const NP = e.type === 'split' ? 6 : e.type === 'ground' ? 18 : 13;
    for (let k = 0; k < NP; k++) {
      // 中心近くにかたまって重なる（等間隔の花びらにしない）
      let d = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
      if (e.type === 'ground') { d.addScaledVector(up, 0.6 - d.dot(up) * 0.3); if (k > 10) d.addScaledVector(up, -d.dot(up) * 0.9); }
      const reach = Math.pow(r(), 1.6);
      pf.push({ d, sp: 3 + reach * 16, s0: 5 + r() * 5, s1: 16 + r() * 20, life: 10 + r() * 12, rot: r() * 6.28, dark: e.type !== 'split' && r() < 0.8 });
    }
    return { e, up, sparks, pf };
  });

  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);

  return {
    group, miniMesh, podMesh, add, puffs, vapSheet, vcone, ab,
    // 作り直す前に、機体に付けたものを外して捨てる
    dispose() {
      for (const o of [ab, vapSheet, vcone]) jetModel.root.remove(o);
      const seen = new Set();
      const free = (o) => o.traverse((x) => { if (x.geometry && !seen.has(x.geometry)) { seen.add(x.geometry); x.geometry.dispose(); } if (x.material && !seen.has(x.material)) { seen.add(x.material); x.material.dispose?.(); } });
      free(group); free(ab); free(vapSheet); free(vcone);
    },
    // t：シミュレーションの秒。cam：カメラ。opts：{ dustVel }
    update(t, cam, sunDir, opts = {}) {
      add.begin(); puffs.begin();
      add.mat.uniforms.uTime.value = t; puffs.mat.uniforms.uSun.value.copy(sunDir);
      add.mat.uniforms.uNear.value = opts.glowNear ?? 1.2;
      const camP = cam.position;
      // ミサイル本体と噴射
      const place = (mesh, list, scale0) => {
        list.forEach((m, k) => {
          const st = missileState(m, t);
          if (!st) { tmpM.makeScale(0, 0, 0); mesh.setMatrixAt(k, tmpM); return; }
          const scale = m.kind === 'pod' && m.gen > 0 ? scale0 * 0.7 : scale0;
          tmpP.set(...st.p); tmpQ.setFromUnitVectors(zAxis, tmpS.set(...st.d));
          tmpM.compose(tmpP, tmpQ, tmpS.set(scale, scale, scale));
          mesh.setMatrixAt(k, tmpM);
          const L = m.kind === 'pod' ? 2.4 : 1.6;
          const tail = [st.p[0] - st.d[0] * L, st.p[1] - st.d[1] * L, st.p[2] - st.d[2] * L];
          const age = t - m.birth * DT;
          const ign = m.kind === 'pod' ? 1 : Math.min(1, age * 8);
          const fl = 0.8 + 0.4 * Math.sin(t * 90 + k * 7.1) * Math.sin(t * 53 + k);
          const pod = m.kind === 'pod';
          // 噴射は尾だけ（鼻先は光らせない＝向きを読み違えない）。カメラが近いほど小さく（画面がつぶれない）
          const dc = Math.hypot(tail[0] - camP.x, tail[1] - camP.y, tail[2] - camP.z);
          const ck = Math.min(1, Math.max(0.16, (dc - 0.8) / 12));
          add.add(tail, (pod ? 4.0 : 1.5) * fl * ck, [1.0, 0.45, 0.8], 2.2 * ign, 0);
          add.add(tail, (pod ? 1.2 : 0.45) * Math.max(0.35, ck), [1.0, 0.95, 1.0], 6 * ign, 0);
          add.add(tail, (pod ? 0.55 : 0.22) * Math.max(0.4, ck), [1.0, 0.6, 0.9], 4.0 * ign, 2, 0, [-st.d[0], -st.d[1], -st.d[2]], (pod ? 9 : 5.5) * fl * Math.max(0.5, ck));
        });
        mesh.instanceMatrix.needsUpdate = true;
      };
      place(miniMesh, minis, 1);
      place(podMesh, pods, 1);

      // 爆発
      let nfb = 0;
      const lights = [];
      const impacts = [];
      for (const X of exps) {
        const e = X.e;
        const a = t - e.t;
        if (a < 0) continue;
        if (e.type === 'ground' && a < 40) impacts.push(e);
        if (a > 30) continue;
        const s = e.size;
        const p = e.pos;
        // 光（煙を照らす）
        if (a < 1.6) lights.push({ p, i: 2.3 * s * Math.exp(-a * 3.5) * (e.type === 'split' ? 1.3 : 1), c: e.type === 'split' ? [0.8, 0.6, 1.0] : [1.0, 0.5, 0.65], d: camP.distanceTo(tmpP.set(...p)) });
        if (a < 0.3) add.add(p, 46 * s * (0.4 + a * 4), [1.0, 0.88, 0.96], 6 * Math.exp(-a * 18), 0);
        if (a < 1.0) add.add(p, 16 * s * (0.6 + a), [1.0, 0.42, 0.62], 2.2 * Math.exp(-a * 5), 0);
        if (a < 0.45) add.add(p, (8 + 170 * Math.sqrt(a)) * s, e.type === 'split' ? [0.5, 0.9, 1.0] : [0.8, 0.92, 1.0], 1.0 * Math.exp(-a * 7), 1, X.sparks[0].d.x * 3);
        if (e.type === 'split' && a < 0.6) add.add(p, (6 + 110 * Math.sqrt(a)) * s, [1.0, 0.35, 0.75], 2.4 * Math.exp(-a * 6), 1, 1.0);
        // 火球
        if (e.type !== 'split' && a < 1.0 && nfb < FB_MAX) {
          fbPos.set([p[0], p[1], p[2], (2.5 + 21 * (1 - Math.exp(-a * 6))) * s], nfb * 4);
          fbDat.set([a, e.seed, 0, 1], nfb * 4);
          nfb++;
        }
        // 火花
        if (a < 1.0) for (const sp of X.sparks) {
          if (a > sp.life) continue;
          const dist = sp.sp * (1 - Math.exp(-a * 3)) / 3;
          const vel = sp.sp * Math.exp(-a * 3);
          const q = [p[0] + sp.d.x * dist, p[1] + sp.d.y * dist, p[2] + sp.d.z * dist];
          const f = 1 - a / sp.life;
          const c = a < 0.15 ? [1, 0.95, 1] : [1.0, 0.45 + 0.3 * f, 0.7];
          add.add(q, sp.w * 3, c, 6 * f, 2, 0, [sp.d.x, sp.d.y, sp.d.z], Math.max(0.8, vel * 0.045));
        }
        // 残る煙の玉
        for (const pf of X.pf) {
          if (a > pf.life) continue;
          const dist = pf.sp * (1 - Math.exp(-a * 1.2)) / 1.2;
          const q = [p[0] + pf.d.x * dist + a * 1.6, p[1] + pf.d.y * dist + a * 0.35, p[2] + pf.d.z * dist - a * 0.8];
          const sz = (pf.s0 + (pf.s1 - pf.s0) * (1 - Math.exp(-a * 0.5))) * s;
          const al = Math.min(1, a * 6) * (1 - a / pf.life) * 0.85;
          const fire = Math.exp(-a * 4.5);
          const base = pf.dark ? [0.10, 0.09, 0.12] : [0.62, 0.62, 0.68];
          const c = [base[0] + 2.6 * fire, base[1] + 0.7 * fire, base[2] + 1.1 * fire];
          puffs.add(q, sz, c, al, 3, pf.rot + a * 0.1);
        }
      }
      fbGeo.instanceCount = nfb;
      fbGeo.attributes.iPos.needsUpdate = true; fbGeo.attributes.iDat.needsUpdate = true;
      fbMat.uniforms.uTime.value = t;

      // 戦闘機：アフターバーナー・ノズル・雲
      const J = jetState(sim.jet, t);
      const thr = J.thr;
      const abk = Math.max(0, (thr - 0.65) / 0.35);
      for (const m of [abMat, abMat2]) { m.uniforms.uThr.value = thr; m.uniforms.uTime.value = t; m.uniforms.uLen.value = 1.6 + 5.4 * abk; }
      ab.visible = thr > 0.3;
      jetModel.setGlow(thr);
      for (const nz of (jetModel.nozzles || [jetModel.nozzle])) {
        const nozW = new THREE.Vector3().copy(nz).applyMatrix4(jetModel.root.matrixWorld);
        add.add([nozW.x, nozW.y, nozW.z], (1.2 + 1.6 * abk) * (jetModel.nozzleR || 0.47) / 0.47, [1.0, 0.5, 0.85], 0.25 + 0.6 * abk, 0);
        lights.push({ p: [nozW.x, nozW.y, nozW.z], i: 0.5 * abk, c: [1.0, 0.45, 0.8], d: 0 });
      }
      const gk = Math.max(0, Math.min(1, (J.g - 6.5) / 5.5));
      vapMat.uniforms.uK.value = gk * 0.9; vapMat.uniforms.uTime.value = t; vapMat.uniforms.uSun.value.copy(sunDir);
      vapSheet.visible = gk > 0.01;
      // 急加速の円錐：推力が上がった直後
      const J2 = jetState(sim.jet, Math.max(0, t - 0.45));
      const burst = Math.max(0, Math.min(1, (thr - J2.thr) * 4)) * (J.speed > 200 ? 1 : 0.4);
      coneMat.uniforms.uK.value = burst; coneMat.uniforms.uTime.value = t; coneMat.uniforms.uSun.value.copy(sunDir);
      vcone.visible = burst > 0.01;

      // 翼端渦：過去 0.75 秒の翼端
      for (let w = 0; w < 2; w++) {
        for (let i = 0; i < TIP_N; i++) {
          const age = i * 0.75 / (TIP_N - 1);
          const S = jetState(sim.jet, Math.max(0, t - age));
          tmpQ.set(S.q[0], S.q[1], S.q[2], S.q[3]);
          const tip = jetModel.tips[w].clone().applyQuaternion(tmpQ).add(tmpP.set(...S.p));
          const toCam = tmpS.copy(camP).sub(tip).normalize();
          const vel = new THREE.Vector3(...S.v).normalize();
          const side = new THREE.Vector3().crossVectors(vel, toCam).normalize().multiplyScalar(0.06 + age * 0.5);
          const k = (w * TIP_N + i) * 2;
          tipPos.set([tip.x + side.x, tip.y + side.y, tip.z + side.z, tip.x - side.x, tip.y - side.y, tip.z - side.z], k * 3);
          const gA = Math.max(0, Math.min(1, (S.g - 4.5) / 4.5));
          const al = gA * (1 - age / 0.75) * Math.min(1, i / 3);
          tipA[k] = tipA[k + 1] = al;
        }
      }
      tipGeo.attributes.position.needsUpdate = true; tipGeo.attributes.aA.needsUpdate = true;

      // 空気の粒
      if (opts.dust) {
        const B = 160;
        const vel = opts.dustVel || new THREE.Vector3();
        const sp = vel.length();
        const vdir = sp > 1 ? vel.clone().multiplyScalar(-1 / sp) : new THREE.Vector3(0, 0, 1);
        for (const d of dustSeeds) {
          const q = [0, 1, 2].map((j) => { const c = camP.getComponent(j); const s = d[j] * B; return c + ((((s - c) % B) + B) % B) - B / 2; });
          const dist = Math.hypot(q[0] - camP.x, q[1] - camP.y, q[2] - camP.z);
          const f = Math.max(0, 1 - dist / (B * 0.5));
          add.add(q, 0.035 + d[3] * 0.04, [0.8, 0.9, 1.0], 0.9 * f * opts.dust, 2, 0, [vdir.x, vdir.y, vdir.z], 0.4 + sp * 0.012);
        }
      }

      add.end(); puffs.end();
      lights.sort((a, b) => b.i / (1 + b.d * 0.002) - a.i / (1 + a.d * 0.002));
      impacts.sort((a, b) => b.t - a.t);
      return { lights: lights.slice(0, 12), impacts: impacts.slice(0, 24), jet: J };
    },
    sortPuffs(cam) {
      // 煙の玉は奥から描く
      const n = puffs.n; if (n < 2) return;
      const ord = [...Array(n).keys()];
      const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
      const d = ord.map((i) => (puffs.pos[i * 3] - cx) ** 2 + (puffs.pos[i * 3 + 1] - cy) ** 2 + (puffs.pos[i * 3 + 2] - cz) ** 2);
      ord.sort((a, b) => d[b] - d[a]);
      const P = puffs.pos.slice(0, n * 3), C = puffs.col.slice(0, n * 4), Q = puffs.par.slice(0, n * 4);
      ord.forEach((src, i) => { puffs.pos.set(P.subarray(src * 3, src * 3 + 3), i * 3); puffs.col.set(C.subarray(src * 4, src * 4 + 4), i * 4); puffs.par.set(Q.subarray(src * 4, src * 4 + 4), i * 4); });
      puffs.end();
    },
  };
}

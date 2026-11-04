// 地形図の上の線：戦闘機の航路（空の道と地上の道）、ミサイル 100 本と母ミサイルの軌道、爆発の印。
// 線は画面の上で太さを決める帯（ribbon）。uReveal（シミュの秒）までを描き、先頭だけ明るい。
import * as THREE from '../vendor/three.module.js';
import { DT, PLANET_C, PLANET_R } from './sim.js';

const PC = new THREE.Vector3(...PLANET_C);
const COL = {
  jet: [1.0, 1.0, 1.0], track: [0.35, 0.85, 1.0],
  P: [1.0, 0.55, 0.85], C: [1.0, 0.24, 0.60], A: [1.0, 0.42, 0.72], B: [1.0, 0.62, 0.82], D: [0.72, 0.48, 1.0],
  E: [1.0, 0.62, 0.82], W: [0.72, 0.48, 1.0],
};

export function makeMapLines(sim) {
  const T = sim.terrain;
  const pos = [], nxt = [], prv = [], side = [], time = [], width = [], col = [], idx = [];
  let nv = 0;
  // 1 本の線（点の列と時刻）を帯にする
  const line = (pts, ts, w, c) => {
    const n = pts.length;
    if (n < 2) return;
    const b = nv;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[Math.min(n - 1, i + 1)], r = pts[Math.max(0, i - 1)];
      for (const sd of [-1, 1]) {
        pos.push(p[0], p[1], p[2]); nxt.push(q[0], q[1], q[2]); prv.push(r[0], r[1], r[2]);
        side.push(sd); time.push(ts[i]); width.push(w); col.push(c[0], c[1], c[2]);
      }
      if (i < n - 1) { const a = b + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    nv += n * 2;
  };
  // 戦闘機：空の道と、地形に落とした地上の道
  {
    const J = sim.jet, pts = [], gp = [], ts = [];
    for (let i = 0; i < J.n; i += 4) {
      const p = [J.pos[i * 3], J.pos[i * 3 + 1], J.pos[i * 3 + 2]];
      pts.push(p); ts.push(i * DT);
      const n = new THREE.Vector3(...p).sub(PC).normalize();
      const g = PC.clone().addScaledVector(n, PLANET_R + T.heightAt(n.x * PLANET_R, n.z * PLANET_R) + 3);
      gp.push([g.x, g.y, g.z]);
    }
    line(gp, ts, 1.6, COL.track);
    line(pts, ts, 3.2, COL.jet);
  }
  // ミサイル
  for (const m of sim.missiles) {
    const n = m.hist.length / 3, pts = [], ts = [];
    for (let k = 0; k < n; k += 4) { pts.push([m.hist[k * 3], m.hist[k * 3 + 1], m.hist[k * 3 + 2]]); ts.push((m.birth + k) * DT); }
    pts.push([m.hist[n * 3 - 3], m.hist[n * 3 - 2], m.hist[n * 3 - 1]]); ts.push(m.death * DT);
    line(pts, ts, m.kind === 'pod' ? 2.6 : 1.25, COL[m.cls] || COL.C);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aNext', new THREE.Float32BufferAttribute(nxt, 3));
  g.setAttribute('aPrev', new THREE.Float32BufferAttribute(prv, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute('aTime', new THREE.Float32BufferAttribute(time, 1));
  g.setAttribute('aWidth', new THREE.Float32BufferAttribute(width, 1));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  // 帯の三角形は線の向きで裏返るので両面で描く
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uReveal: { value: 0 }, uRes: { value: new THREE.Vector2(1920, 1080) }, uAlpha: { value: 1 }, uPx: { value: 1 } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec3 aNext, aPrev, aCol; attribute float aSide, aTime, aWidth;
      uniform vec2 uRes; uniform float uPx;
      varying vec3 vCol; varying float vTime, vSide;
      void main(){
        vec4 c = projectionMatrix*viewMatrix*vec4(position, 1.0);
        vec4 n = projectionMatrix*viewMatrix*vec4(aNext, 1.0);
        vec4 p = projectionMatrix*viewMatrix*vec4(aPrev, 1.0);
        vec2 sc = c.xy/c.w*uRes, sn = n.xy/n.w*uRes, sp = p.xy/p.w*uRes;
        vec2 d = sn - sp; if (dot(d, d) < 1e-6) d = vec2(1.0, 0.0);
        d = normalize(d);
        vec2 off = vec2(-d.y, d.x)*aSide*aWidth*uPx;
        gl_Position = c; gl_Position.xy += off/uRes*c.w;
        vCol = aCol; vTime = aTime; vSide = aSide;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uReveal, uAlpha;
      varying vec3 vCol; varying float vTime, vSide;
      void main(){
        #include <logdepthbuf_fragment>
        if (vTime > uReveal) discard;
        float age = uReveal - vTime;
        float edge = 1.0 - vSide*vSide*0.0;
        float head = exp(-age*2.2);
        vec3 c = vCol*(0.55 + 1.6*head) + vec3(1.0)*head*0.8;
        gl_FragColor = vec4(c*uAlpha*edge, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 40;

  // 爆発の印（輪）と、戦闘機の今の位置の点
  const ex = sim.explosions.filter((e) => e.type !== 'split');
  const mpos = new Float32Array((ex.length + 1) * 3), mt = new Float32Array(ex.length + 1), mk = new Float32Array(ex.length + 1);
  ex.forEach((e, i) => { mpos.set(e.pos, i * 3); mt[i] = e.t; mk[i] = e.type === 'ground' ? 1 : 0; });
  mk[ex.length] = 2;
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.BufferAttribute(mpos, 3).setUsage(THREE.DynamicDrawUsage));
  mg.setAttribute('aTime', new THREE.BufferAttribute(mt, 1));
  mg.setAttribute('aKind', new THREE.BufferAttribute(mk, 1));
  const mmat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uReveal: { value: 0 }, uPx: { value: 1 }, uAlpha: { value: 1 } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float aTime, aKind; uniform float uReveal, uPx; varying float vAge, vKind;
      void main(){
        vAge = uReveal - aTime; vKind = aKind;
        gl_Position = projectionMatrix*viewMatrix*vec4(position, 1.0);
        gl_PointSize = (aKind > 1.5 ? 14.0 : 7.0 + 12.0*exp(-max(vAge, 0.0)*3.0))*uPx;
        if (aKind < 1.5 && vAge < 0.0) gl_PointSize = 0.0;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uAlpha; varying float vAge, vKind;
      void main(){
        #include <logdepthbuf_fragment>
        if (vKind < 1.5 && vAge < 0.0) discard;
        vec2 q = gl_PointCoord*2.0 - 1.0; float r = length(q);
        vec3 c;
        if (vKind > 1.5) { c = vec3(1.0)*(exp(-r*r*6.0)*1.6 + smoothstep(1.0, 0.8, r)*smoothstep(0.6, 0.75, r)*0.8); }
        else {
          float ring = smoothstep(1.0, 0.82, r)*smoothstep(0.55, 0.72, r);
          vec3 base = vKind > 0.5 ? vec3(1.0, 0.75, 0.45) : vec3(1.0, 0.35, 0.68);
          c = base*(ring*(0.45 + 1.0*exp(-vAge*2.5)) + exp(-r*r*8.0)*exp(-vAge*4.0)*0.8);
        }
        gl_FragColor = vec4(c*uAlpha, 1.0);
      }`,
  });
  const marks = new THREE.Points(mg, mmat);
  marks.frustumCulled = false; marks.renderOrder = 41;

  const group = new THREE.Group();
  group.add(mesh, marks);
  group.visible = false;
  return {
    group,
    update(reveal, px, W, H, alpha = 1) {
      mat.uniforms.uReveal.value = reveal; mat.uniforms.uRes.value.set(W, H); mat.uniforms.uPx.value = px; mat.uniforms.uAlpha.value = alpha;
      mmat.uniforms.uReveal.value = reveal; mmat.uniforms.uPx.value = px; mmat.uniforms.uAlpha.value = alpha;
      // 戦闘機の今の点
      const J = sim.jet; const i = Math.min(J.n - 1, Math.max(0, Math.round(reveal / DT)));
      mpos.set([J.pos[i * 3], J.pos[i * 3 + 1], J.pos[i * 3 + 2]], ex.length * 3);
      mg.attributes.position.needsUpdate = true;
    },
  };
}

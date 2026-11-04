// Procedural airframe kit: build smooth, organic aircraft from a few tables of numbers.
// Body axes: nose +Z, up +Y, left wing +X. Units: metres.
//
//   loft(stations)   a body from cross-sections (superellipses), Catmull-Rom between stations
//   foil(stations)   a wing / fin with curved leading and trailing edges and a NACA-like section
//   surface(...)     a straight-edged (trapezoid) wing, for conventional aircraft
//   mirrorX, merge   left/right copies and one geometry per material
//   paint(geo, fn)   vertex colours from position and normal (two-tone, stripes, markings)
//   makeCockpit / makePilot   the interior and the head, placed from the eye point
import * as THREE from 'three';

const CR = (a, b, c, d, u) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);

// Interpolate a list of stations (objects of numbers or [x,y,z] arrays) with Catmull-Rom, `sub` steps per gap
function spline(stations, keys, sub) {
  const out = [];
  const val = (s, k) => s[k] ?? 0;
  for (let i = 0; i < stations.length - 1; i++) {
    const p0 = stations[Math.max(0, i - 1)], p1 = stations[i], p2 = stations[i + 1], p3 = stations[Math.min(stations.length - 1, i + 2)];
    for (let k = 0; k < sub; k++) {
      const u = k / sub, o = {};
      for (const key of keys) {
        const a = val(p0, key), b = val(p1, key), c = val(p2, key), d = val(p3, key);
        if (Array.isArray(b)) o[key] = [0, 1, 2].map((j) => CR(a[j], b[j], c[j], d[j], u));
        else o[key] = CR(a, b, c, d, u);
      }
      out.push(o);
    }
  }
  const last = stations[stations.length - 1], o = {};
  for (const key of keys) o[key] = Array.isArray(last[key]) ? last[key].slice() : (last[key] ?? 0);
  out.push(o);
  return out;
}

/**
 * Body of revolution-ish: each station is a superellipse cross-section.
 * station: { z, w (half width), top, bot (heights above/below cy), n (2 = ellipse, larger = boxier), cy (centre height), cx }
 */
export function loft(stations, M = 48, sub = 5) {
  const S = spline(stations, ['z', 'w', 'top', 'bot', 'n', 'cy', 'cx'], sub);
  const pos = [], idx = [];
  for (const s of S) {
    for (let j = 0; j < M; j++) {
      const th = (j / M) * Math.PI * 2;
      const c = Math.cos(th), sn = Math.sin(th);
      const e = 2 / Math.max(1.2, s.n);
      const x = (s.cx ?? 0) + s.w * Math.sign(c) * Math.pow(Math.abs(c), e);
      const y = (s.cy ?? 0) + (sn >= 0 ? s.top : s.bot) * Math.sign(sn) * Math.pow(Math.abs(sn), e);
      pos.push(x, y, s.z);
    }
  }
  for (let i = 0; i < S.length - 1; i++) for (let j = 0; j < M; j++) {
    const a = i * M + j, b = i * M + ((j + 1) % M), c = (i + 1) * M + j, d = (i + 1) * M + ((j + 1) % M);
    idx.push(a, c, b, b, c, d);
  }
  const f = S[0], l = S[S.length - 1];
  const capF = pos.length / 3; pos.push(f.cx ?? 0, f.cy ?? 0, f.z);
  const capB = pos.length / 3; pos.push(l.cx ?? 0, l.cy ?? 0, l.z);
  const base = (S.length - 1) * M;
  for (let j = 0; j < M; j++) { idx.push(capF, j, (j + 1) % M); idx.push(capB, base + ((j + 1) % M), base + j); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  orientOutward(g); // whichever way the stations run, faces point out
  g.computeVertexNormals();
  return g;
}

// Half thickness of a NACA 4-digit section at chord fraction x, thickness ratio t
export const naca = (x, t) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);

/**
 * Wing or fin with curved edges. Stations go from root to tip.
 * station: { le: [x,y,z], te: [x,y,z], t: thickness ratio, n: [x,y,z] thickness direction (optional, default `axis`) }
 * The tip is closed; a tip with ~zero chord makes a pointed (sickle) tip.
 */
export function foil(stations, { axis = [0, 1, 0], chord = 18, sub = 6 } = {}) {
  const S = spline(stations.map((s) => ({ ...s, n: s.n || axis, t: s.t ?? 0.08 })), ['le', 'te', 't', 'n'], sub);
  const pos = [], idx = [];
  const C = chord, ring = 2 * C;
  const xs = []; for (let k = 0; k < C; k++) xs.push(0.5 - 0.5 * Math.cos((k / (C - 1)) * Math.PI));
  const LE = new THREE.Vector3(), TE = new THREE.Vector3(), N = new THREE.Vector3(), P = new THREE.Vector3();
  for (const s of S) {
    LE.fromArray(s.le); TE.fromArray(s.te); N.fromArray(s.n).normalize();
    const ch = LE.distanceTo(TE);
    for (let k = 0; k < C; k++) { const x = xs[k]; P.copy(LE).lerp(TE, x).addScaledVector(N, naca(Math.max(x, 1e-4), s.t) * ch); pos.push(P.x, P.y, P.z); }
    for (let k = C - 1; k >= 0; k--) { const x = xs[k]; P.copy(LE).lerp(TE, x).addScaledVector(N, -naca(Math.max(x, 1e-4), s.t) * ch); pos.push(P.x, P.y, P.z); }
  }
  for (let s = 0; s < S.length - 1; s++) for (let k = 0; k < ring; k++) {
    const a = s * ring + k, b = s * ring + ((k + 1) % ring), c = (s + 1) * ring + k, d = (s + 1) * ring + ((k + 1) % ring);
    idx.push(a, c, b, b, c, d);
  }
  const tip = (S.length - 1) * ring;
  for (let k = 1; k < C - 1; k++) { idx.push(tip + k, tip + ring - 1 - k, tip + k + 1); idx.push(tip + k + 1, tip + ring - 1 - k, tip + ring - 2 - k); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  orientOutward(g);
  g.computeVertexNormals();
  return g;
}

// Straight-edged wing from root/tip leading and trailing edge points
export function surface({ rLE, rTE, tLE, tTE, axis, tR = 0.045, tT = 0.035, span = 8, chord = 18 }) {
  const st = [];
  for (let s = 0; s <= span; s++) {
    const u = s / span, L = (a, b) => [0, 1, 2].map((j) => a[j] + (b[j] - a[j]) * u);
    st.push({ le: L(rLE, tLE), te: L(rTE, tTE), t: tR + (tT - tR) * u });
  }
  return foil(st, { axis, chord, sub: 1 });
}

// Flip the triangle winding when the surface came out inside-out (signed volume < 0)
function orientOutward(g) {
  const p = g.attributes.position.array, ix = g.index.array;
  let vol = 0;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
    vol += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  if (vol < 0) for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
}

export const mirrorX = (g) => {
  const m = g.clone();
  m.scale(-1, 1, 1);
  const ix = m.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  m.computeVertexNormals();
  return m;
};

export function merge(geos) {
  let n = 0; const pos = [], nor = [], col = [], idx = [];
  const hasCol = geos.some((g) => g.attributes.color);
  for (const g of geos) {
    const gi = g.index ? g : g.toNonIndexed();
    const p = gi.attributes.position.array, q = gi.attributes.normal.array, c = gi.attributes.color?.array;
    for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(q[i]); if (hasCol) col.push(c ? c[i] : 1); }
    if (gi.index) for (const k of gi.index.array) idx.push(k + n); else for (let k = 0; k < p.length / 3; k++) idx.push(k + n);
    n += p.length / 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (hasCol) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// Vertex colours from fn(position: Vector3, normal: Vector3) -> [r, g, b] (linear 0..1)
export function paint(g, fn) {
  const p = g.attributes.position, n = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    P.fromBufferAttribute(p, i); N.fromBufferAttribute(n, i);
    col.set(fn(P, N), i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export const hex = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; }; // sRGB hex -> linear rgb
export const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Glossy painted skin (vertex colours) — the organic, wet-looking finish
export function skinMaterial(envMap, o = {}) {
  return new THREE.MeshPhysicalMaterial({
    vertexColors: true, color: 0xffffff, metalness: o.metalness ?? 0.25, roughness: o.roughness ?? 0.32,
    clearcoat: o.clearcoat ?? 0.8, clearcoatRoughness: o.clearcoatRoughness ?? 0.12,
    envMap: envMap || null, envMapIntensity: o.envMapIntensity ?? 1.0,
  });
}
export function glassMaterial(envMap, tint = 0x203040, opacity = 0.42) {
  return new THREE.MeshPhysicalMaterial({ color: tint, metalness: 0.0, roughness: 0.03, transparent: true, opacity, envMap: envMap || null, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.02, side: THREE.DoubleSide, depthWrite: false });
}

// Pilot (helmet, visor, shoulders) and seat, placed from the eye point
export function makePilot(eye, envMap, suit = 0x3b4a32) {
  const pilot = new THREE.Group();
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 16), new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.35, envMap: envMap || null }));
  helmet.position.set(eye.x, eye.y - 0.01, eye.z - 0.04);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.153, 24, 16, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.35, Math.PI * 0.32), new THREE.MeshStandardMaterial({ color: 0x221a10, roughness: 0.08, metalness: 0.8, envMap: envMap || null, envMapIntensity: 2 }));
  visor.position.copy(helmet.position);
  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.3), new THREE.MeshStandardMaterial({ color: suit, roughness: 0.8 }));
  shoulders.position.set(eye.x, eye.y - 0.27, eye.z - 0.11);
  pilot.add(helmet, visor, shoulders);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.7, 0.14), new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.7 }));
  seat.position.set(eye.x, eye.y - 0.21, eye.z - 0.33); seat.rotation.x = -0.3;
  return { pilot, seat };
}

// Instrument coaming, panel, two MFDs and the HUD combiner, placed from the eye point (seen only from inside)
export function makeCockpit(eye, glow = 0x46ffb0) {
  const cockpit = new THREE.Group();
  const at = (o, dx, dy, dz) => { o.position.set(eye.x + dx, eye.y + dy, eye.z + dz); return o; };
  const coaming = at(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.85, metalness: 0.2 })), 0, -0.39, 1.2);
  coaming.scale.set(0.40, 0.11, 0.42);
  const panel = at(new THREE.Mesh(new THREE.PlaneGeometry(0.80, 0.30), new THREE.MeshStandardMaterial({ color: 0x0c0e10, roughness: 0.9 })), 0, -0.47, 0.89);
  panel.rotation.x = -0.35 + Math.PI; panel.rotation.y = Math.PI;
  const mfdMat = new THREE.MeshBasicMaterial({ color: glow });
  for (const sx of [-0.24, 0.24]) { const s = at(new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.15), mfdMat), sx, -0.46, 0.87); s.rotation.x = 0.35; s.rotation.y = Math.PI; cockpit.add(s); }
  const hudGlass = at(new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.17), new THREE.MeshBasicMaterial({ color: 0x5affc8, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide })), 0, -0.13, 1.04);
  hudGlass.rotation.x = -0.25;
  const postMat = new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.6 });
  for (const sx of [-0.11, 0.11]) { const p = at(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.17, 0.012), postMat), sx, -0.20, 1.04); p.rotation.x = -0.25; cockpit.add(p); }
  cockpit.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.035, 0.07), postMat), 0, -0.29, 1.06));
  cockpit.add(coaming, panel, hudGlass);
  return cockpit;
}

// Engine nozzle: a short open cone and the glowing disc inside it (z0 = exit plane, facing -Z)
export function makeNozzle({ x = 0, y = 0, z0, r, len = 0.8, flare = 1.15, envMap, color = 0x4a4644 }) {
  const g = new THREE.CylinderGeometry(r, r * flare, len, 36, 1, true);
  g.rotateX(Math.PI / 2);
  const noz = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.38, envMap: envMap || null, side: THREE.DoubleSide }));
  noz.position.set(x, y, z0 + len / 2 - 0.05);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(r * 0.98, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  glow.rotation.y = Math.PI; glow.position.set(x, y, z0 + len * 0.6);
  return { noz, glow, exit: new THREE.Vector3(x, y, z0 - 0.5) };
}

/**
 * Wrap meshes into the common aircraft interface used by the renderer and the camera director.
 * extra: { tips, stabTips, eye, nozzles: [{noz, glow, exit}], nozzleR, wingVapor, length, glowColor,
 *          panoramic (true: a wrap-around display cockpit — setPOV(true) also hides the airframe) }
 */
export function assemble({ body, canopy, frame = [], pilot, seat, cockpit, nozzles, nozzleR, tips, stabTips, eye, wingVapor, length, glowColor = [1.0, 0.55, 0.75], name, panoramic = false }) {
  const root = new THREE.Group();
  root.add(body);
  if (canopy) root.add(canopy);
  for (const f of frame) root.add(f);
  root.add(pilot, seat, cockpit);
  for (const n of nozzles) root.add(n.noz, n.glow);
  root.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; } });
  const hidePOV = [canopy, ...frame].filter(Boolean);
  return {
    name, root, body, canopy, pilot, cockpit, seat,
    nozIn: nozzles[0].glow,
    nozzles: nozzles.map((n) => n.exit),
    nozzle: nozzles[0].exit,
    nozzleR: nozzleR ?? nozzles[0].noz.geometry.parameters?.radiusTop ?? 0.4,
    tips, stabTips: stabTips || tips, eye, wingVapor, length, panoramic,
    // panoramic: the cockpit is a wrap-around display, so from inside the airframe is not drawn at all
    setPOV(on, back) { pilot.visible = !on; seat.visible = !back; for (const o of hidePOV) o.visible = !on; if (panoramic) body.visible = !on; },
    setGlow(thr) { const k = 0.6 + thr * 3.5; for (const n of nozzles) n.glow.material.color.setRGB(glowColor[0] * k, glowColor[1] * k, glowColor[2] * k); },
  };
}

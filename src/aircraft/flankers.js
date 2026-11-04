// Twin-engine, twin-fin fighters of the Sukhoi / Mikoyan layout, from one parametric builder:
// long nose with a raised cockpit, long ogival LERX into a swept wing, two engine nacelles spaced apart
// under a flat centre body, fins on top of the nacelles, tailplanes beside them, a tail boom between nozzles.
//   Su-37  ~22.2 m long, ~14.7 m span, canards, sand/brown splinter camouflage
//   MiG-29 ~17.3 m long, ~11.4 m span, slightly canted fins, grey-blue two-tone
// Nose +Z, up +Y, left wing +X.
import * as THREE from 'three';
import { loft, foil, mirrorX, merge, paint, hex, mix3, smooth, skinMaterial, glassMaterial, makePilot, makeCockpit, makeNozzle, assemble } from './kit.js';

function buildTwin(envMap, P) {
  const k = P.scale; // the Su-37 numbers below are scaled for the MiG-29
  const S = (a) => a.map((s) => ({ ...s, z: s.z * k, w: s.w * k, top: s.top * k, bot: s.bot * k, cy: (s.cy ?? 0) * k, cx: (s.cx ?? 0) * k }));
  const V = (v) => v.map((x) => x * k);
  // forward fuselage → cockpit hump → flat centre body → tail boom
  const fus = loft(S([
    { z: 11.1, w: 0.02, top: 0.02, bot: 0.02, n: 2, cy: 0.0 },
    { z: 10.4, w: 0.26, top: 0.26, bot: 0.26, n: 2, cy: 0.02 },
    { z: 9.0, w: 0.48, top: 0.48, bot: 0.48, n: 2, cy: 0.05 },
    { z: 7.6, w: 0.62, top: 0.62, bot: 0.58, n: 2.1, cy: 0.08 },
    { z: 6.2, w: 0.72, top: 0.80, bot: 0.62, n: 2.2, cy: 0.12 },
    { z: 4.8, w: 0.80, top: 0.86, bot: 0.62, n: 2.4, cy: 0.16 },
    { z: 3.4, w: 0.92, top: 0.70, bot: 0.55, n: 2.8, cy: 0.20 },
    { z: 1.8, w: 1.20, top: 0.56, bot: 0.40, n: 3.4, cy: 0.24 },
    { z: -1.0, w: 1.40, top: 0.50, bot: 0.32, n: 3.8, cy: 0.26 },
    { z: -4.5, w: 1.30, top: 0.46, bot: 0.30, n: 3.8, cy: 0.26 },
    { z: -7.2, w: 0.70, top: 0.34, bot: 0.26, n: 3.0, cy: 0.24 },
    { z: -9.6, w: 0.34, top: 0.24, bot: 0.20, n: 2.4, cy: 0.22 },
    { z: -10.9 * P.boom, w: 0.20, top: 0.16, bot: 0.14, n: 2.2, cy: 0.22 },
  ]), 56, 5);
  // engine nacelles with rectangular intakes under the LERX
  const nac = loft(S([
    { z: 2.0, w: 0.50, top: 0.50, bot: 0.46, n: 5.0, cx: 1.20, cy: -0.36 },
    { z: 0.6, w: 0.56, top: 0.54, bot: 0.50, n: 4.2, cx: 1.20, cy: -0.36 },
    { z: -3.0, w: 0.60, top: 0.56, bot: 0.54, n: 3.2, cx: 1.18, cy: -0.30 },
    { z: -6.8, w: 0.58, top: 0.56, bot: 0.56, n: 2.4, cx: 1.16, cy: -0.24 },
    { z: -8.9, w: 0.54, top: 0.54, bot: 0.54, n: 2.0, cx: 1.15, cy: -0.22 },
  ]), 36, 5);
  // LERX blending into the wing
  const lerx = foil([
    { le: V([0.70, 0.30, 6.6]), te: V([0.70, 0.30, 0.6]), t: 0.05 },
    { le: V([1.40, 0.24, 3.6]), te: V([1.40, 0.24, 0.3]), t: 0.05 },
    { le: V([2.30, 0.18, 1.4]), te: V([2.30, 0.18, 0.0]), t: 0.05 },
  ], { axis: [0, 1, 0], chord: 16, sub: 4 });
  const wing = foil([
    { le: V([2.10, 0.20, 1.5]), te: V([2.10, 0.20, -4.6]), t: 0.05 },
    { le: V([4.80, 0.12, -1.9]), te: V([4.80, 0.12, -5.1]), t: 0.04 },
    { le: V([7.35, 0.04, -4.1]), te: V([7.35, 0.04, -5.4]), t: 0.035 },
  ], { axis: [0, 1, 0], chord: 20, sub: 3 });
  const stab = foil([
    { le: V([1.80, -0.20, -6.3]), te: V([1.80, -0.20, -9.3]), t: 0.04 },
    { le: V([3.20, -0.20, -7.6]), te: V([3.20, -0.20, -9.6]), t: 0.035 },
    { le: V([4.70, -0.20, -8.9]), te: V([4.70, -0.20, -9.9]), t: 0.03 },
  ], { axis: [0, 1, 0], chord: 16, sub: 3 });
  const cA = P.cant * Math.PI / 180;
  const fp = (h, z) => V([2.0 + Math.sin(cA) * h, 0.32 + Math.cos(cA) * h, z]);
  const fin = foil([
    { le: fp(0, -4.4), te: fp(0, -8.5), t: 0.045 },
    { le: fp(1.8, -6.2), te: fp(1.8, -8.85), t: 0.04 },
    { le: fp(3.6, -7.9), te: fp(3.6, -9.15), t: 0.035 },
  ], { axis: [Math.cos(cA), -Math.sin(cA), 0], chord: 16, sub: 3 });
  const ventral = foil([
    { le: V([1.55, -0.78, -4.4]), te: V([1.55, -0.78, -6.2]), t: 0.05 },
    { le: V([1.75, -1.55, -5.4]), te: V([1.75, -1.55, -6.3]), t: 0.04 },
  ], { axis: [0.97, 0.24, 0], chord: 12, sub: 3 });
  const parts = [fus, nac, mirrorX(nac), lerx, mirrorX(lerx), wing, mirrorX(wing), stab, mirrorX(stab), fin, mirrorX(fin), ventral, mirrorX(ventral)];
  if (P.canards) {
    const can = foil([
      { le: V([1.0, 0.32, 6.2]), te: V([1.0, 0.32, 4.9]), t: 0.04 },
      { le: V([2.9, 0.36, 4.7]), te: V([2.9, 0.36, 4.1]), t: 0.035 },
    ], { axis: [0, 1, 0], chord: 14, sub: 3 });
    parts.push(can, mirrorX(can));
  }
  const airframe = merge(parts);
  paint(airframe, (p, n) => P.paint(p.clone().multiplyScalar(1 / k), n));
  const body = new THREE.Mesh(airframe, skinMaterial(envMap, { metalness: 0.22, roughness: 0.55, clearcoat: 0.2, clearcoatRoughness: 0.4 }));
  body.castShadow = true; body.receiveShadow = true;
  const mouthMat = new THREE.MeshBasicMaterial({ color: 0x050608, side: THREE.DoubleSide });
  for (const sx of [1, -1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.0 * k, 0.94 * k), mouthMat); m.position.set(1.2 * k * sx, -0.36 * k, 2.01 * k); body.add(m); }

  const canopy = new THREE.Mesh(loft(S([
    { z: 7.5, w: 0.03, top: 0.02, bot: 0.0, n: 2, cy: 0.72 },
    { z: 7.0, w: 0.40, top: 0.26, bot: 0.0, n: 2, cy: 0.78 },
    { z: 6.2, w: 0.54, top: 0.42, bot: 0.0, n: 2, cy: 0.84 },
    { z: 5.2, w: 0.56, top: 0.44, bot: 0.0, n: 2, cy: 0.88 },
    { z: 4.3, w: 0.46, top: 0.30, bot: 0.0, n: 2, cy: 0.90 },
    { z: 3.8, w: 0.10, top: 0.04, bot: 0.0, n: 2, cy: 0.88 },
  ]), 40, 5), glassMaterial(envMap, 0x30404a, 0.4));
  canopy.renderOrder = 3;
  const eye = new THREE.Vector3(0, 1.16 * k, 5.9 * k);
  const { pilot, seat } = makePilot(eye, envMap);
  const cockpit = makeCockpit(eye);
  const nozzles = [1, -1].map((sx) => makeNozzle({ x: 1.15 * k * sx, y: -0.22 * k, z0: -8.9 * k, r: 0.5 * k, len: 0.8 * k, flare: 1.08, envMap, color: 0x3c3a38 }));
  return assemble({
    name: P.name, body, canopy, pilot, seat, cockpit, nozzles,
    tips: [new THREE.Vector3(...V([7.35, 0.04, -4.8])), new THREE.Vector3(...V([-7.35, 0.04, -4.8]))],
    stabTips: [new THREE.Vector3(...V([4.7, -0.2, -9.4])), new THREE.Vector3(...V([-4.7, -0.2, -9.4]))],
    eye, length: 22.2 * k,
    wingVapor: { x: V([2.3, 6.8]), le: V([1.2, -3.5]), te: V([-4.5, -5.3]), y: V([0.22, 0.06]) },
  });
}

// Su-37: sand and brown splinter camouflage, light underside
const SAND = hex(0xb79f78), BROWN = hex(0x7b5f45), UNDER = hex(0xc6ccd0), RAD = hex(0xd8dcd6);
const splinter = (x, z) => { const a = Math.sin(x * 0.55 + z * 0.42) + Math.sin(z * 0.31 - x * 0.83 + 2.1) + 0.5 * Math.sin(x * 1.3 - z * 0.9); return a; };
export function buildSu37(envMap) {
  return buildTwin(envMap, {
    name: 'su37', scale: 1, boom: 1, cant: 0, canards: true,
    paint: (p, n) => {
      if (p.z > 9.6) return RAD;
      let c = splinter(p.x, p.z) > 0.25 ? BROWN : SAND;
      return mix3(UNDER, c, smooth(-0.5, 0.15, n.y + 0.4 * (p.y - 0.1)));
    },
  });
}

// MiG-29: light grey with grey-blue patches, white radome
const GREY = hex(0xa8b3ba), BLUE = hex(0x7a8a98), BELLY = hex(0xc4ccd2), WHITE = hex(0xe2e6e8);
export function buildMiG29(envMap) {
  return buildTwin(envMap, {
    name: 'mig29', scale: 0.78, boom: 0.86, cant: 6, canards: false,
    paint: (p, n) => {
      if (p.z > 9.6) return WHITE;
      const c = splinter(p.x + 3.1, p.z - 1.7) > 0.45 ? BLUE : GREY;
      return mix3(BELLY, c, smooth(-0.5, 0.15, n.y + 0.4 * (p.y - 0.1)));
    },
  });
}

// F-22A Raptor. Nose +Z, up +Y, left wing +X. ~18.9 m long, ~13.6 m span.
// Chined forebody, caret intakes on the sides feeding wide engine trunks, diamond wing (42° leading edge,
// forward-swept trailing edge), large tailplanes, twin fins canted 28°, rectangular 2-D nozzles,
// gold-tinted canopy. Two greys.
import * as THREE from 'three';
import { loft, foil, mirrorX, merge, paint, hex, mix3, smooth, skinMaterial, glassMaterial, makePilot, makeCockpit, assemble } from './kit.js';

const BASE = hex(0x737b82), PATCH = hex(0x5d646b), EDGE = hex(0x50565c), BLACK = hex(0x08090b);

export function buildF22(envMap) {
  // forebody with chines (wider than tall, sharp sides)
  const fore = loft([
    { z: 9.45, w: 0.02, top: 0.015, bot: 0.015, n: 2.4, cy: -0.10 },
    { z: 8.9, w: 0.30, top: 0.16, bot: 0.16, n: 3.0, cy: -0.10 },
    { z: 7.9, w: 0.60, top: 0.34, bot: 0.32, n: 3.4, cy: -0.07 },
    { z: 6.8, w: 0.80, top: 0.48, bot: 0.42, n: 3.6, cy: -0.04 },
    { z: 5.6, w: 0.94, top: 0.56, bot: 0.48, n: 3.8, cy: -0.02 },
    { z: 4.2, w: 1.02, top: 0.58, bot: 0.50, n: 4.0, cy: 0.0 },
    { z: 2.6, w: 1.08, top: 0.56, bot: 0.50, n: 4.2, cy: 0.0 },
    { z: 0.0, w: 1.10, top: 0.50, bot: 0.46, n: 4.4, cy: 0.0 },
    { z: -3.0, w: 1.12, top: 0.44, bot: 0.42, n: 4.6, cy: 0.0 },
    { z: -6.0, w: 1.10, top: 0.38, bot: 0.38, n: 4.6, cy: 0.0 },
    { z: -7.9, w: 1.06, top: 0.30, bot: 0.30, n: 4.4, cy: 0.0 },
    { z: -8.5, w: 0.20, top: 0.18, bot: 0.18, n: 3.0, cy: 0.0 },
  ], 64, 5);
  // engine trunks from the caret intakes on the sides
  const trunk = loft([
    { z: 4.35, w: 0.48, top: 0.50, bot: 0.50, n: 4.5, cx: 1.30, cy: -0.10 },
    { z: 3.4, w: 0.56, top: 0.56, bot: 0.54, n: 4.2, cx: 1.32, cy: -0.08 },
    { z: 0.5, w: 0.60, top: 0.56, bot: 0.54, n: 4.0, cx: 1.28, cy: -0.04 },
    { z: -3.0, w: 0.60, top: 0.52, bot: 0.50, n: 4.0, cx: 1.10, cy: 0.0 },
    { z: -6.2, w: 0.56, top: 0.44, bot: 0.44, n: 4.4, cx: 0.86, cy: 0.0 },
    { z: -8.3, w: 0.52, top: 0.36, bot: 0.36, n: 5.0, cx: 0.66, cy: 0.0 },
    { z: -8.75, w: 0.50, top: 0.32, bot: 0.32, n: 5.5, cx: 0.64, cy: 0.0 },
  ], 36, 5);
  // diamond wing
  const wing = foil([
    { le: [1.80, 0.0, 2.1], te: [1.80, 0.0, -6.2], t: 0.045 },
    { le: [3.40, -0.04, 0.68], te: [3.40, -0.04, -5.55], t: 0.04 },
    { le: [5.20, -0.08, -1.0], te: [5.20, -0.08, -4.80], t: 0.035 },
    { le: [6.78, -0.12, -2.55], te: [6.78, -0.12, -4.05], t: 0.03 },
  ], { axis: [0, 1, 0], chord: 22, sub: 3 });
  // tailplanes
  const stab = foil([
    { le: [1.30, -0.02, -6.15], te: [1.30, -0.02, -9.05], t: 0.04 },
    { le: [3.00, -0.04, -7.30], te: [3.00, -0.04, -9.25], t: 0.035 },
    { le: [4.40, -0.06, -8.40], te: [4.40, -0.06, -9.45], t: 0.03 },
  ], { axis: [0, 1, 0], chord: 18, sub: 3 });
  // twin fins canted 28° outward
  const cA = 28 * Math.PI / 180;
  const finPt = (r, h, z) => [1.18 + Math.sin(cA) * h, 0.42 + Math.cos(cA) * h, z];
  const fin = foil([
    { le: finPt(0, 0, -3.85), te: finPt(0, 0, -7.10), t: 0.045 },
    { le: finPt(0, 1.2, -5.0), te: finPt(0, 1.2, -7.20), t: 0.04 },
    { le: finPt(0, 2.45, -6.15), te: finPt(0, 2.45, -7.35), t: 0.035 },
  ], { axis: [Math.cos(cA), -Math.sin(cA), 0], chord: 16, sub: 3 });

  const airframe = merge([fore, trunk, mirrorX(trunk), wing, mirrorX(wing), stab, mirrorX(stab), fin, mirrorX(fin)]);
  // greys: patches from a smooth pseudo-noise, darker edges on the wings
  const patch = (x, z) => Math.sin(x * 0.9 + z * 0.35) + Math.sin(z * 0.7 - x * 0.5 + 1.7) + 0.6 * Math.sin(x * 1.7 + z * 1.3);
  paint(airframe, (P, N) => {
    let c = mix3(BASE, PATCH, smooth(0.4, 0.8, patch(P.x, P.z)));
    if (Math.abs(N.y) > 0.5 && Math.abs(P.x) > 2.0) { // leading-edge band
      const le = 2.1 - (Math.abs(P.x) - 1.8) * 0.9;
      if (P.z > le - 0.35 && Math.abs(P.x) < 6.9) c = mix3(c, EDGE, 0.6);
    }
    if (P.z < -8.55 && Math.abs(P.x) > 0.3) c = BLACK;
    return c;
  });
  const body = new THREE.Mesh(airframe, skinMaterial(envMap, { metalness: 0.3, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.35 }));
  body.castShadow = true; body.receiveShadow = true;
  // caret intake mouths (dark, raked)
  const mouthMat = new THREE.MeshBasicMaterial({ color: 0x050608, side: THREE.DoubleSide });
  for (const sx of [1, -1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.95), mouthMat);
    m.position.set(1.32 * sx, -0.1, 4.33); m.rotation.y = 0.35 * sx; body.add(m);
  }

  const canopy = new THREE.Mesh(loft([
    { z: 7.0, w: 0.02, top: 0.02, bot: 0.0, n: 2, cy: 0.42 },
    { z: 6.4, w: 0.36, top: 0.22, bot: 0.0, n: 2, cy: 0.46 },
    { z: 5.4, w: 0.52, top: 0.46, bot: 0.0, n: 2, cy: 0.52 },
    { z: 4.2, w: 0.54, top: 0.50, bot: 0.0, n: 2, cy: 0.56 },
    { z: 3.0, w: 0.44, top: 0.34, bot: 0.0, n: 2, cy: 0.56 },
    { z: 2.2, w: 0.20, top: 0.10, bot: 0.0, n: 2, cy: 0.56 },
  ], 40, 5), glassMaterial(envMap, 0x9a7a2a, 0.45));
  canopy.renderOrder = 3;
  const eye = new THREE.Vector3(0, 0.96, 4.4);
  const { pilot, seat } = makePilot(eye, envMap);
  const cockpit = makeCockpit(eye);
  // rectangular 2-D nozzles: a short dark duct and a glowing plate inside
  const nozzles = [1, -1].map((sx) => {
    const noz = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.45), new THREE.MeshStandardMaterial({ color: 0x2f3135, metalness: 0.7, roughness: 0.45, envMap: envMap || null, side: THREE.DoubleSide }));
    noz.position.set(0.64 * sx, 0, -8.95);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    glow.rotation.y = Math.PI; glow.position.set(0.64 * sx, 0, -8.7);
    return { noz, glow, exit: new THREE.Vector3(0.64 * sx, 0, -9.4) };
  });
  return assemble({
    name: 'f22', body, canopy, pilot, seat, cockpit, nozzles, nozzleR: 0.36,
    tips: [new THREE.Vector3(6.8, -0.12, -3.4), new THREE.Vector3(-6.8, -0.12, -3.4)],
    stabTips: [new THREE.Vector3(4.4, -0.06, -9.0), new THREE.Vector3(-4.4, -0.06, -9.0)],
    eye, length: 18.9,
    wingVapor: { x: [1.9, 6.4], le: [2.0, -2.2], te: [-6.0, -4.2], y: [0.02, -0.08] },
  });
}

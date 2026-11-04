// DELPHINUS — an organic, dolphin-like fighter. Smooth spindle body with a long tapering nose,
// a low teardrop canopy, sickle pectoral wings with anhedral, a tall swept dorsal fin, a small
// ventral fin and horizontal tail flukes. Pearl-grey upper surfaces over a deep navy belly.
// Proportions follow the author's own DELPHINUS D-02 (12.7 m); this version is stretched and swept
// further back for a more streamlined line. ~13.5 m long, ~7.6 m span.
import * as THREE from 'three';
import { loft, foil, mirrorX, merge, paint, hex, mix3, smooth, skinMaterial, glassMaterial, makePilot, makeCockpit, makeNozzle, assemble } from './kit.js';

const TOP = hex(0xdfe7ec), BELLY = hex(0x13243a), EDGE = hex(0x263c4e), ACCENT = hex(0x34d6c8);

export function buildDelphinus(envMap, o = {}) {
  const top = o.top ? hex(o.top) : TOP;
  // ---- body: superellipse sections from the nose (+z) to the tail ----
  const fus = loft([
    { z: 7.05, w: 0.012, top: 0.012, bot: 0.012, n: 2, cy: -0.07 },
    { z: 6.7, w: 0.11, top: 0.07, bot: 0.10, n: 2, cy: -0.07 },
    { z: 6.15, w: 0.25, top: 0.17, bot: 0.20, n: 2, cy: -0.06 },
    { z: 5.45, w: 0.40, top: 0.31, bot: 0.28, n: 2.05, cy: -0.03 },
    { z: 4.75, w: 0.54, top: 0.45, bot: 0.36, n: 2.1, cy: 0.0 },
    { z: 4.0, w: 0.68, top: 0.60, bot: 0.46, n: 2.15, cy: 0.03 },
    { z: 3.2, w: 0.81, top: 0.72, bot: 0.56, n: 2.2, cy: 0.05 },
    { z: 2.4, w: 0.93, top: 0.79, bot: 0.64, n: 2.25, cy: 0.06 },
    { z: 1.5, w: 1.01, top: 0.80, bot: 0.67, n: 2.3, cy: 0.05 },
    { z: 0.6, w: 1.04, top: 0.74, bot: 0.64, n: 2.3, cy: 0.03 },
    { z: -0.3, w: 1.00, top: 0.65, bot: 0.59, n: 2.3, cy: 0.02 },
    { z: -1.3, w: 0.90, top: 0.55, bot: 0.53, n: 2.25, cy: 0.0 },
    { z: -2.4, w: 0.77, top: 0.45, bot: 0.47, n: 2.2, cy: -0.01 },
    { z: -3.5, w: 0.64, top: 0.38, bot: 0.41, n: 2.15, cy: -0.02 },
    { z: -4.6, w: 0.52, top: 0.33, bot: 0.35, n: 2.1, cy: -0.02 },
    { z: -5.6, w: 0.42, top: 0.29, bot: 0.30, n: 2.1, cy: -0.01 },
    { z: -6.3, w: 0.37, top: 0.27, bot: 0.27, n: 2.1, cy: 0.0 },
    { z: -6.55, w: 0.36, top: 0.26, bot: 0.26, n: 2.1, cy: 0.0 },
  ], 56, 6);

  // ---- pectoral wings: sickle planform, swept and drooping toward the tips ----
  const wing = foil([
    { le: [0.45, 0.02, 1.35], te: [0.45, 0.02, -1.75], t: 0.10 },
    { le: [0.95, 0.02, 1.05], te: [0.95, 0.02, -2.25], t: 0.09 },
    { le: [1.50, -0.03, 0.30], te: [1.50, -0.03, -2.95], t: 0.085 },
    { le: [2.10, -0.10, -0.75], te: [2.10, -0.10, -3.48], t: 0.08 },
    { le: [2.70, -0.20, -1.85], te: [2.70, -0.20, -3.85], t: 0.075 },
    { le: [3.25, -0.31, -3.05], te: [3.25, -0.31, -4.10], t: 0.07 },
    { le: [3.70, -0.40, -4.12], te: [3.70, -0.40, -4.30], t: 0.06 },
  ], { axis: [0, 1, 0], chord: 20, sub: 6 });

  // ---- dorsal fin: long low root fairing, then a tall blade swept far back (falcate) ----
  const dorsal = foil([
    { le: [0, 0.62, 0.55], te: [0, 0.30, -4.75], t: 0.05 },
    { le: [0, 0.90, -0.55], te: [0, 0.62, -3.95], t: 0.06 },
    { le: [0, 1.25, -1.25], te: [0, 1.05, -3.05], t: 0.07 },
    { le: [0, 1.70, -2.00], te: [0, 1.58, -3.20], t: 0.07 },
    { le: [0, 2.15, -2.85], te: [0, 2.08, -3.62], t: 0.06 },
    { le: [0, 2.48, -3.70], te: [0, 2.44, -4.02], t: 0.05 },
    { le: [0, 2.58, -4.15], te: [0, 2.57, -4.22], t: 0.04 },
  ], { axis: [1, 0, 0], chord: 18, sub: 6 });

  // ---- ventral fin (small, under the belly) ----
  const ventral = foil([
    { le: [0, -0.48, 0.30], te: [0, -0.46, -1.85], t: 0.06 },
    { le: [0, -0.80, -0.45], te: [0, -0.80, -1.62], t: 0.06 },
    { le: [0, -1.08, -1.08], te: [0, -1.08, -1.52], t: 0.05 },
    { le: [0, -1.22, -1.48], te: [0, -1.22, -1.56], t: 0.04 },
  ], { axis: [1, 0, 0], chord: 14, sub: 5 });

  // ---- horizontal tail flukes ----
  const fluke = foil([
    { le: [0.25, 0.0, -3.95], te: [0.25, 0.0, -6.35], t: 0.07 },
    { le: [0.90, 0.02, -4.95], te: [0.90, 0.02, -6.40], t: 0.07 },
    { le: [1.55, 0.05, -5.85], te: [1.55, 0.05, -6.62], t: 0.06 },
    { le: [2.05, 0.08, -6.55], te: [2.05, 0.08, -6.90], t: 0.05 },
    { le: [2.30, 0.10, -7.02], te: [2.30, 0.10, -7.08], t: 0.04 },
  ], { axis: [0, 1, 0], chord: 16, sub: 5 });

  // ---- intake pods blended under the wing roots ----
  const pod = loft([
    { z: 1.25, w: 0.05, top: 0.05, bot: 0.05, n: 2, cy: -0.26, cx: 0.80 },
    { z: 0.85, w: 0.20, top: 0.14, bot: 0.15, n: 2.6, cy: -0.30, cx: 0.80 },
    { z: -0.6, w: 0.22, top: 0.15, bot: 0.17, n: 2.8, cy: -0.32, cx: 0.80 },
    { z: -2.0, w: 0.17, top: 0.12, bot: 0.12, n: 2.5, cy: -0.28, cx: 0.74 },
    { z: -2.9, w: 0.04, top: 0.04, bot: 0.04, n: 2, cy: -0.22, cx: 0.66 },
  ], 24, 4);

  const parts = [fus, wing, mirrorX(wing), dorsal, ventral, fluke, mirrorX(fluke), pod, mirrorX(pod)];
  const airframe = merge(parts);
  // Two-tone: pearl above, navy below, a soft waterline; dark leading edges toward the tips, a thin teal pinstripe
  paint(airframe, (P, N) => {
    const water = smooth(0.12, -0.22, P.y + 0.06 * N.y - 0.02 * Math.max(0, -P.z));
    let c = mix3(top, BELLY, water);
    const span = Math.abs(P.x);
    if (span > 1.2 && Math.abs(N.y) > 0.3) c = mix3(c, EDGE, smooth(2.9, 3.6, span) * 0.8);
    if (P.y > 1.9 && span < 0.2) c = mix3(c, EDGE, smooth(1.9, 2.35, P.y));
    const stripe = Math.abs(P.y - (0.10 - 0.02 * P.z)) < 0.022 && Math.abs(N.y) < 0.55 && span > 0.3 && span < 1.1 && P.z > -5.2 && P.z < 5.4;
    if (stripe) c = ACCENT;
    return c;
  });
  const body = new THREE.Mesh(airframe, skinMaterial(envMap, { metalness: 0.28, roughness: 0.3 }));
  body.castShadow = true; body.receiveShadow = true;

  // ---- canopy: long low teardrop ----
  const canopyGeo = loft([
    { z: 4.85, w: 0.04, top: 0.02, bot: 0.0, n: 2, cy: 0.46 },
    { z: 4.4, w: 0.30, top: 0.17, bot: 0.0, n: 2, cy: 0.57 },
    { z: 3.8, w: 0.46, top: 0.34, bot: 0.0, n: 2, cy: 0.66 },
    { z: 3.1, w: 0.53, top: 0.42, bot: 0.0, n: 2, cy: 0.71 },
    { z: 2.4, w: 0.50, top: 0.37, bot: 0.0, n: 2, cy: 0.75 },
    { z: 1.8, w: 0.38, top: 0.25, bot: 0.0, n: 2, cy: 0.76 },
    { z: 1.3, w: 0.16, top: 0.09, bot: 0.0, n: 2, cy: 0.73 },
    { z: 1.05, w: 0.02, top: 0.01, bot: 0.0, n: 2, cy: 0.70 },
  ], 40, 5);
  const canopy = new THREE.Mesh(canopyGeo, glassMaterial(envMap, 0x14303c, 0.45));
  canopy.renderOrder = 3;

  const eye = new THREE.Vector3(0, 1.0, 2.75);
  const { pilot, seat } = makePilot(eye, envMap, 0x2e3a48);
  const cockpit = makeCockpit(eye, 0x6ff0e6);
  const noz = makeNozzle({ z0: -6.55, r: 0.27, len: 0.55, flare: 1.18, envMap, color: 0x3a4048 });

  return assemble({
    name: 'delphinus', body, canopy, pilot, seat, cockpit, nozzles: [noz],
    tips: [new THREE.Vector3(3.72, -0.40, -4.2), new THREE.Vector3(-3.72, -0.40, -4.2)],
    stabTips: [new THREE.Vector3(2.3, 0.1, -7.05), new THREE.Vector3(-2.3, 0.1, -7.05)],
    eye, length: 13.6,
    wingVapor: { x: [0.95, 3.2], le: [1.0, -2.9], te: [-2.2, -4.05], y: [0.04, -0.28] },
    glowColor: [0.55, 0.9, 1.0],
  });
}

// F-16C Fighting Falcon. Nose +Z, up +Y, left wing +X. ~15.0 m long, ~9.5 m span (10.0 m with tip rails).
// Blended body with a chin intake, large LERX, cropped-delta wing (40° sweep), all-moving tailplanes with
// anhedral, one fin, ventral fins, frameless bubble canopy. Two-tone grey.
import * as THREE from 'three';
import { loft, surface, foil, mirrorX, merge, paint, hex, mix3, smooth, skinMaterial, glassMaterial, makePilot, makeCockpit, makeNozzle, assemble } from './kit.js';

const DARK = hex(0x565c63), LIGHT = hex(0x868f96), RADOME = hex(0x62686f), BLACK = hex(0x0a0b0d);

export function buildF16(envMap) {
  const fus = loft([
    { z: 7.55, w: 0.015, top: 0.015, bot: 0.015, n: 2, cy: -0.05 },
    { z: 7.15, w: 0.17, top: 0.17, bot: 0.17, n: 2, cy: -0.05 },
    { z: 6.4, w: 0.36, top: 0.35, bot: 0.36, n: 2, cy: -0.03 },
    { z: 5.5, w: 0.50, top: 0.48, bot: 0.50, n: 2.1, cy: 0.0 },
    { z: 4.6, w: 0.57, top: 0.55, bot: 0.56, n: 2.3, cy: 0.02 },
    { z: 3.6, w: 0.61, top: 0.57, bot: 0.60, n: 2.6, cy: 0.04 },
    { z: 2.6, w: 0.66, top: 0.58, bot: 0.64, n: 2.8, cy: 0.05 },
    { z: 1.5, w: 0.76, top: 0.66, bot: 0.66, n: 3.0, cy: 0.05 },
    { z: 0.2, w: 0.86, top: 0.74, bot: 0.70, n: 3.2, cy: 0.04 },
    { z: -1.2, w: 0.88, top: 0.72, bot: 0.70, n: 3.2, cy: 0.02 },
    { z: -2.9, w: 0.82, top: 0.66, bot: 0.66, n: 3.0, cy: 0.0 },
    { z: -4.6, w: 0.70, top: 0.60, bot: 0.60, n: 2.6, cy: 0.0 },
    { z: -6.0, w: 0.58, top: 0.55, bot: 0.55, n: 2.2, cy: 0.0 },
    { z: -6.75, w: 0.52, top: 0.52, bot: 0.52, n: 2.0, cy: 0.0 },
  ], 48, 5);
  // chin intake (the "smile")
  const intake = loft([
    { z: 2.65, w: 0.48, top: 0.22, bot: 0.30, n: 3.2, cy: -0.66 },
    { z: 1.9, w: 0.50, top: 0.26, bot: 0.32, n: 3.4, cy: -0.68 },
    { z: 0.4, w: 0.52, top: 0.28, bot: 0.30, n: 3.6, cy: -0.66 },
    { z: -1.4, w: 0.48, top: 0.28, bot: 0.24, n: 3.4, cy: -0.58 },
    { z: -3.0, w: 0.38, top: 0.24, bot: 0.14, n: 3.0, cy: -0.48 },
  ], 32, 4);
  const lerx = surface({ rLE: [0.58, 0.02, 4.4], rTE: [0.58, 0.02, 0.6], tLE: [1.0, 0.0, 1.4], tTE: [1.0, 0.0, 0.5], axis: [0, 1, 0], tR: 0.05, tT: 0.05, span: 3 });
  const wing = surface({ rLE: [0.85, 0.0, 1.35], rTE: [0.85, 0.0, -3.35], tLE: [4.72, 0.0, -2.0], tTE: [4.72, 0.0, -2.95], axis: [0, 1, 0], tR: 0.045, tT: 0.035 });
  const stab = surface({ rLE: [0.70, -0.02, -4.55], rTE: [0.70, -0.02, -6.85], tLE: [2.75, -0.38, -6.05], tTE: [2.75, -0.38, -7.05], axis: [0.17, 0.985, 0], tR: 0.045, tT: 0.035 });
  const vent = surface({ rLE: [0.46, -0.62, -3.5], rTE: [0.46, -0.62, -5.0], tLE: [0.66, -1.12, -4.3], tTE: [0.66, -1.12, -5.1], axis: [0.96, 0.27, 0], tR: 0.06, tT: 0.05, span: 3 });
  const fin = surface({ rLE: [0, 0.62, -2.35], rTE: [0, 0.60, -6.3], tLE: [0, 3.5, -5.6], tTE: [0, 3.5, -6.65], axis: [1, 0, 0], tR: 0.05, tT: 0.04 });
  const spine = loft([
    { z: 1.3, w: 0.26, top: 0.08, bot: 0.05, n: 2, cy: 0.74 },
    { z: 0.4, w: 0.36, top: 0.16, bot: 0.05, n: 2.2, cy: 0.76 },
    { z: -1.6, w: 0.38, top: 0.14, bot: 0.05, n: 2.2, cy: 0.76 },
    { z: -3.6, w: 0.24, top: 0.08, bot: 0.05, n: 2, cy: 0.66 },
    { z: -4.6, w: 0.10, top: 0.03, bot: 0.03, n: 2, cy: 0.60 },
  ], 24, 4);
  const rail = loft([
    { z: -0.4, w: 0.01, top: 0.01, bot: 0.01, n: 2 },
    { z: -0.7, w: 0.06, top: 0.08, bot: 0.06, n: 2.5 },
    { z: -2.9, w: 0.06, top: 0.08, bot: 0.06, n: 2.5 },
  ], 12, 2); rail.translate(4.8, 0, 0);
  const aam = loft([
    { z: 0.6, w: 0.005, top: 0.005, bot: 0.005, n: 2 },
    { z: 0.35, w: 0.06, top: 0.06, bot: 0.06, n: 2 },
    { z: -2.3, w: 0.064, top: 0.064, bot: 0.064, n: 2 },
  ], 14, 2); aam.translate(4.8, -0.12, 0);

  const airframe = merge([fus, intake, lerx, mirrorX(lerx), wing, mirrorX(wing), stab, mirrorX(stab), vent, mirrorX(vent), fin, spine, rail, mirrorX(rail), aam, mirrorX(aam)]);
  paint(airframe, (P, N) => {
    // darker grey on top and on the wing tops, lighter grey on the sides and underside
    let c = mix3(LIGHT, DARK, smooth(0.15, 0.6, N.y) * (Math.abs(P.x) > 0.5 || P.y > 0.3 ? 1 : 0.6));
    if (P.z > 6.0) c = RADOME;
    if (P.z > 2.55 && P.z < 2.7 && P.y < -0.4) c = BLACK;
    return c;
  });
  const body = new THREE.Mesh(airframe, skinMaterial(envMap, { metalness: 0.25, roughness: 0.55, clearcoat: 0.2, clearcoatRoughness: 0.4 }));
  body.castShadow = true; body.receiveShadow = true;
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.46), new THREE.MeshBasicMaterial({ color: 0x050608 }));
  mouth.position.set(0, -0.68, 2.64); body.add(mouth);

  const canopy = new THREE.Mesh(loft([
    { z: 5.0, w: 0.02, top: 0.02, bot: 0.0, n: 2, cy: 0.52 },
    { z: 4.5, w: 0.34, top: 0.30, bot: 0.0, n: 2, cy: 0.54 },
    { z: 3.6, w: 0.46, top: 0.52, bot: 0.0, n: 2, cy: 0.56 },
    { z: 2.6, w: 0.48, top: 0.55, bot: 0.0, n: 2, cy: 0.58 },
    { z: 1.7, w: 0.40, top: 0.38, bot: 0.0, n: 2, cy: 0.64 },
    { z: 1.05, w: 0.26, top: 0.14, bot: 0.0, n: 2, cy: 0.72 },
  ], 40, 5), glassMaterial(envMap, 0x8a6a2a, 0.34));
  canopy.renderOrder = 3;
  const eye = new THREE.Vector3(0, 1.0, 2.75);
  const { pilot, seat } = makePilot(eye, envMap);
  const cockpit = makeCockpit(eye);
  const noz = makeNozzle({ z0: -6.75, r: 0.46, len: 0.8, flare: 1.15, envMap, color: 0x4a4644 });
  return assemble({
    name: 'f16', body, canopy, pilot, seat, cockpit, nozzles: [noz],
    tips: [new THREE.Vector3(4.85, 0, -2.4), new THREE.Vector3(-4.85, 0, -2.4)],
    stabTips: [new THREE.Vector3(2.75, -0.38, -6.9), new THREE.Vector3(-2.75, -0.38, -6.9)],
    eye, length: 15.0,
    wingVapor: { x: [0.9, 4.4], le: [1.3, -1.8], te: [-3.3, -2.9], y: [0, 0] },
  });
}

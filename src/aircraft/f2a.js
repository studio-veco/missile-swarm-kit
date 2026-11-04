// F-2A (JASDF, sea camouflage), built by hand from body sections and wing panels.
// Nose +Z, up +Y, left wing +X. Metres (15.5 m long, 11.1 m span).
import * as THREE from 'three';
import { loft, surface, mirrorX, merge } from './kit.js';

const NOISE_GLSL = /* glsl */`
float hash13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i), hash13(i+vec3(1,0,0)), f.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), f.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
`;

// Sea camouflage, hinomaru and panel lines are painted from the surface position in the shader
function camoMaterial(envMap) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.18, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.35, envMap, envMapIntensity: 0.9 });
  m.userData.previewColor = 0x1c3466; // flat stand-in for the shader camouflage (offline previews)
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj; varying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; vObjN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vObj; varying vec3 vObjN;\n${NOISE_GLSL}
        float disc(vec2 p, vec2 c, float r){ return 1.0 - smoothstep(r-0.012, r+0.012, length(p-c)); }`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
        vec3 P = vObj, N = normalize(vObjN);
        // sea camouflage: two-blue mottle above, pale blue-grey below
        float cn = fbm3(P*vec3(0.28, 0.34, 0.22) + vec3(3.1, 0.0, 1.7));
        float blot = smoothstep(0.50, 0.56, cn);
        vec3 dark = vec3(0.030, 0.058, 0.150), mid = vec3(0.070, 0.150, 0.360), under = vec3(0.24, 0.32, 0.44);
        vec3 top = mix(mid, dark, blot);
        float lowSide = smoothstep(-0.15, -0.55, N.y);
        vec3 col = mix(top, under, lowSide);
        // radome
        col = mix(col, vec3(0.28, 0.31, 0.36), smoothstep(5.72, 5.78, P.z) * step(abs(P.x), 0.8));
        // panel lines
        float pz = abs(fract(P.z/1.07 + 0.37) - 0.5)*1.07;
        float px = abs(fract(P.x/1.31 + 0.11) - 0.5)*1.31;
        float wingish = smoothstep(0.9, 1.2, abs(P.x));
        float line = (1.0 - smoothstep(0.004, 0.012, pz)) * 0.55 + (1.0 - smoothstep(0.004, 0.012, px)) * 0.45 * wingish;
        col *= 1.0 - line*0.35;
        // grime and wear
        col *= 0.92 + 0.12*fbm3(P*3.1);
        // hinomaru: on both wings (upper and lower) and both fuselage sides
        float hm = 0.0, hw = 0.0;
        // both wings, upper and lower surfaces
        if (abs(N.y) > 0.5 && abs(P.x) > 1.5) { vec2 wc = vec2(sign(P.x) * 3.25, -1.75); hm = disc(P.xz, wc, 0.56); hw = disc(P.xz, wc, 0.62); }
        if (abs(N.x) > 0.55 && abs(P.x) < 1.15 && abs(P.y) < 0.8) { hm = disc(P.zy, vec2(-0.2, 0.02), 0.34); hw = disc(P.zy, vec2(-0.2, 0.02), 0.39); }
        col = mix(col, vec3(0.92, 0.93, 0.95), hw);
        col = mix(col, vec3(0.70, 0.03, 0.08), hm);
        // fin badge: a white planet with a cyan ring
        if (abs(N.x) > 0.6 && P.y > 1.2 && abs(P.x) < 0.3) {
          vec2 q = vec2(P.z + 5.55, P.y - 2.55);
          float pl = disc(q, vec2(0.0), 0.42);
          vec2 rq = vec2(q.x*0.42 + q.y*0.28, -q.x*0.11 + q.y*0.95);
          float ring = smoothstep(0.035, 0.0, abs(length(vec2(rq.x/0.95, rq.y/0.28)) - 0.62)) * (1.0 - pl*step(rq.y, 0.0));
          col = mix(col, vec3(0.95), pl);
          col = mix(col, vec3(0.1, 0.85, 1.0), ring);
        }
        vec4 diffuseColor = vec4(col, opacity);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.42, 0.62, fbm3(vObj*2.3));');
  };
  return m;
}

export function buildF2A(envMap) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // airframe (parts hidden in the cockpit view)
  root.add(body);

  // fuselage
  const fus = loft([
    { z: 7.95, w: 0.015, top: 0.015, bot: 0.015, n: 2, cy: -0.02 },
    { z: 7.55, w: 0.19, top: 0.19, bot: 0.19, n: 2, cy: -0.02 },
    { z: 6.8, w: 0.38, top: 0.37, bot: 0.38, n: 2, cy: -0.02 },
    { z: 5.9, w: 0.52, top: 0.50, bot: 0.52, n: 2.1, cy: 0.0 },
    { z: 5.0, w: 0.60, top: 0.60, bot: 0.58, n: 2.3, cy: 0.02 },
    { z: 4.0, w: 0.64, top: 0.62, bot: 0.62, n: 2.6, cy: 0.04 },
    { z: 3.0, w: 0.70, top: 0.62, bot: 0.66, n: 2.8, cy: 0.06 },
    { z: 2.0, w: 0.80, top: 0.70, bot: 0.70, n: 3.0, cy: 0.06 },
    { z: 0.8, w: 0.92, top: 0.80, bot: 0.74, n: 3.2, cy: 0.04 },
    { z: -0.8, w: 0.96, top: 0.80, bot: 0.74, n: 3.2, cy: 0.02 },
    { z: -2.6, w: 0.90, top: 0.74, bot: 0.70, n: 3.0, cy: 0.0 },
    { z: -4.4, w: 0.78, top: 0.66, bot: 0.64, n: 2.6, cy: 0.0 },
    { z: -6.0, w: 0.64, top: 0.60, bot: 0.58, n: 2.2, cy: 0.0 },
    { z: -6.95, w: 0.56, top: 0.56, bot: 0.56, n: 2.0, cy: 0.0 },
  ], 48, 5);

  // chin intake (the F-2 "mouth")
  const intake = loft([
    { z: 3.35, w: 0.50, top: 0.22, bot: 0.30, n: 3.2, cy: -0.66 },
    { z: 2.6, w: 0.52, top: 0.26, bot: 0.32, n: 3.4, cy: -0.68 },
    { z: 1.2, w: 0.54, top: 0.28, bot: 0.30, n: 3.6, cy: -0.66 },
    { z: -0.6, w: 0.50, top: 0.28, bot: 0.24, n: 3.4, cy: -0.58 },
    { z: -2.4, w: 0.40, top: 0.24, bot: 0.14, n: 3.0, cy: -0.48 },
  ], 32, 4);

  // main wing (33 deg leading-edge sweep, larger than the F-16 wing)
  const wingR = surface({ rLE: [0.80, -0.02, 1.85], rTE: [0.80, -0.02, -3.35], tLE: [5.25, -0.02, -1.15], tTE: [5.25, -0.02, -2.55], axis: [0, 1, 0], tR: 0.05, tT: 0.035 });
  // strake (wing root forward to the cockpit)
  const strake = surface({ rLE: [0.62, 0.0, 4.6], rTE: [0.62, 0.0, 0.9], tLE: [0.96, -0.01, 1.9], tTE: [0.96, -0.01, 0.8], axis: [0, 1, 0], tR: 0.045, tT: 0.045, span: 3 });
  // stabilator (10 deg anhedral)
  const stabR = surface({ rLE: [0.70, -0.02, -4.55], rTE: [0.70, -0.02, -7.35], tLE: [2.95, -0.42, -6.30], tTE: [2.95, -0.42, -7.45], axis: [0.17, 0.985, 0], tR: 0.045, tT: 0.035 });
  // ventral fins (canted out)
  const ventR = surface({ rLE: [0.48, -0.62, -3.9], rTE: [0.48, -0.62, -5.4], tLE: [0.68, -1.15, -4.7], tTE: [0.68, -1.15, -5.5], axis: [0.96, 0.27, 0], tR: 0.06, tT: 0.05, span: 3 });
  // fin
  const fin = surface({ rLE: [0, 0.62, -2.75], rTE: [0, 0.60, -6.55], tLE: [0, 3.95, -6.15], tTE: [0, 3.95, -7.25], axis: [1, 0, 0], tR: 0.05, tT: 0.04 });
  // spine (canopy to fin)
  const spine = loft([
    { z: 2.2, w: 0.30, top: 0.10, bot: 0.05, n: 2, cy: 0.70 },
    { z: 1.2, w: 0.40, top: 0.20, bot: 0.05, n: 2.2, cy: 0.72 },
    { z: -1.0, w: 0.42, top: 0.18, bot: 0.05, n: 2.2, cy: 0.74 },
    { z: -3.2, w: 0.30, top: 0.12, bot: 0.05, n: 2, cy: 0.66 },
    { z: -4.5, w: 0.12, top: 0.04, bot: 0.04, n: 2, cy: 0.60 },
  ], 24, 4);
  // drag chute housing at the fin root
  const chute = loft([
    { z: -5.7, w: 0.04, top: 0.04, bot: 0.04, n: 2, cy: 0.78 },
    { z: -6.1, w: 0.20, top: 0.22, bot: 0.18, n: 2, cy: 0.76 },
    { z: -7.6, w: 0.21, top: 0.22, bot: 0.18, n: 2, cy: 0.74 },
    { z: -7.95, w: 0.16, top: 0.16, bot: 0.14, n: 2, cy: 0.74 },
  ], 20, 3);
  // wingtip launch rails and AAMs
  const railR = loft([
    { z: -0.6, w: 0.01, top: 0.01, bot: 0.01, n: 2, cy: 0 },
    { z: -0.9, w: 0.06, top: 0.08, bot: 0.06, n: 2.5, cy: 0 },
    { z: -3.0, w: 0.06, top: 0.08, bot: 0.06, n: 2.5, cy: 0 },
  ], 12, 2); railR.translate(-5.30, -0.02, 0);

  const airframe = merge([fus, intake, wingR, mirrorX(wingR), strake, mirrorX(strake), stabR, mirrorX(stabR), ventR, mirrorX(ventR), fin, spine, chute, railR, mirrorX(railR)]);
  const camo = camoMaterial(envMap);
  const af = new THREE.Mesh(airframe, camo);
  af.castShadow = true; af.receiveShadow = true;
  body.add(af);

  // dark intake throat
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.48), new THREE.MeshBasicMaterial({ color: 0x050608 }));
  mouth.position.set(0, -0.70, 3.34);
  body.add(mouth);

  // wingtip AAMs
  const aamGeo = (() => {
    const b = loft([
      { z: 0.0, w: 0.005, top: 0.005, bot: 0.005, n: 2 },
      { z: -0.25, w: 0.055, top: 0.055, bot: 0.055, n: 2 },
      { z: -0.55, w: 0.064, top: 0.064, bot: 0.064, n: 2 },
      { z: -2.85, w: 0.064, top: 0.064, bot: 0.064, n: 2 },
      { z: -2.9, w: 0.05, top: 0.05, bot: 0.05, n: 2 },
    ], 16, 2);
    const f1 = surface({ rLE: [0, 0.05, -0.55], rTE: [0, 0.05, -0.85], tLE: [0, 0.2, -0.75], tTE: [0, 0.2, -0.85], axis: [1, 0, 0], span: 1, chord: 6 });
    const fins = [];
    for (let k = 0; k < 4; k++) { const a = f1.clone(); a.rotateZ(k * Math.PI / 2 + Math.PI / 4); fins.push(a); const b2 = a.clone(); b2.translate(0, 0, -1.95); b2.scale(1, 1, 1); fins.push(b2); }
    return merge([b, ...fins]);
  })();
  const aamMat = new THREE.MeshStandardMaterial({ color: 0xe8ebee, roughness: 0.35, metalness: 0.1, envMap, envMapIntensity: 0.8 });
  for (const sx of [1, -1]) {
    const a = new THREE.Mesh(aamGeo, aamMat); a.position.set(5.30 * sx, -0.13, 0.5); a.castShadow = true; body.add(a);
  }

  // gold-tinted canopy and frames
  const canopyGeo = loft([
    { z: 4.75, w: 0.02, top: 0.02, bot: 0.0, n: 2, cy: 0.58 },
    { z: 4.3, w: 0.36, top: 0.30, bot: 0.0, n: 2, cy: 0.58 },
    { z: 3.5, w: 0.47, top: 0.50, bot: 0.0, n: 2, cy: 0.58 },
    { z: 2.6, w: 0.48, top: 0.52, bot: 0.0, n: 2, cy: 0.60 },
    { z: 1.8, w: 0.42, top: 0.38, bot: 0.0, n: 2, cy: 0.64 },
    { z: 1.15, w: 0.30, top: 0.16, bot: 0.0, n: 2, cy: 0.70 },
  ], 40, 5);
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x8a6a2a, metalness: 0.0, roughness: 0.03, transparent: true, opacity: 0.32, envMap, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.02, side: THREE.DoubleSide, depthWrite: false });
  const canopy = new THREE.Mesh(canopyGeo, glassMat);
  canopy.renderOrder = 3;
  root.add(canopy);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1a2a44, roughness: 0.6, metalness: 0.3, envMap });
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.03, 8, 40, Math.PI), frameMat);
  bow.position.set(0, 0.585, 3.9); bow.scale.set(1, 1.02, 1);
  root.add(bow);
  const bow2 = new THREE.Mesh(new THREE.TorusGeometry(0.40, 0.026, 8, 40, Math.PI), frameMat);
  bow2.position.set(0, 0.64, 1.75); bow2.scale.set(1, 0.95, 1);
  root.add(bow2);

  // pilot (seen from outside) and cockpit (seen from inside)
  const pilot = new THREE.Group();
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 16), new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.35, envMap }));
  helmet.position.set(0, 0.98, 2.62);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.153, 24, 16, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.35, Math.PI * 0.32), new THREE.MeshStandardMaterial({ color: 0x221a10, roughness: 0.08, metalness: 0.8, envMap, envMapIntensity: 2 }));
  visor.position.copy(helmet.position); visor.rotation.y = 0;
  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.3), new THREE.MeshStandardMaterial({ color: 0x3b4a32, roughness: 0.8 }));
  shoulders.position.set(0, 0.72, 2.55);
  pilot.add(helmet, visor, shoulders);
  root.add(pilot);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.7, 0.14), new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.7 }));
  seat.position.set(0, 0.78, 2.33); seat.rotation.x = -0.3;
  root.add(seat);
  const cockpit = new THREE.Group();
  // instrument coaming and HUD combiner
  const coaming = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.85, metalness: 0.2 }));
  coaming.scale.set(0.40, 0.11, 0.42); coaming.position.set(0, 0.60, 3.86);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.80, 0.30), new THREE.MeshStandardMaterial({ color: 0x0c0e10, roughness: 0.9, emissive: 0x000000 }));
  panel.position.set(0, 0.52, 3.55); panel.rotation.x = -0.35 + Math.PI; panel.rotation.y = Math.PI;
  const mfdMat = new THREE.MeshBasicMaterial({ color: 0x46ffb0 });
  for (const sx of [-0.24, 0.24]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.15), mfdMat); s.position.set(sx, 0.53, 3.53); s.rotation.x = 0.35; s.rotation.y = Math.PI; cockpit.add(s); }
  const hudGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.17), new THREE.MeshBasicMaterial({ color: 0x5affc8, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }));
  hudGlass.position.set(0, 0.86, 3.70); hudGlass.rotation.x = -0.25;
  const postMat = new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.6 });
  const hudFrame = new THREE.Group();
  for (const sx of [-0.11, 0.11]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.17, 0.012), postMat); p.position.set(sx, 0.79, 3.70); p.rotation.x = -0.25; hudFrame.add(p); }
  const hb = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.035, 0.07), postMat); hb.position.set(0, 0.70, 3.72); hudFrame.add(hb);
  cockpit.add(coaming, panel, hudGlass, hudFrame);
  root.add(cockpit);

  // nozzle and the glow inside
  const nozGeo = new THREE.CylinderGeometry(0.47, 0.555, 0.85, 36, 1, true);
  nozGeo.rotateX(Math.PI / 2);
  const noz = new THREE.Mesh(nozGeo, new THREE.MeshStandardMaterial({ color: 0x4a4644, metalness: 0.85, roughness: 0.38, envMap, side: THREE.DoubleSide }));
  noz.position.set(0, 0, -7.35);
  noz.onBeforeCompile = () => {};
  root.add(noz);
  const nozIn = new THREE.Mesh(new THREE.CircleGeometry(0.46, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  nozIn.rotation.y = Math.PI; nozIn.position.set(0, 0, -7.25);
  root.add(nozIn);

  // navigation lights
  const navR = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.2, 0.2) }));
  navR.position.set(-5.2, -0.02, -1.2);
  const navG = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 4, 0.6) }));
  navG.position.set(5.2, -0.02, -1.2);
  root.add(navR, navG);

  root.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; } });

  return {
    name: 'f2a', root, body, canopy, pilot, cockpit, nozIn, seat,
    // wing tips (vortex sources) and the nozzle
    tips: [new THREE.Vector3(5.35, -0.02, -2.3), new THREE.Vector3(-5.35, -0.02, -2.3)],
    stabTips: [new THREE.Vector3(2.95, -0.42, -7.3), new THREE.Vector3(-2.95, -0.42, -7.3)],
    nozzle: new THREE.Vector3(0, 0, -7.75),
    nozzles: [new THREE.Vector3(0, 0, -7.75)],
    nozzleR: 0.47,
    eye: new THREE.Vector3(0, 0.99, 2.66),
    length: 15.9,
    wingVapor: { x: [0.9, 4.5], le: [1.75, -0.95], te: [-3.3, -2.6], y: [0.0, 0.0] },
    setPOV(on, back) { pilot.visible = !on; seat.visible = !back; canopy.visible = !on; bow.visible = !on; bow2.visible = !on; },
    setGlow(thr) { const k = 0.6 + thr * 3.5; nozIn.material.color.setRGB(1.0 * k, 0.55 * k, 0.75 * k); },
  };
}

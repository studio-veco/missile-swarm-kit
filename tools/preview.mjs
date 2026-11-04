// Draw the aircraft without a browser: build each model in node, rasterise it (z-buffer, simple lighting,
// vertex colours) from the top, side, front and a 3/4 angle, and write one PNG sheet.
// Also prints size, triangle count and a sanity check (finite positions, outward-facing closed parts).
// Usage: node tools/preview.mjs out.png [delphinus f22 f16 su37 mig29 f2a]
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import * as THREE from 'three';
import { AIRCRAFT } from '../src/aircraft/index.js';

const out = process.argv[2] || 'preview.png';
const types = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(AIRCRAFT);
const PW = Number(process.env.PW || 520), PH = Number(process.env.PH || 360); // one panel
const ALLV = [
  { name: 'top', dir: [0, -1, 0], up: [0, 0, 1] },
  { name: 'side', dir: [-1, 0, 0], up: [0, 1, 0] },
  { name: 'front', dir: [0, 0, -1], up: [0, 1, 0] },
  { name: '3/4', dir: [-0.62, -0.42, -0.66], up: [0, 1, 0] },
];
const views = process.env.VIEWS ? ALLV.filter((v) => process.env.VIEWS.split(',').includes(v.name)) : ALLV;
const COLS = Number(process.env.COLS || views.length), RPC = Math.ceil(views.length / COLS);
const W = PW * COLS, H = PH * types.length * RPC;
const img = new Float32Array(W * H * 3).fill(Number(process.env.BG ?? 0.06));

function tris(root) {
  root.updateMatrixWorld(true);
  const list = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    let p = o.parent, vis = true; while (p) { if (!p.visible) vis = false; p = p.parent; } if (!vis) return;
    const g = o.geometry, pos = g.attributes.position, col = g.attributes.color, ix = g.index;
    const mc = o.material.userData?.previewColor !== undefined ? new THREE.Color(o.material.userData.previewColor) : (o.material.color || new THREE.Color(1, 1, 1));
    const glass = o.material.transparent;
    const n = ix ? ix.count : pos.count;
    const v = new THREE.Vector3();
    const P = [], C = [];
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); P.push(v.x, v.y, v.z); C.push(col ? col.getX(i) : mc.r, col ? col.getY(i) : mc.g, col ? col.getZ(i) : mc.b); }
    for (let k = 0; k < n; k += 3) {
      const a = ix ? ix.getX(k) : k, b = ix ? ix.getX(k + 1) : k + 1, c = ix ? ix.getX(k + 2) : k + 2;
      list.push({ p: [a, b, c].map((j) => [P[j * 3], P[j * 3 + 1], P[j * 3 + 2]]), c: [a, b, c].map((j) => [C[j * 3], C[j * 3 + 1], C[j * 3 + 2]]), glass, basic: o.material.isMeshBasicMaterial });
    }
  });
  return list;
}

function signedVolume(g) {
  const p = g.attributes.position.array, ix = g.index?.array; if (!ix) return 0;
  let vol = 0;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
    vol += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return vol / 6;
}

const L = new THREE.Vector3(-0.4, 0.8, 0.45).normalize();
types.forEach((type, row) => {
  const A = AIRCRAFT[type].build(null);
  A.setPOV(false, false);
  A.cockpit.visible = false;
  const T = tris(A.root);
  // stats
  const box = new THREE.Box3().setFromObject(A.body);
  const sz = box.getSize(new THREE.Vector3());
  let bad = 0; for (const t of T) for (const p of t.p) if (!p.every(Number.isFinite)) bad++;
  console.log(`${type.padEnd(10)} tris ${String(T.length).padStart(6)}  length ${sz.z.toFixed(2)} m  span ${sz.x.toFixed(2)} m  height ${sz.y.toFixed(2)} m  bad ${bad}  body volume ${signedVolume((A.body.isMesh ? A.body : A.body.children.find((m) => m.isMesh)).geometry).toFixed(2)} m3  eye ${A.eye.toArray().map((x) => x.toFixed(2))}`);
  const c = box.getCenter(new THREE.Vector3());
  views.forEach((vw, colI) => {
    const d = new THREE.Vector3(...vw.dir).normalize();
    const up0 = new THREE.Vector3(...vw.up);
    const rgt = new THREE.Vector3().crossVectors(d, up0).normalize();
    const up = new THREE.Vector3().crossVectors(rgt, d).normalize();
    const R = Math.max(sz.x, sz.y, sz.z) * Number(process.env.FIT || 0.56);
    const sc = Math.min(PW, PH) / (2 * R) * 0.98;
    const ox = (colI % COLS) * PW, oy = (row * RPC + Math.floor(colI / COLS)) * PH;
    const zb = new Float32Array(PW * PH).fill(-1e9);
    const proj = (p) => { const q = new THREE.Vector3(...p).sub(c); return [PW / 2 + q.dot(rgt) * sc, PH / 2 - q.dot(up) * sc, -q.dot(d)]; };
    // opaque first, glass after (blended)
    for (const pass of [false, true]) for (const t of T) {
      if (t.glass !== pass) continue;
      const s = t.p.map(proj);
      const e1 = new THREE.Vector3(...t.p[1]).sub(new THREE.Vector3(...t.p[0])), e2 = new THREE.Vector3(...t.p[2]).sub(new THREE.Vector3(...t.p[0]));
      const nrm = new THREE.Vector3().crossVectors(e1, e2).normalize();
      if (!pass && nrm.dot(d) > 0) continue; // back face
      const lit = t.basic ? 1 : 0.28 + 0.72 * Math.max(0, nrm.dot(L)) + 0.25 * Math.pow(Math.max(0, nrm.clone().reflect(L).negate().dot(d)), 24);
      const minX = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), maxX = Math.min(PW - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
      const minY = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), maxY = Math.min(PH - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
      const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
      if (Math.abs(area) < 1e-9) continue;
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((s[1][0] - px) * (s[2][1] - py) - (s[2][0] - px) * (s[1][1] - py)) / area;
        const w1 = ((s[2][0] - px) * (s[0][1] - py) - (s[0][0] - px) * (s[2][1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * s[0][2] + w1 * s[1][2] + w2 * s[2][2];
        const k = y * PW + x;
        if (z <= zb[k]) continue;
        const col = [0, 1, 2].map((j) => (w0 * t.c[0][j] + w1 * t.c[1][j] + w2 * t.c[2][j]) * lit);
        const o = ((oy + y) * W + ox + x) * 3;
        if (pass) { for (let j = 0; j < 3; j++) img[o + j] = img[o + j] * 0.55 + col[j] * 0.45 + 0.05; }
        else { zb[k] = z; for (let j = 0; j < 3; j++) img[o + j] = col[j]; }
      }
    }
  });
});

// PNG (8-bit RGB, linear -> sRGB)
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W * 3; x++) { const v = Math.max(0, Math.min(1, img[y * W * 3 + x])); raw[y * (W * 3 + 1) + 1 + x] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); } }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote', out, `${W}x${H}`);

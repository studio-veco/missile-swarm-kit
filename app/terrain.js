// 起伏した地形：引き起こし後の超低空区間（戦闘機の地上の道）を中心線にして谷を彫り、谷底に川と支流を流す。
// 結果は高さの格子（と川の距離の格子）。sim（ミサイルの地面）と描画（地形のメッシュ・陰影）の両方がこの格子を引く。node でも動く。
// 座標は「星の表面の x, z」（表面の点 PC + n*R の x と z）。高さは基準の球面からの高さ（m）。
// 格子は 80km 四方。真ん中ほど細かく（約 10m）、外ほど粗い（約 170m、地平の向こう）：x = cx + S·sinh(K·u)/sinh(K)、u は -1..1。

export const T_N = 2048;      // 格子の分割（頂点は T_N+1 四方）
export const T_S = 40000;     // 半分の幅（m）
export const T_K = 3.3;       // 真ん中への寄せ方
export const T_C = [1300, -200]; // 中心（戦いの真下）

function hash2(ix, iz, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise2(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
function fbm2(x, z, seed = 0, oct = 5) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise2(x, z, seed + i * 31); n += a; x = x * 2.03 + 17.1; z = z * 2.03 - 9.3; a *= 0.5; }
  return s / n;
}
function ridged(x, z, seed = 0, oct = 4) {
  let s = 0, a = 0.5, n = 0, w = 1;
  for (let i = 0; i < oct; i++) {
    let r = 1 - Math.abs(vnoise2(x, z, seed + i * 47) * 2 - 1);
    r *= r * w; w = Math.min(1, r * 1.6);
    s += a * r; n += a; x = x * 2.1 + 5.7; z = z * 2.1 + 3.1; a *= 0.5;
  }
  return s / n;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 折れ線の距離場を格子に焼く（線分ごとに近くの格子だけ見る）。格子は不等間隔：G.X[i], G.Z[j] が座標、G.fi(x), G.fj(z) が逆引き
function rasterize(G, pts, rmax, cb) {
  const { N, X, Z } = G, NV = N + 1;
  let s = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    const abx = b[0] - a[0], abz = b[1] - a[1], l2 = abx * abx + abz * abz, l = Math.sqrt(l2);
    if (l < 1e-6) continue;
    const i0 = Math.max(0, Math.floor(G.fi(Math.min(a[0], b[0]) - rmax))), i1 = Math.min(N, Math.ceil(G.fi(Math.max(a[0], b[0]) + rmax)));
    const j0 = Math.max(0, Math.floor(G.fj(Math.min(a[1], b[1]) - rmax))), j1 = Math.min(N, Math.ceil(G.fj(Math.max(a[1], b[1]) + rmax)));
    for (let j = j0; j <= j1; j++) {
      const pz = Z[j];
      for (let i = i0; i <= i1; i++) {
        const px = X[i];
        let t = ((px - a[0]) * abx + (pz - a[1]) * abz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = a[0] + abx * t - px, qz = a[1] + abz * t - pz;
        const d = Math.sqrt(qx * qx + qz * qz);
        if (d < rmax) cb(j * NV + i, d, s + t * l, abx * (pz - a[1]) - abz * (px - a[0]), k, t);
      }
    }
    s += l;
  }
  return s;
}

// 折れ線を両端でまっすぐ延ばす
function extend(pts, len, step) {
  const out = pts.slice();
  const ext = (p, q, sign) => { const dx = p[0] - q[0], dz = p[1] - q[1], l = Math.hypot(dx, dz) || 1; const r = []; for (let d = step; d <= len; d += step) r.push([p[0] + dx / l * d, p[1] + dz / l * d]); return r; };
  const head = ext(pts[0], pts[1]).reverse();
  const tail = ext(pts[pts.length - 1], pts[pts.length - 2]);
  return [...head, ...out, ...tail];
}

// 折れ線の長さに沿った位置・接線・左の法線
function along(pts) {
  const S = [0];
  for (let k = 1; k < pts.length; k++) S.push(S[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  return (s) => {
    let k = 0;
    while (k < pts.length - 2 && S[k + 1] < s) k++;
    const l = Math.max(1e-6, S[k + 1] - S[k]), u = Math.min(1, Math.max(0, (s - S[k]) / l));
    const a = pts[k], b = pts[k + 1];
    const tx = (b[0] - a[0]) / l, tz = (b[1] - a[1]) / l;
    return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], t: [tx, tz], n: [-tz, tx], total: S[S.length - 1] };
  };
}

// track：谷の中心線（戦闘機の地上の道、[x, z] の列）
export function buildTerrain(track) {
  const N = T_N, NV = N + 1, S = T_S, K = T_K, SK = Math.sinh(T_K);
  const [cx, cz] = T_C;
  const X = new Float64Array(NV), Z = new Float64Array(NV);
  for (let i = 0; i <= N; i++) { const u = (i / N) * 2 - 1; X[i] = cx + S * Math.sinh(K * u) / SK; Z[i] = cz + S * Math.sinh(K * u) / SK; }
  const fi = (x) => (Math.asinh((x - cx) * SK / S) / K + 1) / 2 * N;
  const fj = (z) => (Math.asinh((z - cz) * SK / S) / K + 1) / 2 * N;
  const G = { N, X, Z, fi, fj, cx, cz, S, K, ox: cx - S, oz: cz - S, L: 2 * S };

  // ---- 谷の中心線までの距離・沿った位置・左右 ----
  // 谷は戦闘機の道のまわりを蛇行する（谷底の幅の中で。戦闘機はいつも谷底の上）
  const T0 = along(extend(track, 46000, 40));
  const center = [];
  for (let s = 0; s <= T0(0).total; s += 30) { const c = T0(s); const w = 38 * Math.sin(s / 330 + 0.5) * Math.min(1, 0.4 + 0.6 * Math.abs(Math.sin(s / 1700))); center.push([c.p[0] + c.n[0] * w, c.p[1] + c.n[1] * w]); }
  const RMAX = 1300;
  const dist = new Float32Array(NV * NV).fill(RMAX), sAl = new Float32Array(NV * NV), side = new Float32Array(NV * NV);
  rasterize(G, center, RMAX, (k, d, s, cr) => { if (d < dist[k]) { dist[k] = d; sAl[k] = s; side[k] = cr >= 0 ? 1 : -1; } });
  const C = along(center);
  const total = C(0).total;
  // 谷が彫られる区間：戦闘機の道（延ばす前）の両端から 1.5km で閉じ始め、7km で山に戻る（地平線まで平らな溝にしない）
  const sA = 46000, sB = total - 46000;
  const carveK = (s) => sstep(sA - 7000, sA - 1500, s) * (1 - sstep(sB + 1500, sB + 7000, s));

  // ---- 川：谷底を蛇行する本流と、脇の谷から落ちる支流 ----
  const WF = (s) => 62 + 14 * vnoise2(s / 900, 0.5, 11);            // 谷底の半幅
  const WS = (s) => 150 + 100 * vnoise2(s / 760, 2.5, 12);           // 斜面の幅
  const RW = (s) => 10 + 3.5 * vnoise2(s / 400, 4.5, 13);            // 本流の半幅
  const main = [];
  for (let s = sA - 2500; s <= sB + 2500; s += 20) {
    const c = C(s);
    const lim = Math.max(0, WF(s) - RW(s) - 6);
    const m = Math.max(-lim, Math.min(lim, (18 * Math.sin(s / 230 + 1.0) + 9 * Math.sin(s / 83 + 0.3))));
    main.push([c.p[0] + c.n[0] * m, c.p[1] + c.n[1] * m]);
  }
  const tribs = [];
  {
    let a = 77;
    const r = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
    // 戦闘機の低空区間（中心線の中ほど）に沿って、左右から 7 本
    const s0 = 46000 + 400, s1 = total - 46000 - 200;
    const marks = [0.06, 0.17, 0.29, 0.41, 0.55, 0.68, 0.83];
    marks.forEach((f, i) => {
      const s = s0 + (s1 - s0) * f;
      const c = C(s);
      const sg = i % 2 ? 1 : -1;
      // 本流から外へ（下流へ合流するので、上流側へ少し傾ける）
      let hx = c.n[0] * sg - c.t[0] * 0.55, hz = c.n[1] * sg - c.t[1] * 0.55;
      const hl = Math.hypot(hx, hz); hx /= hl; hz /= hl;
      let p = [c.p[0], c.p[1]];
      const pts = [p];
      const len = 900 + r() * 900;
      let ang = 0;
      for (let d = 0; d < len; d += 30) {
        ang += (vnoise2(d / 260, i * 3.3, 21) - 0.5) * 0.35;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const dx = hx * ca - hz * sa, dz = hx * sa + hz * ca;
        p = [p[0] + dx * 30, p[1] + dz * 30];
        pts.push(p);
      }
      tribs.push({ pts: pts.reverse(), hw: 2.6 + r() * 1.6 }); // 源流 → 合流
    });
  }
  // 川の距離場：rd（川の中心までの距離）・rs（流れに沿った位置）・rw（半幅）・種類（1 本流・2 支流）
  const river = new Float32Array(NV * NV * 4);
  for (let k = 0; k < NV * NV; k++) river[k * 4] = 1e4;
  const RMS = (s) => RW(Math.min(total, Math.max(0, s)));
  rasterize(G, main, 90, (k, d, s) => { if (d < river[k * 4]) { river[k * 4] = d; river[k * 4 + 1] = s; river[k * 4 + 2] = RMS(s); river[k * 4 + 3] = 1; } });
  const trib = new Float32Array(NV * NV).fill(1e4);
  tribs.forEach((tr, i) => {
    rasterize(G, tr.pts, 320, (k, d, s, cr, seg, t) => {
      if (d < trib[k]) trib[k] = d;
      if (d < 40 && d < river[k * 4]) { river[k * 4] = d; river[k * 4 + 1] = 20000 * (i + 1) + s; river[k * 4 + 2] = tr.hw * (0.6 + 0.4 * Math.min(1, s / 600)); river[k * 4 + 3] = 2; }
    });
  });

  // ---- 高さ ----
  const H = new Float32Array(NV * NV);
  for (let j = 0; j <= N; j++) {
    const z = Z[j];
    const cz_ = j > 0 ? Z[j] - Z[j - 1] : Z[1] - Z[0];
    for (let i = 0; i <= N; i++) {
      const x = X[i], k = j * NV + i;
      // この格子の細かさ（m）：これより細かい起伏は計算しない
      const cell = Math.max(cz_, i > 0 ? X[i] - X[i - 1] : X[1] - X[0]);
      const d = dist[k], s = sAl[k], sg = side[k];
      // 谷の縁の尾根（左右で別の高さ）と、遠くの山並み
      const wall = 300 + 300 * vnoise2(s / 650, sg * 5.1, 1);
      const far = 70 + 430 * Math.pow(fbm2(x / 2600, z / 2600, 3), 1.4) * 1.5 + 230 * ridged(x / 1400, z / 1400, 7);
      const w = sstep(280, 1150, d);
      let base = wall * (0.8 + 0.4 * fbm2(x / 520, z / 520, 5)) * (1 - w) + far * w;
      // 戦いの場所（盆地）を囲む山脈：中心から 6.5km より外で立ち上がり、2〜4km の峰が地平線をぎざぎざにする
      const rr = Math.hypot(x - cx, (z - cz) / 1.35);
      const ring = sstep(6500, 16000, rr);
      if (ring > 0) {
        const r1 = ridged(x / 5600, z / 5600, 21), r2 = ridged(x / 2100, z / 2100, 25);
        base += ring * (Math.pow(r1, 1.5) * 2700 + fbm2(x / 9500, z / 9500, 23, 4) * 1300 + r2 * r1 * 650);
      }
      if (cell < 120) base += 34 * (fbm2(x / 230, z / 230, 9, cell < 30 ? 5 : 3) - 0.5);
      if (cell < 30) base += 10 * (vnoise2(x / 60, z / 60, 15) - 0.5);
      // 谷の断面（U 字）
      // 高い山を貫く所は斜面を広く（崖になりすぎない）
      const t = Math.min(1, Math.max(0, (d - WF(s)) / (WS(s) + Math.max(0, base - 700) * 0.55)));
      const prof = Math.pow(t * t * (3 - 2 * t), 1.25);
      let h = Math.max(0, base) * prof + 2.2 * vnoise2(x / 45, z / 45, 17) * (1 - prof);
      const ck = d < RMAX ? carveK(s) : 1;
      if (ck < 1) h = Math.max(0, base) * (1 - ck) + h * ck;
      // 支流の脇の谷
      const td = trib[k];
      if (td < 320) h *= 1 - 0.62 * Math.exp(-(td / 85) * (td / 85)) * sstep(0, 120, d - 40);
      // 川床
      const rd = river[k * 4], rw = river[k * 4 + 2];
      if (rd < rw + 6) h -= (river[k * 4 + 3] > 1.5 ? 1.2 : 3.2) * sstep(rw + 5, Math.max(0, rw - 2), rd);
      // 端（40km 先）で基準の球面へ溶かす
      h *= 1 - sstep(S - 9000, S - 1000, Math.max(Math.abs(x - cx), Math.abs(z - cz)));
      H[k] = h;
    }
  }

  const heightAt = (x, z) => {
    const fx = fi(x), fz = fj(z);
    if (!(fx >= 0 && fz >= 0 && fx < N && fz < N)) return 0;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * NV + i;
    return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + NV] * (1 - u) + H[k + NV + 1] * u) * v;
  };
  return { ...G, NV, H, river, heightAt, center, main, tribs, along: C, valleyDist: (x, z) => { const fx = Math.round(fi(x)), fz = Math.round(fj(z)); if (fx < 0 || fz < 0 || fx > N || fz > N) return RMAX; return dist[fz * NV + fx]; } };
}

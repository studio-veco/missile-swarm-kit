// 操縦席の表示（機種ごと）：HUD の照準器・速度・高度・方位と、レーダー（MFD）と、ミサイルの警報
//   west  … F-16（B スコープ＋警戒表示）／F-22（真上から見た戦術状況画面）／F-2A（AESA の B スコープ＋日本語の警報）
//   rus   … Su-37（推力偏向の表示）／MiG-29（赤外線捜索の表示）：黄緑の照準器、掃引線が回る丸いレーダー、キリル文字
//   sf    … デルフィナス：画面全体のホログラム表示（立体レーダー盤・脅威の一覧・照準の枠・極太明朝の警報）
import * as THREE from '../vendor/three.module.js';
import { jetState, missileState, PLANET_C } from './sim.js';

const MONO = '"JetBrains Mono", "SF Mono", Menlo, monospace';
const GOTHIC = '"Zen Kaku Gothic New", "Hiragino Sans", sans-serif';
const HEAVY = '"Noto Serif JP", "Hiragino Mincho ProN", serif';
const PC = new THREE.Vector3(...PLANET_C);

export const HUD_STYLE = { delphinus: 'sf', f22: 'west', f16: 'west', f2a: 'west', su37: 'rus', mig29: 'rus' };

// 戦闘機と、まわりの弾（距離・近づく速さ・画面の位置）
function situation(sim, s, camera) {
  const J = jetState(sim.jet, s);
  const P = new THREE.Vector3(...J.p), V = new THREE.Vector3(...J.v);
  const q = new THREE.Quaternion(...J.q);
  const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(q), bodyUp = new THREE.Vector3(0, 1, 0).applyQuaternion(q), right = new THREE.Vector3(-1, 0, 0).applyQuaternion(q);
  const up = P.clone().sub(PC).normalize();
  const pitch = Math.asin(Math.max(-1, Math.min(1, nose.dot(up))));
  const bank = Math.atan2(-right.dot(up), bodyUp.dot(up));
  const north = new THREE.Vector3(0, 0, 1).addScaledVector(up, -up.z).normalize();
  const east = new THREE.Vector3().crossVectors(up, north);
  const heading = (Math.atan2(nose.dot(east), nose.dot(north)) * 180 / Math.PI + 360) % 360;
  const threats = [];
  const tmp = new THREE.Vector3();
  for (const m of sim.missiles) {
    const st = missileState(m, s); if (!st) continue;
    const mp = new THREE.Vector3(...st.p);
    const rel = mp.clone().sub(P), dist = rel.length();
    const st0 = missileState(m, s - 0.05);
    const mv = st0 ? mp.clone().sub(tmp.set(...st0.p)).divideScalar(0.05) : new THREE.Vector3(...st.d).multiplyScalar(560);
    const closing = -rel.clone().normalize().dot(mv.clone().sub(V));
    const scr = mp.clone().project(camera);
    threats.push({
      m, rel, dist, closing, ttg: closing > 1 ? dist / closing : Infinity,
      fwd: rel.dot(nose), rt: rel.dot(right), upb: rel.dot(bodyUp), hdg: Math.atan2(mv.dot(right), mv.dot(nose)),
      sx: scr.x, sy: scr.y, on: scr.z < 1 && Math.abs(scr.x) < 1 && Math.abs(scr.y) < 1,
    });
  }
  threats.sort((a, b) => a.dist - b.dist);
  return { J, P, V, nose, right, bodyUp, up, pitch, bank, heading, threats, speed: V.length() };
}

export function makeCockpitHUD(g, W, H) {
  const S = H / 1080;
  const txt = (t, x, y, font, color, align = 'left', base = 'alphabetic') => { g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = base; g.fillText(t, x, y); };
  const panel = (x, y, w, h, fill, stroke, cut = 0) => {
    g.beginPath(); g.moveTo(x + cut, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h - cut); g.lineTo(x + w - cut, y + h); g.lineTo(x, y + h); g.lineTo(x, y + cut); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.stroke(); }
  };

  // ---------- 共通：照準器（ピッチの梯子・機首の印・速度・高度・方位） ----------
  function ladder(c, col, o) {
    const cx = W / 2, cy = H * 0.47;
    // 照準ガラスの薄い下地（白い地面の上でも線が読める）
    { const bg = g.createRadialGradient(cx, cy, 40 * S, cx, cy, 420 * S); bg.addColorStop(0, 'rgba(0,14,10,0.30)'); bg.addColorStop(1, 'rgba(0,14,10,0)'); g.fillStyle = bg; g.fillRect(cx - 440 * S, cy - 440 * S, 880 * S, 880 * S); }
    const f = (H / 2) / Math.tan((o.fov || 74) * Math.PI / 360);
    g.save();
    // 白い地面の上でも読めるよう、太めの線と暗いにじみの縁取り
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = (o.russian ? 2.8 : 2.6) * S;
    g.shadowColor = 'rgba(0,12,6,0.95)'; g.shadowBlur = 8 * S;
    g.save();
    g.beginPath(); g.rect(cx - 270 * S, cy - 240 * S, 540 * S, 480 * S); g.clip();
    g.translate(cx, cy); g.rotate(-c.bank);
    for (let d = -90; d <= 90; d += o.step || 10) {
      const a = (d * Math.PI / 180) - c.pitch;
      if (Math.abs(a) > 1.2) continue;
      const y = -f * Math.tan(a);
      if (o.russian) {
        // ロシア式：水平線は真ん中が切れた 1 本、ほかは短い線と数字
        const w = d === 0 ? 300 * S : 46 * S;
        g.beginPath(); g.moveTo(-w, y); g.lineTo(d === 0 ? -60 * S : -14 * S, y); g.moveTo(d === 0 ? 60 * S : 14 * S, y); g.lineTo(w, y); g.stroke();
        if (d !== 0) { g.font = `500 ${14 * S}px ${MONO}`; g.textAlign = 'left'; g.fillText(String(d), w + 6 * S, y + 5 * S); }
      } else {
        const w = d === 0 ? 240 * S : 90 * S;
        g.setLineDash(d < 0 ? [12 * S, 8 * S] : []);
        g.beginPath(); g.moveTo(-w, y); g.lineTo(-30 * S, y); g.moveTo(30 * S, y); g.lineTo(w, y); g.stroke();
        if (d !== 0) { g.beginPath(); g.moveTo(-w, y); g.lineTo(-w, y + (d > 0 ? 10 : -10) * S); g.moveTo(w, y); g.lineTo(w, y + (d > 0 ? 10 : -10) * S); g.stroke(); g.font = `500 ${15 * S}px ${MONO}`; g.textAlign = 'right'; g.fillText(String(Math.abs(d)), -w - 8 * S, y + 5 * S); }
      }
    }
    g.setLineDash([]);
    g.restore();
    // 機首の印
    if (o.russian) { g.beginPath(); g.arc(cx, cy, 9 * S, 0, Math.PI * 2); g.moveTo(cx - 34 * S, cy); g.lineTo(cx - 9 * S, cy); g.moveTo(cx + 9 * S, cy); g.lineTo(cx + 34 * S, cy); g.moveTo(cx, cy - 9 * S); g.lineTo(cx, cy - 22 * S); g.stroke(); }
    else { g.beginPath(); g.moveTo(cx - 40 * S, cy); g.lineTo(cx - 14 * S, cy); g.lineTo(cx - 7 * S, cy + 10 * S); g.lineTo(cx, cy); g.lineTo(cx + 7 * S, cy + 10 * S); g.lineTo(cx + 14 * S, cy); g.lineTo(cx + 40 * S, cy); g.stroke(); }
    // 速度・高度（西側：ノットとフィートの箱／ロシア：km/h と m）
    const kt = c.speed * 1.944, kmh = c.speed * 3.6;
    if (o.russian) {
      txt(o.lab.spd, cx - 330 * S, cy - 26 * S, `500 ${14 * S}px ${MONO}`, col);
      txt(kmh.toFixed(0), cx - 330 * S, cy + 8 * S, `700 ${24 * S}px ${MONO}`, col);
      txt(o.lab.alt, cx + 250 * S, cy - 26 * S, `500 ${14 * S}px ${MONO}`, col);
      txt(Math.max(0, c.J.alt).toFixed(0), cx + 250 * S, cy + 8 * S, `700 ${24 * S}px ${MONO}`, col);
      txt(`${o.lab.g} ${c.J.g.toFixed(1)}`, cx - 330 * S, cy + 44 * S, `500 ${16 * S}px ${MONO}`, col);
      // 傾きの弧（下）
      g.beginPath(); g.arc(cx, cy, 200 * S, Math.PI * 0.62, Math.PI * 0.38, true); g.stroke();
      for (let k = -3; k <= 3; k++) { const a = Math.PI / 2 + k * Math.PI / 12; g.beginPath(); g.moveTo(cx + Math.cos(a) * 200 * S, cy + Math.sin(a) * 200 * S); g.lineTo(cx + Math.cos(a) * 212 * S, cy + Math.sin(a) * 212 * S); g.stroke(); }
      const ba = Math.PI / 2 + Math.max(-0.9, Math.min(0.9, c.bank));
      g.beginPath(); g.moveTo(cx + Math.cos(ba) * 196 * S, cy + Math.sin(ba) * 196 * S); g.lineTo(cx + Math.cos(ba - 0.03) * 182 * S, cy + Math.sin(ba - 0.03) * 182 * S); g.lineTo(cx + Math.cos(ba + 0.03) * 182 * S, cy + Math.sin(ba + 0.03) * 182 * S); g.closePath(); g.fill();
    } else {
      g.strokeRect(cx - 330 * S, cy - 18 * S, 110 * S, 36 * S);
      txt(kt.toFixed(0), cx - 275 * S, cy + 8 * S, `700 ${22 * S}px ${MONO}`, col, 'center');
      g.strokeRect(cx + 220 * S, cy - 18 * S, 120 * S, 36 * S);
      txt(Math.max(0, c.J.alt * 3.28).toFixed(0), cx + 280 * S, cy + 8 * S, `700 ${22 * S}px ${MONO}`, col, 'center');
      txt(`G ${c.J.g.toFixed(1)}`, cx - 330 * S, cy + 60 * S, `500 ${16 * S}px ${MONO}`, col);
      txt(`M ${(c.speed / 300).toFixed(2)}`, cx - 330 * S, cy + 84 * S, `500 ${16 * S}px ${MONO}`, col);
      // 方位の目盛り（上）
      for (let d = -40; d <= 40; d += 5) {
        const v = Math.round((c.heading + d) / 5) * 5, x = cx + (v - c.heading) * 6 * S;
        if (Math.abs(x - cx) > 230 * S) continue;
        g.beginPath(); g.moveTo(x, cy - 250 * S); g.lineTo(x, cy - 250 * S + (v % 10 === 0 ? 14 : 7) * S); g.stroke();
        if (v % 10 === 0) txt(String((((v % 360) + 360) % 360) / 10 | 0).padStart(2, '0'), x, cy - 258 * S, `500 ${15 * S}px ${MONO}`, col, 'center');
      }
    }
    g.restore();
  }

  // 画面の中の弾に印（西側：菱形、ロシア：丸）。近い順に最大 n 本
  function marks(c, col, shape, n = 12) {
    g.save(); g.strokeStyle = col; g.lineWidth = 2 * S; g.shadowColor = 'rgba(0,12,6,0.95)'; g.shadowBlur = 6 * S;
    let k = 0;
    for (const t of c.threats) {
      if (k >= n || t.dist > 2500) break;
      if (!t.on) continue;
      const x = (t.sx * 0.5 + 0.5) * W, y = (-t.sy * 0.5 + 0.5) * H, r = (14 + 30 * Math.max(0, 1 - t.dist / 1500)) * S;
      g.beginPath();
      if (shape === 'circle') g.arc(x, y, r, 0, Math.PI * 2);
      else { g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); }
      g.stroke();
      txt(`${(t.dist / 1000).toFixed(1)}`, x + r + 4 * S, y - 4 * S, `500 ${12 * S}px ${MONO}`, col);
      k++;
    }
    g.restore();
  }

  // MFD の枠
  function mfd(x, y, w, h, col, title, sub) {
    g.save();
    panel(x, y, w, h, 'rgba(2,8,6,0.72)', null);
    g.strokeStyle = col; g.lineWidth = 1.2 * S; g.globalAlpha = 0.85;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.globalAlpha = 1;
    txt(title, x + 10 * S, y + 20 * S, `700 ${13 * S}px ${MONO}`, col);
    if (sub) txt(sub, x + w - 10 * S, y + 20 * S, `500 ${12 * S}px ${MONO}`, col, 'right');
    g.restore();
  }

  // B スコープ：横＝方位（±60°）、縦＝距離。F-16 / F-2A
  function bScope(c, x, y, w, h, col, label, rangeKm) {
    mfd(x, y, w, h, col, label, `${rangeKm}`);
    const ix = x + 14 * S, iy = y + 30 * S, iw = w - 28 * S, ih = h - 44 * S;
    g.save(); g.strokeStyle = col; g.globalAlpha = 0.35; g.lineWidth = 1 * S;
    for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(ix, iy + ih * k / 4); g.lineTo(ix + iw, iy + ih * k / 4); g.stroke(); g.beginPath(); g.moveTo(ix + iw * k / 4, iy); g.lineTo(ix + iw * k / 4, iy + ih); g.stroke(); }
    g.globalAlpha = 1;
    const R = rangeKm * 1000;
    for (const t of c.threats) {
      if (t.fwd <= 0 || t.dist > R) continue;
      const az = Math.atan2(t.rt, t.fwd); if (Math.abs(az) > Math.PI / 3) continue;
      const bx = ix + (az / (Math.PI / 3) * 0.5 + 0.5) * iw, by = iy + ih * (1 - Math.sqrt(t.dist / R));
      const sz = (t.m.kind === 'pod' ? 8 : 5) * S;
      g.fillStyle = t.closing > 0 ? col : 'rgba(200,255,220,0.5)';
      g.fillRect(bx - sz / 2, by - sz / 2, sz, sz);
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.sin(t.hdg) * 12 * S, by - Math.cos(t.hdg) * 12 * S); g.strokeStyle = col; g.stroke();
    }
    g.restore();
  }
  // 警戒表示（RWR）：全周の方位に脅威の印
  function rwr(c, cx, cy, R, col, warnCol) {
    mfd(cx - R - 14 * S, cy - R - 34 * S, 2 * R + 28 * S, 2 * R + 48 * S, col, 'RWR', null);
    g.save(); g.strokeStyle = col; g.lineWidth = 1.2 * S; g.globalAlpha = 0.6;
    for (const k of [1, 0.5]) { g.beginPath(); g.arc(cx, cy + 6 * S, R * k, 0, Math.PI * 2); g.stroke(); }
    g.globalAlpha = 1;
    for (const t of c.threats.slice(0, 10)) {
      if (t.dist > 6000) continue;
      const a = Math.atan2(t.rt, t.fwd), rr = (0.25 + 0.75 * t.dist / 6000) * R;
      txt(t.m.kind === 'pod' ? 'P' : 'M', cx + Math.sin(a) * rr, cy + 6 * S - Math.cos(a) * rr + 5 * S, `700 ${14 * S}px ${MONO}`, t.dist < 1500 ? warnCol : col, 'center');
    }
    g.restore();
  }
  // F-22：真上から見た戦術状況画面（自機は下寄りの三角、距離の輪、脅威は向きつきの印）
  function tsd(c, x, y, w, h, col, warnCol) {
    mfd(x, y, w, h, col, 'TSD', '4 NM');
    const cx = x + w / 2, cy = y + h * 0.58, R = h * 0.4;
    g.save(); g.beginPath(); g.rect(x + 2 * S, y + 26 * S, w - 4 * S, h - 28 * S); g.clip();
    g.strokeStyle = col; g.lineWidth = 1 * S; g.globalAlpha = 0.45;
    const RM = 7400, rs = (d) => Math.sqrt(Math.min(1, d / RM)) * R; // close threats spread out
    for (const d of [500, 2000, 7400]) { g.beginPath(); g.arc(cx, cy, rs(d), 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    g.globalAlpha = 1;
    txt('0.5', cx + rs(500) + 3 * S, cy - 3 * S, `500 ${10 * S}px ${MONO}`, col); txt('2', cx + rs(2000) + 3 * S, cy - 3 * S, `500 ${10 * S}px ${MONO}`, col);
    for (const t of c.threats) {
      if (t.dist > RM) continue;
      const hd = Math.atan2(t.rt, t.fwd), rr = rs(Math.hypot(t.rt, t.fwd));
      const bx = cx + Math.sin(hd) * rr, by = cy - Math.cos(hd) * rr;
      const near = t.dist < 1500;
      g.save(); g.translate(bx, by); g.rotate(t.hdg);
      g.fillStyle = near ? warnCol : 'rgba(255,190,80,0.95)';
      const z = (t.m.kind === 'pod' ? 9 : 6) * S;
      g.beginPath(); g.moveTo(0, -z); g.lineTo(z * 0.7, z * 0.7); g.lineTo(-z * 0.7, z * 0.7); g.closePath(); g.fill();
      g.restore();
    }
    // 自機
    g.fillStyle = col; g.beginPath(); g.moveTo(cx, cy - 10 * S); g.lineTo(cx + 7 * S, cy + 7 * S); g.lineTo(cx - 7 * S, cy + 7 * S); g.closePath(); g.fill();
    g.restore();
  }
  // ロシア式：掃引線が回る丸いレーダー
  function ppi(c, cx, cy, R, col, T, label, rangeKm) {
    g.save();
    g.fillStyle = 'rgba(4,10,2,0.72)'; g.beginPath(); g.arc(cx, cy, R + 16 * S, 0, Math.PI * 2); g.fill();
    g.strokeStyle = col; g.lineWidth = 1.2 * S;
    for (const k of [1, 0.66, 0.33]) { g.globalAlpha = k === 1 ? 0.9 : 0.4; g.beginPath(); g.arc(cx, cy, R * k, 0, Math.PI * 2); g.stroke(); }
    g.globalAlpha = 0.4; for (let a = 0; a < 12; a++) { const t = a * Math.PI / 6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(t) * R, cy - Math.cos(t) * R); g.stroke(); }
    // 掃引
    const sw = (T * 2.4) % (Math.PI * 2);
    const grd = g.createConicGradient ? g.createConicGradient(sw - Math.PI / 2 - 0.6, cx, cy) : null;
    if (grd) { grd.addColorStop(0, 'rgba(200,255,90,0)'); grd.addColorStop(0.09, 'rgba(200,255,90,0.32)'); grd.addColorStop(0.0955, 'rgba(200,255,90,0)'); g.globalAlpha = 1; g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
    const RM = rangeKm * 1000;
    for (const t of c.threats) {
      if (t.dist > RM) continue;
      const a = Math.atan2(t.rt, t.fwd), rr = Math.sqrt(t.dist / RM) * R;
      // 掃引が通った直後ほど明るい
      let age = ((sw - ((a + Math.PI * 2) % (Math.PI * 2))) + Math.PI * 4) % (Math.PI * 2);
      const br = Math.max(0.25, 1 - age / (Math.PI * 1.5));
      g.fillStyle = `rgba(220,255,120,${br})`;
      g.beginPath(); g.arc(cx + Math.sin(a) * rr, cy - Math.cos(a) * rr, (t.m.kind === 'pod' ? 5 : 3) * S, 0, Math.PI * 2); g.fill();
    }
    txt(label, cx - R, cy - R - 4 * S, `700 ${14 * S}px ${MONO}`, col);
    txt(`${rangeKm} км`, cx + R, cy - R - 4 * S, `500 ${12 * S}px ${MONO}`, col, 'right');
    g.restore();
  }

  // ---------- 西側（F-16 / F-22 / F-2A） ----------
  function drawWest(type, c, o) {
    const G = type === 'f22' ? 'rgba(130,255,190,0.95)' : 'rgba(120,255,200,0.92)';
    const R = 'rgba(255,60,110,0.95)';
    if (!o.lookback) { ladder(c, G, { fov: o.fov }); marks(c, G, 'diamond'); }
    const near = c.threats.find((t) => t.m.kind === 'mini' && t.dist < 1600);
    const bw = 300 * S, bh = 230 * S, by = H - bh - 40 * S;
    if (type === 'f22') {
      tsd(c, W / 2 - 200 * S, H - 300 * S - 30 * S, 400 * S, 300 * S, G, R);
      txt('F-22A  APG-77', 40 * S, H - 40 * S, `500 ${13 * S}px ${MONO}`, G);
    } else if (type === 'f16') {
      bScope(c, 40 * S, by, bw, bh, G, 'RWS  APG-68', 10);
      rwr(c, W - 40 * S - 120 * S, by + 130 * S, 92 * S, G, R);
    } else {
      bScope(c, 40 * S, by, bw, bh, G, 'AESA  J/APG-1', 10);
      rwr(c, W - 40 * S - 120 * S, by + 130 * S, 92 * S, G, R);
    }
    // 警報
    if (near && c.s > 3.6) {
      const blink = Math.floor(o.T * 6) % 2 === 0;
      const wy = o.lookback ? H * 0.2 : H * 0.47 + 150 * S;
      if (blink) { g.save(); g.strokeStyle = R; g.lineWidth = 3 * S; g.strokeRect(W / 2 - 160 * S, wy - 30 * S, 320 * S, 50 * S); g.restore(); txt(type === 'f2a' ? 'ミサイル接近' : 'MISSILE', W / 2, wy + 9 * S, `700 ${type === 'f2a' ? 28 : 30}px ${type === 'f2a' ? GOTHIC : MONO}`.replace(/(\d+)px/, (_, n) => `${n * S}px`), R, 'center'); }
      txt(`× ${c.threats.filter((t) => t.m.kind === 'mini' && t.dist < 3000).length}`, W / 2, wy + 52 * S, `700 ${22 * S}px ${MONO}`, 'rgba(255,90,150,0.9)', 'center');
    }
  }

  // ---------- ロシア式（Su-37 / MiG-29） ----------
  const RUS = { spd: 'V КМ/Ч', alt: 'H М', g: 'n' };
  function drawRus(type, c, o) {
    const Y = 'rgba(205,255,105,0.95)', R = 'rgba(255,70,60,0.95)';
    if (!o.lookback) { ladder(c, Y, { fov: o.fov, russian: true, lab: RUS, step: 10 }); marks(c, Y, 'circle'); }
    ppi(c, 40 * S + 130 * S, H - 40 * S - 140 * S, 120 * S, Y, o.T, type === 'su37' ? 'РЛС  Н011М' : 'РЛС  Н019', 10);
    // 右下：機種ごとの表示
    const px = W - 360 * S, py = H - 220 * S;
    mfd(px, py, 320 * S, 180 * S, Y, type === 'su37' ? 'ОВТ  ВЕКТОР ТЯГИ' : 'ОЛС  ТЕПЛОПЕЛЕНГ', null);
    g.save(); g.strokeStyle = Y; g.fillStyle = Y; g.lineWidth = 1.4 * S;
    if (type === 'su37') {
      // 推力偏向：ノズルの向き（縦の速さから）
      const J0 = jetState(o.sim.jet, Math.max(0, c.s - 0.1));
      const prate = (c.pitch - Math.asin(Math.max(-1, Math.min(1, new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...J0.q)).dot(c.up))))) / 0.1;
      const def = Math.max(-1, Math.min(1, prate / 0.8));
      const ox = px + 160 * S, oy = py + 100 * S;
      g.strokeRect(ox - 110 * S, oy - 55 * S, 220 * S, 110 * S);
      g.beginPath(); g.moveTo(ox - 110 * S, oy); g.lineTo(ox + 110 * S, oy); g.stroke();
      g.beginPath(); g.arc(ox, oy - def * 50 * S, 9 * S, 0, Math.PI * 2); g.fill();
      txt(`${(def * 15).toFixed(0)}°`, ox + 118 * S, oy + 5 * S, `700 ${16 * S}px ${MONO}`, Y);
    } else {
      // 赤外線：前方の熱源を点で
      const ox = px + 160 * S, oy = py + 100 * S;
      g.strokeRect(ox - 120 * S, oy - 60 * S, 240 * S, 120 * S);
      g.globalAlpha = 0.45; g.beginPath(); g.moveTo(ox - 120 * S, oy); g.lineTo(ox + 120 * S, oy); g.moveTo(ox, oy - 60 * S); g.lineTo(ox, oy + 60 * S); g.stroke();
      const scan = ox + Math.sin(o.T * 1.6) * 116 * S; g.globalAlpha = 0.8; g.beginPath(); g.moveTo(scan, oy - 58 * S); g.lineTo(scan, oy + 58 * S); g.stroke(); g.globalAlpha = 1;
      for (const t of c.threats) {
        if (t.fwd <= 0 || t.dist > 6000) continue;
        const ax = Math.atan2(t.rt, t.fwd), ay = Math.atan2(t.upb, t.fwd);
        if (Math.abs(ax) > 0.9 || Math.abs(ay) > 0.45) continue;
        g.beginPath(); g.arc(ox + ax / 0.9 * 118 * S, oy - ay / 0.45 * 58 * S, (2 + 3 * (1 - t.dist / 6000)) * S, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
    const near = c.threats.find((t) => t.m.kind === 'mini' && t.dist < 1600);
    if (near && c.s > 3.6 && Math.floor(o.T * 5) % 2 === 0) {
      const wy = o.lookback ? H * 0.2 : H * 0.47 + 150 * S;
      txt('РАКЕТА', W / 2, wy + 9 * S, `700 ${34 * S}px ${MONO}`, R, 'center');
      txt(`${(near.dist).toFixed(0)} М`, W / 2, wy + 44 * S, `700 ${20 * S}px ${MONO}`, R, 'center');
    }
  }

  // ---------- デルフィナス：画面全体のホログラム表示 ----------
  const CY = 'rgba(111,240,230,', AM = 'rgba(255,184,82,', MG = 'rgba(255,61,154,';
  function glowLine(col, w, blur) { g.strokeStyle = col; g.lineWidth = w * S; g.shadowColor = col; g.shadowBlur = blur * S; }
  function hexPatch(x0, y0, cols, rows, r, alpha) {
    g.save(); g.strokeStyle = `${CY}${alpha})`; g.lineWidth = 1 * S; g.shadowBlur = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = x0 + i * r * 1.5, y = y0 + j * r * 1.732 + (i % 2) * r * 0.866;
      g.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; g.lineTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92); } g.closePath(); g.stroke();
    }
    g.restore();
  }
  function drawSF(c, o) {
    const T = o.T, cx = W / 2, cy = H * 0.46;
    const near = c.threats.filter((t) => t.m.kind === 'mini');
    const close = near.length ? near[0] : null;
    const danger = close ? Math.max(0, 1 - close.dist / 900) : 0;
    g.save();
    // 画面の縁：全天周の映写面の端（暗い縁と、角を切った細い枠）
    const vg = g.createRadialGradient(cx, cy, H * 0.35, cx, cy, H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,10,14,${0.55 + 0.2 * danger})`);
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    glowLine(`${CY}0.55)`, 1.2, 6);
    const m = 26 * S, cut = 46 * S;
    g.beginPath(); g.moveTo(m + cut, m); g.lineTo(W - m - cut, m); g.lineTo(W - m, m + cut); g.lineTo(W - m, H - m - cut); g.lineTo(W - m - cut, H - m); g.lineTo(m + cut, H - m); g.lineTo(m, H - m - cut); g.lineTo(m, m + cut); g.closePath(); g.stroke();
    hexPatch(m + 8 * S, m + 60 * S, 5, 4, 16 * S, 0.12);
    hexPatch(W - m - 120 * S, H - m - 160 * S, 5, 4, 16 * S, 0.12);
    // 走査線のゆらぎ
    const sy = ((T * 0.37) % 1) * H;
    g.fillStyle = `${CY}0.05)`; g.fillRect(0, sy, W, 3 * S);

    // 上：状態の帯（推力・荷重・速度・高度）
    const items = [['推力', 'THR', c.J.thr, `${(c.J.thr * 100).toFixed(0)}%`], ['荷重', 'G', Math.min(1, c.J.g / 15), `${c.J.g.toFixed(1)}`], ['速度', 'SPD', Math.min(1, c.speed / 420), `${c.speed.toFixed(0)}`], ['高度', 'ALT', Math.min(1, c.J.alt / 3000), `${Math.max(0, c.J.alt).toFixed(0)}`]];
    const bw = 210 * S, bx0 = cx - (items.length * bw) / 2;
    items.forEach(([ja, en, v, val], i) => {
      const x = bx0 + i * bw + 10 * S, y = 62 * S;
      txt(ja, x, y, `900 ${20 * S}px ${HEAVY}`, `${CY}0.95)`);
      txt(en, x + 50 * S, y, `500 ${11 * S}px ${MONO}`, `${CY}0.6)`);
      txt(val, x + bw - 24 * S, y, `700 ${18 * S}px ${MONO}`, i === 1 && c.J.g > 9 ? `${MG}1)` : 'rgba(235,255,252,0.95)', 'right');
      const segs = 18;
      for (let k = 0; k < segs; k++) { g.fillStyle = k / segs < v ? (i === 1 && k / segs > 0.6 ? `${MG}0.9)` : `${CY}0.85)`) : `${CY}0.14)`; g.fillRect(x + k * ((bw - 34 * S) / segs), y + 10 * S, (bw - 34 * S) / segs - 2 * S, 8 * S); }
    });

    if (!o.lookback) {
      // 中央：回る照準の輪と、傾き・ピッチ
      glowLine(`${CY}0.85)`, 1.6, 10);
      g.save(); g.translate(cx, cy);
      g.rotate(-c.bank);
      for (const [r, a0, a1, sp] of [[150, 0.2, 1.3, 0.3], [150, Math.PI + 0.2, Math.PI + 1.3, 0.3], [178, -0.5, 0.5, -0.18], [178, Math.PI - 0.5, Math.PI + 0.5, -0.18]]) {
        g.beginPath(); g.arc(0, 0, r * S, a0 + T * sp, a1 + T * sp); g.stroke();
      }
      // 地平（目盛りつきの水平線、ピッチで上下）
      const f = (H / 2) / Math.tan((o.fov || 74) * Math.PI / 360);
      const hy = f * Math.tan(c.pitch);
      g.beginPath(); g.moveTo(-420 * S, hy); g.lineTo(-200 * S, hy); g.moveTo(200 * S, hy); g.lineTo(420 * S, hy); g.stroke();
      for (let k = -4; k <= 4; k++) { if (!k) continue; const yy = hy - k * f * Math.tan(10 * Math.PI / 180); if (Math.abs(yy) > 300 * S) continue; g.globalAlpha = 0.6; g.beginPath(); g.moveTo(-230 * S, yy); g.lineTo(-200 * S, yy); g.moveTo(200 * S, yy); g.lineTo(230 * S, yy); g.stroke(); g.globalAlpha = 1; }
      g.restore();
      // 機首の印
      g.beginPath(); g.moveTo(cx - 26 * S, cy); g.lineTo(cx - 8 * S, cy); g.moveTo(cx + 8 * S, cy); g.lineTo(cx + 26 * S, cy); g.moveTo(cx, cy - 8 * S); g.lineTo(cx, cy - 18 * S); g.stroke();
      g.beginPath(); g.arc(cx, cy, 4 * S, 0, Math.PI * 2); g.stroke();
      // 方位（弧の上）
      for (let d = -30; d <= 30; d += 10) {
        const v = Math.round((c.heading + d) / 10) * 10, a = -Math.PI / 2 + (v - c.heading) * Math.PI / 180 * 1.2;
        const x = cx + Math.cos(a) * 205 * S, y = cy + Math.sin(a) * 205 * S;
        txt(String((((v % 360) + 360) % 360)).padStart(3, '0'), x, y, `500 ${12 * S}px ${MONO}`, `${CY}0.8)`, 'center');
      }

      // 画面の中の弾：六角の枠、距離、迫る弾は桃色、いちばん近い弾へ照準から線
      g.shadowBlur = 8 * S;
      let k = 0;
      for (const t of near) {
        if (k >= 14 || t.dist > 3000) break;
        if (!t.on) continue;
        const x = (t.sx * 0.5 + 0.5) * W, y = (-t.sy * 0.5 + 0.5) * H;
        const hot = t.dist < 700 && t.closing > 0;
        const r = (16 + 34 * Math.max(0, 1 - t.dist / 1600)) * S;
        g.strokeStyle = hot ? `${MG}0.95)` : `${CY}0.8)`; g.shadowColor = g.strokeStyle; g.lineWidth = (hot ? 2 : 1.2) * S;
        g.beginPath(); for (let j = 0; j < 6; j++) { const a = j * Math.PI / 3 + T * (hot ? 2 : 0.6); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.closePath(); g.stroke();
        txt(`${t.dist.toFixed(0)}`, x + r + 6 * S, y - 2 * S, `700 ${13 * S}px ${MONO}`, hot ? `${MG}1)` : `${CY}0.9)`);
        if (t.ttg < 5) txt(`T-${t.ttg.toFixed(1)}`, x + r + 6 * S, y + 14 * S, `500 ${11 * S}px ${MONO}`, `${AM}0.95)`);
        if (k === 0) { g.setLineDash([6 * S, 6 * S]); g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke(); g.setLineDash([]); }
        k++;
      }
      // 回避の向き（いちばん近い弾の反対へ）
      if (close && close.dist < 1200) {
        const a = Math.atan2(-close.upb, -close.rt);
        const ax = cx + Math.cos(a) * 120 * S, ay = cy - Math.sin(a) * 120 * S;
        g.save(); g.translate(ax, ay); g.rotate(-a);
        g.fillStyle = `${AM}${0.5 + 0.5 * Math.abs(Math.sin(T * 8))})`; g.shadowColor = `${AM}1)`; g.shadowBlur = 12 * S;
        g.beginPath(); g.moveTo(26 * S, 0); g.lineTo(-10 * S, -16 * S); g.lineTo(-4 * S, 0); g.lineTo(-10 * S, 16 * S); g.closePath(); g.fill();
        g.restore();
        txt('回避', ax + Math.cos(a) * 40 * S, ay - Math.sin(a) * 40 * S + 8 * S, `900 ${22 * S}px ${HEAVY}`, `${AM}0.95)`, 'center');
      }
    }

    // 下：立体レーダー盤（傾けた円盤に弾を置き、高さの差を棒で）
    const rx = cx, ry = H - 150 * S, RX = 300 * S, RY = 96 * S, RM = 4000;
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(0,30,34,0.42)'; g.beginPath(); g.ellipse(rx, ry, RX + 10 * S, RY + 6 * S, 0, 0, Math.PI * 2); g.fill();
    glowLine(`${CY}0.7)`, 1.2, 8);
    for (const k of [1, 0.5, 0.25]) { g.globalAlpha = k === 1 ? 1 : 0.5; g.beginPath(); g.ellipse(rx, ry, RX * k, RY * k, 0, 0, Math.PI * 2); g.stroke(); }
    g.globalAlpha = 0.35;
    for (let a = 0; a < 8; a++) { const t = a * Math.PI / 4; g.beginPath(); g.moveTo(rx, ry); g.lineTo(rx + Math.sin(t) * RX, ry - Math.cos(t) * RY); g.stroke(); }
    g.globalAlpha = 1;
    // 掃引
    const sw = (T * 1.7) % (Math.PI * 2);
    g.save(); g.translate(rx, ry); g.scale(1, RY / RX);
    const grd = g.createConicGradient ? g.createConicGradient(sw - Math.PI / 2 - 0.9, 0, 0) : null;
    if (grd) { grd.addColorStop(0, `${CY}0)`); grd.addColorStop(0.14, `${CY}0.28)`); grd.addColorStop(0.145, `${CY}0)`); g.fillStyle = grd; g.beginPath(); g.arc(0, 0, RX, 0, Math.PI * 2); g.fill(); }
    g.restore();
    txt('1 km', rx + RX * 0.25 + 4 * S, ry + 4 * S, `500 ${10 * S}px ${MONO}`, `${CY}0.6)`);
    txt('2 km', rx + RX * 0.5 + 4 * S, ry + 4 * S, `500 ${10 * S}px ${MONO}`, `${CY}0.6)`);
    txt('4 km', rx + RX + 6 * S, ry + 4 * S, `500 ${10 * S}px ${MONO}`, `${CY}0.6)`);
    // 弾（遠い順に描く）
    const onDisc = near.filter((t) => t.dist < RM).slice().reverse();
    for (const t of onDisc) {
      const sc = Math.min(1, Math.sqrt(Math.hypot(t.rt, t.fwd) / RM)); // 近くを大きく
      const hd = Math.atan2(t.rt, t.fwd);
      const bx = rx + Math.sin(hd) * sc * RX, by = ry - Math.cos(hd) * sc * RY;
      const hy = by - Math.max(-60, Math.min(60, t.upb / 25)) * S;
      const hot = t.dist < 700 && t.closing > 0;
      g.strokeStyle = hot ? `${MG}0.8)` : `${CY}0.45)`; g.lineWidth = 1 * S;
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx, hy); g.stroke();
      g.fillStyle = hot ? `${MG}1)` : `${CY}0.95)`; g.shadowColor = g.fillStyle; g.shadowBlur = 8 * S;
      g.beginPath(); g.arc(bx, hy, (hot ? 4 : 2.6) * S, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
    }
    // 自機
    g.fillStyle = 'rgba(235,255,252,0.95)'; g.beginPath(); g.moveTo(rx, ry - 9 * S); g.lineTo(rx + 7 * S, ry + 6 * S); g.lineTo(rx - 7 * S, ry + 6 * S); g.closePath(); g.fill();
    txt('全周索敵', rx - RX, ry - RY - 14 * S, `900 ${18 * S}px ${HEAVY}`, `${CY}0.95)`);
    txt('HOLO-RADAR 4KM', rx - RX + 92 * S, ry - RY - 14 * S, `500 ${11 * S}px ${MONO}`, `${CY}0.6)`);

    // 左：迫る弾の一覧
    const lx = m + 24 * S, ly = H * 0.30;
    panel(lx, ly, 290 * S, 320 * S, 'rgba(0,22,26,0.48)', `${CY}0.5)`, 18 * S);
    txt('接近脅威', lx + 14 * S, ly + 30 * S, `900 ${20 * S}px ${HEAVY}`, `${CY}0.95)`);
    txt(`${near.filter((t) => t.dist < 3000).length}`, lx + 276 * S, ly + 30 * S, `700 ${22 * S}px ${MONO}`, near.length && near[0].dist < 700 ? `${MG}1)` : 'rgba(235,255,252,0.95)', 'right');
    near.slice(0, 9).forEach((t, i) => {
      const y = ly + 60 * S + i * 28 * S;
      const hot = t.dist < 700 && t.closing > 0;
      txt(`#${String(t.m.id).padStart(3, '0')}`, lx + 14 * S, y, `500 ${12 * S}px ${MONO}`, hot ? `${MG}1)` : `${CY}0.85)`);
      txt(`${t.dist.toFixed(0)}m`, lx + 110 * S, y, `700 ${13 * S}px ${MONO}`, 'rgba(235,255,252,0.9)', 'right');
      txt(t.closing > 0 ? `${t.closing.toFixed(0)}` : '---', lx + 170 * S, y, `500 ${12 * S}px ${MONO}`, `${AM}0.9)`, 'right');
      const v = Math.max(0, Math.min(1, 1 - t.dist / 3000));
      g.fillStyle = `${CY}0.15)`; g.fillRect(lx + 180 * S, y - 9 * S, 96 * S, 8 * S);
      g.fillStyle = hot ? `${MG}0.9)` : `${CY}0.8)`; g.fillRect(lx + 180 * S, y - 9 * S, 96 * S * v, 8 * S);
    });

    // 右：機体の状態（荷重の弧・機体の傾き）
    const rx2 = W - m - 24 * S - 250 * S, ry2 = H * 0.30;
    panel(rx2, ry2, 250 * S, 230 * S, 'rgba(0,22,26,0.48)', `${CY}0.5)`, 18 * S);
    txt('機体', rx2 + 14 * S, ry2 + 30 * S, `900 ${20 * S}px ${HEAVY}`, `${CY}0.95)`);
    txt('DELPHINUS', rx2 + 236 * S, ry2 + 30 * S, `500 ${11 * S}px ${MONO}`, `${CY}0.6)`, 'right');
    const gx = rx2 + 125 * S, gy = ry2 + 150 * S, gr = 70 * S;
    glowLine(`${CY}0.3)`, 6, 0); g.beginPath(); g.arc(gx, gy, gr, Math.PI * 0.8, Math.PI * 2.2); g.stroke();
    const gv = Math.max(0, Math.min(1, (c.J.g + 2) / 17));
    glowLine(c.J.g > 9 ? `${MG}0.95)` : `${CY}0.95)`, 6, 10); g.beginPath(); g.arc(gx, gy, gr, Math.PI * 0.8, Math.PI * (0.8 + 1.4 * gv)); g.stroke();
    txt(`${c.J.g.toFixed(1)}G`, gx, gy + 8 * S, `700 ${26 * S}px ${MONO}`, 'rgba(235,255,252,0.95)', 'center');
    g.save(); g.translate(gx, gy + 44 * S); g.rotate(-c.bank); glowLine(`${CY}0.8)`, 1.4, 6);
    g.beginPath(); g.moveTo(-36 * S, 0); g.lineTo(36 * S, 0); g.moveTo(0, 0); g.lineTo(0, -8 * S); g.stroke(); g.restore();

    // 上の帯：警報（危ないほど強く）。極太の明朝と斜めの縞
    if (close && close.dist < 1600 && c.s > 3.6) {
      const k = close.dist < 300 ? 1 : 0.6;
      const by = 100 * S, bh = 64 * S;
      g.save();
      g.globalAlpha = (0.55 + 0.45 * Math.abs(Math.sin(T * (close.dist < 300 ? 14 : 7)))) * k;
      g.fillStyle = 'rgba(40,0,14,0.55)'; g.fillRect(cx - 360 * S, by, 720 * S, bh);
      g.beginPath(); g.rect(cx - 360 * S, by, 720 * S, bh); g.clip();
      g.fillStyle = `${MG}0.85)`;
      for (let x = -40, i = 0; x < 760; x += 28, i++) { if (i % 2) continue; g.beginPath(); g.moveTo(cx - 360 * S + x * S, by + bh); g.lineTo(cx - 360 * S + (x + 14) * S, by + bh); g.lineTo(cx - 360 * S + (x + 34) * S, by); g.lineTo(cx - 360 * S + (x + 20) * S, by); g.closePath(); g.fill(); }
      g.restore();
      g.save(); g.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(T * 7));
      g.fillStyle = 'rgba(30,0,10,0.75)'; g.fillRect(cx - 220 * S, by + 6 * S, 440 * S, bh - 12 * S);
      txt(close.dist < 300 ? '直撃警報' : '接近警報', cx, by + 46 * S, `900 ${40 * S}px ${HEAVY}`, `${MG}1)`, 'center');
      g.restore();
      txt(`MISSILE ${close.dist.toFixed(0)}M  ×${near.filter((t) => t.dist < 1600).length}`, cx, by + bh + 22 * S, `700 ${14 * S}px ${MONO}`, `${MG}0.95)`, 'center');
    }
    g.restore();
  }

  return {
    draw(type, sim, s, T, cam, camera, lookback) {
      const c = situation(sim, s, camera); c.s = s;
      const o = { T, fov: cam.fov, lookback, sim };
      const style = HUD_STYLE[type] || 'west';
      if (style === 'sf') drawSF(c, o);
      else if (style === 'rus') drawRus(type, c, o);
      else drawWest(type, c, o);
    },
  };
}

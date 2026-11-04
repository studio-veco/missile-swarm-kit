// HUD・字幕（2D キャンバスに描いて最後に重ねる）
// tele：外から見る時の小さな計器と「残りの本数」／cockpit：操縦席の HUD／lookback：警報／seeker：ミサイルの目／map：地形図の凡例／card：画面いっぱいの極太明朝
import * as THREE from '../vendor/three.module.js';
import { jetState, missileState, DT, PLANET_C } from './sim.js';
import { makeCockpitHUD } from './cockpit_hud.js';

const MINCHO = '"Shippori Mincho B1", "Hiragino Mincho ProN", "Yu Mincho", serif';
// 極太明朝：Noto Serif JP の Black（900）
const HEAVY = '"Noto Serif JP", "Hiragino Mincho ProN", serif';
const GOTHIC = '"Zen Kaku Gothic New", "Hiragino Sans", "Yu Gothic", sans-serif';
const MONO = '"JetBrains Mono", "SF Mono", Menlo, monospace';
const PINK = '#ff3d9a', CYAN = '#27d6ff', HUDG = 'rgba(120,255,200,0.92)';

export async function loadFonts() {
  try {
    await Promise.all([
      document.fonts.load(`900 120px "Noto Serif JP"`, '追尾、限界。凌駕'),
      document.fonts.load(`700 30px "Zen Kaku Gothic New"`, 'studio veco残り航路ミサイル軌道等高線'),
      document.fonts.load(`500 30px "Zen Kaku Gothic New"`, '追尾ミサイル'),
      document.fonts.load(`700 24px "JetBrains Mono"`, '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
    ]);
  } catch {}
}

export function makeHud(W, H) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.premultiplyAlpha = true;
  const S = H / 1080; // 1080 を基準にした大きさ
  const ck = makeCockpitHUD(g, W, H);
  let craft = 'f2a';
  const PC = new THREE.Vector3(...PLANET_C);

  const text = (t, x, y, font, color, align = 'left', base = 'alphabetic') => { g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = base; g.fillText(t, x, y); };
  const aliveAt = (sim, s) => sim.missiles.filter((m) => m.kind === 'mini' && m.birth * DT <= s && m.death * DT > s).length;

  // 左上：studio veco
  function brand() {
    g.save();
    g.globalAlpha = 0.9;
    g.fillStyle = PINK; g.beginPath(); g.arc(64 * S, 62 * S, 6 * S, 0, Math.PI * 2); g.fill();
    g.letterSpacing = `${1.5 * S}px`;
    text('studio veco', 80 * S, 70 * S, `700 ${24 * S}px ${GOTHIC}`, '#fff');
    g.restore();
  }

  function tele(sim, s, T) {
    const J = jetState(sim.jet, s);
    const minis = sim.missiles.filter((m) => m.kind === 'mini');
    const launched = minis.filter((m) => m.birth * DT <= s);
    const alive = launched.filter((m) => m.death * DT > s).length;
    g.save();
    g.globalAlpha = 0.9;
    brand();
    // 左下：残りの本数（100 本の目盛り：生きている＝白、爆発した＝桃の点）
    if (launched.length) {
      text(String(alive).padStart(2, '0'), 64 * S, H - 92 * S, `700 ${64 * S}px ${MONO}`, '#fff');
      text('残り', 64 * S + 92 * S, H - 112 * S, `700 ${18 * S}px ${GOTHIC}`, 'rgba(255,255,255,0.75)');
      const x0 = 64 * S, y0 = H - 66 * S;
      // 1 波＝1 行（本数が多いほど詰める）
      const per = sim.cfg?.count || 50, dx = Math.min(9, 450 / per) * S;
      minis.forEach((m, i) => {
        const x = x0 + (i % per) * dx, y = y0 + Math.floor(i / per) * 10 * S;
        const born = m.birth * DT <= s, dead = m.death * DT <= s, sz = Math.min(5 * S, dx * 0.62);
        if (!born) { g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, y, sz, sz); return; }
        if (dead) {
          const a = s - m.death * DT;
          g.fillStyle = a < 0.4 ? '#fff' : PINK; g.globalAlpha = a < 0.4 ? 1 : 0.85; g.fillRect(x, y, sz, sz); g.globalAlpha = 0.9;
        } else { g.strokeStyle = '#fff'; g.lineWidth = 1.2 * S; g.strokeRect(x + 0.5, y + 0.5, sz * 0.9, sz * 0.9); }
      });
    }
    // 右下：機体の数字
    const sp = Math.hypot(...J.v);
    const rows = [['SPD', `${sp.toFixed(0)} m/s`], ['ALT', `${Math.max(0, J.alt).toFixed(0)} m`], ['G', `${J.g.toFixed(1)}`]];
    rows.forEach(([k, v], i) => {
      const y = H - 120 * S + i * 28 * S;
      text(k, W - 250 * S, y, `500 ${15 * S}px ${MONO}`, 'rgba(200,220,255,0.6)');
      text(v, W - 64 * S, y, `700 ${20 * S}px ${MONO}`, i === 2 && J.g > 9 ? PINK : '#fff', 'right');
    });
    g.restore();
  }

  // 操縦席の HUD（ピッチの梯子・速度・高度・G・警報）
  function cockpit(sim, s, T, cam, lookback) {
    const J = jetState(sim.jet, s);
    const q = new THREE.Quaternion(...J.q);
    const P = new THREE.Vector3(...J.p);
    const up = P.clone().sub(PC).normalize();
    const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(q), bodyUp = new THREE.Vector3(0, 1, 0).applyQuaternion(q), right = new THREE.Vector3(-1, 0, 0).applyQuaternion(q);
    const pitch = Math.asin(Math.max(-1, Math.min(1, nose.dot(up))));
    const bank = Math.atan2(-right.dot(up), bodyUp.dot(up));
    const near = sim.missiles.filter((m) => m.kind !== 'pod' || true).some((m) => { const st = missileState(m, s); return st && Math.hypot(st.p[0] - J.p[0], st.p[1] - J.p[1], st.p[2] - J.p[2]) < 1600; });
    const warn = s > 3.6 && near;
    g.save();
    if (!lookback) {
      const cx = W / 2, cy = H * 0.47;
      const f = (H / 2) / Math.tan((cam.fov || 74) * Math.PI / 360);
      g.strokeStyle = HUDG; g.fillStyle = HUDG; g.lineWidth = 2.4 * S;
      // 白い地面の上でも読めるように、暗い縁取りの影
      g.shadowColor = 'rgba(0,20,15,0.85)'; g.shadowBlur = 5 * S;
      // ピッチの梯子
      g.save();
      g.beginPath(); g.rect(cx - 260 * S, cy - 230 * S, 520 * S, 460 * S); g.clip();
      g.translate(cx, cy); g.rotate(-bank);
      for (let d = -90; d <= 90; d += 10) {
        const y = -f * Math.tan((d * Math.PI / 180) - pitch) ;
        if (Math.abs((d * Math.PI / 180) - pitch) > 1.2) continue;
        const w = d === 0 ? 240 * S : 90 * S;
        g.setLineDash(d < 0 ? [12 * S, 8 * S] : []);
        g.beginPath(); g.moveTo(-w, y); g.lineTo(-30 * S, y); g.moveTo(30 * S, y); g.lineTo(w, y); g.stroke();
        if (d !== 0) { g.font = `500 ${15 * S}px ${MONO}`; g.textAlign = 'right'; g.fillText(String(Math.abs(d)), -w - 8 * S, y + 5 * S); }
      }
      g.setLineDash([]);
      g.restore();
      // 機首の印
      g.beginPath(); g.moveTo(cx - 40 * S, cy); g.lineTo(cx - 14 * S, cy); g.lineTo(cx - 7 * S, cy + 10 * S); g.lineTo(cx, cy); g.lineTo(cx + 7 * S, cy + 10 * S); g.lineTo(cx + 14 * S, cy); g.lineTo(cx + 40 * S, cy); g.stroke();
      // 速度・高度
      const sp = Math.hypot(...J.v) * 1.944;
      g.strokeRect(cx - 330 * S, cy - 18 * S, 110 * S, 36 * S);
      g.font = `700 ${22 * S}px ${MONO}`; g.textAlign = 'center'; g.fillText(sp.toFixed(0), cx - 275 * S, cy + 8 * S);
      g.strokeRect(cx + 220 * S, cy - 18 * S, 120 * S, 36 * S);
      g.fillText(Math.max(0, J.alt * 3.28).toFixed(0), cx + 280 * S, cy + 8 * S);
      g.font = `500 ${16 * S}px ${MONO}`;
      g.textAlign = 'left'; g.fillText(`G ${J.g.toFixed(1)}`, cx - 330 * S, cy + 60 * S);
      g.fillText(`M ${(Math.hypot(...J.v) / 300).toFixed(2)}`, cx - 330 * S, cy + 84 * S);
      // 方位の目盛り
      const hd = Math.atan2(nose.x, nose.z) * 180 / Math.PI;
      for (let d = -40; d <= 40; d += 5) {
        const v = Math.round((hd + d) / 5) * 5, x = cx + (v - hd) * 6 * S;
        if (Math.abs(x - cx) > 230 * S) continue;
        g.beginPath(); g.moveTo(x, cy - 250 * S); g.lineTo(x, cy - 250 * S + (v % 10 === 0 ? 14 : 7) * S); g.stroke();
        if (v % 10 === 0) { g.textAlign = 'center'; g.fillText(String(((v % 360) + 360) % 360 / 10 | 0).padStart(2, '0'), x, cy - 258 * S); }
      }
    }
    // 警報
    g.shadowBlur = 0;
    if (warn) {
      const blink = Math.floor(T * 6) % 2 === 0;
      if (blink) {
        g.fillStyle = 'rgba(255,40,110,0.95)'; g.strokeStyle = 'rgba(255,40,110,0.95)'; g.lineWidth = 3 * S;
        const wx = W / 2, wy = lookback ? H * 0.2 : H * 0.47 + 150 * S;
        g.strokeRect(wx - 150 * S, wy - 30 * S, 300 * S, 50 * S);
        text('MISSILE', wx, wy + 8 * S, `700 ${30 * S}px ${MONO}`, 'rgba(255,40,110,0.95)', 'center');
      }
      const n = aliveAt(sim, s);
      if (n) text(`× ${n}`, W / 2, (lookback ? H * 0.2 : H * 0.47 + 150 * S) + 52 * S, `700 ${22 * S}px ${MONO}`, 'rgba(255,90,150,0.9)', 'center');
    }
    if (lookback) {
      // 後ろの脅威（小さなレーダーの円）
      const rx = W - 190 * S, ry = H - 190 * S, R = 120 * S;
      g.strokeStyle = 'rgba(120,255,200,0.7)'; g.lineWidth = 1.5 * S;
      g.beginPath(); g.arc(rx, ry, R, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(rx, ry, R * 0.5, 0, Math.PI * 2); g.stroke();
      const fwd = nose, rt = right;
      for (const m of sim.missiles) {
        const st = missileState(m, s); if (!st) continue;
        const d = new THREE.Vector3(...st.p).sub(P); const dist = d.length(); if (dist > 3000) continue;
        const a = Math.atan2(d.dot(rt), d.dot(fwd)); const rr = Math.min(1, dist / 3000) * R;
        g.fillStyle = m.kind === 'pod' ? PINK : 'rgba(255,90,150,0.9)';
        g.fillRect(rx + Math.sin(a) * rr - 3 * S, ry - Math.cos(a) * rr - 3 * S, 6 * S, 6 * S);
      }
      text(`G ${J.g.toFixed(1)}`, 64 * S, H - 70 * S, `700 ${28 * S}px ${MONO}`, J.g > 9 ? PINK : HUDG);
    }
    g.restore();
  }

  function seeker(sim, s, T, camera, id) {
    const J = jetState(sim.jet, s);
    const m = sim.missiles[id];
    const st = missileState(m, Math.min(s, m.death * DT));
    const P = new THREE.Vector3(...J.p).project(camera);
    const x = (P.x * 0.5 + 0.5) * W, y = (-P.y * 0.5 + 0.5) * H;
    const on = P.z < 1 && Math.abs(P.x) < 0.55 && Math.abs(P.y) < 0.55;
    const dist = st ? Math.hypot(st.p[0] - J.p[0], st.p[1] - J.p[1], st.p[2] - J.p[2]) : 0;
    g.save();
    g.strokeStyle = 'rgba(230,255,240,0.85)'; g.fillStyle = 'rgba(230,255,240,0.85)'; g.lineWidth = 2 * S;
    // 照準の十字
    const cx = W / 2, cy = H / 2;
    g.beginPath(); g.moveTo(cx - 400 * S, cy); g.lineTo(cx - 60 * S, cy); g.moveTo(cx + 60 * S, cy); g.lineTo(cx + 400 * S, cy);
    g.moveTo(cx, cy - 300 * S); g.lineTo(cx, cy - 60 * S); g.moveTo(cx, cy + 60 * S); g.lineTo(cx, cy + 300 * S); g.stroke();
    g.strokeRect(cx - 300 * S, cy - 300 * S, 600 * S, 600 * S);
    // 捕まえている枠
    if (on) {
      const b = 46 * S;
      g.lineWidth = 3 * S;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.beginPath(); g.moveTo(x + sx * b, y + sy * b * 0.5); g.lineTo(x + sx * b, y + sy * b); g.lineTo(x + sx * b * 0.5, y + sy * b); g.stroke(); }
      text('TRACK', x + b + 10 * S, y - b + 14 * S, `700 ${18 * S}px ${MONO}`, 'rgba(230,255,240,0.9)');
    } else if (Math.floor(T * 8) % 2 === 0) {
      text('LOST', cx, cy - 330 * S, `700 ${40 * S}px ${MONO}`, 'rgba(255,80,140,0.95)', 'center');
    }
    text(`SEEKER  #${String(id).padStart(3, '0')}`, 80 * S, 90 * S, `700 ${22 * S}px ${MONO}`, 'rgba(230,255,240,0.9)');
    text(`RNG ${dist.toFixed(0).padStart(5)} m`, 80 * S, 122 * S, `500 ${20 * S}px ${MONO}`, 'rgba(230,255,240,0.8)');
    text(`TGO ${(dist / 560).toFixed(2)} s`, 80 * S, 150 * S, `500 ${20 * S}px ${MONO}`, 'rgba(230,255,240,0.8)');
    g.restore();
  }

  // 字幕カード：極太明朝で画面を埋める。行ごとに字の墨の箱を測り、横・縦とも画面（行の高さ）いっぱいまで伸ばす。はみ出してよい
  function card(lines, u, dur) {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const n = lines.length, rowH = H / n, fs = 400;
    const punch = 1.0 + 0.05 * Math.exp(-u * 9); // 入りに少しだけ寄る
    g.save();
    g.font = `900 ${fs}px ${HEAVY}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineJoin = 'miter'; g.lineWidth = fs * 0.012;
    lines.forEach((l, i) => {
      const m = g.measureText(l);
      const lw = g.lineWidth;
      const iw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight + lw, ih = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + lw;
      const sx = (W * 1.03 / iw) * punch, sy = (rowH * (n > 1 ? 0.99 : 1.04) / ih) * punch;
      g.save();
      g.translate(W / 2, rowH * (i + 0.5));
      g.scale(sx, sy);
      const x = m.actualBoundingBoxLeft - (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) / 2;
      const y = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
      g.strokeText(l, x, y); g.fillText(l, x, y);
      g.restore();
    });
    g.restore();
  }

  // 地形図：凡例・縮尺・経過秒
  function mapHud(main, sim, T, camera) {
    const cam = main.cam;
    const a = Math.min(1, Math.max(0, (main.u - 0.4) / 0.8));
    g.save();
    g.globalAlpha = a;
    brand();
    const x0 = 64 * S, y0 = H - 150 * S;
    const row = (y, color, w, label) => { g.fillStyle = color; g.fillRect(x0, y - 6 * S, 40 * S, w * S); text(label, x0 + 54 * S, y, `700 ${18 * S}px ${GOTHIC}`, 'rgba(255,255,255,0.9)'); };
    row(y0, '#ffffff', 3, '航路');
    row(y0 + 32 * S, 'rgba(90,215,255,0.9)', 2, '航路（地表）');
    row(y0 + 64 * S, PINK, 2, 'ミサイル軌道');
    text('等高線 40 m', x0, y0 + 104 * S, `500 ${15 * S}px ${GOTHIC}`, 'rgba(200,225,255,0.6)');
    // 経過（右上）
    const rv = cam.reveal ?? 0;
    text(`T+ ${rv.toFixed(1).padStart(4, '0')} s`, W - 64 * S, 70 * S, `700 ${22 * S}px ${MONO}`, 'rgba(230,245,255,0.9)', 'right');
    // 縮尺（右下）：見ている所での 1 km の長さ
    const tgt = cam.look.clone(), right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const p0 = tgt.clone().project(camera), p1 = tgt.clone().addScaledVector(right, 1000).project(camera);
    const px = Math.abs(p1.x - p0.x) * W / 2;
    const bx = W - 64 * S - px, by = H - 80 * S;
    g.strokeStyle = 'rgba(230,245,255,0.85)'; g.lineWidth = 2 * S;
    g.beginPath(); g.moveTo(bx, by - 8 * S); g.lineTo(bx, by); g.lineTo(bx + px, by); g.lineTo(bx + px, by - 8 * S); g.stroke();
    text('1 km', bx + px / 2, by - 14 * S, `700 ${16 * S}px ${MONO}`, 'rgba(230,245,255,0.9)', 'center');
    g.restore();
  }

  return {
    tex,
    clear() { g.clearRect(0, 0, W, H); tex.needsUpdate = true; },
    setCraft(t) { craft = t; },
    draw(main, sim, T, camera) {
      g.clearRect(0, 0, W, H);
      const sh = main.shot;
      if (sh.card) card(sh.card, main.u, sh.dur);
      else if (sh.hud === 'tele') tele(sim, main.s, T);
      else if (sh.hud === 'cockpit') ck.draw(craft, sim, main.s, T, main.cam, camera, false);
      else if (sh.hud === 'lookback') ck.draw(craft, sim, main.s, T, main.cam, camera, true);
      else if (sh.hud === 'seeker') seeker(sim, main.s, T, camera, sh.seekerId);
      else if (sh.hud === 'map') mapHud(main, sim, T, camera);
      tex.needsUpdate = true;
    },
  };
}

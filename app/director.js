// カット表：作品の秒 T → どのシミュレーションの秒 s を、どこから撮るか
// v2：174 BPM の拍で組む。各カットの長さは拍の数（beats）。大事な瞬間は anchor: [シミュの秒, カットの何拍目] で拍に乗せる。
// 各カットは s0 から始まり、rate（速さ）の折れ線で進む（1＝実時間、0.2＝スロー）。span: [s0, s1] なら一定の速さで s0→s1。
import * as THREE from '../vendor/three.module.js';
import { jetState, jetVisual, makeDodge, missileState, DT, PLANET_C, PLANET_R } from './sim.js';
import { SUN_DIR } from './world.js';

export const BPM = 174;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;

const Vc = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const PC = new THREE.Vector3(...PLANET_C);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
// なめらかな乱れ（手持ち・振動）
const wob = (t, f, seed) => Math.sin(t * f + seed) * 0.6 + Math.sin(t * f * 2.13 + seed * 1.7) * 0.3 + Math.sin(t * f * 4.7 + seed * 3.1) * 0.1;

export function makeDirector(sim, model = {}) {
  const TR = sim.terrain;
  const J = (s) => { const j = jetState(sim.jet, s); return { ...j, P: Vc(j.p), Q: new THREE.Quaternion(j.q[0], j.q[1], j.q[2], j.q[3]), Vv: Vc(j.v) }; };
  // 操縦席の視点は回避の跳ね・ロールごと（機体と一緒に揺れる）
  const dodge = makeDodge(sim);
  const JV = (s) => { const j = jetVisual(sim, dodge, s); return { ...j, P: Vc(j.p), Q: new THREE.Quaternion(j.q[0], j.q[1], j.q[2], j.q[3]), Vv: Vc(j.v) }; };
  const body = (s, x, y, z, q) => { const j = JV(s); return new THREE.Vector3(x, y, z).applyQuaternion(q || j.Q).add(j.P); };
  // 操縦席の目（機体ごと）。F-2A の目 (0, 0.99, 2.66) を基準に書いた位置を、機体の目からの差に直す
  const EYE = model.eye || new THREE.Vector3(0, 0.99, 2.66);
  const eyeAt = (s, dx, dy, dz) => body(s, EYE.x + dx, EYE.y + dy, EYE.z + dz);
  const upAt = (p) => p.clone().sub(PC).normalize();
  // 表面の x, z の地面（地形込み）の上 h m の点
  const ground = (x, z, h) => { const n = new THREE.Vector3(x / PLANET_R, 0, z / PLANET_R); n.y = Math.sqrt(1 - n.x * n.x - n.z * n.z); return PC.clone().addScaledVector(n, PLANET_R + TR.heightAt(x, z) + h); };
  // 点 p の真下の地面から h m の高さへ置き直す
  const lift = (p, h) => { const n = upAt(p); return ground(n.x * PLANET_R, n.z * PLANET_R, h); };
  const hAbove = (p) => { const n = upAt(p); return p.distanceTo(PC) - PLANET_R - TR.heightAt(n.x * PLANET_R, n.z * PLANET_R); };
  const M = (id, s) => { const m = sim.missiles[id]; const st = missileState(m, Math.min(Math.max(s, m.birth * DT), m.death * DT)); return { P: Vc(st.p), D: Vc(st.d) }; };
  // ---- 計算結果から「見せる弾」と「見せる瞬間」を選ぶ（どの設定でも成り立つように）----
  const minis = sim.missiles.filter((m) => m.kind === 'mini');
  const lives = (m, a, b) => m.birth * DT <= a && m.death * DT >= b;
  const waveSplits = (w) => sim.explosions.filter((e) => e.type === 'split' && e.id >= 0 && sim.missiles[e.id].wave === w)
    .filter((e) => minis.some((m) => m.birth === Math.round(e.t / DT) && m.wave === w));
  const centroid = (w, t) => { const c = new THREE.Vector3(); let n = 0; for (const m of minis) { if (m.wave !== w) continue; const st = missileState(m, t); if (st) { c.add(Vc(st.p)); n++; } } return n ? c.divideScalar(n) : null; };
  const pick = {};
  {
    // 50 本に割れる瞬間（1 段なら、発射された群れが扇に開いたところ）
    const s1 = waveSplits(0)[0], s2 = waveSplits(1)[0];
    pick.split1 = s1 ? { t: s1.t, P: Vc(s1.pos), flash: true } : { t: 2.2, P: centroid(0, 2.2) || J(2.2).P.clone(), flash: false };
    pick.split2 = s2 ? { t: s2.t, P: Vc(s2.pos), flash: true } : { t: 16.96, P: null, flash: false };
    // 母弾のカット（2.05〜3.98 秒）：その間いちばん長く飛んでいる波 1 の弾（ポッドを優先）
    const W0 = sim.missiles.filter((m) => m.wave === 0);
    const span = (m) => Math.min(m.death * DT, 3.98) - Math.max(m.birth * DT, 2.05) + (m.kind === 'pod' ? 0.5 - 0.1 * (m.gen || 0) : 0);
    pick.pod = (W0.slice().sort((a, b) => span(b) - span(a))[0] || { id: 0 }).id;
    // 紙一重のアップ：7.85〜9.3 秒ずっと飛んでいて、8.0〜9.4 秒にいちばん近くすれ違う弾
    const okClose = new Set(minis.filter((m) => lives(m, 7.85, 9.3)).map((m) => m.id));
    const ps = sim.passes.filter((p) => okClose.has(p.id) && p.t > 8.0 && p.t < 9.4).sort((a, b) => a.dist - b.dist);
    pick.close = ps[0]?.id ?? [...okClose].map((id) => ({ id, d: M(id, 8.6).P.distanceTo(J(8.6).P) })).sort((a, b) => a.d - b.d)[0]?.id ?? null;
    if (pick.close !== null) { const d = sim.missiles[pick.close].death * DT; pick.closeFlash = d > 8.6 && d < 9.6 ? d : null; }
    // ミサイルの目：10.75〜11.72 秒、機首が戦闘機を向き続けて、終わり近くですれ違う弾
    const cand = minis.filter((m) => lives(m, 10.75, 11.72));
    const score = (m) => {
      let k = 0, n = 0;
      for (let t = 10.75; t <= 11.5; t += 0.05) { const st = missileState(m, t); const j = J(t); if (!st) continue; const to = j.P.clone().sub(Vc(st.p)).normalize(); if (to.dot(Vc(st.d)) > Math.cos(25 * Math.PI / 180)) k++; n++; }
      const pass = sim.passes.some((p) => p.id === m.id && p.t > 11.1 && p.t < 11.9) ? 0.5 : 0;
      return (n ? k / n : 0) + pass;
    };
    pick.seeker = cand.length ? cand.map((m) => ({ id: m.id, s: score(m) })).sort((a, b) => b.s - a.s)[0].id : null;
    // 真後ろに張り付く弾（いなければ 33.4 秒に戦闘機にいちばん近い弾）
    const tail = sim.missiles.find((m) => m.tail);
    pick.tail = tail ? tail.id : (minis.filter((m) => lives(m, 32.95, 33.95)).map((m) => ({ id: m.id, d: M(m.id, 33.4).P.distanceTo(J(33.4).P) })).sort((a, b) => a.d - b.d)[0]?.id ?? null);
    // 最後の追尾：34.3 秒に飛んでいて、いちばん遅くまで残る弾（張り付き役は除く）
    const last = minis.filter((m) => !m.tail && m.birth * DT <= 34.3 && m.death * DT > 34.45 && m.death * DT < 37).sort((a, b) => b.death - a.death)[0];
    pick.last = last ? last.id : null;
    pick.lastT = last ? last.death * DT : 34.95;
  }
  // 地平の枠：進行方向（水平に倒した）・上・横
  const horizonFrame = (s) => {
    const j = J(s); const u = upAt(j.P);
    let f = j.Vv.clone().addScaledVector(u, -j.Vv.dot(u)); if (f.lengthSq() < 1) f = new THREE.Vector3(0, 0, 1).applyQuaternion(j.Q);
    f.normalize(); const r = new THREE.Vector3().crossVectors(f, u).normalize();
    return { f, u, r, P: j.P };
  };
  // 機体の姿勢を少し遅らせて追う（ふり回される感じ）
  const lagQ = (s, lag) => { const a = J(s).Q, b = J(Math.max(0, s - lag)).Q; return b.clone().slerp(a, 0.35); };
  const chase = (s, off, look, lag = 0.18, roll = 1) => {
    const q = lagQ(s, lag);
    const j = J(s);
    const pos = new THREE.Vector3(...off).applyQuaternion(q).add(j.P);
    const lk = new THREE.Vector3(...look).applyQuaternion(j.Q).add(j.P);
    const upB = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const up = upB.lerp(upAt(j.P), 1 - roll).normalize();
    return { pos, look: lk, up };
  };
  const shake = (cam, T, amp, f = 23) => {
    if (!amp) return cam;
    const d = cam.look.clone().sub(cam.pos); const L = d.length();
    const side = new THREE.Vector3().crossVectors(d, cam.up).normalize();
    const up = new THREE.Vector3().crossVectors(side, d).normalize();
    cam.look = cam.look.clone().addScaledVector(side, wob(T, f, 1.3) * amp * L).addScaledVector(up, wob(T, f * 1.1, 4.2) * amp * L);
    cam.roll = (cam.roll || 0) + wob(T, f * 0.7, 7.7) * amp * 0.6;
    return cam;
  };
  // 戦闘機の地平の枠で、戦闘機から (後ろ D・上 h・右 x) に置いて戦闘機を見る（枠の向きは t0 で固定）
  const rig = (s, t0, D, h, x) => {
    const hf = horizonFrame(t0); const j = J(s); const u = upAt(j.P);
    return { pos: j.P.clone().addScaledVector(hf.f, -D).addScaledVector(u, h).addScaledVector(hf.r, x), look: j.P.clone(), up: u };
  };
  // ミサイルの道に沿って 0.8 倍の速さで並走するカメラ（sB で弾がカメラを追い越す）
  const pace = (id, s, sB, side, upOff) => {
    const sc = sB + 0.8 * (s - sB);
    const m = M(id, sc);
    const u0 = upAt(m.P); const sd = new THREE.Vector3().crossVectors(m.D, u0).normalize();
    const up = new THREE.Vector3().crossVectors(sd, m.D).normalize();
    return { pos: m.P.clone().addScaledVector(sd, side).addScaledVector(up, upOff), D: m.D, up, sd };
  };

  // 谷で真後ろに張り付く弾（sim の TAIL）

  // 谷底のカメラ：戦闘機が一番低く通る所（地上 25m 前後）の脇の川岸
  const vd = (() => {
    let best = { h: 1e9 };
    for (let t = 29.6; t < 32.0; t += 0.01) { const j = J(t); const h = hAbove(j.P); if (h < best.h) best = { h, t, P: j.P.clone() }; }
    const hf = horizonFrame(best.t);
    const g = lift(best.P.clone().addScaledVector(hf.r, 9).addScaledVector(hf.f, 14), 2.6);
    return { ...best, g, hf };
  })();
  // 着弾を見下ろす尾根：谷の脇の斜面の上
  const gr = (() => {
    const hits = sim.explosions.filter((e) => e.type === 'ground' && e.t > 28.8 && e.t < 30.7);
    const c = new THREE.Vector3(); for (const e of hits) c.add(Vc(e.pos)); if (hits.length) c.divideScalar(hits.length); else c.copy(J(29.5).P);
    const hf = horizonFrame(30.0);
    const cam = lift(J(30.6).P.clone().addScaledVector(hf.r, 45).addScaledVector(hf.f, 380), 170);
    return { c, cam, hf };
  })();

  // ---- カット ----
  // cam(s, u, T, k)：s＝シミュの秒、u＝カット内の秒、k＝カット内の割合
  const shots = [
    // ===== 前奏（音楽なし）=====
    // 01 白い星の上空：はるか下に谷と川、戦闘機は小さな点
    {
      name: 'vista', beats: 8, span: [0.0, 2.2], hud: 'tele', fadeIn: 0.9,
      cam: (s, u, T, k) => {
        const hf = horizonFrame(0.5); const j = J(s);
        const pos = J(0).P.clone().addScaledVector(hf.f, -520 + u * 60).addScaledVector(hf.u, 300 - u * 15).addScaledVector(hf.r, -330);
        const look = j.P.clone().addScaledVector(hf.f, 2600).addScaledVector(hf.u, -900).lerp(j.P, 0.5);
        return shake({ pos, look, up: hf.u, fov: 48 }, T, 0.0008, 5);
      },
    },
    // 02 静けさ：戦闘機が横をかすめていく（カメラは空中に止まって振り向く）
    {
      name: 'flyby', beats: 8, span: [0.6, 3.36], hud: 'tele',
      cam: (s, u, T, k) => {
        const hf = horizonFrame(1.6);
        const p0 = hf.P.clone().addScaledVector(hf.r, -16).addScaledVector(hf.u, 4.5).addScaledVector(hf.f, 30);
        const j = J(s);
        const look = j.P.clone().addScaledVector(j.Vv.clone().normalize(), 6);
        const fov = u < 1.6 ? lerp(30, 64, sstep(0.9, 1.5, u)) : lerp(64, 16, sstep(1.6, 2.7, u));
        return shake({ pos: p0, look, up: hf.u, fov }, T, 0.002, 11);
      },
    },
    // 03 操縦席：静かな前方 → 警報、アフターバーナー（3.6 秒を 3 拍目に）
    {
      name: 'cockpit_alert', beats: 7, anchor: [3.6, 3], hud: 'cockpit', pov: true,
      cam: (s, u, T) => {
        const j = JV(s);
        const pos = eyeAt(s, 0, 0.01, -0.04);
        const look = eyeAt(s, 0, -0.03, 60 - EYE.z);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(j.Q);
        return shake({ pos, look, up, fov: 74, pov: true, near: 0.02 }, T, s > 3.6 ? 0.004 : 0.0012, 30);
      },
    },
    // 04 母ミサイル：1 本で飛んでくる
    {
      name: 'pod', beats: 8, span: [2.05, 3.98], hud: 'tele',
      cam: (s, u, T) => {
        const p = M(pick.pod, s); const d = p.D;
        const u0 = upAt(p.P); const side = new THREE.Vector3().crossVectors(d, u0).normalize();
        const base = M(pick.pod, 3.9).P.clone().addScaledVector(side, 30).addScaledVector(u0, 7);
        return shake({ pos: base, look: p.P, up: u0, fov: lerp(6, 50, sstep(1.4, 2.7, u)) }, T, 0.0015, 17);
      },
    },
    // ===== 1 回目のドロップ：分裂の閃光が小節の頭 =====
    // 05 分裂：約 50 本が扇に開いてこちらへ（超広角）
    {
      name: 'split', beats: 7, anchor: [pick.split1.t, 1], rate: [[0, 0.7], [0.35, 0.22], [1.1, 0.22], [1.6, 0.8], [2.41, 1.0]], hud: 'tele',
      cam: (s, u, T) => {
        const P0 = pick.split1.P, t0 = pick.split1.t;
        const j = J(t0);
        const toJ = j.P.clone().sub(P0).normalize();
        const u0 = upAt(P0); const side = new THREE.Vector3().crossVectors(toJ, u0).normalize();
        const pos = P0.clone().addScaledVector(toJ, 120 + u * 70).addScaledVector(side, 18).addScaledVector(u0, -10);
        const look = P0.clone().addScaledVector(toJ, 30);
        return shake({ pos, look, up: u0, fov: 92 }, T, s > t0 ? 0.006 : 0.001, 26);
      },
      flash: pick.split1.flash ? [{ s: pick.split1.t, dur: 0.12, kind: 'flash' }, { s: pick.split1.t + 0.01, dur: 0.05, kind: 'invert' }] : [],
      post: { uCA: 0.006 },
    },
    // 06 振り返り：肩越しに後ろ。迫る煙（逆光）
    {
      name: 'lookback', beats: 6, span: [5.2, 6.6], hud: 'lookback', pov: true,
      cam: (s, u, T) => {
        const j = JV(s);
        const pos = eyeAt(s, 0.30, 0.11, -0.26);
        const look = eyeAt(s, 3.4, 0.01, -30 - EYE.z);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(j.Q);
        return shake({ pos, look, up, fov: 78, pov: true, back: true, near: 0.02 }, T, 0.005, 28);
      },
    },
    // 08 追う：戦闘機の後ろ、尾に並んで追ってくる弾の群れ
    {
      name: 'chase_break', beats: 6, span: [6.6, 7.6], hud: 'tele',
      cam: (s, u, T) => shake({ ...chase(s, [2.5, 4.0, -24 + u * 2], [0, 1, 20], 0.22, 0.85), fov: 56 }, T, 0.004, 19),
    },
    // 07 追い越し：戦闘機の 40m 後ろ。カメラの後ろから弾が時間差で次々と、すぐ脇を急速に抜けて戦闘機へ（残りはまだ 50）
    {
      name: 'rush', beats: 7, span: [7.6, 9.0], hud: 'tele',
      cam: (s, u, T) => shake({ ...rig(s, 7.6, 40, 12, 0), fov: 64, glowNear: 0.4 }, T, 0.003, 23),
    },
    // 08 四隅から：戦闘機の 160m 後ろ・上。21 本が画面の隅から斜めに入って戦闘機へ集まる（さっきの追い越しを別の角度で）
    {
      name: 'corners', beats: 6, span: [7.2, 8.3], hud: 'tele',
      cam: (s, u, T) => shake({ ...rig(s, 7.2, 160, 30, 0), fov: 34 }, T, 0.0015, 15),
    },
    // 09 ミサイル超どアップ（後ろから）：追って、紙一重で外して、自爆（#9）
    {
      name: 'missile_close', beats: 8, span: [7.85, 9.5], rate: [[0, 1.0], [1.0, 0.55], [2.2, 0.55], [2.76, 1.0]], hud: 'tele',
      cam: (s, u, T) => {
        if (pick.close === null) return shake({ ...chase(s, [3, 2.2, -16], [0, 0.5, 20], 0.2, 0.8), fov: 54 }, T, 0.003, 19);
        const m = M(pick.close, s);
        const u0 = upAt(m.P); const side = new THREE.Vector3().crossVectors(m.D, u0).normalize();
        const up = new THREE.Vector3().crossVectors(side, m.D).normalize();
        // 斜め後ろ上から：胴の長さとフィン、尾の噴射が見える
        const pos = m.P.clone().addScaledVector(m.D, -3.6).addScaledVector(up, 1.05).addScaledVector(side, 1.7);
        const look = m.P.clone().addScaledVector(m.D, 22).addScaledVector(side, -0.6).addScaledVector(up, 0.9);
        return shake({ pos, look, up, fov: 50, near: 0.02, glowNear: 0.25 }, T, 0.004, 37);
      },
      flash: pick.closeFlash ? [{ s: pick.closeFlash, dur: 0.09, kind: 'flash' }] : [],
      post: { uCA: 0.005 },
    },
    // 10 ロール：回る機体を後ろ斜めから、スロー。後ろから来た弾が次々と抜けていく
    {
      name: 'roll_pass', beats: 7, span: [9.62, 10.38], rate: [[0, 0.5], [0.4, 0.28], [2.0, 0.28], [2.41, 0.5]], hud: 'tele',
      cam: (s, u, T) => {
        const hf = horizonFrame(10.0); const j = J(s);
        const a = -2.1 + u * 0.35;
        const pos = j.P.clone().addScaledVector(hf.r, Math.cos(a) * 20).addScaledVector(hf.f, Math.sin(a) * 20).addScaledVector(hf.u, 4.5);
        return shake({ pos, look: j.P.clone().addScaledVector(hf.f, 8), up: hf.u, fov: 56 }, T, 0.002, 11);
      },
    },
    // 12 コブラ（急減速）：横から。機首を起こす瞬間に寄り（クラッシュズーム）、弾が前へ抜けていく
    {
      name: 'cobra', beats: 10, anchor: [10.62, 2], rate: [[0, 1.0], [0.5, 0.3], [2.6, 0.24], [3.1, 0.8], [3.45, 1.0]], hud: 'tele',
      cam: (s, u, T, k) => {
        const hf = horizonFrame(10.6);
        const j = J(s);
        const a = lerp(-1.25, 0.25, sstep(0, 3.45, u));
        const off = hf.r.clone().multiplyScalar(Math.cos(a) * 34).addScaledVector(hf.f, Math.sin(a) * 34).addScaledVector(hf.u, 5);
        // 機首上げ（10.62）でぐっと寄る、のちゆっくり戻す
        const z = sstep(10.6, 10.7, s) * (1 - 0.55 * sstep(11.2, 11.8, s));
        const fov = lerp(48, 24, z);
        return shake({ pos: j.P.clone().add(off), look: j.P.clone().addScaledVector(hf.f, 4), up: hf.u, fov }, T, 0.002 + 0.006 * sstep(10.6, 10.66, s) * (1 - sstep(10.75, 10.95, s)), 9);
      },
    },
    // 13 ミサイルの目：照準の中で戦闘機が止まる → 追い越して見失う（#38）
    {
      name: 'seeker', beats: 6, span: [10.75, 11.72], hud: pick.seeker === null ? 'tele' : 'seeker', seekerId: pick.seeker,
      cam: (s, u, T) => {
        if (pick.seeker === null) return shake({ ...chase(s, [-4, 1.5, -20], [0, 0.5, 20], 0.2, 0.8), fov: 50 }, T, 0.003, 19);
        const m = M(pick.seeker, s);
        const j = J(s);
        const u0 = upAt(m.P);
        const toJ = j.P.clone().sub(m.P).normalize();
        const off = Math.acos(Math.max(-1, Math.min(1, toJ.dot(m.D))));
        const k = 1 - sstep(0.55, 0.75, off);
        const dir = m.D.clone().lerp(toJ, k).normalize();
        const look = m.P.clone().addScaledVector(dir, 100);
        return shake({ pos: m.P.clone().addScaledVector(m.D, 1.6), look, up: u0, fov: 18 }, T, 0.0025, 41);
      },
      post: { uMono: 1, uCA: 0.002, uGrain: 0.09, uVig: 0.6 },
    },
    // 14 遠景：再加速、ミサイルが大きな弧で引き返して追う
    {
      name: 'arcs_wide', beats: 7, span: [11.9, 14.5], hud: 'tele',
      cam: (s, u, T) => {
        const c = J(12.6).P;
        const hf = horizonFrame(12.6);
        const pos = c.clone().addScaledVector(hf.r, -900).addScaledVector(hf.f, -500).addScaledVector(hf.u, -650 + u * 30);
        const look = c.clone().lerp(J(s).P, 0.5).addScaledVector(hf.u, 150);
        return shake({ pos, look, up: hf.u, fov: 52 }, T, 0.0008, 5);
      },
    },
    // 15 急上昇：横から並んで撮る。下から追い上げてくる弾が次々と戦闘機の脇を通り抜ける
    {
      name: 'climb', beats: 7, span: [13.9, 15.75], hud: 'tele',
      cam: (s, u, T) => shake({ ...rig(s, 14.4, -10, -18, 95), fov: 46 }, T, 0.002, 13),
    },
    // 16 操縦席：上を向いた先で 2 波目の母ミサイルが割れる（閃光を小節の頭へ）
    {
      name: 'headon_pov', beats: 7, anchor: [pick.split2.t, 4], rate: [[0, 1.0], [0.75, 0.3], [1.6, 0.3], [2.41, 0.6]], hud: 'cockpit', pov: true,
      cam: (s, u, T) => {
        const j = JV(s);
        const pos = eyeAt(s, 0, 0.01, -0.04);
        const look = eyeAt(s, 0, 0.41, 60 - EYE.z);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(j.Q);
        return shake({ pos, look, up, fov: 82, pov: true, near: 0.02 }, T, s > pick.split2.t ? 0.007 : 0.002, 33);
      },
      flash: pick.split2.flash ? [{ s: pick.split2.t, dur: 0.1, kind: 'flash' }] : [],
    },
    // 17 四隅から（2 波目）：戦闘機の前上から振り返る。12 本が隅から一斉に入ってきて交差する
    {
      name: 'corners2', beats: 7, span: [17.95, 19.3], rate: [[0, 0.8], [0.6, 0.45], [2.0, 0.45], [2.41, 0.8]], hud: 'tele',
      cam: (s, u, T) => shake({ ...rig(s, 18.0, -30, 30, 25), fov: 36 }, T, 0.002, 21),
      flash: [{ s: 18.6, dur: 0.05, kind: 'invert' }],
    },
    // 18 字幕カード
    { name: 'card2', beats: 2, card: ['追尾、', '限界。'], span: [19.3, 19.3] },
    // ===== 抜け（パッドだけ）=====
    // 19 曲線で引く：機体 10m のアップから回り込みながら 800m へ。煙のもつれごと見せる
    {
      name: 'orbit_pullout', beats: 12, span: [19.3, 22.0], hud: 'tele',
      cam: (s, u, T, k) => {
        const j = J(s); const hf = horizonFrame(s);
        const e = sstep(0.05, 1.0, k);
        const R = 14 * Math.pow(57, e);
        const th = -0.4 + e * 2.9, ph = 0.18 - 0.75 * e;
        const off = hf.r.clone().multiplyScalar(Math.cos(th) * Math.cos(ph)).addScaledVector(hf.f, Math.sin(th) * Math.cos(ph)).addScaledVector(hf.u, Math.sin(ph)).multiplyScalar(R);
        const look = j.P.clone().lerp(J(19.0).P.clone().addScaledVector(hf.u, 250), 0.35 * e);
        return shake({ pos: j.P.clone().add(off), look, up: hf.u, fov: lerp(46, 58, e) }, T, 0.0012, 7);
      },
    },
    // 20 遠景：ぐしゃぐしゃに描かれた軌道。戦闘機は点
    {
      name: 'tangle', beats: 8, span: [21.9, 25.2], hud: 'tele',
      cam: (s, u, T) => {
        // 下から見上げる：白い地平を画面の下に、軌道は黒い空に描かれる
        const c = J(20.5).P;
        const hf = horizonFrame(20.0);
        const g = lift(c.clone().addScaledVector(hf.r, 3800).addScaledVector(hf.f, 3400), 420);
        const look = c.clone().addScaledVector(upAt(c), 300).lerp(J(s).P, 0.25);
        return { pos: g.addScaledVector(hf.r, -u * 90), look, up: upAt(c), fov: 40 };
      },
      post: { uBloom: 0.07 },
    },
    // 21 操縦席：急降下、谷が迫る（高まり）
    {
      name: 'dive_pov', beats: 5, span: [25.7, 27.6], hud: 'cockpit', pov: true,
      cam: (s, u, T) => {
        const j = JV(s);
        const pos = eyeAt(s, 0, 0.01, -0.04);
        const look = eyeAt(s, 0, -0.09, 60 - EYE.z);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(j.Q);
        return shake({ pos, look, up, fov: 78, pov: true, near: 0.02 }, T, 0.004 + 0.006 * sstep(26.6, 27.4, s), 35);
      },
    },
    // 22 谷の脇の斜面から：谷へ突っ込む戦闘機。追えない弾が谷の壁と谷底に次々と刺さる
    {
      name: 'ground', beats: 7, span: [27.6, 29.75], hud: 'tele',
      cam: (s, u, T) => {
        const look = gr.c.clone().lerp(J(s).P, 0.45);
        return shake({ pos: gr.cam.clone().addScaledVector(gr.hf.f, u * 20), look, up: upAt(gr.cam), fov: 62 }, T, 0.002 + 0.006 * sstep(29.05, 29.12, s) * (1 - sstep(29.2, 29.7, s)), 17);
      },
    },
    // ===== 2 回目のドロップ：谷底のカメラの真上を抜ける瞬間 =====
    // 22 谷底：戦闘機がこちらへ突っ込み、引き起こして地上 25m で頭上を抜ける。後ろで弾が谷底に刺さる
    {
      name: 'valley_dive', beats: 9, anchor: [vd.t, 4], rate: [[0, 1.0], [1.5, 0.8], [1.9, 0.35], [2.4, 0.35], [3.1, 0.9]], hud: 'tele',
      cam: (s, u, T) => {
        const j = J(s);
        const look = j.P.clone();
        // 真上へ向きすぎないよう、見上げる角は 72°まで
        const d = look.clone().sub(vd.g); const up = upAt(vd.g);
        const el = Math.asin(Math.min(1, d.clone().normalize().dot(up)));
        if (el > 1.25) { const hz = d.clone().addScaledVector(up, -d.dot(up)).normalize(); look.copy(vd.g).addScaledVector(hz, 10).addScaledVector(up, 10 * Math.tan(1.25)); }
        const near = Math.max(0, 1 - j.P.distanceTo(vd.g) / 120);
        return shake({ pos: vd.g, look, up, fov: lerp(46, 84, sstep(29.6, 30.9, s)) }, T, 0.002 + 0.014 * near, 21);
      },
    },
    // 24 谷：低く追う。両側の壁が流れ、川が光る
    {
      name: 'canyon', beats: 8, span: [31.9, 33.4], hud: 'tele',
      cam: (s, u, T) => shake({ ...chase(s, [7, 2.6, -24], [0, 0, 30], 0.25, 0.25), fov: 62 }, T, 0.003, 17),
    },
    // 25 真後ろに張り付く：弾のすぐ後ろから戦闘機を見る。弾が迫り、戦闘機の噴射の十数 m 後ろに張り付く
    {
      name: 'tail_close', beats: 6, span: [32.95, 33.95], rate: [[0, 0.6], [0.8, 0.42], [2.07, 0.42]], hud: 'tele',
      cam: (s, u, T) => {
        if (pick.tail === null) return shake({ ...chase(s, [0, 1.6, -18], [0, 0.3, 20], 0.25, 0.3), fov: 48 }, T, 0.004, 33);
        const m = M(pick.tail, s); const jp = J(s).P;
        const u0 = upAt(m.P); const side = new THREE.Vector3().crossVectors(m.D, u0).normalize();
        const back = m.P.clone().sub(jp).normalize();
        const pos = m.P.clone().addScaledVector(back, 5.0).addScaledVector(side, 2.6).addScaledVector(u0, 1.6);
        return shake({ pos, look: jp.clone().lerp(m.P, 0.35), up: u0, fov: 48, near: 0.02, glowNear: 0.3, smokeDensity: 0.8, smokeNear: 28 }, T, 0.004, 33);
      },
    },
    // 26 バレルロール（螺旋）：回り込むカメラ、スロー。後ろで最後の弾が迫る
    {
      name: 'barrel', beats: 9, span: [33.95, 34.85], rate: [[0, 0.6], [0.6, 0.25], [2.4, 0.25], [3.1, 0.4]], hud: 'tele',
      cam: (s, u, T) => {
        const hf = horizonFrame(s);
        const j = J(s);
        const a = -0.6 + u * 1.15;
        const off = hf.r.clone().multiplyScalar(Math.cos(a) * 30).addScaledVector(hf.f, Math.sin(a) * 30 - 8).addScaledVector(hf.u, 7);
        return shake({ pos: j.P.clone().add(off), look: j.P.clone().addScaledVector(hf.f, 6), up: hf.u, fov: 54 }, T, 0.002, 9);
      },
    },
    // 27 最後の追尾：谷を逃げる戦闘機を後ろから追い詰める弾（#97）→ 戦闘機の 300m 後ろで爆発
    {
      name: 'last_chase', beats: 8, span: [pick.lastT - 0.65, pick.lastT + 0.07], rate: [[0, 0.5], [2.76, 0.25]], hud: 'tele',
      cam: (s, u, T) => {
        if (pick.last === null) return shake({ ...chase(s, [5, 2, -26], [0, 0, 30], 0.25, 0.25), fov: 46 }, T, 0.003, 31);
        const m = M(pick.last, s);
        const u0 = upAt(m.P); const side = new THREE.Vector3().crossVectors(m.D, u0).normalize();
        const up = new THREE.Vector3().crossVectors(side, m.D).normalize();
        const jp = J(s).P;
        const back = m.P.clone().sub(jp).normalize().lerp(m.D.clone().negate(), 0.35).normalize();
        const pos = m.P.clone().addScaledVector(back, 7.0).addScaledVector(side, 1.8).addScaledVector(up, 1.0);
        return shake({ pos, look: jp.clone().lerp(m.P, 0.15), up, fov: 42, near: 0.02, glowNear: 0.3 }, T, 0.004, 31);
      },
      flash: pick.last !== null ? [{ s: pick.lastT, dur: 0.07, kind: 'flash' }] : [],
    },
    // 28 字幕カード
    { name: 'card3', beats: 2, card: ['凌駕。'], span: [35.0, 35.0] },
    // 29 連鎖：谷の脇から見上げる。最後の弾が次々に爆発し、戦闘機は谷の奥へ
    {
      name: 'finale', beats: 9, span: [34.9, 36.7], rate: [[0, 0.5], [1.2, 0.55], [2.4, 0.7], [3.1, 1.0]], hud: 'tele',
      cam: (s, u, T) => {
        const hf = horizonFrame(35.4); const c = J(35.4).P;
        const g = lift(c.clone().addScaledVector(hf.r, 22).addScaledVector(hf.f, 420), 10);
        const look = J(s).P.clone().addScaledVector(upAt(c), 90);
        return shake({ pos: g, look, up: upAt(g), fov: 56 }, T, 0.002 + 0.008 * sstep(34.9, 35.0, s) * (1 - sstep(35.1, 35.6, s)) + 0.01 * Math.max(0, 1 - J(s).P.distanceTo(g) / 90), 19);
      },
      flash: pick.last !== null ? [{ s: pick.lastT, dur: 0.07, kind: 'flash' }] : [],
    },
    // ===== 終わり：ゆっくり回りながら弧を描いて谷から上がる =====
    // 30 勝ちのロール：横から。1 回転しながら谷を出て空へ弧を描く
    {
      name: 'victory', beats: 13, span: [40.8, 46.2], hud: 'tele',
      cam: (s, u, T, k) => {
        const hf = horizonFrame(41.5); const j = J(s);
        let pos = J(Math.max(0, s - 0.3)).P.clone().addScaledVector(hf.r, -68).addScaledVector(hf.f, -18).addScaledVector(upAt(j.P), -9);
        if (hAbove(pos) < 25) pos = lift(pos, 25);
        return shake({ pos, look: j.P.clone().addScaledVector(j.Vv.clone().normalize(), 6), up: upAt(j.P), fov: lerp(30, 24, k) }, T, 0.0012, 7);
      },
    },
    // 31 煙の織物を見上げる。戦闘機は空へ
    {
      name: 'end', beats: 8, span: [46.0, 49.0], hud: 'tele',
      cam: (s, u, T) => {
        const g = ground(3900, 1000, 120);
        const look = ground(2000, 4300, 1900);
        return { pos: g.addScaledVector(new THREE.Vector3(-1, 0, 0), u * 40), look, up: upAt(g), fov: 50 };
      },
    },
    // ===== 地形図：谷の地形に、戦闘機の航路と 100 本の軌道を時間順に描き出す =====
    {
      name: 'map', beats: 28, span: [0, 0], hud: 'map', map: true, fadeOut: 1.2,
      cam: (s, u, T, k) => {
        const tgt = ground(600, 1600, 0).addScaledVector(upAt(ground(600, 1600, 0)), 900);
        const a = 0.95 + k * 0.42, el = lerp(0.62, 0.86, sstep(0, 1, k)), D = lerp(15500, 12500, sstep(0, 1, k));
        const up = upAt(tgt);
        const pos = tgt.clone().add(new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)).multiplyScalar(D));
        return { pos, look: tgt, up, fov: 40, map: sstep(0.0, 0.9, u), reveal: lerp(0, 56, sstep(1.0, 7.6, u)) };
      },
    },
  ];

  // 時刻表をつくる（拍で）
  let T = 0;
  for (const sh of shots) {
    sh.dur = sh.beats * BEAT;
    sh.T0 = T; T += sh.dur;
    let rate;
    if (sh.span && !sh.rate) { const r = (sh.span[1] - sh.span[0]) / sh.dur; rate = [[0, r], [sh.dur, r]]; }
    else rate = sh.rate || [[0, 1], [sh.dur, 1]];
    // rate の折れ線の最後は dur まで延ばす
    if (rate[rate.length - 1][0] < sh.dur) rate = [...rate, [sh.dur, rate[rate.length - 1][1]]];
    // s(u) を細かく積分しておく
    const N = 400, tab = new Float32Array(N + 1);
    const r = (u) => { for (let i = 0; i < rate.length - 1; i++) if (u <= rate[i + 1][0]) { const k = (u - rate[i][0]) / Math.max(1e-6, rate[i + 1][0] - rate[i][0]); return lerp(rate[i][1], rate[i + 1][1], k * k * (3 - 2 * k)); } return rate[rate.length - 1][1]; };
    let acc = 0; tab[0] = 0;
    for (let i = 1; i <= N; i++) { const u0 = ((i - 1) / N) * sh.dur, u1 = (i / N) * sh.dur; acc += (r(u0) + r(u1)) * 0.5 * (u1 - u0); tab[i] = acc; }
    const at = (u) => { const f = Math.min(N, Math.max(0, (u / sh.dur) * N)); const i = Math.min(N - 1, Math.floor(f)); return lerp(tab[i], tab[i + 1], f - i); };
    // 始まりの秒：anchor（シミュの秒を何拍目に）／span の始まり／s0
    if (sh.anchor) sh.s0 = sh.anchor[0] - at(sh.anchor[1] * BEAT);
    else if (sh.span) {
      sh.s0 = sh.span[0];
      // rate を指定した span は、終わりがちょうど span[1] になるよう速さを掛け直す
      if (sh.rate && sh.span[1] > sh.span[0]) { const g = (sh.span[1] - sh.span[0]) / Math.max(1e-6, tab[N]); for (let i = 0; i <= N; i++) tab[i] *= g; }
    }
    sh.s0 = sh.s0 ?? 0;
    sh.sOf = (u) => sh.s0 + at(u);
    sh.s1 = sh.sOf(sh.dur);
  }
  const duration = T;

  return {
    duration, shots, BPM, BEAT, BAR, pick,
    at(Tf) {
      const T = Math.min(Math.max(0, Tf), duration - 1e-4);
      let sh = shots[shots.length - 1];
      for (const x of shots) if (T >= x.T0 && T < x.T0 + x.dur) { sh = x; break; }
      const u = T - sh.T0, k = u / sh.dur;
      const s = sh.sOf(u);
      const post = { uExposure: 1.0, uBloom: 0.09, uCA: 0.0025, uVig: 0.35, uGrain: 0.045, uFlash: 0, uInvert: 0, uMono: 0, uLetter: 0, uSat: 1.0, uBlack: 0, uHudOn: 1, ...(sh.post || {}) };
      if (sh.card) {
        return { s, shot: sh, u, k, T, cam: { pos: new THREE.Vector3(0, 1e6, 0), look: new THREE.Vector3(0, 1e6 + 1, 1), fov: 50 }, post: { ...post, uBlack: 1 } };
      }
      const cam = sh.cam(s, u, T, k);
      cam.pov = !!sh.pov;
      // カメラの速さ（空気の粒の筋の向き）
      const ds = 1 / 240;
      const c2 = sh.cam(sh.sOf(Math.max(0, u - ds)), Math.max(0, u - ds), T - ds, Math.max(0, u - ds) / sh.dur);
      const sd = Math.max(1e-4, s - sh.sOf(Math.max(0, u - ds)));
      cam.vel = cam.pos.clone().sub(c2.pos).divideScalar(sd);
      cam.dust = sh.pov ? 0.5 : sh.map ? 0 : 1;
      // 閃光・反転のコマ（シミュの秒で指定）
      let flash = 0, inv = 0;
      for (const f of sh.flash || []) {
        const a = (s - f.s) / Math.max(1e-3, sh.sOf(u + 1 / 60) - s) / 60; // 作品の秒に直した経過
        if (a >= 0 && a < f.dur) { if (f.kind === 'flash') flash = Math.max(flash, 1 - a / f.dur); else inv = 1; }
      }
      if (sh.fadeIn && u < sh.fadeIn) post.uBlack = 1 - sstep(0, sh.fadeIn, u);
      if (sh.fadeOut && u > sh.dur - sh.fadeOut) post.uBlack = sstep(sh.dur - sh.fadeOut, sh.dur, u);
      post.uFlash = Math.max(post.uFlash || 0, flash);
      post.uInvert = inv;
      return { s, shot: sh, u, k, T, cam, post };
    },
  };
}

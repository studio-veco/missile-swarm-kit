// 音：映像の曲（自作の合成曲）＋その場で合成する効果音（爆発・分裂・弾が脇を抜ける風切り・エンジンの唸り）
// 効果音はシミュレーションの出来事から鳴らす。スローの所では低く・遅くなる。音源ファイルは使わない。
import * as THREE from '../vendor/three.module.js';
import { missileState, DT } from './sim.js';

export function makeAudio(musicUrl) {
  let ctx = null, master, musicBus, sfxBus, noise, musicBuf = null, musicSrc = null, musicStart = 0, musicFrom = 0, musicLoop = false;
  let rumbleGain, roarGain, roarFilter, enabled = false, loading = null;
  const tmp = new THREE.Vector3(), camR = new THREE.Vector3();
  let near = new Float32Array(0), near2 = new Float32Array(0), voices = 0;

  async function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    master = ctx.createGain(); master.gain.value = 0.0;
    master.connect(comp).connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.5; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.85; sfxBus.connect(master);
    // 2 秒の白いノイズ（効果音の素）
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0); let b = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2.0; }
    // エンジンの唸り（低いノイズ）と吹き上がり（帯域ノイズ）を鳴らし続け、音量だけ動かす
    const loop = (f, type, freq, q) => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = freq; fl.Q.value = q; const g = ctx.createGain(); g.gain.value = 0; s.connect(fl).connect(g).connect(sfxBus); s.start(); return { g, fl }; };
    ({ g: rumbleGain } = loop(0, 'lowpass', 140, 0.7));
    ({ g: roarGain, fl: roarFilter } = loop(0, 'bandpass', 420, 0.8));
    loading = fetch(musicUrl).then((r) => r.arrayBuffer()).then((a) => new Promise((res, rej) => ctx.decodeAudioData(a, res, rej))).then((buf) => { musicBuf = buf; }).catch(() => {});
  }

  function stopMusic() { if (musicSrc) { try { musicSrc.stop(); } catch {} musicSrc.disconnect(); musicSrc = null; } }
  function startMusic(from, loopIt) {
    stopMusic();
    if (!musicBuf || !enabled) return;
    const s = ctx.createBufferSource(); s.buffer = musicBuf;
    if (loopIt) { s.loop = true; s.loopStart = 8.27; s.loopEnd = Math.min(musicBuf.duration, 78.6); }
    s.connect(musicBus);
    const off = Math.max(0, Math.min(musicBuf.duration - 0.05, from));
    s.start(ctx.currentTime + 0.02, off);
    musicSrc = s; musicStart = ctx.currentTime + 0.02; musicFrom = off; musicLoop = loopIt;
  }
  const musicPos = () => musicSrc ? musicFrom + (ctx.currentTime - musicStart) : -1;

  // 効果音
  function env(g, t0, a, peak, dec) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec); }
  function pan(x) { const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null; if (p) { p.pan.value = Math.max(-1, Math.min(1, x)); p.connect(sfxBus); return p; } return sfxBus; }
  function boom(vol, px, size, rate, kind) {
    if (voices > 14) return; voices++;
    const t0 = ctx.currentTime + 0.01, out = pan(px);
    const r = Math.max(0.35, Math.min(1, rate));
    // 本体：低域ノイズの爆風
    const n = ctx.createBufferSource(); n.buffer = noise; n.playbackRate.value = (0.45 + 0.2 * Math.random()) * r;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(kind === 'split' ? 5200 : 2400, t0); lp.frequency.exponentialRampToValueAtTime(160, t0 + 1.4 / r);
    const g = ctx.createGain(); env(g, t0, 0.006, vol * (kind === 'split' ? 0.7 : 1.0), (0.9 + 0.5 * size) / r);
    n.connect(lp).connect(g).connect(out); n.start(t0, Math.random() * 1.2); n.stop(t0 + 2.6 / r);
    // 腹に来る一撃
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90 * r, t0); o.frequency.exponentialRampToValueAtTime(34 * r, t0 + 0.45 / r);
    const og = ctx.createGain(); env(og, t0, 0.004, vol * 0.9 * Math.min(1.4, size), 0.55 / r);
    o.connect(og).connect(out); o.start(t0); o.stop(t0 + 0.8 / r);
    // 分裂は甲高い割れる音
    if (kind === 'split') {
      const h = ctx.createBufferSource(); h.buffer = noise; h.playbackRate.value = 1.6 * r;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400;
      const hg = ctx.createGain(); env(hg, t0, 0.002, vol * 0.5, 0.35 / r);
      h.connect(hp).connect(hg).connect(out); h.start(t0); h.stop(t0 + 0.6 / r);
    }
    setTimeout(() => { voices--; }, 2600 / r);
  }
  function whiz(vol, px, rate) {
    if (voices > 18) return; voices++;
    const t0 = ctx.currentTime + 0.005, out = pan(px);
    const r = Math.max(0.35, Math.min(1, rate));
    const n = ctx.createBufferSource(); n.buffer = noise; n.playbackRate.value = r;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(2600 * r, t0); bp.frequency.exponentialRampToValueAtTime(520 * r, t0 + 0.42 / r);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.12 / r); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5 / r);
    n.connect(bp).connect(g).connect(out); n.start(t0, Math.random()); n.stop(t0 + 0.6 / r);
    setTimeout(() => { voices--; }, 700 / r);
  }

  return {
    get ready() { return !!ctx; },
    get enabled() { return enabled; },
    async setEnabled(on) {
      enabled = on;
      if (on) { await init(); if (ctx.state === 'suspended') await ctx.resume(); master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.05); await loading; }
      else if (ctx) { master.gain.setTargetAtTime(0.0, ctx.currentTime, 0.05); stopMusic(); }
    },
    // 新しい計算結果になった・時刻を飛ばした
    reset(sim) { near = new Float32Array(sim.missiles.length).fill(1e9); near2 = new Float32Array(sim.missiles.length).fill(1e9); },
    // 映像の曲：映像の秒 T に合わせる（free＝自由視点なら曲だけループ）
    music(T, playing, free) {
      if (!ctx || !enabled || !musicBuf) return;
      if (!playing) { stopMusic(); return; }
      if (free) { if (!musicSrc || !musicLoop) startMusic(8.27, true); return; }
      if (T >= musicBuf.duration - 0.1) { stopMusic(); return; }
      const p = musicPos();
      if (!musicSrc || musicLoop || Math.abs(p - T) > 0.15) startMusic(T, false);
    },
    // 効果音：シミュの秒 s0 → s1 の間に起きたこと。rate＝スローの度合い（1＝実時間）
    update(sim, s0, s1, rate, camera, jet) {
      if (!ctx || !enabled) return;
      const now = ctx.currentTime;
      // エンジン：カメラが機体に近いほど大きい
      const jd = camera.position.distanceTo(tmp.set(jet.p[0], jet.p[1], jet.p[2]));
      const near1 = Math.min(1, 26 / (jd + 6));
      rumbleGain.gain.setTargetAtTime(0.5 * near1 * (0.3 + 0.7 * jet.thr), now, 0.08);
      roarGain.gain.setTargetAtTime(0.22 * near1 * Math.max(0, jet.thr - 0.5) * 2, now, 0.08);
      roarFilter.frequency.setTargetAtTime(300 + 500 * jet.thr * Math.max(0.4, rate), now, 0.1);
      if (!(s1 > s0) || s1 - s0 > 0.35) return; // 止まっている・飛ばした
      camR.setFromMatrixColumn(camera.matrixWorld, 0);
      // 爆発・分裂
      let n = 0;
      for (const e of sim.explosions) {
        if (e.t <= s0 || e.t > s1) continue;
        if (n++ > 5) break;
        tmp.set(e.pos[0], e.pos[1], e.pos[2]);
        const d = tmp.distanceTo(camera.position);
        const vol = Math.min(1, (e.type === 'split' ? 420 : 260) / (d + 60)) * Math.min(1.3, e.size);
        if (vol < 0.02) continue;
        const px = tmp.sub(camera.position).normalize().dot(camR);
        boom(vol, px * 0.8, e.size, rate, e.type);
      }
      // 弾がカメラの脇を抜けた（カメラとの距離の極小、30m 以内）
      for (let k = 0; k < sim.missiles.length; k++) {
        const m = sim.missiles[k];
        const st = missileState(m, s1);
        if (!st) { near[k] = near2[k] = 1e9; continue; }
        tmp.set(st.p[0], st.p[1], st.p[2]);
        const d = tmp.distanceTo(camera.position);
        if (near[k] < 30 && near[k] < near2[k] && d > near[k] + 0.5) {
          const px = tmp.sub(camera.position).normalize().dot(camR);
          whiz(Math.min(0.6, 9 / (near[k] + 3)), px, rate);
        }
        near2[k] = near[k]; near[k] = d;
      }
    },
  };
}

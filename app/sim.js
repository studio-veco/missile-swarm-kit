// つなぎ：戦闘機の操縦（1 回だけ）→ その道から谷の地形（1 回だけ）→ ミサイル（設定が変わるたび）
// 計算そのものはキット（src/）にある。ここは映像の設定（2 波・張り付き・最後の連鎖）を渡すだけ。
import { simulateFlight, jetState as jetStateK, FWD, RIGHT } from '../src/flight.js';
import { simulateSwarm, missileState as missileStateK, FILM_WAVES, DEFAULT_MIX } from '../src/missiles.js';
import { sphereWorld } from '../src/world.js';
import { add, sub, scl, dot, len, nrm, clamp, sstep, qmul, qaxis, qnrm, qrot, crs } from '../src/math.js';
import { buildTerrain } from './terrain.js';

export const DT = 1 / 120;
export const SIM_LEN = 56;
export const PLANET_R = 60000;
export const PLANET_C = [0, -PLANET_R, 0];
export const VALLEY_T = [24.0, SIM_LEN];
export const FINAL_T = 34.0;
export const TAIL = { t0: 32.0, t1: 33.95, gap: 11, close: 420 };
export const FILM = { count: 50, stages: 2, mix: { C: 22, E: 18, S: 0, W: 10 }, seed: 20261103 };

const base = sphereWorld({ radius: PLANET_R });
export const altOf = base.alt;
export const surfXZ = base.surfXZ;
export const vec = { add, sub, scl, dot, crs, len, nrm, qrot, qmul, qaxis, clamp, sstep };
export const jetState = (J, t) => jetStateK(J, t, DT);
export const missileState = (m, t) => missileStateK(m, t, DT);

export function terrainFromJet(J) {
  const track = [];
  for (let t = VALLEY_T[0]; t <= VALLEY_T[1] + 1e-6; t += 0.1) {
    const i = Math.min(J.n - 1, Math.round(t / DT));
    track.push(surfXZ([J.pos[i * 3], J.pos[i * 3 + 1], J.pos[i * 3 + 2]]));
  }
  const T = buildTerrain(track);
  T.hAt = (p) => { const [x, z] = surfXZ(p); return T.heightAt(x, z); };
  return T;
}

let cache = null;
// 戦闘機と地形（設定に関係しない部分）
export function solveBase() {
  if (cache) return cache;
  const jet = simulateFlight({ duration: SIM_LEN, dt: DT, world: base });
  const terrain = terrainFromJet(jet);
  const world = sphereWorld({ radius: PLANET_R, heightAt: terrain.heightAt });
  cache = { jet, terrain, world };
  return cache;
}

// cfg: { count, stages, mix: {C,E,S,W}, seed }
export function runSim(cfg = {}) {
  const { jet, terrain, world } = solveBase();
  const c = { ...FILM, ...cfg, mix: { ...(cfg.mix || FILM.mix) } };
  const S = simulateSwarm({
    target: jet, world, dt: DT, count: c.count, stages: c.stages, mix: c.mix, seed: c.seed,
    waves: FILM_WAVES, script: { tail: TAIL, finale: FINAL_T },
  });
  return { jet, terrain, ...S, cfg: c };
}

// 紙一重の回避（見た目）：近いすれ違い（22m 以内）の直前に、弾と反対へ最大 4m 跳ねてロールし、すぐ戻る。
// sim の道は変えない。描画と操縦席のカメラだけがこれを使う。
export function makeDodge(S) {
  const list = [];
  for (const p of S.passes) {
    if (p.dist > 22) continue;
    const m = S.missiles[p.id];
    const st = missileState(m, p.t); if (!st) continue;
    const j = jetState(S.jet, p.t);
    const v = nrm(j.v);
    let perp = sub(st.p, j.p); perp = sub(perp, scl(v, dot(perp, v)));
    if (len(perp) < 1e-3) continue;
    const away = scl(nrm(perp), -1);
    const right = qrot(j.q, RIGHT);
    const k = clamp(1 - (p.dist - 10) / 16, 0.35, 1);
    list.push({ t: p.t, away, amp: 4.0 * k, roll: (dot(away, right) >= 0 ? 1 : -1) * 0.95 * k });
  }
  return (s) => {
    let off = [0, 0, 0], roll = 0;
    for (const d of list) {
      if (s < d.t - 0.4 || s > d.t + 0.8) continue;
      const w = sstep(d.t - 0.3, d.t - 0.03, s) * (1 - sstep(d.t + 0.08, d.t + 0.65, s));
      off = add(off, scl(d.away, d.amp * w));
      roll += d.roll * w;
    }
    const l = len(off); if (l > 6) off = scl(off, 6 / l);
    roll = clamp(roll, -1.4, 1.4);
    return { off, roll };
  };
}
export function jetVisual(S, dodge, t) {
  const j = jetState(S.jet, t);
  const d = dodge(t);
  if (!d.roll && !d.off[0] && !d.off[1] && !d.off[2]) return j;
  return { ...j, p: add(j.p, d.off), q: qnrm(qmul(j.q, qaxis(FWD, d.roll))) };
}
export { DEFAULT_MIX };

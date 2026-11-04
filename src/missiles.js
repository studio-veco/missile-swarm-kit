// Homing missile swarm: pods that split into dozens of homing missiles that fan out, arc, corkscrew,
// skim past the target by a hair and blow up one by one. Everything is solved up front at a fixed step
// and stored per missile, so a renderer can scrub to any time and every replay is identical.
//
// Knobs a viewer can turn:
//   count   missiles per wave (after the last split)
//   stages  1 = launched straight at the target, 2 = pod -> count, 3 = pod -> 5 pods -> count, 4 = pod -> 3 -> 9 -> count
//   mix     share of each trajectory style (any positive weights; they are normalised):
//             C straight   — homes in directly, narrow fan
//             E fan-out    — opens wide first, then runs straight in from wherever it ended up
//             S swirl      — the classic arc: swirls around the line of sight, tightens late (A/B/D flavours)
//             W wobble     — keeps changing curl speed and radius, never fully settles
import { add, sub, scl, dot, crs, len, nrm, clamp, sstep, qaxis, qrot, rng, segDist } from './math.js';
import { sphereWorld } from './world.js';

export const MIX_KEYS = ['C', 'E', 'S', 'W'];
export const DEFAULT_MIX = { C: 44, E: 36, S: 0, W: 20 };

// Guidance constants (tuned for a ~300 m/s fighter on a 60 km planet)
export const GUIDE = {
  ampK: 0.6, fwd0: 0.5, convLo: 1.0, convHi: 2.0, keep: 0.85, lead: 0.6, aK: 1.9,
  missLo: 9, missHi: 18,        // aim this far off the target's centre (they must graze, not hit)
  tail: 0.7,                    // far away, aim at where the target was (follow its turn)
  sprint: 0.35, sprintT: 31.0,  // late sprint for the survivors
  avoidR: 13, avoidT: 0.7, avoidK: 5, // last-moment sidestep if the closest approach would be < avoidR
  firstDeath: 9.0,              // nobody dies before this (except into the ground)
  gEsc: 120, gAim: 30,          // terrain-aware missiles pull up below gEsc m and never aim below gAim m
  fanLo: 1.0, fanHi: 5.0, fanC: 2.5, fanPull: 0,
  slugH: 900,                   // heavy missiles turn sluggishly when diving below this height
};

// Per style: speed, lateral acceleration, curl (rad/s), swirl amplitude, opening angle at the split (deg)
export const CLS = {
  C: { sp: [560, 640], a: [420, 520], curl: [0, 0], amp: [0, 0], spread: [4, 22] },
  A: { sp: [520, 590], a: [700, 950], curl: [3.0, 5.0], amp: [1.8, 2.6], spread: [55, 105] },
  B: { sp: [500, 560], a: [380, 520], curl: [1.5, 2.6], amp: [1.3, 1.9], spread: [38, 78] },
  D: { sp: [540, 610], a: [330, 460], curl: [1.0, 1.9], amp: [2.4, 3.2], spread: [72, 120] },
  E: { sp: [540, 610], a: [480, 650], curl: [0, 0], amp: [0, 0], spread: [40, 110] },
  W: { sp: [520, 590], a: [700, 950], curl: [3.0, 5.0], amp: [1.9, 2.8], spread: [55, 115] },
};
const SWIRL = ['A', 'B', 'D'];

// Two waves as in the film. off = launch point relative to the target.
export const FILM_WAVES = [
  { t: 0.0, off: [380, 520, -3300], life: [8.0, 34.0], passes: [1, 4] },
  // Wave 2: the light (terrain-aware) missiles live long and are kept for the finale; the heavy ones burn out early
  { t: 13.0, off: [-1500, 3600, 2600], life: [5.0, 25.5], passes: [1, 4], light: { life: [19.5, 24.5], passes: [2, 4], minDoom: 33.8 }, heavyLife: [6, 16] },
];

// Integer counts per style (largest remainder), in the fixed order C, E, S, W
export function mixCounts(mix = DEFAULT_MIX, n = 50) {
  const w = MIX_KEYS.map((k) => Math.max(0, Number(mix[k]) || 0));
  const tot = w.reduce((a, b) => a + b, 0) || 1;
  const exact = w.map((x) => (x / tot) * n);
  const out = exact.map(Math.floor);
  let rest = n - out.reduce((a, b) => a + b, 0);
  const ord = exact.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; rest > 0; k = (k + 1) % ord.length, rest--) out[ord[k].i]++;
  return Object.fromEntries(MIX_KEYS.map((k, i) => [k, out[i]]));
}

// Style of each slot 0..n-1 (C first, then E, S, W). Swirl slots take A/B/D in turn.
function slotClasses(mix, n) {
  const c = mixCounts(mix, n);
  const out = [];
  for (const k of MIX_KEYS) for (let i = 0; i < c[k]; i++) out.push(k === 'S' ? SWIRL[i % 3] : k);
  return out;
}

// Split plan per stage count: how many children each pod generation has and how close it splits
function stagePlan(stages) {
  if (stages <= 1) return { gens: 0, branch: [], splitR: [] };
  if (stages === 2) return { gens: 1, branch: [], splitR: [1150], splitT: [9] };
  if (stages === 3) return { gens: 2, branch: [5], splitR: [2300, 1150], splitT: [5, 5] };
  return { gens: 3, branch: [3, 3], splitR: [2700, 1900, 1150], splitT: [4, 4, 5] };
}

// Pick a direction perpendicular to toT (basis from the smallest component, so it never degenerates)
export function swirlDir(toT, ang) {
  const ax = Math.abs(toT[0]), ay = Math.abs(toT[1]), az = Math.abs(toT[2]);
  const b = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const e1 = nrm(crs(toT, b));
  const e2 = nrm(crs(e1, toT));
  return add(scl(e2, Math.cos(ang)), scl(e1, Math.sin(ang)));
}

// Turn the velocity toward `desired`, limited by lateral acceleration a (angular rate a / speed).
// Speed is set to m.speed. (Adding a velocity difference instead barely turns when the aim is behind.)
export function steer(m, desired, dt, target = m) {
  const s = len(target.v) || 1;
  const vh = scl(target.v, 1 / s);
  const ang = Math.acos(clamp(dot(vh, desired), -1, 1));
  let nd = vh;
  if (ang > 1e-6) {
    let ax = crs(vh, desired);
    if (len(ax) < 1e-6) ax = crs(vh, Math.abs(vh[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
    nd = qrot(qaxis(nrm(ax), Math.min(ang, (m.a / Math.max(60, m.speed)) * dt)), vh);
  }
  target.v = scl(nrm(nd), m.speed);
}

/**
 * Solve the whole swarm.
 * @param {object} o
 * @param {object} o.target   sampled target track {n, dt, pos: Float32Array(n*3), vel: Float32Array(n*3)} (see flight.js)
 * @param {object} [o.world]  sphereWorld(...) — ground collisions and terrain avoidance
 * @param {number} [o.count=50] missiles per wave
 * @param {number} [o.stages=2]
 * @param {object} [o.mix]    weights for C/E/S/W
 * @param {Array}  [o.waves]
 * @param {object} [o.guide]  overrides for GUIDE
 * @param {object} [o.script] choreography: { tail: {t0,t1,gap,close}, finale: seconds } (both optional)
 * @param {number} [o.seed]
 * @returns {{missiles, explosions, passes, stats}}
 *   missile: {id, kind:'pod'|'mini', gen, wave, cls, birth, death (step index), deathType, hist: Float32Array}
 *   explosion: {t, pos, type:'split'|'overshoot'|'fuel'|'ground'|'collide', id, size, seed}
 *   pass: closest approach to the target under 160 m {t, id, dist}
 */
export function simulateSwarm(o) {
  const J = o.target;
  const DT = o.dt || J.dt || 1 / 120;
  const world = o.world || sphereWorld();
  const G = { ...GUIDE, ...(o.guide || {}) };
  const count = Math.max(1, Math.round(o.count ?? 50));
  const stages = Math.max(1, Math.min(4, Math.round(o.stages ?? 2)));
  const plan = stagePlan(stages);
  const classes = slotClasses(o.mix || DEFAULT_MIX, count);
  const script = o.script || {};
  const TAIL = script.tail || null;
  const FINAL_T = script.finale ?? null;
  const rand = rng(o.seed ?? 20261103);
  const rr = (a, b) => a + (b - a) * rand();
  const upOf = world.up, altOf = world.alt, TH = world.ground;
  const N = J.n;
  const missiles = [];
  const explosions = [];
  const passes = [];
  const stats = { grazes: 0, minDist: 1e9 };

  const jetAt = (t) => {
    const f = clamp(t / DT, 0, J.n - 1), i = Math.min(J.n - 2, Math.floor(f)), u = f - i;
    const P = (k) => J.pos[i * 3 + k] * (1 - u) + J.pos[i * 3 + 3 + k] * u;
    const V = (k) => J.vel[i * 3 + k] * (1 - u) + J.vel[i * 3 + 3 + k] * u;
    return { p: [P(0), P(1), P(2)], v: [V(0), V(1), V(2)] };
  };

  const pending = (o.waves || FILM_WAVES).map((w, k) => ({ ...w, k, finals: 0, finalPods: Math.max(1, plan.branch.reduce((a, b) => a * b, 1)) }));
  const alive = [];
  const kill = (m, i, type, at) => {
    if (!m.alive) return;
    m.alive = false; m.death = i;
    m.deathType = type;
    if (type !== 'split') explosions.push({ t: i * DT, pos: at || m.p.slice(), type, id: m.id, size: m.kind === 'pod' ? 1.6 : type === 'collide' ? 1.25 : type === 'ground' ? 1.35 : 1.0, seed: rand() });
  };
  const rec = (m) => { m.hist.push(m.p[0], m.p[1], m.p[2]); };

  // Children of a pod (or of the launcher when stages = 1): `slots` are this pod's indices into the wave's style list
  const spawnMinis = (src, i, jp, jv, w, slots, recNow = true) => {
    const toT = nrm(sub(add(jp, scl(jv, 1.5)), src.p));
    for (const k of slots) {
      const cls = classes[k];
      const C = CLS[cls];
      // open around an axis perpendicular to the line of sight
      const axis = swirlDir(toT, rand() * Math.PI * 2);
      const spread = rr(C.spread[0], C.spread[1]) * Math.PI / 180;
      let d = qrot(qaxis(axis, spread * (rand() < 0.5 ? -1 : 1)), toT);
      d = nrm(d);
      const sp = rr(C.sp[0], C.sp[1]);
      const mm = {
        id: missiles.length, kind: 'mini', gen: src.gen + 1, wave: w.k, cls, birth: i, death: -1, alive: true, hist: [],
        p: add(src.p, [rr(-2, 2), rr(-2, 2), rr(-2, 2)]),
        v: add(scl(src.v, 0.25), scl(d, sp * 0.9)),
        speed: sp, a: rr(C.a[0], C.a[1]), curl: rr(C.curl[0], C.curl[1]) * (rand() < 0.5 ? -1 : 1), amp: rr(C.amp[0], C.amp[1]),
        seedA: rand() * Math.PI * 2, conv: rr(G.convLo, G.convHi), t: 0, tc: 0,
        life: rr(w.life[0], w.life[1]), maxPasses: Math.floor(rr(w.passes[0], w.passes[1] + 0.999)), passes: 0, doom: -1,
        missR: rr(G.missLo, G.missHi), heavy: cls === 'C' || rand() < 0.45, missDir: nrm([rr(-1, 1), rr(-1, 1), rr(-1, 1)]), d1: 1e9, d2: 1e9,
      };
      if (w.light && !mm.heavy) { mm.life = rr(w.light.life[0], w.light.life[1]); mm.maxPasses = Math.floor(rr(w.light.passes[0], w.light.passes[1])); mm.minDoom = w.light.minDoom; }
      if (w.heavyLife && mm.heavy) mm.life = rr(w.heavyLife[0], w.heavyLife[1]);
      // How long it keeps flying along its fan direction before homing (straight attackers arrive staggered)
      mm.fan = cls === 'E' ? rr(G.fanLo, G.fanHi) : cls === 'C' ? rr(0, G.fanC) : 0;
      missiles.push(mm);
      // Launched before this step's update (stages = 1): the update records the first point, like a pod
      if (recNow) rec(mm);
    }
  };
  // Sub-pods (stages 3 and 4): fly apart a little, keep homing, split again closer in
  const spawnPods = (src, i, jp, jv, w) => {
    const b = plan.branch[src.gen];
    const toT = nrm(sub(add(jp, scl(jv, 1.5)), src.p));
    const base = rand() * Math.PI * 2;
    for (let j = 0; j < b; j++) {
      const axis = swirlDir(toT, base + (j / b) * Math.PI * 2 + rr(-0.3, 0.3));
      const d = nrm(qrot(qaxis(axis, rr(14, 30) * Math.PI / 180), toT));
      missiles.push({
        id: missiles.length, kind: 'pod', gen: src.gen + 1, wave: w.k, cls: 'P', birth: i, death: -1, alive: true, hist: [],
        p: add(src.p, scl(d, 3)), v: add(scl(src.v, 0.3), scl(d, 760 * 0.85)), speed: 760, a: 240, t: 0, wcfg: w,
      });
      rec(missiles[missiles.length - 1]);
    }
  };
  // Which wave slots a final-generation pod carries: interleaved, so every pod gets a mix of styles
  const slotsFor = (w) => { const P = w.finalPods, j = w.finals++; const s = []; for (let k = j; k < count; k += P) s.push(k); return s; };

  for (let i = 0; i < N; i++) {
    const t = i * DT;
    const { p: jp, v: jv } = jetAt(t);
    // Launch
    for (const w of pending) {
      if (w.done || t < w.t) continue;
      w.done = true;
      const p0 = add(jp, w.off);
      const dir = nrm(sub(jp, p0));
      if (plan.gens === 0) {
        // One stage: the whole wave leaves the launcher at once (a flash marks the launch)
        explosions.push({ t, pos: p0.slice(), type: 'split', id: -1, size: 1.0, seed: rand() });
        spawnMinis({ p: p0, v: scl(dir, 820), gen: -1 }, i, jp, jv, w, [...Array(count).keys()], false);
      } else {
        missiles.push({
          id: missiles.length, kind: 'pod', gen: 0, wave: w.k, cls: 'P', birth: i, death: -1, alive: true, hist: [],
          p: p0, v: scl(dir, 820), speed: 820, a: 160, t: 0, wcfg: w,
        });
      }
    }
    alive.length = 0;
    for (const m of missiles) if (m.alive) alive.push(m);
    // Choreography: one missile glues itself to the target's tail
    if (TAIL && i === Math.round(TAIL.t0 / DT)) {
      const ok = (m) => { const q = add(m.p, scl(m.v, 0.6)); return altOf(m.p) - TH(m.p) > 90 && altOf(q) - TH(q) > 60; };
      const cand = alive.filter((m) => m.kind === 'mini' && ok(m));
      // Prefer an agile missile (a sluggish one overshoots the gap and rams the target)
      const agile = cand.filter((m) => m.a >= 600);
      const c = (agile.length ? agile : cand).map((m) => ({ m, d: len(sub(m.p, jp)) })).sort((a, b) => a.d - b.d)[0];
      if (c) { c.m.tail = true; c.m.life = Math.max(c.m.life, c.m.t + 10); c.m.doom = -1; c.m.minDoom = 99; c.m.heavy = false; }
    }
    // Choreography: the finale — the survivors self-destruct far to near, 0.16 s apart
    if (FINAL_T !== null && i === Math.round(FINAL_T / DT)) {
      const rest = alive.filter((m) => m.kind === 'mini' && !m.tail).map((m) => ({ m, d: len(sub(m.p, jp)) })).sort((a, b) => b.d - a.d);
      rest.forEach(({ m }, k) => { m.minDoom = 0; m.doom = FINAL_T + 0.15 + k * 0.16; });
    }
    for (const m of alive) {
      m.prev = m.p.slice();
      const toJ = sub(jp, m.p);
      const dist = len(toJ);
      if (m.kind === 'pod') {
        m.t += DT;
        const tGo = clamp(dist / m.speed, 0, 3);
        const aim = nrm(sub(add(jp, scl(jv, tGo)), m.p));
        steer(m, aim, DT);
        m.p = add(m.p, scl(m.v, DT));
        rec(m);
        const g = m.gen;
        if ((m.t > 0.5 && dist < plan.splitR[g]) || m.t > plan.splitT[g]) {
          kill(m, i, 'split');
          explosions.push({ t, pos: m.p.slice(), type: 'split', id: m.id, size: g === 0 ? 1.4 : 1.0, seed: rand() });
          const w = m.wcfg;
          if (g < plan.gens - 1) spawnPods(m, i, jp, jv, w);
          else spawnMinis(m, i, jp, jv, w, slotsFor(w));
        }
        continue;
      }
      // ---- homing missile ----
      m.t += DT; m.tc += DT;
      const boost = 0.55 + 0.45 * sstep(0, 0.7, m.t);
      const sprint = m.minDoom ? sstep(G.sprintT, G.sprintT + 1.5, t) : 0;
      let sp = m.speed * boost * (1 + G.sprint * sprint);
      const tailOn = m.tail && t < TAIL.t1, tailOff = m.tail && t >= TAIL.t1;
      if (tailOn) { const js = len(jv); sp = js + clamp((dist - TAIL.gap) * 2.2, -60, TAIL.close); m.tailSp = js; }
      if (tailOff) { sp = m.tailSp; if (m.doom < 0) m.doom = TAIL.t1 + 1.5; }
      const tGo = clamp(dist / sp, 0, G.lead);
      let aimP = add(jp, scl(jv, tGo));
      // Far away: aim at where the target was (ride its tail through the turn)
      if (G.tail > 0) aimP = add(aimP, scl(jv, -G.tail * clamp((dist - 350) / 900, 0, 1)));
      // Close in: aim a little off-centre (always a near miss)
      const losN = nrm(toJ);
      let md = sub(m.missDir, scl(losN, dot(m.missDir, losN)));
      md = nrm(md);
      const near = clamp(1 - dist / 650, 0, 1);
      aimP = add(aimP, scl(md, m.missR * near));
      // Light missiles know the terrain (never aim below gAim)
      if (!m.heavy) { const ha = altOf(aimP) - TH(aimP); if (ha < G.gAim) aimP = add(aimP, scl(upOf(aimP), G.gAim - ha)); }
      const toT = nrm(sub(aimP, m.p));
      let des = toT;
      if (m.t < m.fan) {
        // Still fanning out: keep the heading; level off if it opened downward
        des = nrm(add(nrm(m.v), scl(toT, G.fanPull)));
        { const Uf = upOf(m.p), vd = dot(des, Uf); if (vd < -0.1) des = nrm(add(des, scl(Uf, -vd + 0.1))); }
      } else if (m.cls === 'W') {
        // Wobble: curl speed and radius keep changing, never fully converges
        m.ph = (m.ph ?? m.seedA) + DT * m.curl * (1 + 0.7 * Math.sin(m.t * 1.7 + m.seedA) + 0.4 * Math.sin(m.t * 3.9 + m.seedA * 2));
        let k = clamp(m.tc / (m.conv * 2.2), 0, 1); k = k * k * (3 - 2 * k);
        const conv = Math.max(k * 0.6, clamp(1 - dist / 900, 0, 1) * 0.5, sprint * 0.55);
        const amp = m.amp * (0.65 + 0.45 * Math.sin(m.t * 2.3 + m.seedA * 3));
        const sw = swirlDir(toT, m.ph);
        des = nrm(add(scl(toT, 0.25 + 0.75 * conv), scl(sw, amp * (1 - conv * 0.7))));
      } else if (m.cls !== 'C' && m.cls !== 'E') {
        // Swirl: rotate around the line of sight; converge with time and when close
        let k = clamp(m.tc / m.conv, 0, 1); k = k * k * (3 - 2 * k);
        const nearC = clamp(1 - dist / 1500, 0, 1);
        const conv = Math.max(k, nearC, sprint * 0.55);
        const sw = swirlDir(toT, m.t * m.curl + m.seedA);
        des = nrm(add(scl(toT, G.fwd0 + (1 - G.fwd0) * conv), scl(sw, m.amp * G.ampK * (1 - conv * G.keep))));
      }
      // Heavy missiles turn sluggishly in a low dive (they plough into the ground)
      const U = upOf(m.p);
      const hg = TH(m.p);
      const h = altOf(m.p) - hg;
      const vdn = dot(nrm(m.v), U);
      const aEff = m.a * (m.heavy && vdn < -0.45 && h < G.slugH ? 0.42 : 1);
      // Light missiles look 0.4 and 0.9 s ahead and pull up from walls early
      let hs = h;
      if (!m.heavy) for (const la of [0.4, 0.9]) { const q = add(m.p, scl(m.v, la)); hs = Math.min(hs, altOf(q) - TH(q) + la * 40); }
      if (m.tail && hs < 18) des = nrm(add(des, scl(U, (18 - hs) / 18)));
      if (!m.heavy && !m.tail && hs < G.gEsc) des = nrm(add(des, scl(U, ((G.gEsc - hs) / G.gEsc) * 2.2 * Math.max(0.15, 0.3 - vdn) * (hs < h ? 1.6 : 1))));
      // Tail glue: chase the point the target passed `lag` seconds ago, match its heading when close
      if (tailOn) {
        const js = Math.max(60, len(jv));
        const lag = clamp((dist * 0.55) / js, TAIL.gap / js, 1.4);
        const tp0 = jetAt(t - lag).p;
        const tp = add(tp0, scl(upOf(tp0), Math.min(50, Math.max(0, dist - 40) * 0.25)));
        const jd = nrm(jv);
        des = nrm(add(nrm(sub(tp, m.p)), scl(jd, clamp(1 - (dist - TAIL.gap) / 60, 0, 1) * 1.5)));
      } else if (tailOff) des = nrm(m.v);
      // Sidestep: if the closest approach within avoidT s is under avoidR m, swerve so it only grazes
      if (!m.tail) {
        const rv = sub(m.v, jv), rp = sub(m.p, jp);
        const rv2 = dot(rv, rv);
        const tc = rv2 > 1 ? clamp(-dot(rp, rv) / rv2, 0, G.avoidT) : 0;
        const cp = add(rp, scl(rv, tc));
        const cd = len(cp);
        // Swirlers also come alongside with little closing speed (tc = 0): push them off too
        const swirler = m.cls === 'A' || m.cls === 'B' || m.cls === 'D';
        if ((tc > 0 || swirler) && cd < G.avoidR * (swirler ? 1.6 : 1)) {
          let away = sub(cp, scl(nrm(rv), dot(cp, nrm(rv))));
          if (len(away) < 0.5) away = sub(md, scl(nrm(rv), dot(md, nrm(rv))));
          des = nrm(add(des, scl(nrm(away), G.avoidK * (1 - cd / G.avoidR) + 0.5)));
        }
      }
      steer({ ...m, speed: sp, a: (m.tail ? m.a * 2.2 : aEff) * G.aK }, des, DT, m);
      m.p = add(m.p, scl(m.v, DT));
      // Never touch the target: push out to 9 m (graze)
      const dj = sub(m.p, jp), dl = len(dj);
      if (dl < 9) { m.p = add(jp, scl(nrm(dj), 9)); stats.grazes++; }
      stats.minDist = Math.min(stats.minDist, Math.max(dl, 9));
      rec(m);
      // Pass detection (local minimum of distance)
      if (m.d1 < 160 && m.d1 < m.d2 && dl > m.d1) {
        m.passes++; m.tc = 0;
        passes.push({ t: t - DT, id: m.id, dist: m.d1 });
        if (m.passes >= m.maxPasses && m.doom < 0 && t > (m.minDoom || 0)) m.doom = Math.max(t + rr(0.3, 1.5), G.firstDeath + rr(0.05, 0.6));
      }
      m.d2 = m.d1; m.d1 = dl;
      // Ways to die
      if (h < 1.5) { kill(m, i, 'ground', world.groundPoint(U, hg)); continue; }
      if (m.doom > 0 && t >= m.doom) { kill(m, i, 'overshoot'); continue; }
      if (m.t >= m.life && t >= G.firstDeath) { kill(m, i, 'fuel'); continue; }
    }
    // Missile-missile collisions (swept segments). Not within 90 m of the target (keeps the shot readable)
    const minis = t < G.firstDeath ? [] : alive.filter((m) => m.alive && m.kind === 'mini' && m.t > 0.6);
    for (let a = 0; a < minis.length; a++) {
      const A = minis[a];
      for (let b = a + 1; b < minis.length; b++) {
        const B = minis[b];
        if (!A.alive || !B.alive) continue;
        if (Math.abs(A.p[0] - B.p[0]) > 25 || Math.abs(A.p[1] - B.p[1]) > 25 || Math.abs(A.p[2] - B.p[2]) > 25) continue;
        if (len(sub(A.p, jp)) < 90) continue;
        if (segDist(A.prev, A.p, B.prev, B.p) < 3.2) {
          const mid = scl(add(A.p, B.p), 0.5);
          kill(A, i, 'collide', mid);
          B.alive = false; B.death = i; B.deathType = 'collide2';
        }
      }
    }
  }
  for (const m of missiles) {
    m.hist = new Float32Array(m.hist); if (m.death < 0) m.death = N - 1;
    // drop solver-only state
    for (const k of ['prev', 'p', 'v', 'wcfg', 'd1', 'd2', 'missDir', 'alive']) delete m[k];
  }
  explosions.sort((a, b) => a.t - b.t);
  return { missiles, explosions, passes, stats, config: { count, stages, mix: mixCounts(o.mix || DEFAULT_MIX, count), seed: o.seed ?? 20261103 } };
}

// Missile position and heading at time t (null when not alive)
export function missileState(m, t, dt = 1 / 120) {
  const f = t / dt;
  if (f < m.birth || f > m.death) return null;
  const k = f - m.birth, n = m.hist.length / 3;
  const i = Math.min(n - 2, Math.floor(k)), u = k - i;
  if (n < 2) return { p: [m.hist[0], m.hist[1], m.hist[2]], d: [0, 0, 1] };
  const H = m.hist;
  const p = [H[i * 3] * (1 - u) + H[i * 3 + 3] * u, H[i * 3 + 1] * (1 - u) + H[i * 3 + 4] * u, H[i * 3 + 2] * (1 - u) + H[i * 3 + 5] * u];
  const d = nrm([H[i * 3 + 3] - H[i * 3], H[i * 3 + 4] - H[i * 3 + 1], H[i * 3 + 5] - H[i * 3 + 2]]);
  return { p, d };
}

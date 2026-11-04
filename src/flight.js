// Fighter flight model driven by a "maneuver program" (a list of timed stick/throttle commands).
// Integrated at a fixed step (default 120 Hz) and stored as arrays, so any moment can be looked up later.
// Body axes: nose +Z, up +Y, left wing +X. Units: metres, seconds.
import { add, scl, dot, crs, nrm, clamp, sstep, qmul, qaxis, qnrm, qrot, qfromTo } from './math.js';
import { sphereWorld } from './world.js';

const G0 = 9.81;
export const FWD = [0, 0, 1], UP = [0, 1, 0], RIGHT = [-1, 0, 0];

// Thrust/drag as accelerations (top speed ~380 m/s), lift capped at 15 G
export const JET = {
  thrust: 30, kD: 30 / 380 ** 2, kAlpha: 9,
  cL: 0.0105, aMax: 150,
  aoaMax: 28 * Math.PI / 180, stab: 2.4,
};

// ---- Maneuver commands ----
// Each command acts inside t0..t1 and ramps in/out over r seconds.
// roll/pitch/yaw: rotate this many degrees over the window. pullG: hold a load factor.
// bankTo / holdAlt / holdGam: simple autopilots. thr: throttle step.
// Optional: startIf(state) / stopIf(state) to trigger on altitude or flight-path angle,
// mark: name the moment a command stops, rel: time the command relative to a mark.
export const R = (t0, t1, deg, r = 0.12) => ({ t0, t1, r, k: 'roll', deg });
export const P = (t0, t1, deg, r = 0.12) => ({ t0, t1, r, k: 'pitch', deg });
export const Y = (t0, t1, deg, r = 0.12) => ({ t0, t1, r, k: 'yaw', deg });
export const PG = (t0, t1, g, r = 0.25) => ({ t0, t1, r, k: 'pullG', g });
export const BANK = (t0, t1, deg, r = 0.2) => ({ t0, t1, r, k: 'bankTo', deg });
export const ALT = (t0, t1, alt, r = 0.4, kp = 0.6, kd = 1.0) => ({ t0, t1, r, k: 'holdAlt', alt, kp, kd });
export const GAM = (t0, t1, deg, r = 0.3) => ({ t0, t1, r, k: 'holdGam', deg });
export const THR = (t, v) => ({ t0: t, k: 'thr', v });

// The "valley escape" program used in the film: cruise, break, aileron roll, cobra, vertical climb,
// split-S dive, 15 G pull-out into a canyon at 35 m, S-turns, barrel roll, snap rolls, victory roll.
export function valleyEscapeProgram() {
  return [
    THR(0, 0.6),
    ALT(0, 3.9, 1600),
    BANK(0.2, 1.6, -18), BANK(1.6, 3.4, 4),
    THR(3.6, 1.0),
    BANK(3.9, 4.5, -82, 0.12),
    PG(4.5, 7.4, 11.5),
    R(7.35, 7.85, 165, 0.1),
    PG(7.85, 9.3, 11),
    R(9.72, 10.3, 360, 0.08),
    BANK(10.3, 10.58, 0, 0.1),
    GAM(10.3, 10.6, 2),
    THR(10.55, 0.15),
    P(10.6, 11.1, 100, 0.08),
    P(11.35, 11.85, -96, 0.08),
    THR(11.8, 1.0),
    GAM(11.9, 13.2, -8),
    BANK(11.9, 13.2, 0),
    { ...PG(13.2, 16, 14), stopIf: (s) => s.gam > 80 },
    GAM(14.4, 16.7, 86),
    R(14.9, 16.5, 360, 0.25),
    THR(15.4, 0.45),
    R(16.65, 17.05, 180, 0.08),
    { ...PG(17.05, 23, 15), stopIf: (s) => s.gam < -84 && s.t > 18 },
    THR(18.6, 1.0),
    { ...PG(19, 34, 15), startIf: (s) => s.alt < 870 && s.gam < -40, stopIf: (s) => s.gam > -18, mark: 'bottom' },
    { ...ALT(19, 44, 35, 0.6, 1.2, 2.4), bank: true, startIf: (s) => s.alt < 500 && s.gam > -25 },
    ...[
      BANK(0.3, 1.6, 85), PG(0.5, 1.5, 8),
      BANK(1.6, 3.0, -85), PG(1.8, 2.9, 8),
      BANK(3.0, 4.1, 0),
      R(4.1, 6.5, 400, 0.15),
      PG(4.1, 6.5, 6.0, 0.2),
      BANK(6.5, 7.0, 85, 0.1),
      PG(6.9, 8.8, 13),
      R(8.9, 9.6, -720, 0.08),
      BANK(9.6, 10.6, 0),
      GAM(10.6, 40, 34, 1.6),
      R(11.4, 16.4, 360, 1.0),
      THR(16, 0.8),
    ].map((c) => ({ ...c, rel: 'bottom' })),
  ];
}

function bankOf(q, U) {
  const r = qrot(q, RIGHT), u = qrot(q, UP);
  return Math.atan2(-dot(r, U), dot(u, U));
}

/**
 * Integrate the fighter.
 * @returns {{n, dt, pos, quat, vel, speed, g, thr, alpha, alt, events}} typed arrays, one sample per step
 */
export function simulateFlight({
  program = valleyEscapeProgram(), duration = 56, dt = 1 / 120,
  world = sphereWorld(), start = [0, 1600, 0], speed: speed0 = 290, throttle = 0.6, jet = JET,
} = {}) {
  const upOf = world.up, altOf = world.alt;
  const n = Math.round(duration / dt) + 1;
  const out = {
    n, dt, pos: new Float32Array(n * 3), quat: new Float32Array(n * 4), vel: new Float32Array(n * 3),
    speed: new Float32Array(n), g: new Float32Array(n), thr: new Float32Array(n), alpha: new Float32Array(n), alt: new Float32Array(n),
  };
  let p = start.slice();
  let q = [0, 0, 0, 1];
  let vdir = [0, 0, 1], speed = speed0, thr = throttle, thrCmd = throttle;
  for (const c of program) { delete c._ts; delete c._te; }
  const ev = {};
  const T0 = (c) => (c.rel ? (ev[c.rel] === undefined ? Infinity : ev[c.rel] + c.t0) : c.t0);
  const T1 = (c) => (c.rel ? (ev[c.rel] === undefined ? Infinity : ev[c.rel] + c.t1) : c.t1);
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    let tb = -1;
    for (const e of program) if (e.k === 'thr' && T0(e) <= t && T0(e) >= tb) { tb = T0(e); thrCmd = e.v; }
    thr += (thrCmd - thr) * Math.min(1, dt * (thrCmd > thr ? 5 : 3));
    const U = upOf(p);
    let pr = 0, qr = 0, yr = 0, pitchCmd = false;
    const gamNow = Math.asin(clamp(dot(vdir, U), -1, 1)) * 180 / Math.PI;
    const st = { t, alt: altOf(p), gam: gamNow, speed };
    // Available load is limited by lift (small at low speed)
    const aAvail = Math.min(jet.aMax, jet.cL * speed * speed * Math.sin(2 * jet.aoaMax) * 0.5);
    for (const c of program) {
      const c0 = T0(c), c1 = T1(c);
      if (c.k === 'thr' || t < c0) continue;
      if (c._ts === undefined) { if (c.startIf && !c.startIf(st)) continue; c._ts = t; }
      if (c._te === undefined && c.stopIf && c.stopIf(st)) { c._te = Math.min(c1, t + c.r); if (c.mark) ev[c.mark] = c._te; }
      const ts = c.startIf ? c._ts : c0, te = c._te !== undefined ? c._te : c1;
      if (t > te) continue;
      const w = sstep(ts, ts + c.r, t) * (1 - sstep(te - c.r, te, t));
      const span = Math.max(0.05, c.t1 - c.t0 - c.r);
      if (c.k === 'pitch') pitchCmd = true;
      if (c.k === 'roll') pr += w * (c.deg * Math.PI / 180) / span;
      else if (c.k === 'pitch') qr += w * (c.deg * Math.PI / 180) / span;
      else if (c.k === 'yaw') yr += w * (c.deg * Math.PI / 180) / span;
      else if (c.k === 'pullG') qr += w * Math.min(c.g * G0, aAvail) / Math.max(60, speed);
      else if (c.k === 'bankTo') {
        let d = c.deg * Math.PI / 180 - bankOf(q, U);
        d = Math.atan2(Math.sin(d), Math.cos(d));
        pr += w * clamp(d * 5, -4.5, 4.5);
      } else if (c.k === 'holdAlt') {
        const vz = dot(vdir, U) * speed;
        const h = altOf(p);
        const lim = c.bank ? Math.min(aAvail, 45) : aAvail;
        const want = clamp((c.alt - h) * c.kp - vz * c.kd, -lim, lim);
        const up = qrot(q, UP);
        const cu = dot(up, U);
        // bank: while banked only the vertical part of the pull helps, so pull harder
        const eff = c.bank ? 1 / Math.max(0.4, Math.abs(cu)) : Math.min(1, Math.abs(cu) * 1.5);
        qr += w * clamp(want / Math.max(60, speed) * Math.sign(cu || 1) * eff, -1.2, 1.2);
      } else if (c.k === 'holdGam') {
        const gam = Math.asin(clamp(dot(vdir, U), -1, 1));
        const up = qrot(q, UP);
        const cu = dot(up, U);
        const d = c.deg * Math.PI / 180 - gam;
        qr += w * clamp(d * 2.2, -aAvail / Math.max(60, speed), aAvail / Math.max(60, speed)) * Math.sign(cu || 1) * Math.min(1, Math.abs(cu) * 2 + 0.15);
      }
    }
    if (pr) q = qmul(q, qaxis(FWD, pr * dt));
    if (qr) q = qmul(q, qaxis([-1, 0, 0], qr * dt));
    if (yr) q = qmul(q, qaxis([0, -1, 0], yr * dt));
    q = qnrm(q);
    // Without a pitch command, an over-large angle of attack weathervanes back into the airflow
    if (!pitchCmd) {
      const n0 = qrot(q, FWD), a0 = Math.acos(clamp(dot(n0, vdir), -1, 1));
      if (a0 > jet.aoaMax) {
        const ax = nrm(crs(n0, vdir));
        q = qnrm(qmul(qaxis(ax, Math.min(a0 - jet.aoaMax, jet.stab * (a0 - jet.aoaMax) * dt)), q));
      }
    }
    // Lift turns the velocity toward the nose
    const nose = qrot(q, FWD);
    const ca = clamp(dot(vdir, nose), -1, 1);
    const alpha = Math.acos(ca);
    let aLat = 0;
    if (alpha > 1e-5) {
      const lift = Math.max(0, jet.cL * speed * speed * Math.sin(2 * Math.min(alpha, Math.PI / 2)) * 0.5);
      aLat = Math.min(jet.aMax, lift);
      const turn = Math.min(alpha, (aLat / Math.max(30, speed)) * dt);
      const ax = nrm(crs(vdir, nose));
      vdir = nrm(qrot(qaxis(ax, turn), vdir));
    }
    // Speed: thrust, drag (grows with angle of attack), gravity along the path
    const sa = Math.sin(Math.min(alpha, Math.PI / 2));
    const acc = jet.thrust * thr - jet.kD * speed * speed * (1 + jet.kAlpha * sa * sa) - G0 * dot(vdir, U);
    speed = Math.max(40, speed + acc * dt);
    // Move, then carry the body frame along the sphere (straight = great circle)
    const np = add(p, scl(vdir, speed * dt));
    const tr = qfromTo(U, upOf(np));
    q = qnrm(qmul(tr, q));
    vdir = nrm(qrot(tr, vdir));
    p = np;
    out.pos.set(p, i * 3); out.quat.set(q, i * 4); out.vel.set(scl(vdir, speed), i * 3);
    out.speed[i] = speed; out.g[i] = aLat / G0 + dot(qrot(q, UP), U); out.thr[i] = thr; out.alpha[i] = alpha; out.alt[i] = altOf(p);
  }
  out.events = ev;
  return out;
}

// Interpolated state at time t (position, attitude, velocity and gauges)
export function jetState(J, t, dt = J.dt || 1 / 120) {
  const f = clamp(t / dt, 0, J.n - 1), i = Math.min(J.n - 2, Math.floor(f)), u = f - i;
  const L = (arr, k, s) => arr[i * s + k] * (1 - u) + arr[(i + 1) * s + k] * u;
  const q0 = [J.quat[i * 4], J.quat[i * 4 + 1], J.quat[i * 4 + 2], J.quat[i * 4 + 3]];
  let q1 = [J.quat[i * 4 + 4], J.quat[i * 4 + 5], J.quat[i * 4 + 6], J.quat[i * 4 + 7]];
  if (q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2] + q0[3] * q1[3] < 0) q1 = q1.map((x) => -x);
  const q = qnrm([0, 1, 2, 3].map((k) => q0[k] * (1 - u) + q1[k] * u));
  return {
    p: [L(J.pos, 0, 3), L(J.pos, 1, 3), L(J.pos, 2, 3)], q,
    v: [L(J.vel, 0, 3), L(J.vel, 1, 3), L(J.vel, 2, 3)],
    speed: L(J.speed, 0, 1), g: L(J.g, 0, 1), thr: L(J.thr, 0, 1), alpha: L(J.alpha, 0, 1), alt: L(J.alt, 0, 1),
  };
}

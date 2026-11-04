// Regression check against the original film solver (sim.js of the film project).
// With the film's settings (2 stages, 50 per wave, C/E/W = 22/18/10) the kit must reproduce it exactly.
// Usage: node tools/regress_film.mjs /path/to/original/js
import { pathToFileURL } from 'node:url';
import { simulateFlight } from '../src/flight.js';
import { simulateSwarm, FILM_WAVES } from '../src/missiles.js';
import { sphereWorld } from '../src/world.js';

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/regress_film.mjs <original js dir>'); process.exit(2); }
const old = await import(pathToFileURL(`${dir}/sim.js`).href);
const { buildTerrain } = await import(pathToFileURL(`${dir}/terrain.js`).href);

const A = old.runSim();

const base = sphereWorld({ radius: 60000 });
const J = simulateFlight({ duration: 56, world: base });
const track = [];
for (let t = 24.0; t <= 56 + 1e-6; t += 0.1) {
  const i = Math.min(J.n - 1, Math.round(t / J.dt));
  track.push(base.surfXZ([J.pos[i * 3], J.pos[i * 3 + 1], J.pos[i * 3 + 2]]));
}
const T = buildTerrain(track);
const world = sphereWorld({ radius: 60000, heightAt: T.heightAt });
const B = simulateSwarm({
  target: J, world, count: 50, stages: 2, mix: { C: 22, E: 18, S: 0, W: 10 }, waves: FILM_WAVES,
  script: { tail: { t0: 32.0, t1: 33.95, gap: 11, close: 420 }, finale: 34.0 }, seed: 20261103,
});

let bad = 0;
const eq = (name, a, b) => { const ok = a === b; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'DIFF'} ${name}: ${a} ${ok ? '' : `vs ${b}`}`); };
let jd = 0; for (let i = 0; i < J.pos.length; i++) jd = Math.max(jd, Math.abs(J.pos[i] - A.jet.pos[i]));
eq('jet max |dpos|', jd, 0);
eq('missiles', B.missiles.length, A.missiles.length);
eq('explosions', B.explosions.length, A.explosions.length);
eq('passes', B.passes.length, A.passes.length);
eq('minDist', B.stats.minDist, A.stats.minDist);
eq('grazes', B.stats.grazes, A.stats.grazes);
let hd = 0, dd = 0;
A.missiles.forEach((m, k) => { const n = B.missiles[k]; if (!n) return; if (n.death !== m.death || n.cls !== m.cls) dd++; const L = Math.min(m.hist.length, n.hist.length); for (let i = 0; i < L; i++) hd = Math.max(hd, Math.abs(m.hist[i] - n.hist[i])); if (m.hist.length !== n.hist.length) dd++; });
eq('missile death/class/length mismatches', dd, 0);
eq('missile max |dhist|', hd, 0);
eq('tail id', B.missiles.find((m) => m.tail)?.id, A.missiles.find((m) => m.tail)?.id);
console.log(bad ? `FAIL (${bad})` : 'PASS');
process.exit(bad ? 1 : 0);

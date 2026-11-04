// The ground the swarm flies over: a sphere (default: a small 60 km planet) with an optional height field.
// Flight and missiles only talk to the world through this object, so you can swap in a flat world,
// a real-scale planet, or no ground at all.
import { add, sub, scl, nrm } from './math.js';

export function sphereWorld({ radius = 60000, heightAt = null } = {}) {
  const C = [0, -radius, 0];
  const up = (p) => nrm(sub(p, C));
  // Height above the reference sphere (not above the terrain)
  const alt = (p) => Math.hypot(p[0] - C[0], p[1] - C[1], p[2] - C[2]) - radius;
  // Surface x, z (the terrain grid coordinates)
  const surfXZ = (p) => { const n = up(p); return [n[0] * radius, n[2] * radius]; };
  // Terrain height under p (0 when there is no height field)
  const ground = heightAt ? (p) => { const s = surfXZ(p); return heightAt(s[0], s[1]); } : () => 0;
  // A point on the terrain under the unit up-vector u
  const groundPoint = (u, hg) => add(C, scl(u, radius + hg + 0.5));
  return { radius, center: C, up, alt, surfXZ, ground, groundPoint };
}

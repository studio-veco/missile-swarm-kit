// Aircraft registry. Every builder returns the same interface (see kit.js `assemble`):
// { root, body, canopy, pilot, cockpit, seat, nozIn, nozzles[], nozzle, nozzleR, tips[2], stabTips[2],
//   eye, wingVapor, length, setPOV(on, back), setGlow(throttle) }
export { buildDelphinus } from './delphinus.js';
export { buildF2A } from './f2a.js';
export { buildF16 } from './f16.js';
export { buildF22 } from './f22.js';
export { buildSu37, buildMiG29 } from './flankers.js';
export * as kit from './kit.js';
import { buildDelphinus } from './delphinus.js';
import { buildF2A } from './f2a.js';
import { buildF16 } from './f16.js';
import { buildF22 } from './f22.js';
import { buildSu37, buildMiG29 } from './flankers.js';

export const AIRCRAFT = {
  delphinus: { name: 'DELPHINUS', ja: 'デルフィナス', note: 'Organic dolphin-like fighter: long nose, sickle wings, tall swept dorsal fin', build: buildDelphinus },
  f22: { name: 'F-22A', ja: 'F-22', note: 'Diamond wing, caret intakes, canted twin fins, 2-D nozzles', build: buildF22 },
  f16: { name: 'F-16C', ja: 'F-16', note: 'Chin intake, cropped delta, single fin', build: buildF16 },
  su37: { name: 'Su-37', ja: 'Su-37', note: 'Canards, long LERX, widely spaced twin engines, splinter camouflage', build: buildSu37 },
  mig29: { name: 'MiG-29', ja: 'MiG-29', note: 'Twin engines under LERX intakes, twin canted fins', build: buildMiG29 },
  f2a: { name: 'F-2A', ja: 'F-2A', note: 'JASDF F-2A in sea camouflage', build: buildF2A },
};

export function buildAircraft(type, envMap, opts) {
  const a = AIRCRAFT[type] || AIRCRAFT.delphinus;
  return a.build(envMap, opts);
}

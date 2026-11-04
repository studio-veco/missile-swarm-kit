// まとめ役：設定（機体・段数・軌道の割合・本数・乱数）→ 計算 → 「映像」（カット割り）か「自由視点」で描く
import * as THREE from '../vendor/three.module.js';
import { runSim, solveBase, jetState, jetVisual, makeDodge, missileState as missileStateFree, DT, FILM, PLANET_C } from './sim.js';
import { makeWorld, SUN_DIR, SUN_COL } from './world.js';
import { AIRCRAFT, buildAircraft } from '../src/aircraft/index.js';
import { mixCounts } from '../src/missiles.js';
import { makeSmoke, makeNoise3D } from './smoke.js';
import { makeFX } from './fx.js';
import { makePost } from './post.js';
import { makeDirector } from './director.js';
import { makeHud, loadFonts } from './hud.js';
import { makeMapLines } from './map.js';
import { makeAudio } from './audio.js';

const Q = new URLSearchParams(location.search);
const CAPTURE = Q.has('capture');
const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const clampInt = (v, a, b, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) && v !== null && v !== '' ? Math.min(b, Math.max(a, n)) : d; };

// ---------------- 設定 ----------------
export const PRESETS = {
  film: { label: '映像と同じ', mix: { C: 22, E: 18, S: 0, W: 10 } },
  swirl: { label: '回り込み多め', mix: { C: 15, E: 15, S: 50, W: 20 } },
  even: { label: '均等', mix: { C: 25, E: 25, S: 25, W: 25 } },
  wobble: { label: 'ぐにゃぐにゃだけ', mix: { C: 0, E: 0, S: 0, W: 100 } },
  straight: { label: '直進だけ', mix: { C: 100, E: 0, S: 0, W: 0 } },
};
const QUALITY = {
  high: { label: '高', scale: 1.0, maxW: 1920, smoke: 1, shadow: 2048, stride: 1 },
  mid: { label: '中', scale: 0.75, maxW: 1600, smoke: 2, shadow: 1024, stride: 2 },
  low: { label: '低', scale: 0.55, maxW: 1100, smoke: 3, shadow: 1024, stride: 4 },
};
function readState() {
  const mix = (Q.get('mix') || '').split(',').map(Number);
  const coarse = matchMedia('(pointer: coarse)').matches;
  return {
    craft: AIRCRAFT[Q.get('craft')] ? Q.get('craft') : 'delphinus',
    stages: clampInt(Q.get('st'), 1, 4, 2),
    count: clampInt(Q.get('n'), 10, 100, 50),
    mix: mix.length === 4 && mix.every((x) => Number.isFinite(x) && x >= 0) && mix.some((x) => x > 0) ? { C: mix[0], E: mix[1], S: mix[2], W: mix[3] } : { ...PRESETS.film.mix },
    seed: clampInt(Q.get('seed'), 1, 2147483646, FILM.seed),
    mode: Q.get('mode') === 'free' ? 'free' : 'film',
    quality: QUALITY[Q.get('q')] ? Q.get('q') : (coarse ? 'low' : 'mid'),
  };
}
const state = readState();
const shareURL = (s = state) => {
  const u = new URL(location.href);
  u.search = new URLSearchParams({ craft: s.craft, st: s.stages, n: s.count, mix: [s.mix.C, s.mix.E, s.mix.S, s.mix.W].join(','), seed: s.seed, mode: s.mode }).toString();
  return u.toString();
};
const writeURL = () => { if (CAPTURE) return; const u = new URL(shareURL()); u.searchParams.set('q', state.quality); history.replaceState(null, '', u.toString()); };

// ---------------- 描画の土台 ----------------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

function frameSize() {
  if (CAPTURE) return [Number(Q.get('w') || 1920), Number(Q.get('h') || 1080)];
  const q = QUALITY[state.quality];
  const r = canvas.getBoundingClientRect();
  let w = Math.round(Math.max(320, r.width) * Math.min(2, devicePixelRatio || 1) * q.scale);
  w = Math.max(480, Math.min(q.maxW, w));
  return [w, Math.round(w * 9 / 16)];
}
let [W, H] = frameSize();
renderer.setSize(W, H, false);

const status = (s) => { const el = $('status'); if (!el) return; el.textContent = s || ''; el.classList.toggle('on', !!s); };
status('地形を作っています…');
await nextFrame();
solveBase();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, W / H, 0.05, 6e6);
scene.add(camera);
// 映り込み用の環境（上は暗い宇宙、下は白い星、低い太陽）
const envMap = (() => {
  const es = new THREE.Scene();
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, uniforms: { uSun: { value: SUN_DIR } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uSun; varying vec3 vD; void main(){ vec3 d = normalize(vD);
      float g = smoothstep(-0.25, 0.05, d.y);
      vec3 c = mix(vec3(0.95, 0.96, 1.0)*0.9, vec3(0.02, 0.03, 0.07), g);
      c += vec3(0.55, 0.7, 1.0)*exp(-abs(d.y + 0.08)*14.0)*0.6;
      c += vec3(1.0, 0.95, 0.88)*(pow(max(dot(d, uSun), 0.0), 600.0)*80.0 + pow(max(dot(d, uSun), 0.0), 20.0)*0.6);
      gl_FragColor = vec4(c, 1.0); }`,
  });
  es.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), m));
  const pm = new THREE.PMREMGenerator(renderer);
  return pm.fromScene(es, 0.0, 0.1, 100).texture;
})();
const world = makeWorld(scene, solveBase().terrain, { renderer: Q.has('nobake') ? null : renderer, stride: QUALITY[state.quality].stride });
const noise3 = makeNoise3D(64);
const sun = new THREE.DirectionalLight(SUN_COL, 3.4);
sun.castShadow = true;
sun.shadow.mapSize.set(QUALITY[state.quality].shadow, QUALITY[state.quality].shadow);
Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 90 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0x101830, 0xdfe5ee, 1.25));
const pls = Array.from({ length: 4 }, () => { const l = new THREE.PointLight(0xff88cc, 0, 0, 2); scene.add(l); return l; });

await loadFonts();
let post = makePost(renderer, W, H);
let hud = makeHud(W, H);
const audio = makeAudio('data/music.m4a');

// ---------------- 計算結果と、それに付く描画物 ----------------
let sim, dodge, jet, smoke, fx, mapLines, director, built = {};
const freeTree = (o) => o.traverse((x) => { x.geometry?.dispose?.(); if (x.material) (Array.isArray(x.material) ? x.material : [x.material]).forEach((m) => m.dispose?.()); });
const simKey = (s) => JSON.stringify([s.stages, s.count, s.mix.C, s.mix.E, s.mix.S, s.mix.W, s.seed]);

async function rebuild(force = false) {
  const kSim = simKey(state), kJet = state.craft, kQ = state.quality;
  const simChanged = force || kSim !== built.sim || kQ !== built.q;
  const jetChanged = force || kJet !== built.jet;
  if (!simChanged && !jetChanged) return false;
  if (simChanged) { status('ミサイルを計算しています…'); await nextFrame(); }
  if (simChanged && (kSim !== built.sim || !sim)) {
    sim = runSim({ count: state.count, stages: state.stages, mix: state.mix, seed: state.seed });
    dodge = makeDodge(sim);
  }
  if (jetChanged) {
    if (fx) { scene.remove(fx.group); fx.dispose(); fx = null; }
    if (jet) { scene.remove(jet.root); freeTree(jet.root); }
    jet = buildAircraft(state.craft, envMap);
    scene.add(jet.root);
  }
  if (simChanged) {
    status('煙を組み立てています…'); await nextFrame();
    if (smoke) { scene.remove(smoke.smoke, smoke.core); smoke.dispose(); }
    smoke = makeSmoke(sim, noise3, QUALITY[state.quality].smoke);
    scene.add(smoke.smoke, smoke.core);
    if (mapLines) { scene.remove(mapLines.group); freeTree(mapLines.group); }
    mapLines = makeMapLines(sim);
    scene.add(mapLines.group);
  }
  if (fx) { scene.remove(fx.group); fx.dispose(); }
  fx = makeFX(sim, noise3, envMap, jet);
  scene.add(fx.group);
  director = makeDirector(sim, jet);
  hud.setCraft(state.craft);
  audio.reset(sim);
  built = { sim: kSim, jet: kJet, q: kQ };
  status('');
  return true;
}
await rebuild(true);

// ---------------- 1 コマ描く ----------------
const PC = new THREE.Vector3(...PLANET_C);
let lastDebug = {};
function setupAndDraw(s, cam) {
  const J = jetVisual(sim, dodge, s);
  jet.root.position.set(...J.p);
  jet.root.quaternion.set(J.q[0], J.q[1], J.q[2], J.q[3]);
  jet.root.updateMatrixWorld(true);
  jet.setPOV(!!cam.pov, !!cam.back);
  jet.cockpit.visible = (!!cam.pov || !!cam.cockpit) && !jet.panoramic;
  camera.position.copy(cam.pos);
  if (cam.quat) camera.quaternion.copy(cam.quat);
  else { camera.up.copy(cam.up || new THREE.Vector3(0, 1, 0)); camera.lookAt(cam.look); }
  if (cam.roll) camera.rotateZ(cam.roll);
  camera.fov = cam.fov || 50;
  camera.near = cam.near || 0.05;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  sun.position.copy(jet.root.position).addScaledVector(SUN_DIR, 40);
  sun.target.position.copy(jet.root.position);
  sun.target.updateMatrixWorld();
  smoke.update(s, SUN_DIR);
  const r = fx.update(s, camera, SUN_DIR, { dust: cam.dust ?? 1, dustVel: cam.vel || new THREE.Vector3(), glowNear: cam.glowNear });
  fx.sortPuffs(camera);
  smoke.setLights(r.lights);
  smoke.smokeMat.uniforms.uDensity.value = cam.smokeDensity ?? 1;
  smoke.smokeMat.uniforms.uNearFade.value = cam.smokeNear ?? 9;
  smoke.coreMat.uniforms.uGain.value = cam.coreGain ?? 1;
  world.update(s, H / 1080, r.impacts, J);
  sun.intensity = 3.4 * (0.1 + 0.9 * world.sunVisAt(jet.root.position));
  world.setMap(cam.map || 0);
  const jp = jet.root.position;
  const near = r.lights.filter((l) => l.i > 0.5).map((l) => ({ l, d: Math.hypot(l.p[0] - jp.x, l.p[1] - jp.y, l.p[2] - jp.z) })).sort((a, b) => a.d - b.d);
  pls.forEach((pl, i) => { const n = near[i]; if (n && n.d < 600) { pl.position.set(...n.l.p); pl.intensity = n.l.i * 800; pl.color.setRGB(...n.l.c); } else pl.intensity = 0; });
  const mapOn = (cam.map || 0) > 0;
  mapLines.group.visible = mapOn;
  for (const o of [smoke.smoke, smoke.core, fx.group, jet.root]) o.visible = !mapOn;
  if (mapOn) mapLines.update(cam.reveal ?? 56, H / 1080, W, H, Math.min(1, cam.map * 1.2));
  renderer.render(scene, camera);
  lastDebug = { s, alive: sim.missiles.filter((m) => m.birth * DT <= s && m.death * DT > s && m.kind === 'mini').length };
  return J;
}

// 映像：作品の秒 T（sub＞1 なら 1 コマを sub 回描いて平均＝動きのブレ）
function renderFilm(T, sub = 1, shutter = 0.5) {
  post.beginAccum();
  for (let k = 0; k < sub; k++) {
    const Tk = sub > 1 ? T + ((k + 0.5) / sub - 0.5) * shutter / 60 : T;
    const shot = director.at(Tk);
    post.renderSub(() => setupAndDraw(shot.s, shot.cam), 1 / sub);
  }
  const main = director.at(T);
  hud.draw(main, sim, T, camera);
  post.finish(hud.tex, { ...main.post, uTime: T });
  return main;
}

// 自由視点：シミュの秒 s。戦闘機（またはミサイル）のまわりを指で回す
const FREE_LEN = 49;
const orbit = { yaw: 2.35, pitch: 0.16, dist: 30, follow: -1, cockpit: false };
const POST0 = { uExposure: 1.0, uBloom: 0.09, uCA: 0.0025, uVig: 0.35, uGrain: 0.045, uFlash: 0, uInvert: 0, uMono: 0, uLetter: 0, uSat: 1.0, uBlack: 0, uHudOn: 1 };
function freeCam(s) {
  const j = jetVisual(sim, dodge, s);
  const P = new THREE.Vector3(...j.p), V = new THREE.Vector3(...j.v);
  const u = P.clone().sub(PC).normalize();
  let f = V.clone().addScaledVector(u, -V.dot(u)); if (f.lengthSq() < 1) f.set(0, 0, 1); f.normalize();
  const r = new THREE.Vector3().crossVectors(f, u).normalize();
  if (orbit.cockpit) {
    // 操縦席：機体の目の位置から前を見る（回避の跳ね・ロールごと）
    const q = new THREE.Quaternion(j.q[0], j.q[1], j.q[2], j.q[3]);
    const E = jet.eye;
    const pos = new THREE.Vector3(E.x, E.y + 0.01, E.z - 0.04).applyQuaternion(q).add(P);
    const look = new THREE.Vector3(E.x, E.y - 0.03, 60).applyQuaternion(q).add(P);
    return { pos, look, up: new THREE.Vector3(0, 1, 0).applyQuaternion(q), fov: 76, pov: true, near: 0.02, vel: V, dust: 0.5 };
  }
  if (orbit.follow >= 0) {
    const m = sim.missiles[orbit.follow];
    if (m && m.birth * DT <= s && m.death * DT > s) {
      const st = missileStateFree(m, s);
      const mp = new THREE.Vector3(...st.p), md = new THREE.Vector3(...st.d);
      const up = mp.clone().sub(PC).normalize();
      const side = new THREE.Vector3().crossVectors(md, up).normalize();
      const pos = mp.clone().addScaledVector(md, -6.5).addScaledVector(up, 1.6).addScaledVector(side, 1.2);
      return { pos, look: P.clone().lerp(mp, 0.25), up, fov: 52, vel: md.clone().multiplyScalar(560), glowNear: 0.3, near: 0.02 };
    }
    orbit.follow = nextMissile(s);
  }
  const cp = Math.cos(orbit.pitch);
  const off = r.clone().multiplyScalar(Math.cos(orbit.yaw) * cp * orbit.dist).addScaledVector(f, Math.sin(orbit.yaw) * cp * orbit.dist).addScaledVector(u, Math.sin(orbit.pitch) * orbit.dist);
  return { pos: P.clone().add(off), look: P, up: u, fov: 50, vel: V };
}
function nextMissile(s, after = -1) {
  const alive = sim.missiles.filter((m) => m.kind === 'mini' && m.birth * DT <= s && m.death * DT > s + 0.5);
  if (!alive.length) return -1;
  const jp = new THREE.Vector3(...jetState(sim.jet, s).p);
  alive.sort((a, b) => missileDist(a, s, jp) - missileDist(b, s, jp));
  const i = alive.findIndex((m) => m.id === after);
  return alive[(i + 1) % Math.min(alive.length, 12)].id;
}
const missileDist = (m, s, jp) => { const st = missileStateFree(m, s); return st ? jp.distanceTo(new THREE.Vector3(...st.p)) : 1e9; };
function renderFree(s) {
  const cam = freeCam(s);
  post.beginAccum();
  post.renderSub(() => setupAndDraw(s, cam), 1);
  const main = { shot: { hud: orbit.cockpit ? 'cockpit' : 'tele' }, s, u: 0, T: s, cam, post: POST0 };
  hud.draw(main, sim, s, camera);
  post.finish(hud.tex, { ...POST0, uTime: s });
  return main;
}

// 書き出し・確認用（ヘッドレスの Chrome から呼ぶ）
window.__film = {
  ready: true,
  get sim() { return sim; }, get director() { return director; }, get duration() { return director.duration; },
  renderFilm, renderFree,
  get objs() { return { smoke, fx, world, jet, scene, camera, renderer, post }; },
  async apply(cfg) { Object.assign(state, cfg); if (cfg.mix) state.mix = { ...cfg.mix }; await rebuild(); return { picks: director.pick, duration: director.duration, missiles: sim.missiles.length }; },
  async renderQuery(qs) {
    const q = new URLSearchParams(qs);
    if (q.has('free')) { orbit.cockpit = q.get('cam') === 'cockpit'; orbit.follow = -1; renderFree(Number(q.get('free'))); }
    else renderFilm(Number(q.get('t') || 0), Number(q.get('sub') || 1));
    return lastDebug;
  },
  grab(qual = 0.9) { return canvas.toDataURL('image/jpeg', qual); },
};
if (CAPTURE) { status(''); }

// ---------------- 画面（再生バーと設定） ----------------
if (!CAPTURE) {
  const play = $('play'), bar = $('seek'), tl = $('time'), app = $('app');
  let playing = false, T = 0, S = 0, last = performance.now(), prevS = 0, started = false;
  const POSTER_T = 11.4;
  const dur = () => (state.mode === 'film' ? director.duration : FREE_LEN);
  const setPlaying = (on) => {
    playing = on; if (on) started = true; app.classList.toggle('playing', on); play.setAttribute('aria-label', on ? '一時停止' : '再生');
    $('bigplay').hidden = on || T > 0.01 || S > 0.01;
    last = performance.now();
  };
  const seekTo = (x) => { if (state.mode === 'film') T = x; else S = x; prevS = -1; audio.reset(sim); };
  play.onclick = async () => { if (!audio.ready && $('sound').getAttribute('aria-pressed') === 'true') await audio.setEnabled(true); setPlaying(!playing); };
  $('bigplay').onclick = async () => { await audio.setEnabled(true); syncSound(); setPlaying(true); };
  bar.oninput = () => seekTo(Number(bar.value));
  const syncSound = () => $('sound').setAttribute('aria-pressed', audio.enabled ? 'true' : 'false');
  $('sound').onclick = async () => { await audio.setEnabled(!audio.enabled); syncSound(); };
  $('fs').onclick = () => { const el = document.documentElement; if (!document.fullscreenElement) (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el); else document.exitFullscreen?.(); };
  // 映像 / 自由視点
  const modeBtns = document.querySelectorAll('[data-mode]');
  const setMode = (m) => {
    state.mode = m; writeURL();
    modeBtns.forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === m ? 'true' : 'false'));
    app.classList.toggle('free', m === 'free');
    bar.max = String(dur()); prevS = -1;
    if (m === 'free') { S = Math.min(FREE_LEN, Math.max(0, director.at(T).s)); orbit.follow = -1; }
  };
  modeBtns.forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  const markCam = () => { $('orbit').setAttribute('aria-pressed', !orbit.cockpit && orbit.follow < 0 ? 'true' : 'false'); $('pov').setAttribute('aria-pressed', orbit.cockpit ? 'true' : 'false'); $('follow').setAttribute('aria-pressed', orbit.follow >= 0 && !orbit.cockpit ? 'true' : 'false'); };
  $('follow').onclick = () => { const s = S; orbit.cockpit = false; orbit.follow = orbit.follow >= 0 ? nextMissile(s, orbit.follow) : nextMissile(s); markCam(); };
  $('orbit').onclick = () => { orbit.follow = -1; orbit.cockpit = false; markCam(); };
  $('pov').onclick = () => { orbit.follow = -1; orbit.cockpit = true; markCam(); };
  // 指・マウスで回す（自由視点）
  const ptrs = new Map(); let pinch0 = 0, dist0 = 30;
  canvas.addEventListener('pointerdown', (e) => { if (state.mode !== 'free') return; canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); dist0 = orbit.dist; } });
  canvas.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const p = ptrs.get(e.pointerId), dx = e.clientX - p.x, dy = e.clientY - p.y;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) { orbit.yaw -= dx * 0.008; orbit.pitch = Math.max(-1.2, Math.min(1.35, orbit.pitch + dy * 0.006)); orbit.follow = -1; orbit.cockpit = false; markCam(); }
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0 > 0) orbit.dist = Math.max(12, Math.min(900, dist0 * pinch0 / d)); }
  });
  const up = (e) => { ptrs.delete(e.pointerId); pinch0 = 0; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { if (state.mode !== 'free') return; e.preventDefault(); orbit.dist = Math.max(12, Math.min(900, orbit.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });
  addEventListener('keydown', (e) => {
    if (e.target.closest('input, button, select')) return;
    if (e.code === 'Space') { play.click(); e.preventDefault(); }
    if (e.code === 'ArrowRight') seekTo(Math.min(dur(), (state.mode === 'film' ? T : S) + 1));
    if (e.code === 'ArrowLeft') seekTo(Math.max(0, (state.mode === 'film' ? T : S) - 1));
  });

  // ---- 設定パネル ----
  const panel = $('panel');
  $('settings').onclick = () => { const on = !app.classList.contains('panel'); app.classList.toggle('panel', on); $('settings').setAttribute('aria-expanded', on ? 'true' : 'false'); };
  $('closePanel').onclick = () => { app.classList.remove('panel'); $('settings').setAttribute('aria-expanded', 'false'); };
  const draft = JSON.parse(JSON.stringify(state));
  // 機体：押したらすぐ替える
  const craftBox = $('crafts');
  for (const [k, a] of Object.entries(AIRCRAFT)) {
    const b = document.createElement('button');
    b.className = 'craft'; b.dataset.craft = k; b.type = 'button';
    b.innerHTML = `<img src="data/craft_${k}.png" alt="" width="240" height="150"><span class="cn">${a.ja}</span><span class="ce">${a.name}</span>`;
    b.onclick = async () => { draft.craft = state.craft = k; markCraft(); writeURL(); await rebuild(); };
    craftBox.append(b);
  }
  const markCraft = () => craftBox.querySelectorAll('.craft').forEach((b) => b.setAttribute('aria-pressed', b.dataset.craft === state.craft ? 'true' : 'false'));
  // 段数
  const STAGE_NOTE = { 1: '発射台から全部を一度に撃つ', 2: '母ミサイル 1 本が手前で割れる', 3: '母ミサイル → 5 本 → さらに割れる', 4: '母ミサイル → 3 本 → 9 本 → さらに割れる' };
  const stBtns = document.querySelectorAll('[data-st]');
  stBtns.forEach((b) => (b.onclick = () => { draft.stages = Number(b.dataset.st); paintDraft(); }));
  // 割合
  const KEYS = ['C', 'E', 'S', 'W'];
  KEYS.forEach((k) => { $(`mix${k}`).oninput = (e) => { draft.mix[k] = Number(e.target.value); paintDraft(); }; });
  const presetBox = $('presets');
  for (const [k, p] of Object.entries(PRESETS)) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = p.label;
    b.onclick = () => { draft.mix = { ...p.mix }; paintDraft(); };
    presetBox.append(b);
  }
  $('count').oninput = (e) => { draft.count = Number(e.target.value); paintDraft(); };
  $('reseed').onclick = () => { draft.seed = 1 + Math.floor(Math.random() * 2147483000); paintDraft(); };
  document.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { draft.quality = b.dataset.q; paintDraft(); }));
  function paintDraft() {
    stBtns.forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.st) === draft.stages ? 'true' : 'false'));
    $('stNote').textContent = STAGE_NOTE[draft.stages];
    const tot = KEYS.reduce((a, k) => a + draft.mix[k], 0) || 1;
    const cnt = mixCounts(draft.mix, draft.count);
    KEYS.forEach((k) => {
      $(`mix${k}`).value = String(draft.mix[k]);
      $(`pct${k}`).textContent = `${Math.round((draft.mix[k] / tot) * 100)}%`;
      $(`seg${k}`).style.flexGrow = String(cnt[k]);
      $(`seg${k}`).textContent = cnt[k] ? String(cnt[k]) : '';
    });
    $('count').value = String(draft.count); $('countV').textContent = `${draft.count} 本 × 2 波`;
    $('seedV').textContent = String(draft.seed);
    document.querySelectorAll('[data-q]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.q === draft.quality ? 'true' : 'false'));
    const dirty = simKey(draft) !== simKey(state) || draft.quality !== state.quality;
    $('apply').classList.toggle('dirty', dirty);
  }
  $('apply').onclick = async () => {
    const qChanged = draft.quality !== state.quality;
    Object.assign(state, { stages: draft.stages, count: draft.count, mix: { ...draft.mix }, seed: draft.seed, quality: draft.quality });
    writeURL();
    if (qChanged) { status('画質を切り替えています…'); location.reload(); return; }
    await rebuild();
    paintDraft();
    seekTo(0); setMode(state.mode); bar.value = '0';
    if (matchMedia('(max-width: 820px)').matches) app.classList.remove('panel');
    if (!audio.ready) await audio.setEnabled(true).catch(() => {});
    syncSound(); setPlaying(true);
  };
  $('share').onclick = async () => {
    const url = shareURL();
    try { await navigator.clipboard.writeText(url); $('share').textContent = 'コピーしました'; } catch { prompt('この URL を共有してください', url); }
    setTimeout(() => { $('share').textContent = 'URL をコピー'; }, 1600);
  };
  markCraft(); paintDraft(); setMode(state.mode); writeURL(); markCam();

  // ---- 画面の大きさが変わったら描く大きさを直す ----
  function resize(force) {
    const [w, h] = frameSize();
    if (!force && Math.abs(w - W) < 8) return;
    W = w; H = h;
    renderer.setSize(W, H, false);
    post = makePost(renderer, W, H);
    hud = makeHud(W, H);
    hud.setCraft(state.craft);
  }
  let rt = 0;
  new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => resize(false), 200); }).observe(canvas);

  // ---- ループ ----
  let hideT = performance.now();
  addEventListener('pointermove', () => { app.classList.remove('idle'); hideT = performance.now(); });
  addEventListener('pointerdown', () => { app.classList.remove('idle'); hideT = performance.now(); });
  const loop = (now) => {
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now;
    let main, sNow, rate = 1;
    if (state.mode === 'film') {
      const T0 = T;
      if (playing) { T += dt; if (T > director.duration) { T = director.duration; setPlaying(false); } }
      // まだ一度も再生していない間は、見どころの 1 コマを表紙に出す（冒頭は溶明で真っ黒なため）
      main = renderFilm(!started && T === 0 ? POSTER_T : T, 1);
      sNow = main.s;
      rate = T > T0 ? Math.max(0, (sNow - prevS) / (T - T0)) : 1;
      audio.music(T, playing, false);
      bar.value = String(T);
      tl.textContent = `${fmt(T)} / ${fmt(director.duration)}`;
    } else {
      if (playing) { S += dt; if (S > FREE_LEN) S = 0; }
      main = renderFree(S);
      sNow = S;
      audio.music(0, playing, true);
      bar.value = String(S);
      tl.textContent = `${fmt(S)} / ${fmt(FREE_LEN)}`;
    }
    if (playing && prevS >= 0) audio.update(sim, prevS, sNow, rate, camera, jetState(sim.jet, sNow));
    prevS = sNow;
    if (playing && now - hideT > 2600 && !app.classList.contains('panel')) app.classList.add('idle');
    requestAnimationFrame(loop);
  };
  const fmt = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
  requestAnimationFrame(loop);
  status('');
}

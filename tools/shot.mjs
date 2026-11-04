// Render frames of the site headlessly (for checks and for video footage). Settings via CFG (JSON).
//   CFG='{"craft":"f22","stages":3}' node tools/shot.mjs out.jpg "t=12.5" "free=20" "free=30&cam=cockpit" ...
// t = film time, free = simulation time in the free camera. Needs Chrome and ffmpeg (for the contact sheet).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { serve } from './serve.mjs';

// Chrome / Chromium to drive (set CHROME to your own path on Linux or Windows)
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [out, ...qs] = process.argv.slice(2);
const W = Number(process.env.W || 1280), H = Number(process.env.H || 720);
const { srv, url } = await serve(0, process.env.ROOT);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); if (process.env.LOG) console.log('[page]', m.text()); });
const t0 = Date.now();
await page.goto(`${url}/index.html?capture=1&w=${W}&h=${H}${process.env.QS || ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__film && window.__film.ready, null, { timeout: 180000 }).catch(() => {});
console.log('ready', Date.now() - t0, 'ms');
if (process.env.CFG) { const r = await page.evaluate(async (c) => window.__film.apply(c), JSON.parse(process.env.CFG)); console.log('apply', JSON.stringify(r)); }
if (errs.length) console.log('errors:', errs.slice(0, 8).join('\n'));
const base = out.replace(/\.(jpg|png)$/, '');
const files = [];
for (let i = 0; i < qs.length; i++) {
  const t1 = Date.now();
  const r = await page.evaluate(async (q) => { const d = await window.__film.renderQuery(q); return { d, img: window.__film.grab(0.9) }; }, qs[i]);
  const f = `${base}_${String(i).padStart(2, '0')}.jpg`;
  fs.writeFileSync(f, Buffer.from(r.img.split(',')[1], 'base64'));
  files.push(f);
  console.log(f, qs[i], JSON.stringify(r.d), (Date.now() - t1) + 'ms');
}
if (errs.length) console.log('errors:', [...new Set(errs)].slice(0, 12).join('\n'));
if (files.length > 1) {
  const cols = Math.min(Number(process.env.COLS || 3), files.length), rows = Math.ceil(files.length / cols);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `${base}_%02d.jpg`, '-vf', `scale=${process.env.TW || 560}:-1,tile=${cols}x${rows}:padding=4`, '-frames:v', '1', `${base}.jpg`]);
  console.log('sheet', `${base}.jpg`);
}
await browser.close();
srv.close();

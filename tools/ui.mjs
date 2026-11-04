// UI walkthrough: open the page normally, play, change settings, re-solve, switch to the free cockpit camera, take screenshots.
//   node tools/ui.mjs out_prefix
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
// Chrome / Chromium to drive (set CHROME to your own path on Linux or Windows)
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const out = process.argv[2];
const { srv, url } = await serve(0, process.env.ROOT);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errs = [];
for (const [name, vp, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`${name}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`${name}: ${m.text()}`); });
  page.on('requestfailed', (r) => errs.push(`${name}: failed ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) errs.push(`${name}: ${r.status()} ${r.url()}`); });
  await page.goto(`${url}/index.html${process.env.QS || ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__film && window.__film.ready && !document.getElementById('status').classList.contains('on'), null, { timeout: 120000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}_${name}_0.jpg`, quality: 80, fullPage: false });
  // 再生して 2 秒
  await page.click('#bigplay');
  await page.waitForTimeout(2000);
  const t1 = await page.textContent('#time');
  // 設定：F-22・3 段・回り込み多め → 飛ばす
  if (!mobile) await page.click('#settings');
  await page.waitForTimeout(500);
  await page.click('.craft[data-craft="f22"]');
  await page.waitForTimeout(800);
  await page.click('[data-st="3"]');
  await page.click('#presets .chip:nth-child(2)');
  await page.screenshot({ path: `${out}_${name}_1.jpg`, quality: 80, fullPage: mobile });
  const t0 = Date.now();
  await page.click('#apply');
  await page.waitForFunction(() => !document.getElementById('status').classList.contains('on'), null, { timeout: 60000 });
  const applyMs = Date.now() - t0;
  await page.waitForTimeout(1500);
  const t2 = await page.textContent('#time');
  const url2 = page.url();
  // 自由視点
  await page.click('[data-mode="free"]');
  await page.waitForTimeout(800);
  await page.click('#pov');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}_${name}_2.jpg`, quality: 80, fullPage: false });
  // フレームの重さ（2 秒数える）
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); }));
  console.log(name, 'time after 2s:', t1, '| after apply:', t2, '| apply', applyMs, 'ms | fps', fps.toFixed(1), '| url', url2.replace(url, ''));
  await ctx.close();
}
console.log(errs.length ? 'errors:\n' + [...new Set(errs)].join('\n') : 'no errors');
await browser.close(); srv.close();

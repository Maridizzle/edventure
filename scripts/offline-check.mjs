/**
 * Verifies the service worker actually serves the app offline.
 *
 * This is the check worth having: a base-path mistake in the PWA config does
 * not break the first load at all — it breaks the *second* one, once the
 * service worker is in charge, and it presents as a white screen. That is the
 * worst failure this app can have, because a 5-year-old cannot refresh, clear
 * a cache, or tell you what happened.
 *
 * Usage: node scripts/offline-check.mjs http://127.0.0.1:4174/edventure
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4174/edventure';

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const ctx = await browser.newContext({
  viewport: { width: 412, height: 883 },
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();

let failed = false;
const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  failed = true;
};

// 1. First load, and wait for the service worker to take control.
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
const registered = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  return reg ? reg.scope : 'none';
});
console.log(`service worker scope: ${registered}`);
if (registered === 'none' || registered === 'unsupported') {
  fail('service worker never became ready');
} else if (!registered.endsWith('/edventure/')) {
  fail(`scope is ${registered}, expected it to end with /edventure/`);
}

// Give workbox a moment to finish writing the precache.
await page.waitForTimeout(2500);

const cached = await page.evaluate(async () => {
  const names = await caches.keys();
  let total = 0;
  for (const n of names) total += (await (await caches.open(n)).keys()).length;
  return { names, total };
});
console.log(`precached ${cached.total} entries across ${cached.names.length} cache(s)`);
if (cached.total === 0) fail('nothing was precached');

// 2. Cut the network entirely and reload. This is the real test.
await ctx.setOffline(true);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.reload({ waitUntil: 'load' }).catch((e) => fail(`offline reload threw: ${e.message}`));
await page.waitForTimeout(2500);

const alive = await page.evaluate(() => {
  const c = document.getElementById('gl');
  const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
  return { hasCanvas: !!c, w: c?.width ?? 0, h: c?.height ?? 0, hasGl: !!gl };
});
console.log(`offline reload -> canvas ${alive.w}x${alive.h}, webgl ${alive.hasGl}`);

if (!alive.hasCanvas) fail('no canvas after offline reload — the white screen bug');
if (alive.w === 0 || alive.h === 0) fail('canvas has no drawing buffer offline');
if (errors.length) {
  for (const e of errors) console.error('  page error: ' + e);
  fail('page errors during offline reload');
}

await page.screenshot({ path: 'scratch/shots/03-offline.png' });
await browser.close();

console.log(failed ? 'OFFLINE CHECK FAILED' : 'OK: the app loads and runs with the network off.');
process.exit(failed ? 1 : 0);

/**
 * Prove his collection actually comes back.
 *
 * This is the only check that exercises saving end to end, and it exists
 * because a save that silently fails is worse than no save: he will trust it,
 * find eight creatures, close the app, and lose them without anyone noticing
 * for weeks. Unit tests can prove the roster round-trips in memory; only a real
 * browser proves it round-trips through IndexedDB and a page reload.
 *
 * Usage: node scripts/save-check.mjs http://127.0.0.1:4173
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const URL_ = `${BASE}/?debug=1&seed=20260830`;

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
// One context for the whole run: reloading in the SAME context is the point.
// A fresh context would have fresh storage and the check would prove nothing.
const context = await browser.newContext({
  viewport: { width: 412, height: 883 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

let failed = false;
const fail = (m) => {
  console.error(`FAIL: ${m}`);
  failed = true;
};

await page.goto(URL_, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const atStart = await page.evaluate(() => window.__collection?.() ?? 0);
console.log(`fresh start: ${atStart} in the collection`);
if (atStart < 1) fail('he did not even start with the friend he is given');

// A real touch first: that is where persistent storage gets requested, and it
// is also the only way a phone would ever reach this state.
await page.mouse.move(206, 700);
await page.mouse.down();
await page.mouse.move(230, 640, { steps: 4 });
await page.waitForTimeout(600);
await page.evaluate(() => {
  for (let i = 0; i < 4; i++) window.__friend?.();
});
await page.mouse.up();
await page.waitForTimeout(400);

const found = await page.evaluate(() => window.__collection?.() ?? 0);
console.log(`after finding some: ${found}`);
if (found <= atStart) fail('finding creatures did not grow the collection');

// Past the save debounce, then close the page the way a phone would.
await page.waitForTimeout(1200);

await page.reload({ waitUntil: 'networkidle' });
// The restore is async and lands a moment after the room does, by design.
await page.waitForTimeout(2000);

const restored = await page.evaluate(() => window.__collection?.() ?? 0);
const parade = await page.evaluate(() => window.__parade?.() ?? 0);
console.log(`after a reload: ${restored} in the collection, ${parade} following him`);

if (restored < found) fail(`lost ${found - restored} of ${found} across a reload`);
if (parade < 2) fail(`collection came back but nobody is following him (${parade})`);

const persisted = await page.evaluate(() => navigator.storage?.persisted?.() ?? false);
console.log(`storage marked persistent: ${persisted}`);

if (errors.length) {
  for (const e of errors.slice(0, 6)) console.error('  ' + e);
  fail('page errors during the save round trip');
}

await browser.close();
console.log(failed ? 'SAVE CHECK FAILED' : `OK: ${restored} creatures survived a reload.`);
process.exit(failed ? 1 : 0);

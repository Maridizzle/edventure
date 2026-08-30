/**
 * Walk through the door ten times and prove nothing leaks.
 *
 * This path had never executed before rooms could be left: every session until
 * now built exactly one scene, so `PlayScene.dispose()` was dead code. Ten
 * transitions with anything undisposed crashes a 4 GB phone, so the memory
 * counters get asserted rather than eyeballed.
 *
 * Usage: node scripts/rooms-check.mjs http://127.0.0.1:4200
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4200';
const ROUNDS = 10;
const OUT = 'scratch/shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: 412, height: 883 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

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

await page.goto(`${BASE}/?debug=1`, { waitUntil: 'networkidle' });
await page.mouse.move(206, 700);
await page.mouse.down();
await page.mouse.move(230, 640, { steps: 4 });
await page.waitForTimeout(1200);

// Open the door and photograph the celebration mid-flight.
await page.evaluate(() => window.__openDoor?.());
await page.waitForTimeout(220);
await page.screenshot({ path: `${OUT}/04-door-open.png` });
await page.mouse.up();

const baseline = await page.evaluate(() => window.__mem?.());
console.log(`baseline: ${baseline.geometries} geometries, ${baseline.textures} textures`);

for (let i = 0; i < ROUNDS; i++) {
  await page.evaluate(() => window.__exit?.());
  await page.waitForTimeout(1400);
  await page.evaluate(() => window.__openDoor?.());
  await page.waitForTimeout(120);
}

// Give the GPU resource lists a moment to settle after the last swap.
await page.waitForTimeout(800);
const after = await page.evaluate(() => window.__mem?.());
console.log(`after ${ROUNDS} rooms: ${after.geometries} geometries, ${after.textures} textures`);

await page.screenshot({ path: `${OUT}/05-new-room.png` });

// A little slack for pooled/idle resources, but nothing proportional to rounds.
const geoGrowth = after.geometries - baseline.geometries;
const texGrowth = after.textures - baseline.textures;
console.log(`growth: ${geoGrowth} geometries, ${texGrowth} textures`);

if (geoGrowth > 4) fail(`geometries grew by ${geoGrowth} across ${ROUNDS} rooms — leak`);
if (texGrowth > 2) fail(`textures grew by ${texGrowth} across ${ROUNDS} rooms — leak`);
if (errors.length) {
  for (const e of errors.slice(0, 6)) console.error('  ' + e);
  fail('page errors during room transitions');
}

await browser.close();
console.log(failed ? 'ROOM CHECK FAILED' : `OK: ${ROUNDS} room changes, no leak.`);
process.exit(failed ? 1 : 0);

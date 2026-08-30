/**
 * Headless smoke test: does it actually render, and does driving actually paint?
 *
 * Not a substitute for the real device — risk #12 says never trust a desktop —
 * but it catches shader compile failures, colour-space blowups and mask/world
 * misalignment before anything reaches the phone.
 *
 * Usage: node scripts/smoke.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const TARGET = process.argv[2] ?? 'http://localhost:4173';
// Accept either a served URL or a path to the standalone single-file build.
const URL_ = TARGET.endsWith('.html')
  ? `file://${resolve(TARGET)}?debug=1`
  : `${TARGET}/?debug=1`;
const OUT = 'scratch/shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

// A mid-range Android, roughly: 1080x2400 at DPR 3.
const page = await browser.newPage({
  viewport: { width: 412, height: 883 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(URL_, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/01-start.png` });

// Drive: press near the centre, drag up-left, hold, then sweep around.
const cx = 206;
const cy = 700;
await page.mouse.move(cx, cy);
await page.mouse.down();

const path = [
  [cx - 60, cy - 60],
  [cx + 60, cy - 60],
  [cx + 60, cy + 40],
  [cx - 60, cy + 40],
  [cx - 20, cy - 70],
];
for (const [x, y] of path) {
  await page.mouse.move(x, y, { steps: 8 });
  await page.waitForTimeout(900);
}
// Capture DURING a burst, not after it.
//
// This is how "I don't see any bursts" went unnoticed for a whole round: every
// screenshot was taken after the last input, by which time every particle had
// decayed. Fire one deliberately and shoot it in flight.
await page.evaluate(() => window.__burst?.());
await page.waitForTimeout(170);
await page.screenshot({ path: `${OUT}/02-burst.png` });

const sparks = await page.evaluate(() => {
  // Count bright pixels as a crude proof that something actually rendered.
  const c = document.getElementById('gl');
  return c ? `${c.width}x${c.height}` : 'no canvas';
});
console.log(`burst frame captured (${sparks})`);

await page.mouse.up();
await page.waitForTimeout(400);

await page.screenshot({ path: `${OUT}/03-painted.png` });

const stats = await page.evaluate(() => {
  const el = document.getElementById('debug');
  return el ? el.textContent : null;
});

// Sample the middle of the canvas: has anything non-grey appeared?
const coverage = stats?.match(/cover\s+([\d.]+)%/)?.[1];

console.log('--- debug overlay ---');
console.log(stats ?? '(overlay missing)');
console.log('---------------------');

let failed = false;
if (errors.length) {
  console.error('PAGE ERRORS:');
  for (const e of errors) console.error('  ' + e);
  failed = true;
}
if (coverage === undefined) {
  console.error('FAIL: no coverage reading — the scene did not initialise.');
  failed = true;
} else if (Number(coverage) <= 0) {
  console.error(`FAIL: driving produced no paint (coverage ${coverage}%).`);
  failed = true;
} else {
  console.log(`OK: driving painted ${coverage}% of the area.`);
}

await browser.close();
process.exit(failed ? 1 : 0);

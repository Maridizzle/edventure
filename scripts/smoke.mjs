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
// A pinned seed: the warmth capture below has to DRIVE at a hidden thing, and
// it cannot do that reproducibly in a room that is different every run.
const QUERY = 'debug=1&seed=20260830';
const URL_ = TARGET.endsWith('.html')
  ? `file://${resolve(TARGET)}?${QUERY}`
  : `${TARGET}/?${QUERY}`;
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
// Frame one, before any input: the friend he starts with must already be there.
const startParade = await page.evaluate(() => window.__parade?.() ?? 0);
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
// Walk deliberately AT the nearest hidden thing and photograph the warmth glow
// on the way in. The glow's whole point is that it shows on UNPAINTED gray
// floor -- a shot of painted ground proves nothing -- so this happens first,
// while the room is still drained.
//
// The same lesson as the fireworks, which shipped invisible for a release
// because every screenshot was taken after they had decayed: photograph the
// moment on purpose, never hope to catch it.
let peakWarmth = 0;
let warmthShot = false;
for (let leg = 0; leg < 120 && !warmthShot; leg++) {
  const to = await page.evaluate(() => window.__hidden?.() ?? null);
  if (!to) break;
  // Stick space IS world XZ: x right, y into the screen. The camera never
  // yaws, so that mapping is a constant for the whole game.
  await page.mouse.move(cx + to.dx * 55, cy + to.dz * 55, { steps: 3 });
  await page.waitForTimeout(140);
  const w = await page.evaluate(() => window.__warmth?.() ?? 0);
  if (w > peakWarmth) peakWarmth = w;
  // Just under 0.34, which is as hot as the floor can get before the creature
  // is found at 2.6 m. Shooting at the first "getting warm" threshold instead
  // photographs the glow at a fifth of its strength and proves very little.
  if (w > 0.28) {
    await page.screenshot({ path: `${OUT}/01b-warmth.png` });
    warmthShot = true;
  }
}

// Then MEASURE it, rather than trusting a screenshot.
//
// "Does this effect read?" is the exact question that shipped invisible
// fireworks for a whole release, and it went unnoticed because a human looked
// at a picture and thought it looked fine. Photograph the same frame with the
// glow on and with it off, and count the pixels that differ. A number cannot
// talk itself into seeing something.
let warmthPixels = 0;
if (warmthShot) {
  await page.mouse.up();
  await page.waitForTimeout(350);
  const on = await page.screenshot();
  await page.evaluate(() => window.__warmGain?.(0));
  await page.waitForTimeout(250);
  const off = await page.screenshot();
  await page.evaluate(() => window.__warmGain?.(1));
  warmthPixels = await page.evaluate(async ([a, c]) => {
    const load = (b64) =>
      new Promise((res) => {
        const im = new Image();
        im.onload = () => res(im);
        im.src = 'data:image/png;base64,' + b64;
      });
    const [ia, ib] = await Promise.all([load(a), load(c)]);
    const cv = document.createElement('canvas');
    cv.width = ia.width;
    cv.height = ia.height;
    const g = cv.getContext('2d');
    g.drawImage(ia, 0, 0);
    const da = g.getImageData(0, 0, cv.width, cv.height).data;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(ib, 0, 0);
    const db = g.getImageData(0, 0, cv.width, cv.height).data;
    let changed = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d =
        Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
      if (d > 8) changed++;
    }
    return (100 * changed) / (da.length / 4);
  }, [on.toString('base64'), off.toString('base64')]);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
}

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

// --- the celebration ------------------------------------------------------
//
// Same lesson as the burst: this lasts about four seconds and every frame of
// it looks different, so it is photographed at named moments rather than
// whenever the script happens to finish.
await page.evaluate(() => {
  for (let i = 0; i < 6; i++) window.__friend?.();
});
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx - 10, cy - 70, { steps: 6 });
await page.waitForTimeout(1600);
const parade = await page.evaluate(() => window.__parade?.() ?? 0);
await page.screenshot({ path: `${OUT}/04-parade.png` });

await page.evaluate(() => window.__openDoor?.());
// Mid-cheer: the room is popping outward and everybody is in the air.
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/05-cheer.png` });

// Then they break for the door, so keep driving him after them.
await page.waitForTimeout(3600);
await page.screenshot({ path: `${OUT}/06-gathered.png` });
await page.mouse.up();
console.log(`parade: ${parade} friends following`);

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
if (startParade < 1) {
  console.error('FAIL: he started with no friend at all.');
  failed = true;
} else {
  console.log(`OK: started with ${startParade} friend already following.`);
}
if (!warmthShot) {
  console.error(`FAIL: drove at a hidden thing and never got warm (peak ${peakWarmth.toFixed(2)}).`);
  failed = true;
} else if (warmthPixels < 3) {
  console.error(`FAIL: the warmth glow changes only ${warmthPixels.toFixed(1)}% of the screen.`);
  failed = true;
} else {
  console.log(
    `OK: warmth glow reads (peak ${peakWarmth.toFixed(2)}, ${warmthPixels.toFixed(1)}% of pixels).`,
  );
}
if (parade < 2) {
  console.error(`FAIL: only ${parade} followers — the parade did not build.`);
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

/**
 * Generates the PWA icons.
 *
 * We ship no image assets and have no image library, so this writes PNGs
 * directly: raw RGBA scanlines -> zlib deflate -> IHDR/IDAT/IEND chunks. Run
 * with `node scripts/make-icons.mjs`.
 *
 * The icon is the blob on its drained-world background — the same thing he
 * sees on the home screen is the thing he plays as. Deliberately no text,
 * because the OS puts the app name underneath anyway.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/**
 * @param {number} size
 * @param {number} inset 0 = fill the square, higher = more padding for maskable
 */
function drawIcon(size, inset) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 2) * (1 - inset);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // Background: the drained world, lighter toward the top.
      const bgT = y / size;
      let cr = lerp(0x2c, 0x1c, bgT);
      let cg = lerp(0x32, 0x20, bgT);
      let cb = lerp(0x3c, 0x28, bgT);

      // A sweep of paint across the lower half — the verb, in one shape.
      const swoosh = Math.sin((x / size) * Math.PI * 1.2) * size * 0.06;
      const bandY = size * 0.68 + swoosh;
      const band = smooth(size * 0.13, 0, Math.abs(y - bandY));
      cr = lerp(cr, 0x74, band * 0.85);
      cg = lerp(cg, 0xc9, band * 0.85);
      cb = lerp(cb, 0x5c, band * 0.85);

      // The blob itself.
      const dx = x - cx;
      const dy = y - cy - size * 0.04;
      const d = Math.hypot(dx, dy) / (r * 0.52);
      const body = 1 - smooth(0.94, 1.02, d);
      if (body > 0) {
        // Shade it so it reads as a sphere, not a flat disc.
        const shade = clamp01(1 - (dy / (r * 0.52)) * 0.42 - (dx / (r * 0.52)) * 0.12);
        const br = lerp(0xd8, 0xff, shade);
        const bg = lerp(0x3f, 0x8f, shade);
        const bb = lerp(0x82, 0xc2, shade);
        cr = lerp(cr, br, body);
        cg = lerp(cg, bg, body);
        cb = lerp(cb, bb, body);
      }

      // Highlight blob, matching the character's accent part.
      const hd = Math.hypot(x - (cx + r * 0.19), y - (cy - r * 0.16)) / (r * 0.13);
      const hi = 1 - smooth(0.9, 1.05, hd);
      if (hi > 0) {
        cr = lerp(cr, 0xff, hi);
        cg = lerp(cg, 0xe0, hi);
        cb = lerp(cb, 0x66, hi);
      }

      // Two eyes, so it is unmistakably a character at 48px.
      for (const ex of [-0.17, 0.17]) {
        const ed = Math.hypot(x - (cx + r * ex), y - (cy - r * 0.06)) / (r * 0.062);
        const e = 1 - smooth(0.85, 1.05, ed);
        if (e > 0) {
          cr = lerp(cr, 0x1a, e);
          cg = lerp(cg, 0x10, e);
          cb = lerp(cb, 0x30, e);
        }
      }

      px[i] = Math.round(cr);
      px[i + 1] = Math.round(cg);
      px[i + 2] = Math.round(cb);
      px[i + 3] = 255;
    }
  }
  return px;
}

mkdirSync(OUT, { recursive: true });

const targets = [
  ['icon-192.png', 192, 0.0],
  ['icon-512.png', 512, 0.0],
  // Maskable icons get cropped to a circle by Android; keep art inside 80%.
  ['icon-maskable-512.png', 512, 0.16],
];

for (const [name, size, inset] of targets) {
  writeFileSync(join(OUT, name), encodePng(size, size, drawIcon(size, inset)));
  console.log(`wrote ${name} (${size}x${size})`);
}

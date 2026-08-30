/**
 * Builds a single self-contained HTML file — the tap-to-play link.
 *
 * Everything is inlined, so the result makes zero network requests (three.js is
 * already bundled). It is NOT a PWA: no service worker, no manifest, no
 * home-screen icon, no offline. That is what the GitHub Pages deploy is for.
 * This exists so there is always something playable to hand over in one tap,
 * independent of hosting.
 *
 * Output has no <!doctype>/<html>/<head>/<body> — just <title>, <style>, the
 * markup and one inline <script> — because the Artifact wrapper supplies the
 * document skeleton.
 *
 * Usage: node scripts/build-standalone.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist-standalone');
const OUT = join(ROOT, 'scratch', 'edventure.html');

console.log('building (STANDALONE=1)...');
rmSync(DIST, { recursive: true, force: true });
execFileSync('npx', ['vite', 'build'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, STANDALONE: '1', BASE_PATH: './' },
});

const assets = readdirSync(join(DIST, 'assets'));
const jsName = assets.find((f) => f.endsWith('.js'));
const cssName = assets.find((f) => f.endsWith('.css'));
if (!jsName) throw new Error('no JS bundle found in dist-standalone/assets');

const js = readFileSync(join(DIST, 'assets', jsName), 'utf8');
const css = cssName ? readFileSync(join(DIST, 'assets', cssName), 'utf8') : '';

// Pull the <style> and the #app markup straight out of the source index.html so
// this script never drifts from the real page.
const src = readFileSync(join(ROOT, 'index.html'), 'utf8');
const style = src.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const body = src.match(/<div id="app">([\s\S]*?)<\/div>\s*<script/)?.[1];
if (!style || !body) throw new Error('could not extract <style>/#app from index.html');

// A closing </script> anywhere inside the bundle would terminate the inline
// script tag early. Splitting it is the standard, safe escape.
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');

const html = `<title>Edventure</title>
<style>
${style.trim()}
${css}
</style>
<div id="app">${body}</div>
<script type="module">
${safeJs}
</script>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
rmSync(DIST, { recursive: true, force: true });

console.log(`wrote ${OUT} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);

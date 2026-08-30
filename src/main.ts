import { SRGBColorSpace, WebGLRenderer } from 'three';
import { PlayScene } from './game/PlayScene';
import { Joystick } from './ui/Joystick';
import { DebugOverlay } from './ui/DebugOverlay';
import {
  QualityGovernor,
  TIERS,
  guessTier,
  loadSettledTier,
  pixelRatioFor,
  type Tier,
} from './core/Quality';

const app = document.getElementById('app') as HTMLElement;
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const firstTouch = document.getElementById('firsttouch') as HTMLElement;

// --- renderer -------------------------------------------------------------
const renderer = new WebGLRenderer({
  canvas,
  antialias: false, // decided once at context creation; MSAA cannot be toggled later
  alpha: false,
  powerPreference: 'high-performance',
  // Never preserveDrawingBuffer — it taxes every frame of the whole game.
  preserveDrawingBuffer: false,
  stencil: false,
});
renderer.outputColorSpace = SRGBColorSpace;
renderer.setClearColor(0x20242c, 1);

// --- quality --------------------------------------------------------------
const gl = renderer.getContext();
// Never start high: a first-load stutter is the worst first impression, and
// stepping up later is invisible while stepping down is not.
const settled = loadSettledTier();
const guessed: Tier = settled ?? guessTier(gl);
const startTier: Tier = guessed === 'high' && !settled ? 'mid' : guessed;

const governor = new QualityGovernor(startTier);
let pixelRatio = 1;

function applySize(): void {
  const w = app.clientWidth || innerWidth;
  const h = app.clientHeight || innerHeight;
  pixelRatio = pixelRatioFor(governor.settings, w, h);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  scene.resize(w, h);
}

// --- scene ----------------------------------------------------------------
const seed = Math.floor(Math.random() * 0xffffffff);
const scene = new PlayScene(seed, { ...TIERS[startTier] }, 1);

governor.onChange = (_t, s) => {
  scene.applySettings(s);
  applySize();
};

// --- input ----------------------------------------------------------------
const stick = new Joystick();
stick.attach(app);
stick.onFirstTouch = () => {
  firstTouch.classList.add('gone');
  void requestWakeLock();
  // Mobile browsers only start audio from a real user gesture, so this is the
  // one moment it can happen.
  scene.audio.unlock();
  scene.audio.startPad();
};

// --- debug ----------------------------------------------------------------
const debug = new DebugOverlay();
debug.mount(app, scene.mask);

// --- wake lock ------------------------------------------------------------
type WakeLockSentinel = { release(): Promise<void> };
let wakeLock: WakeLockSentinel | null = null;

async function requestWakeLock(): Promise<void> {
  if (wakeLock) return;
  try {
    const n = navigator as Navigator & {
      wakeLock?: { request(t: 'screen'): Promise<WakeLockSentinel> };
    };
    if (n.wakeLock) wakeLock = await n.wakeLock.request('screen');
  } catch {
    /* denied or unsupported; the screen may dim, which is survivable */
  }
}

function releaseWakeLock(): void {
  // Android drops the lock on backgrounding anyway; clearing the handle is what
  // lets us re-acquire on resume instead of thinking we still hold one.
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// --- context loss ---------------------------------------------------------
// Far more common on Android than iOS. Without this the app becomes a black
// rectangle that only a force-quit fixes, and a 5-year-old cannot force-quit.
let contextLost = false;
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  contextLost = true;
});
canvas.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  applySize();
});

// --- lifecycle ------------------------------------------------------------
let hidden = false;
document.addEventListener('visibilitychange', () => {
  hidden = document.hidden;
  if (hidden) {
    releaseWakeLock();
    scene.audio.suspend();
  } else {
    scene.audio.resume();
    last = performance.now();
    void requestWakeLock();
  }
});

window.addEventListener('resize', applySize);
applySize();

// Compile before the first render so the driver's 100-400ms shader compile
// does not land on frame one.
renderer.compile(scene.scene, scene.follow.camera);

// --- loop -----------------------------------------------------------------
const FIXED = 1 / 60;
const MAX_SUBSTEPS = 5; // prevents a spiral of death after a tab-switch stall
let accumulator = 0;
let last = performance.now();

function frame(now: number): void {
  requestAnimationFrame(frame);
  if (hidden || contextLost) {
    last = now;
    return;
  }

  const dtMs = now - last;
  last = now;
  const dt = Math.min(dtMs / 1000, 0.25);

  governor.frame(dtMs);

  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED && steps < MAX_SUBSTEPS) {
    scene.fixedUpdate(stick.value, FIXED);
    accumulator -= FIXED;
    steps++;
  }
  if (steps === MAX_SUBSTEPS) accumulator = 0;

  scene.render(renderer, dt);
  debug.update(dtMs, renderer, scene.mask, governor.tier, pixelRatio);
}

requestAnimationFrame(frame);

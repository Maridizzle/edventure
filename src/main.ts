import { SRGBColorSpace, Vector2, WebGLRenderer } from 'three';
import { PlayScene } from './game/PlayScene';
import { Transition } from './game/Transition';
import { AudioEngine } from './core/Audio/AudioEngine';
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
//
// The audio engine lives HERE, not in the scene: the ambient pad has to survive
// a room change, and the first-touch unlock must not be re-run every time he
// walks through a door.
const audio = new AudioEngine();
const transition = new Transition(app);

let scene = makeScene(Math.floor(Math.random() * 0xffffffff));

function makeScene(seed: number): PlayScene {
  const s = new PlayScene(seed, { ...TIERS[governor.tier] }, 1, audio);
  s.onExit = () => void goThroughDoor();
  transition.setColor(s.def.sky.fogColor);
  return s;
}

/**
 * Walk through the door into a fresh room.
 *
 * Everything expensive -- tearing down the old scene, building the new one, and
 * compiling its shaders -- happens behind the fade, so the hitch is never seen.
 */
async function goThroughDoor(): Promise<void> {
  if (transition.running) return;
  await transition.run(() => {
    const old = scene;
    scene = makeScene(Math.floor(Math.random() * 0xffffffff));
    old.dispose();
    applySize();
    renderer.compile(scene.scene, scene.follow.camera);
    debug.remount(app, scene.mask);
  });
}

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
  audio.unlock();
  audio.startPad();
};

// --- debug ----------------------------------------------------------------
const debug = new DebugOverlay();
debug.mount(app, scene.mask);
if (DebugOverlay.enabled) {
  // Lets the smoke test photograph a firework mid-flight instead of trying to
  // catch one by luck -- which is exactly how these shipped invisible once.
  const w = window as unknown as {
    __burst?: () => void;
    __openDoor?: () => void;
    __exit?: () => Promise<void>;
    __mem?: () => { geometries: number; textures: number };
  };
  w.__burst = () => scene.testBurst();
  w.__openDoor = () => scene.forceOpenDoor();
  w.__exit = () => goThroughDoor();
  // The leak check: this teardown path had never run before rooms could be
  // left, so it gets asserted rather than eyeballed.
  w.__mem = () => ({
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
  });
}

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
    audio.suspend();
  } else {
    audio.resume();
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
/** Input is frozen mid-transition, so the dying room cannot be driven. */
const ZERO_INPUT = new Vector2();

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
    scene.fixedUpdate(transition.running ? ZERO_INPUT : stick.value, FIXED);
    accumulator -= FIXED;
    steps++;
  }
  if (steps === MAX_SUBSTEPS) accumulator = 0;

  scene.render(renderer, dt);
  debug.update(dtMs, renderer, scene.mask, governor.tier, pixelRatio);
}

requestAnimationFrame(frame);

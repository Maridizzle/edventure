import { SRGBColorSpace, Vector2, WebGLRenderer } from 'three';
import { PlayScene } from './game/PlayScene';
import { Transition } from './game/Transition';
import { AudioEngine } from './core/Audio/AudioEngine';
import { VoiceStore } from './core/Audio/Voice';
import { Roster } from './game/Roster';
import { starterFriend } from './content/collectibles/friend';
import { Joystick } from './ui/Joystick';
import { GrownUpPanel } from './ui/GrownUpPanel';
import { Hud } from './ui/Hud';
import { COLLECTIBLE_BY_ID } from './content/collectibles';
import { flushSave, loadSave, queueSave, requestPersistence } from './core/Save';
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
// Three things live HERE rather than in the scene, all for the same reason: a
// scene is thrown away every time he walks through a door.
//
//  - the audio engine, so the ambient pad survives and the first-touch unlock
//    is never re-run;
//  - the ROSTER, so his friends come with him and the parade keeps growing --
//    that is the whole long game, and a scene-owned list would reset every
//    couple of minutes;
//  - the recorded cheer, which is read from the device once.
const audio = new AudioEngine();
const roster = new Roster();
// He starts with a friend. A five-year-old cannot be TOLD that things follow
// him once he finds them -- he has to see it happen, and the cheapest way to
// show him is for it to already be true on frame one. Everything he finds
// afterwards adds to something he already understands.
roster.add(starterFriend);

/** Every change to the collection is written to the device, coalesced. */
function saveRoster(): void {
  queueSave({ found: roster.ids() });
}

/**
 * Bring back what he found last time.
 *
 * Restoring goes through the SAME two calls a real find makes -- add to the
 * roster, then give it a body -- rather than a second code path that could
 * drift from the first. Storage is async and the first room is built
 * synchronously, so his friends arrive a moment after the room does, which
 * reads as them catching up with him rather than as a glitch.
 */
async function restoreRoster(): Promise<void> {
  const save = await loadSave();
  if (!save) return;
  const defs = save.found
    .map((id) => COLLECTIBLE_BY_ID.get(id))
    .filter((d): d is NonNullable<typeof d> => d !== undefined);
  const p = scene.playerPos;
  for (const def of roster.restore(defs)) {
    if (def.onFind === 'follow') scene.followers.add(def, p.x, p.z + 2);
  }
}
const voice = new VoiceStore();
void voice.load();
const transition = new Transition(app);

/**
 * `?seed=N` pins the first room. Rooms are otherwise random, which makes a
 * screenshot of anything in particular a matter of luck -- and the checks in
 * `scripts/` need to photograph specific moments, not whatever turned up.
 */
const seedParam = new URLSearchParams(location.search).get('seed');
const firstSeed = seedParam !== null ? Number(seedParam) >>> 0 : randomSeed();

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

let scene = makeScene(firstSeed);

function makeScene(seed: number): PlayScene {
  const s = new PlayScene(seed, { ...TIERS[governor.tier] }, 1, audio, undefined, roster, voice);
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
    scene = makeScene(randomSeed());
    old.dispose();
    applySize();
    renderer.compile(scene.scene, scene.follow.camera);
    hud.setScene(scene);
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
  // Decode the recorded cheer now, so the first finished room does not have to
  // wait on it.
  void voice.prime(audio);
  // Ask here rather than at load: some browsers weigh user engagement, and this
  // is the first moment there is any.
  void requestPersistence();
};

// The grown-up door: hold a screen corner for two seconds. Never surfaced to
// him, and never prompted during play.
const grownUp = new GrownUpPanel(app, voice, audio);

// The map and the collection row. App-level, like the audio and the roster:
// only the room it is pointed at changes.
const hud = new Hud();
hud.mount(app);
hud.setScene(scene);
void restoreRoster();

// --- debug ----------------------------------------------------------------
const debug = new DebugOverlay();
debug.mount(app, scene.mask);
if (DebugOverlay.enabled) {
  // Lets the smoke test photograph a firework mid-flight instead of trying to
  // catch one by luck -- which is exactly how these shipped invisible once.
  const w = window as unknown as {
    __burst?: () => void;
    __openDoor?: () => void;
    __friend?: () => void;
    __parade?: () => number;
    __warmth?: () => number;
    __hidden?: () => { dx: number; dz: number; d: number } | null;
    __warmGain?: (v: number) => void;
    __collection?: () => number;
    __exit?: () => Promise<void>;
    __mem?: () => { geometries: number; textures: number };
  };
  w.__burst = () => scene.testBurst();
  w.__openDoor = () => scene.forceOpenDoor();
  w.__friend = () => scene.debugAddFriend();
  // Proves the parade actually rebuilt in the new room -- without this the
  // leak check would pass trivially on a parade that silently vanished.
  w.__parade = () => scene.followers.count;
  w.__warmth = () => scene.debugWarmth();
  // Lets a check DRIVE toward a hidden thing rather than hoping to stumble on
  // one, which is the only way to photograph the warmth glow reliably.
  w.__hidden = () => scene.debugNearestHidden();
  w.__warmGain = (v) => scene.debugWarmGain(v);
  // The roster, not the visible parade -- the parade is capped at eight and the
  // collection is not, and it is the collection that gets saved.
  w.__collection = () => roster.size;
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
    // Backgrounding may be the last thing that happens to this page, and the
    // save is debounced -- write it out now rather than losing the last find.
    flushSave();
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
/** Input is frozen mid-transition and behind the grown-up panel. */
const ZERO_INPUT = new Vector2();

/** Last collection size written to the device. */
let savedCount = 0;

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
    const frozen = transition.running || grownUp.open;
    scene.fixedUpdate(frozen ? ZERO_INPUT : stick.value, FIXED);
    accumulator -= FIXED;
    steps++;
  }
  if (steps === MAX_SUBSTEPS) accumulator = 0;

  scene.render(renderer, dt);
  hud.update(dtMs);
  debug.update(dtMs, renderer, scene.mask, governor.tier, pixelRatio);

  // Polled rather than pushed: a callback would have to be re-wired onto every
  // new PlayScene and is one edit away from being forgotten in a room where a
  // find would then go unsaved. An integer compare cannot be forgotten.
  if (roster.size !== savedCount) {
    savedCount = roster.size;
    saveRoster();
  }
}

requestAnimationFrame(frame);

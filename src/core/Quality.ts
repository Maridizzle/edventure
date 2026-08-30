/**
 * Quality tiers + the adaptive governor.
 *
 * The floor is a mid-range Android (Adreno 610-619 / Mali-G57 class). Two
 * rules shape everything here:
 *
 *  1. Never start high. A first-load stutter is the worst first impression,
 *     and stepping *up* is invisible while stepping *down* is not.
 *  2. Static device signals are hints only. `deviceMemory` and
 *     WEBGL_debug_renderer_info are Chromium-only and are being progressively
 *     restricted for privacy, so the governor is the real mechanism.
 *
 * The governor also solves thermal throttling for free: as the phone heats up
 * it steps down instead of stuttering.
 */

export type Tier = 'low' | 'mid' | 'high';

const ORDER: Tier[] = ['low', 'mid', 'high'];

export interface TierSettings {
  pixelRatioCap: number;
  pixelBudget: number;
  terrainGrid: number;
  maskCells: number;
  maskUploadInterval: number;
  propInstances: number;
  detailInstances: number;
  particles: number;
  msaa: boolean;
  fogFar: number;
  /** Max subdivision level ShapeBuilder may use. */
  shapeDetail: number;
}

export const TIERS: Record<Tier, TierSettings> = {
  low: {
    pixelRatioCap: 1.25,
    pixelBudget: 700_000,
    terrainGrid: 96,
    maskCells: 128,
    maskUploadInterval: 3,
    propInstances: 450,
    detailInstances: 0,
    particles: 220,
    msaa: false,
    fogFar: 150,
    shapeDetail: 0,
  },
  mid: {
    pixelRatioCap: 1.75,
    pixelBudget: 1_200_000,
    terrainGrid: 128,
    maskCells: 192,
    maskUploadInterval: 2,
    propInstances: 800,
    detailInstances: 300,
    particles: 650,
    msaa: false,
    fogFar: 190,
    shapeDetail: 1,
  },
  high: {
    pixelRatioCap: 2.5,
    pixelBudget: 2_200_000,
    terrainGrid: 160,
    maskCells: 256,
    maskUploadInterval: 1,
    propInstances: 1400,
    detailInstances: 900,
    particles: 1400,
    msaa: true,
    fogFar: 220,
    shapeDetail: 2,
  },
};

/** Static signals, 0 ms, at boot. Hints only — the governor is the backstop. */
export function guessTier(gl: WebGL2RenderingContext | WebGLRenderingContext): Tier {
  let renderer = '';
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '');
  } catch {
    /* privacy-restricted; fall through to the heuristics below */
  }

  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = nav.deviceMemory ?? 4;
  const cpus = navigator.hardwareConcurrency ?? 4;
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

  if (/Apple GPU/i.test(renderer)) return 'high';
  if (/Adreno.*\b(7[2-9]\d|8\d\d)\b/i.test(renderer)) return 'high';
  if (/Mali-G(7[0-9]|[89]\d)|Immortalis/i.test(renderer)) return 'high';
  if (/Adreno.*\b(6[0-9]\d|71\d)\b/i.test(renderer)) return 'mid';
  if (/Mali-G(3[0-9]|5[0-9]|6[0-9])/i.test(renderer)) return 'mid';
  if (/Mali-4\d\d|Adreno.*\b[45]\d\d\b|PowerVR/i.test(renderer)) return 'low';

  if (mem <= 2 || cpus <= 4 || maxTex < 8192) return 'low';
  return 'mid';
}

const STORAGE_PREFIX = 'edv.tier.';

function deviceKey(): string {
  return (
    STORAGE_PREFIX +
    `${screen.width}x${screen.height}@${Math.round(devicePixelRatio * 100)}:${
      navigator.hardwareConcurrency ?? 0
    }`
  );
}

export function loadSettledTier(): Tier | null {
  try {
    const v = localStorage.getItem(deviceKey());
    return v === 'low' || v === 'mid' || v === 'high' ? v : null;
  } catch {
    return null;
  }
}

function saveSettledTier(t: Tier): void {
  try {
    localStorage.setItem(deviceKey(), t);
  } catch {
    /* private mode; not worth caring about */
  }
}

const WINDOW = 90;
const STEP_DOWN_MS = 20.0;
const STEP_UP_MS = 11.0;
const COOLDOWN_WINDOWS = 7;
const GOOD_WINDOWS_TO_PROMOTE = 6;

export class QualityGovernor {
  tier: Tier;
  settings: TierSettings;
  /** Fires when a live-adjustable knob should be re-applied. */
  onChange: ((t: Tier, s: TierSettings) => void) | null = null;

  private times = new Float32Array(WINDOW);
  private n = 0;
  private cooldown = 0;
  private goodWindows = 0;
  private scratch = new Float32Array(WINDOW);

  constructor(start: Tier) {
    this.tier = start;
    this.settings = TIERS[start];
  }

  frame(dtMs: number): void {
    this.times[this.n % WINDOW] = dtMs;
    this.n++;
    if (this.n % WINDOW !== 0) return;

    if (this.cooldown > 0) {
      this.cooldown--;
      return;
    }

    // Median, not mean — one GC pause must not demote the whole device.
    this.scratch.set(this.times);
    this.scratch.sort();
    const med = this.scratch[WINDOW >> 1]!;

    if (med > STEP_DOWN_MS && this.tier !== 'low') {
      this.step(-1);
      this.goodWindows = 0;
    } else if (med < STEP_UP_MS && this.tier !== 'high') {
      if (++this.goodWindows >= GOOD_WINDOWS_TO_PROMOTE) {
        this.step(1);
        this.goodWindows = 0;
      }
    } else {
      this.goodWindows = 0;
    }
  }

  private step(dir: number): void {
    const i = ORDER.indexOf(this.tier) + dir;
    if (i < 0 || i >= ORDER.length) return;
    this.tier = ORDER[i]!;
    this.settings = TIERS[this.tier];
    this.cooldown = COOLDOWN_WINDOWS;
    saveSettledTier(this.tier);
    this.onChange?.(this.tier, this.settings);
  }
}

/**
 * The single biggest performance lever in the project, and it is one line.
 * A 1080x2400 phone at DPR 3 is a 2.59 MP drawing buffer; capped at 1.75 it
 * is 1.15 MP — a 2.25x cut in every fragment shader invocation, every frame.
 */
export function pixelRatioFor(s: TierSettings, w: number, h: number): number {
  const byBudget = Math.sqrt(s.pixelBudget / Math.max(1, w * h));
  return Math.max(1, Math.min(devicePixelRatio || 1, s.pixelRatioCap, byBudget));
}

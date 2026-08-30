import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  SRGBColorSpace,
} from 'three';

/**
 * Fireworks.
 *
 * One pooled `Points` object for every particle in the game: a single draw
 * call, fixed-size typed arrays, no allocation in the frame loop.
 *
 * THE BUG THAT MADE THESE INVISIBLE: point size was computed as
 * `aSize * viewportHeight * 0.35 / distance`. The correct perspective scale is
 * `viewportHeight / (2 * tan(fovY/2))`, which at 50 degrees is about
 * `viewportHeight * 1.07` -- three times larger. Motes were firing correctly
 * the whole time and drawing as 2-pixel specks. Keep `setPixelScale` honest.
 *
 * What actually costs money here is overdraw, not particle count: additive
 * blending is pure fill rate on a tile GPU. That is what `uMaxPixels` governs,
 * and it only starts mattering now that the sizes are right.
 */

const vert = /* glsl */ `
precision mediump float;

attribute float aSize;
attribute float aLife;   // 1 at birth -> 0 at death
attribute vec3  aColor;

varying vec3  vCol;
varying float vLife;

uniform float uPixelScale;
uniform float uMaxPixels;

void main() {
  vCol = aColor;
  vLife = aLife;
  vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;

  // Sparks flare bright and small, then swell slightly as they fade.
  float grow = mix(1.35, 0.75, vLife);
  float s = aSize * grow * uPixelScale / max(0.001, -mv.z);
  gl_PointSize = clamp(s, 1.0, uMaxPixels) * smoothstep(0.0, 0.12, aLife);
}
`;

const frag = /* glsl */ `
precision mediump float;

varying vec3  vCol;
varying float vLife;

void main() {
  // Soft round spark with a hot core, procedurally -- no texture to ship.
  vec2 d = gl_PointCoord - vec2(0.5);
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float halo = smoothstep(0.25, 0.0, r2);
  float core = smoothstep(0.045, 0.0, r2);
  vec3 col = mix(vCol, vec3(1.0), core * 0.7);
  float a = halo * vLife;
  gl_FragColor = vec4(col * a, a);
}
`;

const GRAVITY = -8.5;
const DRAG = 0.955;
/** Life value at which a crackle particle throws its own secondary burst. */
const CRACKLE_AT = 0.55;

export class Motes {
  readonly points: Points;
  readonly capacity: number;

  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private decay: Float32Array;
  private size: Float32Array;
  private col: Float32Array;
  /** 1 = this spark will burst again on its way down. */
  private crackle: Uint8Array;
  private cursor = 0;

  private posAttr: BufferAttribute;
  private lifeAttr: BufferAttribute;
  private sizeAttr: BufferAttribute;
  private colAttr: BufferAttribute;
  private material: ShaderMaterial;
  private scratch = new Color();

  constructor(capacity: number) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.decay = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.col = new Float32Array(capacity * 3);
    this.crackle = new Uint8Array(capacity);

    for (let i = 0; i < capacity; i++) this.pos[i * 3 + 1] = -1000;

    const g = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.pos, 3);
    this.lifeAttr = new BufferAttribute(this.life, 1);
    this.sizeAttr = new BufferAttribute(this.size, 1);
    this.colAttr = new BufferAttribute(this.col, 3);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aLife', this.lifeAttr);
    g.setAttribute('aSize', this.sizeAttr);
    g.setAttribute('aColor', this.colAttr);
    g.setDrawRange(0, capacity);

    this.material = new ShaderMaterial({
      uniforms: {
        uPixelScale: { value: 900 },
        uMaxPixels: { value: 44 },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
  }

  /**
   * The one formula that matters: a world-space radius r at distance d covers
   * `r * H / (2 * d * tan(fovY/2))` pixels.
   */
  setPixelScale(viewportHeightPx: number, fovYDeg: number): void {
    const halfFov = (fovYDeg * Math.PI) / 360;
    this.material.uniforms.uPixelScale!.value = viewportHeightPx / (2 * Math.tan(halfFov));
    this.material.uniforms.uMaxPixels!.value = Math.max(24, viewportHeightPx * 0.09);
  }

  private spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    decay: number,
    r: number,
    g: number,
    b: number,
    crackle: boolean,
  ): void {
    const s = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const p = s * 3;
    this.pos[p] = x;
    this.pos[p + 1] = y;
    this.pos[p + 2] = z;
    this.vel[p] = vx;
    this.vel[p + 1] = vy;
    this.vel[p + 2] = vz;
    this.life[s] = 1;
    this.decay[s] = decay;
    this.size[s] = size;
    this.col[p] = r;
    this.col[p + 1] = g;
    this.col[p + 2] = b;
    this.crackle[s] = crackle ? 1 : 0;
  }

  /**
   * A firework: a fast outward shell in the object's colour, a few white-hot
   * sparks, and a handful of crackle sparks that burst again on the way down.
   */
  burst(
    x: number,
    y: number,
    z: number,
    count: number,
    hex: number,
    accentHex?: number,
    speed = 6.5,
  ): void {
    this.scratch.setHex(hex, SRGBColorSpace);
    const cr = this.scratch.r;
    const cg = this.scratch.g;
    const cb = this.scratch.b;

    let ar = 1;
    let ag = 1;
    let ab = 1;
    if (accentHex !== undefined) {
      this.scratch.setHex(accentHex, SRGBColorSpace);
      ar = this.scratch.r;
      ag = this.scratch.g;
      ab = this.scratch.b;
    }

    for (let i = 0; i < count; i++) {
      // Spherical-ish shell, biased upward so it arcs rather than puffs.
      const a = Math.random() * Math.PI * 2;
      const up = -0.15 + Math.random() * 1.15;
      const r = Math.sqrt(Math.max(0, 1 - up * up));
      const v = speed * (0.55 + Math.random() * 0.9);

      const accent = i % 4 === 0;
      const hot = i % 7 === 0;
      this.spawn(
        x,
        y,
        z,
        Math.cos(a) * r * v,
        up * v + 1.5,
        Math.sin(a) * r * v,
        (hot ? 0.6 : 0.34) + Math.random() * 0.28,
        0.75 + Math.random() * 0.6,
        hot ? 1 : accent ? ar : cr,
        hot ? 1 : accent ? ag : cg,
        hot ? 1 : accent ? ab : cb,
        i % 6 === 0,
      );
    }
  }

  /** The secondary pop, thrown by a crackle spark partway through its fall. */
  private crackleBurst(px: number, py: number, pz: number, r: number, g: number, b: number): void {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      const rad = Math.sqrt(Math.max(0, 1 - up * up));
      const v = 2.6 * (0.5 + Math.random());
      this.spawn(
        px,
        py,
        pz,
        Math.cos(a) * rad * v,
        up * v,
        Math.sin(a) * rad * v,
        0.26 + Math.random() * 0.16,
        1.6 + Math.random(),
        r,
        g,
        b,
        false,
      );
    }
  }

  /** A single drifting sparkle, for painted things idling. */
  twinkle(x: number, y: number, z: number, hex: number): void {
    this.scratch.setHex(hex, SRGBColorSpace);
    this.spawn(
      x,
      y,
      z,
      (Math.random() - 0.5) * 0.5,
      0.7 + Math.random() * 0.5,
      (Math.random() - 0.5) * 0.5,
      0.24 + Math.random() * 0.14,
      0.75,
      this.scratch.r,
      this.scratch.g,
      this.scratch.b,
      false,
    );
  }

  update(dt: number): void {
    const drag = Math.pow(DRAG, dt * 60);
    let anyAlive = false;

    for (let i = 0; i < this.capacity; i++) {
      const l = this.life[i]!;
      if (l <= 0) continue;
      anyAlive = true;

      const nl = l - this.decay[i]! * dt;
      this.life[i] = nl > 0 ? nl : 0;

      const b = i * 3;
      this.vel[b + 1]! += GRAVITY * dt;
      this.vel[b] = this.vel[b]! * drag;
      this.vel[b + 1] = this.vel[b + 1]! * drag;
      this.vel[b + 2] = this.vel[b + 2]! * drag;
      this.pos[b] = this.pos[b]! + this.vel[b]! * dt;
      this.pos[b + 1] = this.pos[b + 1]! + this.vel[b + 1]! * dt;
      this.pos[b + 2] = this.pos[b + 2]! + this.vel[b + 2]! * dt;

      if (this.crackle[i] === 1 && this.life[i]! < CRACKLE_AT) {
        this.crackle[i] = 0;
        this.crackleBurst(
          this.pos[b]!,
          this.pos[b + 1]!,
          this.pos[b + 2]!,
          this.col[b]!,
          this.col[b + 1]!,
          this.col[b + 2]!,
        );
      }

      if (this.life[i] === 0) this.pos[b + 1] = -1000;
    }

    if (anyAlive) {
      this.posAttr.needsUpdate = true;
      this.lifeAttr.needsUpdate = true;
      this.sizeAttr.needsUpdate = true;
      this.colAttr.needsUpdate = true;
    }
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }
}

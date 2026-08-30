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
 * The burst of colour when something is painted.
 *
 * One pooled `Points` object for every particle in the game: a single draw
 * call, fixed-size typed arrays, and no allocation in the frame loop.
 *
 * The thing that actually costs money here is not the particle COUNT but the
 * overdraw — additive blending on a tile GPU is fillrate, so point size is
 * clamped in pixels rather than left to scale with distance.
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

  // Perspective size, then clamped so a mote near the camera cannot smear
  // across the screen and eat the fill rate.
  float s = aSize * uPixelScale / max(0.001, -mv.z);
  gl_PointSize = min(s, uMaxPixels) * smoothstep(0.0, 0.25, aLife);
}
`;

const frag = /* glsl */ `
precision mediump float;

varying vec3  vCol;
varying float vLife;

void main() {
  // Soft round dot, procedurally — no texture to ship or upload.
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = dot(d, d);
  if (r > 0.25) discard;
  float a = smoothstep(0.25, 0.0, r) * vLife;
  gl_FragColor = vec4(vCol * a, a);
}
`;

const GRAVITY = -7.0;
const DRAG = 0.94;

export class Motes {
  readonly points: Points;
  readonly capacity: number;

  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private decay: Float32Array;
  private size: Float32Array;
  private col: Float32Array;
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

    // Park every mote far below the floor until it is used.
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
        uPixelScale: { value: 300 },
        uMaxPixels: { value: 26 },
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

  setPixelScale(heightPx: number): void {
    this.material.uniforms.uPixelScale!.value = heightPx * 0.35;
  }

  /** A shower of motes flying outward and up from a point. */
  burst(x: number, y: number, z: number, count: number, hex: number, speed = 4.5): void {
    this.scratch.setHex(hex, SRGBColorSpace);
    for (let i = 0; i < count; i++) {
      const s = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;

      // Cheap uniform-ish hemisphere.
      const a = Math.random() * Math.PI * 2;
      const up = 0.35 + Math.random() * 0.85;
      const r = Math.sqrt(Math.max(0, 1 - up * up));
      const v = speed * (0.55 + Math.random() * 0.7);

      this.pos[s * 3] = x;
      this.pos[s * 3 + 1] = y;
      this.pos[s * 3 + 2] = z;
      this.vel[s * 3] = Math.cos(a) * r * v;
      this.vel[s * 3 + 1] = up * v;
      this.vel[s * 3 + 2] = Math.sin(a) * r * v;
      this.life[s] = 1;
      this.decay[s] = 0.9 + Math.random() * 0.9;
      this.size[s] = 0.16 + Math.random() * 0.22;
      this.col[s * 3] = this.scratch.r;
      this.col[s * 3 + 1] = this.scratch.g;
      this.col[s * 3 + 2] = this.scratch.b;
    }
  }

  /** A single drifting sparkle, for painted things idling. */
  twinkle(x: number, y: number, z: number, hex: number): void {
    this.scratch.setHex(hex, SRGBColorSpace);
    const s = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.pos[s * 3] = x;
    this.pos[s * 3 + 1] = y;
    this.pos[s * 3 + 2] = z;
    this.vel[s * 3] = (Math.random() - 0.5) * 0.4;
    this.vel[s * 3 + 1] = 0.5 + Math.random() * 0.5;
    this.vel[s * 3 + 2] = (Math.random() - 0.5) * 0.4;
    this.life[s] = 1;
    this.decay[s] = 0.7;
    this.size[s] = 0.12 + Math.random() * 0.1;
    this.col[s * 3] = this.scratch.r;
    this.col[s * 3 + 1] = this.scratch.g;
    this.col[s * 3 + 2] = this.scratch.b;
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

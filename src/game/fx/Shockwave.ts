import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  ShaderMaterial,
  SRGBColorSpace,
} from 'three';

/**
 * The expanding ring under a firework.
 *
 * A pool of flat rings in one InstancedMesh, so any number of simultaneous
 * bursts is still one draw call. Each is a ring rather than a disc, so it
 * reads as a shockwave spreading outward rather than a blob under the object.
 */

const RINGS = 12;

const vert = /* glsl */ `
precision mediump float;

attribute float aAge;      // seconds since birth; <0 = dead
attribute vec3  aColor;

varying float vFade;
varying vec3  vCol;

uniform float uLifetime;

void main() {
  float t = aAge < 0.0 ? -1.0 : aAge / uLifetime;
  vFade = t < 0.0 || t > 1.0 ? 0.0 : 1.0 - t;
  vCol = aColor;

  // Expand fast then ease out, the way a real shockwave decelerates.
  float grow = t < 0.0 ? 0.0 : 1.0 - pow(1.0 - clamp(t, 0.0, 1.0), 2.5);
  vec3 p = position * (0.4 + grow * 5.2);

  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const frag = /* glsl */ `
precision mediump float;
varying float vFade;
varying vec3  vCol;

void main() {
  if (vFade <= 0.001) discard;
  gl_FragColor = vec4(vCol * vFade, vFade);
}
`;

const LIFETIME = 0.45;

/** A flat annulus on the XZ plane. */
function ringGeometry(inner: number, outer: number, segs: number): BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    pos.push(c0 * inner, 0, s0 * inner, c0 * outer, 0, s0 * outer, c1 * outer, 0, s1 * outer);
    pos.push(c0 * inner, 0, s0 * inner, c1 * outer, 0, s1 * outer, c1 * inner, 0, s1 * inner);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  return g;
}

export class Shockwave {
  readonly mesh: InstancedMesh;
  private age: InstancedBufferAttribute;
  private color: InstancedBufferAttribute;
  private material: ShaderMaterial;
  private cursor = 0;
  private m4 = new Matrix4();
  private scratch = new Color();

  constructor() {
    const geo = ringGeometry(0.72, 1.0, 24);
    this.age = new InstancedBufferAttribute(new Float32Array(RINGS), 1);
    this.color = new InstancedBufferAttribute(new Float32Array(RINGS * 3), 3);
    this.age.array.fill(-1);
    geo.setAttribute('aAge', this.age);
    geo.setAttribute('aColor', this.color);

    this.material = new ShaderMaterial({
      uniforms: { uLifetime: { value: LIFETIME } },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.mesh = new InstancedMesh(geo, this.material, RINGS);
    this.mesh.frustumCulled = false;
    // Park every ring until used.
    for (let i = 0; i < RINGS; i++) {
      this.m4.makeTranslation(0, -1000, 0);
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  fire(x: number, y: number, z: number, hex: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % RINGS;
    this.m4.makeTranslation(x, y, z);
    this.mesh.setMatrixAt(i, this.m4);
    this.mesh.instanceMatrix.needsUpdate = true;

    this.scratch.setHex(hex, SRGBColorSpace);
    this.color.array[i * 3] = this.scratch.r;
    this.color.array[i * 3 + 1] = this.scratch.g;
    this.color.array[i * 3 + 2] = this.scratch.b;
    this.color.needsUpdate = true;

    this.age.array[i] = 0;
    this.age.needsUpdate = true;
  }

  update(dt: number): void {
    let dirty = false;
    for (let i = 0; i < RINGS; i++) {
      const a = this.age.array[i]!;
      if (a < 0) continue;
      const na = a + dt;
      this.age.array[i] = na > LIFETIME ? -1 : na;
      dirty = true;
    }
    if (dirty) this.age.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
    this.mesh.dispose();
  }
}

import { Color, ShaderMaterial, SRGBColorSpace, Vector2, Vector3, type DataTexture } from 'three';
import { fogPars, maskPars } from '../paint/fog.glsl';

/**
 * The material every prop and fixture renders with.
 *
 * Paint state is per INSTANCE, held in two InstancedBufferAttributes and
 * animated entirely in the vertex shader. Painting an object writes four floats
 * and does zero CPU matrix work — `instanceMatrix` is written once at build
 * time and never touched — so hundreds of props can all be mid-animation at no
 * per-frame cost.
 */

const vert = /* glsl */ `
precision mediump float;

attribute vec3 color;
attribute float aPaintTime;   // -1 = never painted
attribute vec3 aTint;

varying vec3 vCol;
varying vec3 vNrm;
varying vec3 vWorld;
varying float vPainted;

uniform float uTime;

void main() {
  float age = aPaintTime < 0.0 ? -1.0 : uTime - aPaintTime;
  vPainted = aPaintTime < 0.0 ? 0.0 : clamp(age / 0.30, 0.0, 1.0);
  vCol = mix(color, color * aTint, vPainted);

  // A bigger, bouncier pop than a plain scale-in: overshoot hard, then settle.
  float pop = age < 0.0 ? 0.0 : exp(-age * 6.0) * sin(age * 20.0) * 0.42;
  vec3 p = position * (1.0 + pop);

  // Squash on the way up so it reads as alive, not merely recoloured.
  p.y *= age < 0.0 ? 1.0 : 1.0 + exp(-age * 7.0) * sin(age * 16.0) * 0.3;
  p.y += age < 0.0 ? 0.0 : max(0.0, exp(-age * 5.0) * sin(age * 12.0)) * 0.35;

  // A quick spin as it bursts into colour.
  float spin = age < 0.0 ? 0.0 : exp(-age * 5.0) * 0.9;
  float c = cos(spin), s = sin(spin);
  p.xz = mat2(c, -s, s, c) * p.xz;

  vNrm = normalize(normalMatrix * mat3(instanceMatrix) * normal);

  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const frag = /* glsl */ `
precision mediump float;

varying vec3 vCol;
varying vec3 vNrm;
varying vec3 vWorld;
varying float vPainted;

uniform vec3 uLightDir;
uniform vec3 uGrayTint;

${maskPars}
${fogPars}

void main() {
  vec3 col = vCol;

  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  vec3 gray = mix(vec3(lum), uGrayTint, 0.62) * 0.55;
  col = mix(gray, col, vPainted);

  float ndl = dot(normalize(vNrm), uLightDir) * 0.5 + 0.5;
  col *= mix(0.55, 1.16, ndl);

  // A painted object stays visible, and so does one standing on painted floor.
  float lit = max(vPainted, groundLit(vWorld));
  col = applyFog(col, vWorld, lit, 1.0);

  gl_FragColor = vec4(col, 1.0);

  #include <colorspace_fragment>
}
`;

export interface InstancedToyOpts {
  lightDir: Vector3;
  grayTint: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  paintTex: DataTexture;
  exploredTex: DataTexture;
  maskOrigin: Vector2;
  maskInvSize: number;
}

export function createInstancedToyMaterial(o: InstancedToyOpts): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uLightDir: { value: o.lightDir.clone().normalize() },
      uGrayTint: { value: new Color().setHex(o.grayTint, SRGBColorSpace) },
      uTime: { value: 0 },
      uPaintTex: { value: o.paintTex },
      uExploredTex: { value: o.exploredTex },
      uMaskOrigin: { value: o.maskOrigin.clone() },
      uMaskInvSize: { value: o.maskInvSize },
      uFogCenter: { value: new Vector2() },
      uFogRange: { value: new Vector2(o.fogNear, o.fogFar) },
      uFogColor: { value: new Color().setHex(o.fogColor, SRGBColorSpace) },
    },
    vertexShader: vert,
    fragmentShader: frag,
  });
}

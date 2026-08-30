import { Color, ShaderMaterial, SRGBColorSpace, UniformsLib, UniformsUtils, Vector3 } from 'three';

/**
 * The material every prop and fixture renders with.
 *
 * Paint state is per INSTANCE, held in two InstancedBufferAttributes and
 * animated entirely in the vertex shader. Painting an object therefore writes
 * four floats and does zero CPU matrix work — `instanceMatrix` is written once
 * at build time and never touched again, so eight hundred props can all be
 * mid-animation at no per-frame cost.
 *
 * One shader permutation for every solid object in the game means no compile
 * hitch when a new prop kind first becomes visible.
 */

const vert = /* glsl */ `
precision mediump float;

attribute vec3 color;
attribute float aPaintTime;   // -1 = never painted
attribute vec3 aTint;

varying vec3 vCol;
varying vec3 vNrm;
varying float vPainted;

uniform float uTime;

#include <fog_pars_vertex>

void main() {
  float age = aPaintTime < 0.0 ? -1.0 : uTime - aPaintTime;
  vPainted = aPaintTime < 0.0 ? 0.0 : clamp(age / 0.35, 0.0, 1.0);
  vCol = mix(color, color * aTint, vPainted);
  vNrm = normalize(normalMatrix * mat3(instanceMatrix) * normal);

  // Damped-spring pop: overshoot then settle.
  float pop = age < 0.0 ? 0.0 : exp(-age * 7.0) * sin(age * 22.0) * 0.28;
  vec3 p = position * (1.0 + pop);
  // A little hop on being painted, so it reads as alive rather than recoloured.
  p.y += age < 0.0 ? 0.0 : max(0.0, exp(-age * 6.0) * sin(age * 14.0)) * 0.18;

  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`;

const frag = /* glsl */ `
precision mediump float;

varying vec3 vCol;
varying vec3 vNrm;
varying float vPainted;

uniform vec3 uLightDir;
uniform vec3 uGrayTint;

#include <fog_pars_fragment>

void main() {
  vec3 col = vCol;

  // The same drained treatment as the ground, so an unpainted lollipop reads
  // as the same material as the unpainted floor it stands on.
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  vec3 gray = mix(vec3(lum), uGrayTint, 0.62) * 0.55;
  col = mix(gray, col, vPainted);

  float ndl = dot(normalize(vNrm), uLightDir) * 0.5 + 0.5;
  col *= mix(0.55, 1.16, ndl);

  gl_FragColor = vec4(col, 1.0);

  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

export interface InstancedToyOpts {
  lightDir: Vector3;
  grayTint: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
}

export function createInstancedToyMaterial(o: InstancedToyOpts): ShaderMaterial {
  const uniforms = UniformsUtils.merge([
    UniformsLib.fog,
    {
      uLightDir: { value: new Vector3() },
      uGrayTint: { value: new Color() },
      uTime: { value: 0 },
    },
  ]);

  (uniforms.uLightDir!.value as Vector3).copy(o.lightDir).normalize();
  (uniforms.uGrayTint!.value as Color).copy(new Color().setHex(o.grayTint, SRGBColorSpace));
  (uniforms.fogColor!.value as Color).copy(new Color().setHex(o.fogColor, SRGBColorSpace));
  uniforms.fogNear!.value = o.fogNear;
  uniforms.fogFar!.value = o.fogFar;

  return new ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    fog: true,
  });
}

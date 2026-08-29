import { Color, ShaderMaterial, SRGBColorSpace, UniformsLib, UniformsUtils, Vector3 } from 'three';

/**
 * The shared material for every solid object that is not the ground: props,
 * collectibles, the gate, the player.
 *
 * One hardcoded directional + hemi term instead of three.js lights. That means
 * exactly one shader permutation for the whole game, so no compile hitch when a
 * new object type first becomes visible, and no per-frame light uniform churn.
 * Colour arrives baked into the vertex `color` attribute by ShapeBuilder.
 */

const vert = /* glsl */ `
precision mediump float;

attribute vec3 color;
varying vec3 vCol;
varying vec3 vNrm;

uniform float uPaintAmount;   // 0 = drained, 1 = full colour
uniform float uPop;           // spring overshoot on being painted

#include <fog_pars_vertex>

void main() {
  vCol = color;
  vNrm = normalize(normalMatrix * normal);

  vec3 p = position * (1.0 + uPop);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  // Must be named mvPosition: the <fog_vertex> chunk reads it by that name.
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`;

const frag = /* glsl */ `
precision mediump float;

varying vec3 vCol;
varying vec3 vNrm;

uniform vec3  uLightDir;
uniform vec3  uGrayTint;
uniform float uPaintAmount;

#include <fog_pars_fragment>

void main() {
  vec3 col = vCol;

  // Same drained treatment as the ground, so a gray rock reads as the same
  // material as the gray hill it sits on.
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  vec3 gray = mix(vec3(lum), uGrayTint, 0.62) * 0.55;
  col = mix(gray, col, uPaintAmount);

  float ndl = dot(normalize(vNrm), uLightDir) * 0.5 + 0.5;
  col *= mix(0.55, 1.16, ndl);

  gl_FragColor = vec4(col, 1.0);

  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

export interface ToyMaterialOpts {
  lightDir: Vector3;
  grayTint: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  painted?: boolean;
}

export function createToyMaterial(o: ToyMaterialOpts): ShaderMaterial {
  const uniforms = UniformsUtils.merge([
    UniformsLib.fog,
    {
      uLightDir: { value: new Vector3() },
      uGrayTint: { value: new Color() },
      uPaintAmount: { value: o.painted === false ? 0 : 1 },
      uPop: { value: 0 },
    },
  ]);

  (uniforms.uLightDir!.value as Vector3).copy(o.lightDir).normalize();
  (uniforms.uGrayTint!.value as Color).copy(new Color().setHex(o.grayTint, SRGBColorSpace));
  uniforms.uPaintAmount!.value = o.painted === false ? 0 : 1;
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

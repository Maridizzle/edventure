import { Color, ShaderMaterial, SRGBColorSpace, Vector2, Vector3, type DataTexture } from 'three';
import { fogPars, maskPars } from '../paint/fog.glsl';

/**
 * The material for solid objects that are NOT instanced: the walls, the tray,
 * the door, and the player.
 *
 * One hardcoded directional + hemi term instead of three.js lights, so exactly
 * one shader permutation and no compile hitch when something new first appears.
 */

const vert = /* glsl */ `
precision mediump float;

attribute vec3 color;
varying vec3 vCol;
varying vec3 vNrm;
varying vec3 vWorld;

uniform float uPop;

void main() {
  vCol = color;
  vNrm = normalize(normalMatrix * normal);

  vec3 p = position * (1.0 + uPop);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const frag = /* glsl */ `
precision mediump float;

varying vec3 vCol;
varying vec3 vNrm;
varying vec3 vWorld;

uniform vec3  uLightDir;
uniform vec3  uGrayTint;
uniform float uPaintAmount;
/** Caps how far this object may fade. The door uses it as a landmark. */
uniform float uMaxFog;
/** 1 = ignore the mask and use uPaintAmount alone (the player). */
uniform float uSelfLit;

${maskPars}
${fogPars}

void main() {
  vec3 col = vCol;

  // The same drained treatment as the floor, so an unpainted wall reads as the
  // same material as the unpainted ground it stands on.
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  vec3 gray = mix(vec3(lum), uGrayTint, 0.62) * 0.55;

  // Walls and the door come alive where the floor beneath them is painted, so
  // colour climbs the room as he works.
  float lit = max(groundLit(vWorld) * (1.0 - uSelfLit), uPaintAmount);
  col = mix(gray, col, lit);

  float ndl = dot(normalize(vNrm), uLightDir) * 0.5 + 0.5;
  col *= mix(0.55, 1.16, ndl);

  col = applyFog(col, vWorld, max(lit, uSelfLit), uMaxFog);

  gl_FragColor = vec4(col, 1.0);

  #include <colorspace_fragment>
}
`;

export interface ToyMaterialOpts {
  lightDir: Vector3;
  grayTint: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  paintTex: DataTexture;
  maskOrigin: Vector2;
  maskInvSize: number;
  /** true for the player, which is always in colour and never fades. */
  selfLit?: boolean;
  painted?: boolean;
  maxFog?: number;
}

export function createToyMaterial(o: ToyMaterialOpts): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uLightDir: { value: o.lightDir.clone().normalize() },
      uGrayTint: { value: new Color().setHex(o.grayTint, SRGBColorSpace) },
      uPaintAmount: { value: o.painted ? 1 : 0 },
      uPop: { value: 0 },
      uMaxFog: { value: o.maxFog ?? 1 },
      uSelfLit: { value: o.selfLit ? 1 : 0 },
      uPaintTex: { value: o.paintTex },
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

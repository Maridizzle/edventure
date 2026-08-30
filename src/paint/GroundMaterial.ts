import { Color, ShaderMaterial, SRGBColorSpace, Vector2, Vector3, type DataTexture } from 'three';
import { groundFrag, groundVert } from './paint.glsl';
import type { AreaTransform } from '../core/AreaTransform';

export interface GroundPalette {
  groundA: number;
  groundB: number;
  accent: number;
  grayTint: number;
}

/**
 * Colour management, risk #6: with a raw ShaderMaterial three appends no
 * conversion for us. Colours must be handed in already converted to the linear
 * working space, and the fragment shader must end with <colorspace_fragment>.
 * Get one of the two wrong and everything looks flat and milky, and you spend
 * an evening tweaking a palette that was correct all along.
 */
function linear(hex: number): Color {
  return new Color().setHex(hex, SRGBColorSpace);
}

export interface GroundMaterialOpts {
  palette: GroundPalette;
  transform: AreaTransform;
  paintTex: DataTexture;
  exploredTex: DataTexture;
  fieldTex: DataTexture;
  maskOrigin: Vector2;
  maskInvSize: number;
  noiseTex: DataTexture;
  heightMin: number;
  heightRange: number;
  lightDir: Vector3;
  fogColor: number;
  fogNear: number;
  fogFar: number;
}

export function createGroundMaterial(o: GroundMaterialOpts): ShaderMaterial {
  const t = o.transform.uniforms();
  return new ShaderMaterial({
    uniforms: {
      uPaintTex: { value: o.paintTex },
      uExploredTex: { value: o.exploredTex },
      uFieldTex: { value: o.fieldTex },
      uNoise: { value: o.noiseTex },
      uMaskOrigin: { value: t.uMaskOrigin },
      uMaskInvSize: { value: t.uMaskInvSize },
      uColorA: { value: linear(o.palette.groundA) },
      uColorB: { value: linear(o.palette.groundB) },
      uColorAccent: { value: linear(o.palette.accent) },
      uGrayTint: { value: linear(o.palette.grayTint) },
      uLightDir: { value: o.lightDir.clone().normalize() },
      uTime: { value: 0 },
      uHeightMin: { value: o.heightMin },
      uHeightRange: { value: o.heightRange },
      uFogCenter: { value: new Vector2() },
      uFogRange: { value: new Vector2(o.fogNear, o.fogFar) },
      uFogColor: { value: linear(o.fogColor) },
    },
    vertexShader: groundVert,
    fragmentShader: groundFrag,
  });
}

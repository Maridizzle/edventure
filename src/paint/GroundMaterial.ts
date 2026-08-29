import {
  Color,
  ShaderMaterial,
  SRGBColorSpace,
  UniformsUtils,
  UniformsLib,
  Vector2,
  Vector3,
  type DataTexture,
} from 'three';
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
  fieldTex: DataTexture;
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

  const uniforms = UniformsUtils.merge([
    UniformsLib.fog,
    {
      uPaintTex: { value: null },
      uFieldTex: { value: null },
      uNoise: { value: null },
      uMaskOrigin: { value: new Vector2() },
      uMaskInvSize: { value: 0 },
      uColorA: { value: new Color() },
      uColorB: { value: new Color() },
      uColorAccent: { value: new Color() },
      uGrayTint: { value: new Color() },
      uLightDir: { value: new Vector3() },
      uTime: { value: 0 },
      uHeightMin: { value: 0 },
      uHeightRange: { value: 1 },
    },
  ]);

  // UniformsUtils.merge clones values, so assign the real objects afterwards.
  uniforms.uPaintTex!.value = o.paintTex;
  uniforms.uFieldTex!.value = o.fieldTex;
  uniforms.uNoise!.value = o.noiseTex;
  (uniforms.uMaskOrigin!.value as Vector2).copy(t.uMaskOrigin);
  uniforms.uMaskInvSize!.value = t.uMaskInvSize;
  (uniforms.uColorA!.value as Color).copy(linear(o.palette.groundA));
  (uniforms.uColorB!.value as Color).copy(linear(o.palette.groundB));
  (uniforms.uColorAccent!.value as Color).copy(linear(o.palette.accent));
  (uniforms.uGrayTint!.value as Color).copy(linear(o.palette.grayTint));
  (uniforms.uLightDir!.value as Vector3).copy(o.lightDir).normalize();
  uniforms.uHeightMin!.value = o.heightMin;
  uniforms.uHeightRange!.value = o.heightRange;
  (uniforms.fogColor!.value as Color).copy(linear(o.fogColor));
  uniforms.fogNear!.value = o.fogNear;
  uniforms.fogFar!.value = o.fogFar;

  return new ShaderMaterial({
    uniforms,
    vertexShader: groundVert,
    fragmentShader: groundFrag,
    fog: true,
  });
}

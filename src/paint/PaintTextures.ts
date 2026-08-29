import { DataTexture, LinearFilter, ClampToEdgeWrapping, RGFormat, RGBAFormat, UnsignedByteType, NoColorSpace, RepeatWrapping } from 'three';
import type { PaintMask } from './PaintMask';

/**
 * Upload policy — full re-upload of the RG texture, when dirty, at most once
 * per RENDERED frame.
 *
 * 256^2 * 2 bytes = 131072 bytes. As a texSubImage2D into an already-allocated
 * texture that is ~30-80us on a mid-range Android: under 1% of the frame
 * budget. The byte count is genuinely not the problem. These are, in order:
 *
 *  1. generateMipmaps — regenerates the whole mip chain on the GPU on EVERY
 *     upload. This is the actual killer.
 *  2. Re-allocation — three only does texSubImage2D if nothing about the
 *     texture's shape or params changed since creation. Mutating format, type,
 *     flipY, unpackAlignment or generateMipmaps afterwards forces a full
 *     texImage2D realloc every single frame. So: set everything here, once,
 *     and never touch it again.
 *  3. unpackAlignment — the default is 4. A 192-wide RG8 row is 384 bytes
 *     (fine), but get this wrong with an odd width and the mask renders as
 *     sheared garbage. Set it explicitly.
 *  4. Uploading from the sim step, which may run up to 5 substeps per frame.
 */
export function createPaintTexture(mask: PaintMask): DataTexture {
  const t = new DataTexture(mask.rg, mask.n, mask.n, RGFormat, UnsignedByteType);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.flipY = false;
  t.unpackAlignment = 1;
  // It is DATA, not colour. Leaving this default applies an sRGB decode to the
  // mask values and everything goes subtly wrong.
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * The static field texture: R = paintable, G = collectible warmth.
 * Uploaded once at area load, then only when a collectible is found.
 */
export function createFieldTexture(data: Uint8Array, cells: number): DataTexture {
  const t = new DataTexture(data, cells, cells, RGFormat, UnsignedByteType);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.flipY = false;
  t.unpackAlignment = 1;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Runtime-generated wrapping RGBA noise. Ships no image assets. */
export function createNoiseTexture(data: Uint8Array, size: number): DataTexture {
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.generateMipmaps = false;
  t.flipY = false;
  t.unpackAlignment = 1;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

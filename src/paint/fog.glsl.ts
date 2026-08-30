/**
 * Player-centred fog, and the mask lookup it depends on.
 *
 * three.js fog is camera-distance based, which is not what this needs: the
 * world should be hazy beyond a small circle around the CHILD, not around the
 * viewpoint. So three's fog is gone entirely and every material shares these
 * two chunks instead.
 *
 * The important part is that painting clears fog permanently. Coverage stops
 * being an abstract number and becomes "I lit up this world" — and a fully
 * painted room is a genuine reveal at the end.
 *
 * Fog is the SKY's colour, never dark. A small child alone in a dark fog bank
 * is frightening; in a bright haze it is mysterious.
 */

/** Declares the paint-mask uniforms and how to read them. */
export const maskPars = /* glsl */ `
uniform sampler2D uPaintTex;
uniform vec2  uMaskOrigin;
uniform float uMaskInvSize;

/** How painted the floor is beneath a world position, 0..1. */
float groundLit(vec3 world) {
  vec2 muv = (world.xz - uMaskOrigin) * uMaskInvSize;
  if (muv.x < 0.0 || muv.x > 1.0 || muv.y < 0.0 || muv.y > 1.0) return 0.0;
  return smoothstep(0.34, 0.78, texture2D(uPaintTex, muv).r);
}
`;

/** Declares the fog uniforms and applies them. Requires maskPars above it. */
export const fogPars = /* glsl */ `
uniform vec2 uFogCenter;   // player XZ
uniform vec2 uFogRange;    // x = clear radius, y = fully fogged
uniform vec3 uFogColor;

float fogAmount(vec3 world, float lit) {
  float d = distance(world.xz, uFogCenter);
  return smoothstep(uFogRange.x, uFogRange.y, d) * (1.0 - clamp(lit, 0.0, 1.0));
}

/**
 * maxFog caps how far something can fade out. The door uses it so it always
 * glows faintly through the haze -- he must never be unable to find the way out.
 */
vec3 applyFog(vec3 col, vec3 world, float lit, float maxFog) {
  return mix(col, uFogColor, min(fogAmount(world, lit), maxFog));
}
`;

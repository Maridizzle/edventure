/**
 * The ground shader. All GLSL lives in string exports like this one so that a
 * future move to WebGPU/TSL is two files, not the whole codebase.
 *
 * The trick that lets a 192^2 mask look like a 1024^2 one: warp the mask UV
 * lookup with low-frequency noise before sampling. The paint boundary stops
 * being texel-shaped and becomes organic. This is why we can afford a mask
 * coarse enough to keep on the CPU, which is in turn why coverage is exact
 * and free.
 */

export const groundVert = /* glsl */ `
precision mediump float;

varying vec3  vWorld;
varying vec3  vNrm;
varying float vHeight01;
varying vec2  vLocal;

uniform float uHeightRange;
uniform float uHeightMin;

#include <fog_pars_vertex>

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNrm   = normalize(normalMatrix * normal);
  vHeight01 = clamp((wp.y - uHeightMin) / max(0.001, uHeightRange), 0.0, 1.0);

  // Local coords (relative to area origin) keep noise lookups small enough for
  // mediump. Sampling noise from raw world coords banded on Mali.
  vLocal = position.xz;

  // Must be named mvPosition: the <fog_vertex> chunk reads it by that name.
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`;

export const groundFrag = /* glsl */ `
precision mediump float;

varying vec3  vWorld;
varying vec3  vNrm;
varying float vHeight01;
varying vec2  vLocal;

uniform sampler2D uPaintTex;   // R = amount, G = freshness
uniform sampler2D uFieldTex;   // R = paintable, G = warmth (collectible proximity)
uniform sampler2D uNoise;      // wrapping RGBA, generated at runtime

uniform vec2  uMaskOrigin;
uniform float uMaskInvSize;

uniform vec3  uColorA;
uniform vec3  uColorB;
uniform vec3  uColorAccent;
uniform vec3  uGrayTint;
uniform vec3  uLightDir;
uniform float uTime;

#include <fog_pars_fragment>

void main() {
  vec2 muv = (vWorld.xz - uMaskOrigin) * uMaskInvSize;

  // Organic edge: warp the lookup so texel boundaries vanish.
  vec2 warp = (texture2D(uNoise, vLocal * 0.055).rg - 0.5) * 0.022;
  vec2 pt   = texture2D(uPaintTex, muv + warp).rg;
  vec2 fd   = texture2D(uFieldTex, muv).rg;

  float amount = pt.r;
  float fresh  = pt.g;
  float warmth = fd.g;

  float p = smoothstep(0.34, 0.78, amount);

  // Biome colour: height ramp + noise variation + accent speckle.
  float v = texture2D(uNoise, vLocal * 0.14).b;
  vec3 colorful = mix(uColorA, uColorB, clamp(vHeight01 + (v - 0.5) * 0.30, 0.0, 1.0));
  colorful = mix(colorful, uColorAccent, smoothstep(0.72, 0.96, v));

  // The drained look: desaturate toward luminance, tint cold, darken.
  float lum  = dot(colorful, vec3(0.2126, 0.7152, 0.0722));
  vec3  gray = mix(vec3(lum), uGrayTint, 0.62) * 0.55;

  vec3 base = mix(gray, colorful, p);

  // The warmth tell: near a hidden thing the paint runs hotter and sparkles.
  // Baked into a static texture, so no uniform arrays and no per-fragment loop.
  float sparkle = step(0.985, texture2D(uNoise, vLocal * 1.9 + uTime * 0.06).a);
  base = mix(base, base * vec3(1.22, 1.10, 0.86), warmth * p);
  base += uColorAccent * sparkle * warmth * p * 0.9;

  // The bloom wavefront: a bright rim where paint is fresh.
  float ring = fresh * (1.0 - abs(p - 0.5) * 2.0);
  base += uColorAccent * ring * 0.75;

  // One hardcoded directional + hemi term. No three.js lights, so no shader
  // permutations and no uniform block churn.
  float ndl = dot(normalize(vNrm), uLightDir) * 0.5 + 0.5;
  base *= mix(0.58, 1.14, ndl);

  gl_FragColor = vec4(base, 1.0);

  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

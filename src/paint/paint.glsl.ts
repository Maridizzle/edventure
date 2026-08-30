import { fogPars, maskPars } from './fog.glsl';

/**
 * The floor shader. All GLSL lives in string exports like this so a future
 * move to WebGPU/TSL is a handful of files rather than the whole codebase.
 *
 * The trick that lets a 192^2 mask look like a 1024^2 one: warp the mask UV
 * lookup with low-frequency noise before sampling. The paint boundary stops
 * being texel-shaped and becomes organic. That is why the mask can stay coarse
 * enough to live on the CPU, which is in turn why coverage is exact and free.
 */

export const groundVert = /* glsl */ `
precision mediump float;

varying vec3  vWorld;
varying vec3  vNrm;
varying float vHeight01;
varying vec2  vLocal;

uniform float uHeightRange;
uniform float uHeightMin;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNrm   = normalize(normalMatrix * normal);
  vHeight01 = clamp((wp.y - uHeightMin) / max(0.001, uHeightRange), 0.0, 1.0);

  // Local coords keep noise lookups small enough for mediump. Sampling noise
  // from raw world coords banded on Mali.
  vLocal = position.xz;

  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const groundFrag = /* glsl */ `
precision mediump float;

varying vec3  vWorld;
varying vec3  vNrm;
varying float vHeight01;
varying vec2  vLocal;

uniform sampler2D uFieldTex;   // R = paintable, G = warmth (collectible proximity)
uniform sampler2D uNoise;      // wrapping RGBA, generated at runtime

uniform vec3  uColorA;
uniform vec3  uColorB;
uniform vec3  uColorAccent;
uniform vec3  uGrayTint;
uniform vec3  uLightDir;
uniform float uTime;
/** 1 normally. A check can zero it to measure what the glow is actually worth. */
uniform float uWarmGain;

${maskPars}
${fogPars}

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

  // The warmth tell: near a hidden thing the floor ripples, in rings that run
  // inward toward whatever is buried there.
  //
  // NOT multiplied by p, which is paint coverage. It used to be, and that made
  // it useless: the only floor the glow appeared on was floor he had already
  // driven over, so it could confirm "you walked past one" and never point at
  // one. Hidden things are by construction somewhere he has NOT been.
  //
  // The rings are the part that makes it read. bakeWarmth stores the falloff
  // SQUARED, so the square root recovers a linear ramp -- and one minus that is
  // the normalised DISTANCE to the hidden thing, straight out of a channel that
  // already existed. Rings drawn on that distance converge on the spot and
  // crawl inward. A plain tint could not do this job: it comes out the same
  // colour as paint, so it reads as "a bit of floor got coloured in" rather
  // than as a signal. Moving rings cannot be mistaken for anything.
  // Boosted, because warmth can never reach 1 in play: the creature is found
  // at 2.6 m, where the stored value is only about 0.34. Scaled by 1.7 the
  // glow instead saturates exactly as he arrives, using the whole range.
  float g = clamp(sqrt(warmth) * 1.7, 0.0, 1.0) * uWarmGain;
  float rad = 1.0 - sqrt(warmth);
  // Named ping, not ring: the bloom wavefront below already owns that name.
  float ping = smoothstep(0.0, 0.7, sin(rad * 26.0 - uTime * 3.4));
  float glow = g * (0.25 + 0.75 * ping);
  float sparkle = step(0.955 - g * 0.05, texture2D(uNoise, vLocal * 1.9 + uTime * 0.06).a);

  // Pale, NOT the accent on its own. The accent is the colour paint leaves
  // behind, so an accent-coloured glow on drained floor reads as "a bit of this
  // got coloured in" rather than as a signal. Washed toward white, and lifted
  // in brightness as well as hue, it reads as light coming up through the
  // floor -- which is a thing paint never does.
  vec3 glowCol = mix(uColorAccent, vec3(1.0), 0.55);
  base = mix(base, base * vec3(1.22, 1.10, 0.86), glow * p);
  base = mix(base, glowCol, glow * (1.0 - p) * 0.75);
  base *= 1.0 + glow * 0.5;
  base += uColorAccent * sparkle * glow * 0.75;

  // The bloom wavefront: a bright rim where paint is fresh.
  float ring = fresh * (1.0 - abs(p - 0.5) * 2.0);
  base += uColorAccent * ring * 0.75;

  // One hardcoded directional + hemi term. No three.js lights, so no shader
  // permutations and no uniform block churn.
  float ndl = dot(normalize(vNrm), uLightDir) * 0.5 + 0.5;
  base *= mix(0.58, 1.14, ndl);

  // Painted floor stays lit forever; everything else fades into the haze.
  base = applyFog(base, vWorld, p, 1.0);

  gl_FragColor = vec4(base, 1.0);

  #include <colorspace_fragment>
}
`;

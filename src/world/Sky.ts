import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, SRGBColorSpace } from 'three';

/**
 * A gradient dome.
 *
 * Once the camera drops to a shallow angle there is a great deal of sky on
 * screen, and a flat background colour reads as a void rather than a place.
 * One inside-out sphere, one draw call, no depth write.
 */

const vert = /* glsl */ `
precision mediump float;
varying vec3 vDir;
void main() {
  vDir = position;
  // Strip translation so the dome is always centred on the camera.
  mat4 v = viewMatrix;
  v[3].xyz = vec3(0.0);
  gl_Position = projectionMatrix * v * modelMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w; // pin to the far plane
}
`;

const frag = /* glsl */ `
precision mediump float;
varying vec3 vDir;
uniform vec3 uTop;
uniform vec3 uHorizon;

void main() {
  float h = normalize(vDir).y * 0.5 + 0.5;
  gl_FragColor = vec4(mix(uHorizon, uTop, smoothstep(0.42, 0.95, h)), 1.0);
  #include <colorspace_fragment>
}
`;

export function createSky(topHex: number, horizonHex: number): Mesh {
  const material = new ShaderMaterial({
    uniforms: {
      uTop: { value: new Color().setHex(topHex, SRGBColorSpace) },
      uHorizon: { value: new Color().setHex(horizonHex, SRGBColorSpace) },
    },
    vertexShader: vert,
    fragmentShader: frag,
    side: BackSide,
    depthWrite: false,
  });
  const mesh = new Mesh(new SphereGeometry(1, 16, 10), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}

// The pixel filter (Settings): render at a fraction of the screen's resolution, scale up with hard
// nearest-neighbour pixels, and dither the colours with a 4×4 Bayer pattern — the retro look that suits
// low poly. Off by default; drawing fewer pixels also makes it faster.
import type * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const KEY = 'runekart.pixel';
export const PIXEL_SIZES = [0, 2, 3, 4] as const; // 0: off; otherwise screen pixels per rendered pixel

/** The remembered pixel size: 0 (off), 2, 3 or 4. */
export function pixelSize(): number {
  try { const v = Number(localStorage.getItem(KEY)); return (PIXEL_SIZES as readonly number[]).includes(v) ? v : 0; } catch { return 0; }
}
export function setPixelSize(v: number) {
  try { localStorage.setItem(KEY, String(v)); } catch { /* not remembered */ }
}

/** The renderer's pixel ratio for a pixel size (the normal one when off). */
export const pixelRatioFor = (size: number) => (size ? 1 / size : Math.min(devicePixelRatio, 1.5));

/** Point the renderer at a pixel size: buffer resolution, and hard-edged upscaling of the canvas. */
export function applyPixelSize(renderer: THREE.WebGLRenderer, size: number) {
  renderer.setPixelRatio(pixelRatioFor(size));
  renderer.domElement.style.imageRendering = size ? 'pixelated' : '';
}

/** Ordered dithering down to `levels` steps per channel. Goes after OutputPass, on display (sRGB) colours. */
export function ditherPass(levels: number) {
  return new ShaderPass({
    uniforms: { tDiffuse: { value: null }, levels: { value: levels } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float levels;
      varying vec2 vUv;
      const float BAYER[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        ivec2 p = ivec2(mod(gl_FragCoord.xy, 4.0));
        float d = BAYER[p.x + p.y * 4] / 16.0 - 0.5; // the threshold for this pixel of the pattern
        c.rgb = floor(c.rgb * levels + d + 0.5) / levels;
        gl_FragColor = c;
      }`,
  });
}

/** Colour steps per channel for each pixel size: coarser pixels, coarser colour. */
export const ditherLevels = (size: number) => ({ 2: 32, 3: 20, 4: 12 } as Record<number, number>)[size] ?? 32;

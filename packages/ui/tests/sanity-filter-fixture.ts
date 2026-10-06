import * as THREE from 'three';
import { parseKtex } from '@dontstarve-web/animation/parseKtex';
import { DstLightingRenderer, type DstLightPhase } from '../../../src/dstLighting';

export async function checkSanityFilter() {
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(128, 128);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.append(renderer.domElement);
  const lighting = await DstLightingRenderer.create(renderer, '/dst/data/images/colour_cubes', {
    season: 'spring', phase: 'day', sanityPercent: 35 / 200,
  });
  const initialPercent = lighting.getSanityPercent();
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  // A texture background bypasses world ambient dimming to isolate LUT grading.
  const colour = [160, 120, 80];
  const background = new THREE.DataTexture(new Uint8Array([...colour, 255]), 1, 1);
  background.colorSpace = THREE.SRGBColorSpace;
  background.needsUpdate = true;
  scene.background = background;
  const gl = renderer.getContext();
  const read = () => {
    const pixels = new Uint8Array(128 * 128 * 4);
    gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  };
  const draw = () => {
    lighting.render(scene, camera);
    return Array.from(read().slice((64 * 128 + 64) * 4, (64 * 128 + 64) * 4 + 3));
  };
  // Independently sample the original .tex LUT on the CPU with trilinear filtering.
  const expectedInsane = async (name: string) => {
    const response = await fetch(`/dst/data/images/colour_cubes/${name}`);
    const lut = parseKtex(new Uint8Array(await response.arrayBuffer()));
    const [r, g, b] = colour.map((v) => v / 255 * 31);
    const sample = (slice: number, channel: number) => {
      const pixel = (x: number, y: number) => lut.pixels[(y * lut.width + slice * 32 + x) * 4 + channel];
      const row = (y: number) => THREE.MathUtils.lerp(pixel(Math.floor(r), y), pixel(Math.ceil(r), y), r % 1);
      return THREE.MathUtils.lerp(row(Math.floor(g)), row(Math.ceil(g)), g % 1);
    };
    return [0, 1, 2].map((channel) => THREE.MathUtils.lerp(sample(Math.floor(b), channel), sample(Math.ceil(b), channel), b % 1));
  };
  const phases = [];
  for (const phase of ['day', 'dusk', 'night', 'full_moon'] as DstLightPhase[]) {
    lighting.setPhase(phase);
    lighting.update(10);
    lighting.setSanityPercent(1);
    const normal = draw();
    lighting.setSanityPercent(0.5);
    const halfSanity = draw();
    lighting.setSanityPercent(0);
    const insane = draw();
    const levels = [0.149, 0.15, 0.175, 0.249, 0.25, 0.95].map((percent) => {
      lighting.setSanityPercent(percent);
      return { percent, actualPercent: lighting.getSanityPercent(), colour: draw() };
    });
    lighting.setSanityPercent(1);
    const restored = draw();
    const expected = await expectedInsane(`insane_${phase === 'full_moon' ? 'night' : phase}_cc.tex`);
    phases.push({ phase, normal, halfSanity, insane, expected, restored, levels });
  }
  // Spring uses the same ambient LUT for dusk/night, but different insane LUTs.
  lighting.setSanityPercent(0);
  lighting.setPhase('dusk');
  lighting.update(6);
  const dusk = draw();
  lighting.setPhase('night');
  lighting.update(4);
  const halfway = draw();
  lighting.update(4);
  const night = draw();

  // A high-frequency background exposes edge motion without moving the world.
  const pattern = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const offset = (y * 128 + x) * 4;
    const value = ((x + y) % 4 < 2) ? 220 : 50;
    pattern.set([value, value / 2, 255 - value, 255], offset);
  }
  const patternTexture = new THREE.DataTexture(pattern, 128, 128);
  patternTexture.colorSpace = THREE.SRGBColorSpace;
  patternTexture.magFilter = THREE.LinearFilter;
  patternTexture.needsUpdate = true;
  scene.background = patternTexture;
  draw();
  const before = read();
  lighting.update(0.17);
  draw();
  const after = read();
  let centreChanges = 0;
  let edgeChanges = 0;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const offset = (y * 128 + x) * 4;
    const changed = [0, 1, 2].some((c) => Math.abs(before[offset + c] - after[offset + c]) > 2);
    if (!changed) continue;
    if (x > 48 && x < 80 && y > 48 && y < 80) centreChanges++;
    if (x < 16 || x > 112 || y < 16 || y > 112) edgeChanges++;
  }
  lighting.setSanityPercent(1);
  draw();
  const saneBefore = read();
  lighting.update(0.17);
  draw();
  const saneAfter = read();
  const saneChanges = saneBefore.some((v, i) => v !== saneAfter[i]);
  // A uniform source must stay uniform right up to the viewport boundaries:
  // resizing, DPR and large time deltas must not introduce bright scanlines.
  scene.background = background;
  lighting.setSanityPercent(0);
  lighting.setPhase('day');
  lighting.update(4);
  const reference = draw();
  let maxBoundaryError = 0;
  for (const [width, height, pixelRatio] of [[127, 73, 1], [129, 75, 2], [1, 1, 1]]) {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
    for (const dt of [1 / 60, 0.17, 1e9, 1 / 60]) {
      lighting.update(dt);
      lighting.render(scene, camera);
      const frame = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, frame);
      for (let i = 0; i < frame.length; i += 4) {
        for (let c = 0; c < 3; c++) maxBoundaryError = Math.max(maxBoundaryError, Math.abs(frame[i + c] - reference[c]));
      }
    }
  }
  background.dispose();
  patternTexture.dispose();
  renderer.dispose();
  return { initialPercent, phases, dusk, halfway, night, centreChanges, edgeChanges, saneChanges, maxBoundaryError };
}

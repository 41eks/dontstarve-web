// src/universal.ts

import * as THREE from 'three';
import { DstLightingRenderer } from './dstLighting';
import { CursorLabelUi } from '@three-roaming/ui/cursor-label';
const scene = new THREE.Scene();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
// renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const cursorUi = new CursorLabelUi(renderer.domElement, `${import.meta.env.BASE_URL}dst/data/fonts/controllers.zip`);

let displayWidth = 0;
let displayHeight = 0;
let displayPixelRatio = 0;

function resizeRendererToDisplaySize() {
  const canvas = renderer.domElement;
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  const needsResize =
    width !== displayWidth ||
    height !== displayHeight ||
    pixelRatio !== displayPixelRatio;

  if (needsResize) {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    displayWidth = width;
    displayHeight = height;
    displayPixelRatio = pixelRatio;
  }

  return { width, height, needsResize };
}

// Lambert materials need neutral base illumination. DstLightingRenderer applies
// ambient + local colour through the world XZ lightmap before seasonal grading.
// Lambert's diffuse BRDF divides irradiance by PI; this keeps white neutral.
scene.add(new THREE.AmbientLight(0xffffff, Math.PI));

const dstLighting = await DstLightingRenderer.create(
  renderer,
  `${import.meta.env.BASE_URL}dst/data/images/colour_cubes`,
);

export { cursorUi, dstLighting, scene, renderer, resizeRendererToDisplaySize };

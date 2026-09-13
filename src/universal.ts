// src/universal.ts

import * as THREE from 'three';
const scene = new THREE.Scene();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
// renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

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

const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(0, 20, 10);
console.log(light);
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff));


export { scene, renderer, resizeRendererToDisplaySize };

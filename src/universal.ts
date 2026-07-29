// src/universal.ts

import * as THREE from 'three';
const scene = new THREE.Scene();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
// renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(0, 20, 10);
console.log(light);
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff));


export { scene, renderer };

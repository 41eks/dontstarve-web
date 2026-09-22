// src/building.ts

import * as THREE from 'three';
import { createMoonTreeForest } from '@three-roaming/prefab/moontree';

const groundTexture = new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}384px-GROUND_DECIDUOUS.png`
);
groundTexture.colorSpace = THREE.SRGBColorSpace;
groundTexture.wrapS = THREE.RepeatWrapping;
groundTexture.wrapT = THREE.RepeatWrapping;
groundTexture.repeat.set(10, 10);

const groundGeometry = new THREE.PlaneGeometry(1000, 1000);
const groundMaterial = new THREE.MeshLambertMaterial({
    map: groundTexture,
    side: THREE.DoubleSide
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;

ground.receiveShadow = true;

const moonTreeForest = await createMoonTreeForest(
    `${import.meta.env.BASE_URL}dst/data/anim`,
);

const boxes = [moonTreeForest.group];

export const setTreeNormals = moonTreeForest.setNormals;
export const updateTreeAnimation = moonTreeForest.update;
export { ground, boxes };

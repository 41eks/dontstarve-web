// src/player.ts

import * as THREE from 'three';

export const pig = await loadGLB('googlepig.glb').then((model) => {
  model.scale.set(6, 6, 6);
  model.position.set(-10, 0, -10);
  return model;
});

import { loadGLB } from './handleGLB';
// --- 核心：模型加载完后，立即为它创建一个物理刚体 ---

const shapeRadius = 3;
const pigMaterial = new CANNON.Material("pig");

export const pigBody = new CANNON.Body({
  mass: 5,
  shape: new CANNON.Sphere(shapeRadius),
  // 物理刚体的初始位置必须和 Three.js 模型一致
  position: new CANNON.Vec3(pig.position.x, pig.position.y, pig.position.z)
    .vadd(new CANNON.Vec3(0, shapeRadius, 0)),
  material: pigMaterial,
  fixedRotation: true,
}) as PlayerBody;
// pigBody.canJump = false;

const positionOffset = new THREE.Vector3(0, shapeRadius, 0);
export const updatePigPosition = () => {

  pig.position.copy(pigBody.position as unknown as THREE.Vector3)
    .sub(positionOffset);
}
import * as CANNON from "cannon-es";
import type { PlayerBody } from './types/Player';
// import * as CANNON from 'cannon-es'
import type { Body, ContactEquation } from 'cannon-es';
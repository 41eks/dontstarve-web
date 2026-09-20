// src/player.ts

import { createWilsonPlayer } from '@three-roaming/wilson';

export const player = await createWilsonPlayer(`${import.meta.env.BASE_URL}dst/data/anim`);
// --- 核心：模型加载完后，立即为它创建一个物理刚体 ---

const shapeRadius = 4.5;
const playerMaterial = new CANNON.Material("player");

export const playerBody = new CANNON.Body({
  mass: 5,
  shape: new CANNON.Sphere(shapeRadius),
  // 物理刚体的初始位置必须和 Three.js 模型一致
  position: new CANNON.Vec3(player.position.x, player.position.y, player.position.z)
    .vadd(new CANNON.Vec3(0, shapeRadius, 0)),
  material: playerMaterial,
  fixedRotation: true,
}) as PlayerBody;
playerBody.canJump = false;
// 监听落地碰撞，允许跳跃
// playerBody.addEventListener("collide", (e: CANNON.ICollisionEvent) => {
//   playerBody.canJump = true;
// });
playerBody.addEventListener("collide", (_e: {
  body: Body;
  contact: ContactEquation;
  target: Body; 
  type: string;
}) => {
  playerBody.canJump = true;
});

export function setPlayerNormal(normal: THREE.Vector3) {
  const horizontalNormal = normal.clone();
  horizontalNormal.y = 0;
  if (horizontalNormal.lengthSq() === 0) return;
  horizontalNormal.normalize();
  player.rotation.y = Math.atan2(horizontalNormal.x, horizontalNormal.z);
}
import * as CANNON from "cannon-es";
import * as THREE from 'three';
import type { PlayerBody } from './types/Player';
// import * as CANNON from 'cannon-es'
import type { Body, ContactEquation } from 'cannon-es';

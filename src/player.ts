// src/player.ts

export const player = await loadGLB('ShinChan.glb').then((model) => {
  model.scale.set(0.01, 0.01, 0.01);
  model.position.set(0, 30, 0);
  return model;
});

import { loadGLB } from './handleGLB';
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
import * as CANNON from "cannon-es";
import type { PlayerBody } from './types/Player';
// import * as CANNON from 'cannon-es'
import type { Body, ContactEquation } from 'cannon-es';
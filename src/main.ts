// src/main.ts

import './style.css';
import { createAnimationUpdater } from './animation';

import * as THREE from 'three';

import * as CANNON from "cannon-es";
// --- 1. 初始化物理世界 ---
const world = new CANNON.World({
  gravity: new CANNON.Vec3(0, -9.82, 0), // 设置重力
});

// --- 2. 创建物理地面 ---
const groundMaterial = new CANNON.Material("ground");
const groundBody = new CANNON.Body({
  mass: 0, // 质量为0代表静态物体，不会掉落
  shape: new CANNON.Plane(),
  material: groundMaterial,
});
// Cannon 的 Plane 默认面向 Z 轴，需要旋转使其平躺在地面
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);
import {
  ground, boxes, setTreeNormals

} from './building';
import { animate, backTasks, middleTasks } from './animate';
import { camera } from './camera';
import { pigKingBody, pigKingFloor, pigKingStandee, setPigKingNormal } from './pigking';
import { renderer, scene } from './universal';
scene.background = new THREE.Color(0xbfd1e5);

scene.add(ground);
scene.add(pigKingFloor);
scene.add(pigKingStandee);
// scene.add(boxes);
boxes.forEach(box => {
  scene.add(box);
})


// import { input } from './InputManager';
import { updateMovement } from './updatePlayerMovement';

import { player, playerBody } from './player';

world.addBody(playerBody);

scene.add(player);

import { pigBody, pig, updatePigPosition } from './pig';
import { setupPigInteraction } from './pigInteraction';
world.addBody(pigBody);
scene.add(pig);
setupPigInteraction(camera, renderer, pig);
world.addBody(pigKingBody);
function getVelocity() {
  const velocity = new THREE.Vector3(0, 0, 16);
  const originLength = velocity.length();
  return originLength
}

const updatePlayerMovement = updateMovement(camera, player, playerBody);


const updateAnimationListener = createAnimationUpdater(player);

const cameraDirection = new THREE.Vector3();

middleTasks.push(updateAnimationListener);
middleTasks.push((dt: number) => {
  updatePlayerMovement(getVelocity(), dt);
  updatePigPosition();

});
import CannonDebugger from 'cannon-es-debugger';
const isGitHubPages = window.location.hostname.endsWith('github.io');
if (!isGitHubPages) {
  const cannonDebugger = CannonDebugger(scene, world, {
    color: 0x00ff00, // 物理碰撞体将显示为绿色线框
  });
  backTasks.push(() => {
    // 在 animate 循环中更新 debugger
    cannonDebugger.update();
  });
}

backTasks.push(() => {
  camera.getWorldDirection(cameraDirection);
  setPigKingNormal(cameraDirection);
  setTreeNormals(cameraDirection);
});

animate(world, camera);

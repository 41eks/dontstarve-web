// src/main.ts

import { createAnimationUpdater } from './animation';

import * as THREE from 'three';
// import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import * as CANNON from "cannon-es";
import type { PlayerBody } from './types/Player';
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
  ground, boxes

} from './building';
import { scene, camera, renderer } from './universal';
scene.background = new THREE.Color(0xbfd1e5);

scene.add(ground);
// scene.add(boxes);
boxes.forEach(box => {
  scene.add(box);
})


camera.position.set(4, 10, -12); // 初始化在玩家后上方
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 4, 0);   // 初始看向出生点
controls.enableDamping = true;
controls.update();
controls.addEventListener("change", () => {
  // console.log(camera.position);
})

// import { input } from './InputManager';
import { updateMovement } from './updatePlayerMovement';

import { player, playerBody } from './player';

world.addBody(playerBody);

scene.add(player);


function getVelocity() {
  const velocity = new THREE.Vector3(0, 0, 16);
  const originLength = velocity.length();
  return originLength
}

const updatePlayerMovement = updateMovement(camera, player, playerBody);


const updateAnimationListener = createAnimationUpdater(player);

const timer = new THREE.Timer();

export type Updatable = (dt: number) => void;
const inputTasks: Updatable[] = [];
const simulationTasks: Updatable[] = [];
const postPhysicsTasks: Updatable[] = [];
simulationTasks.push(updateAnimationListener);
simulationTasks.push((dt: number) => {
  updatePlayerMovement(getVelocity(), dt);
});
import CannonDebugger from 'cannon-es-debugger';
const cannonDebugger = CannonDebugger(scene, world, {
  color: 0x00ff00, // 物理碰撞体将显示为红色线框
});
postPhysicsTasks.push(() => {
  // 2. 在 animate 循环中更新 debugger
  cannonDebugger.update();
});


// 更新相机位置
(() => {
  const diff = new THREE.Vector3()
  inputTasks.push(() => {
    // 1. 先让 OrbitControls 把这一帧的阻尼、鼠标旋转全部计算完毕！
    // 这样它计算出来的相机位置就是最终静止、没有残余惯性的位置
    controls.update();

    // 2. 在玩家移动前，计算此时此刻的差值
    diff.copy(camera.position).sub(player.position);
  })

  postPhysicsTasks.push(() => {
    controls.target.copy(player.position);

    camera.position.copy(player.position).add(diff);
  })
})();

const FIXED_TIMESTEP = 1 / 60;   // 物理模拟的固定步长
const MAX_SUBSTEPS = 3;           // 每帧最多补偿的子步数
function animate() {
  requestAnimationFrame(animate);
  timer.update();
  const dt = timer.getDelta();

  inputTasks.forEach((listener) => listener(dt));
  simulationTasks.forEach((listener) => listener(dt));
  // 3. 【物理世界模拟】当这一帧所有的输入和推力都准备好了，物理世界往前走一步
  world.step(FIXED_TIMESTEP, dt, MAX_SUBSTEPS);
  postPhysicsTasks.forEach((listener) => listener(dt));

  renderer.render(scene, camera);
}
animate();
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


// // camera.position.set(10, 10, 10);
// camera.position.set(0, 6, -12);

// // 2. 让相机初始就看向角色出生点
// camera.lookAt(5, 0, 5);
// === 【修改点 1】给相机和控制器一个好看的初始观测点 ===
camera.position.set(0, 6, -12); // 初始化在玩家后上方
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);   // 初始看向出生点
controls.enableDamping = true;
controls.update();
controls.addEventListener("change", () => {
  // console.log(camera.position);
})
import { loadGLB } from './handleGLB';

// import { input } from './InputManager';
import { updateMovement } from './calcDirection';

const player = await loadGLB('ShinChan.glb').then((model) => {
  model.scale.set(0.01, 0.01, 0.01);
  model.position.set(0, 0, 0);
  return model;
});
scene.add(player);

// --- 核心：模型加载完后，立即为它创建一个物理刚体 ---

// 注意：因为你的模型缩放了 0.01，你需要根据 ShinChan 在屏幕上的实际大小来估算这个半径
// 如果物理球体太大，模型会浮在半空中；如果太小，模型的脚会陷进地里
const shapeRadius = 4.5;
const playerMaterial = new CANNON.Material("player");
// 在外部提前声明变量，方便在 animate 循环中使用

const playerBody = new CANNON.Body({
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
playerBody.addEventListener("collide", (e: any) => {
  playerBody.canJump = true;
});


world.addBody(playerBody);



function getVelocity() {
  const velocity = new THREE.Vector3(0, 0, 16);
  const originLength = velocity.length();
  return originLength
}

const movestate = updateMovement(camera, player, playerBody);


const updateAnimationListener = createAnimationUpdater(player);

// 1. 使用 Timer 替代 Clock
const timer = new THREE.Timer();

export type Updatable = (dt: number) => void;
const frontTasks: Updatable[] = [];
const middleTasks: Updatable[] = [];
const backTasks: Updatable[] = [];
middleTasks.push(updateAnimationListener);
middleTasks.push((dt: number) => {
  movestate(getVelocity(), dt);
});
import CannonDebugger from 'cannon-es-debugger';
const cannonDebugger = CannonDebugger(scene, world, {
  color: 0x00ff00, // 物理碰撞体将显示为红色线框
});
middleTasks.push(() => {
  // 2. 在 animate 循环中更新 debugger
  cannonDebugger.update();
});


// 更新相机位置
(() => {
  const diff = new THREE.Vector3()
  frontTasks.push(() => {
    // 1. 先让 OrbitControls 把这一帧的阻尼、鼠标旋转全部计算完毕！
    // 这样它计算出来的相机位置就是最终静止、没有残余惯性的位置
    controls.update();

    // 2. 在玩家移动前，计算此时此刻的差值
    diff.copy(camera.position).sub(player.position);
  })

  backTasks.push(() => {
    controls.target.copy(player.position);

    camera.position.copy(player.position).add(diff);
  })
})();

function animate() {
  requestAnimationFrame(animate);
  timer.update();
  const dt = timer.getDelta();
  // 1. 先更新物理世界，计算出这一帧刚体的新位置
  world.step(1 / 60, dt, 3);

  frontTasks.forEach((listener) => listener(dt));
  middleTasks.forEach((listener) => listener(dt));
  backTasks.forEach((listener) => listener(dt));

  renderer.render(scene, camera);
}
animate();
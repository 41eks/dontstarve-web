
import { createAnimationUpdater } from './animation';

import * as THREE from 'three';
// import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

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
  scene.add(model);
  return model;
});
const velocity = new THREE.Vector3(0, 0, 16);
const originLength = velocity.length();
const movestate = updateMovement(camera, player);


const updateAnimationListener = createAnimationUpdater(player);

// 1. 使用 Timer 替代 Clock
const timer = new THREE.Timer();

export type Updatable = (dt: number) => void;
const queue: Updatable[] = [];
queue.push(updateAnimationListener);
queue.push((dt: number) => {
  movestate(originLength, dt);
});


function animate() {
  requestAnimationFrame(animate);
  timer.update();
  const dt = timer.getDelta();
  // 1. 先让 OrbitControls 把这一帧的阻尼、鼠标旋转全部计算完毕！
  // 这样它计算出来的相机位置就是最终静止、没有残余惯性的位置
  controls.update();

  // 2. 【核心：实现你的想法】在玩家移动前，计算此时此刻最干净的差值
  const diff = new THREE.Vector3().copy(camera.position).sub(player.position);


  queue.forEach((listener) => listener(dt));
  controls.target.copy(player.position);

  camera.position.copy(player.position).add(diff);

  // 5. 让控制器的目标死死咬住玩家的新位置
  controls.target.copy(player.position);


  renderer.render(scene, camera);
}
animate();
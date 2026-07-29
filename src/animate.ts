import * as THREE from 'three';
import type { World } from 'cannon-es';
import type { Camera } from 'three';
import { renderer, scene } from './universal';

type Updatable = (dt: number) => void;

export const frontTasks: Updatable[] = [];
export const middleTasks: Updatable[] = [];
export const backTasks: Updatable[] = [];

const timer = new THREE.Timer();
const FIXED_TIMESTEP = 1 / 60;   // 物理模拟的固定步长
const MAX_SUBSTEPS = 3;           // 每帧最多补偿的子步数

export function animate(world: World, camera: Camera) {
    function tick() {
        requestAnimationFrame(tick);
        timer.update();
        const dt = timer.getDelta();

        frontTasks.forEach((listener) => listener(dt));
        middleTasks.forEach((listener) => listener(dt));
        // 当这一帧所有的输入和推力都准备好了，物理世界往前走一步
        world.step(FIXED_TIMESTEP, dt, MAX_SUBSTEPS);
        backTasks.forEach((listener) => listener(dt));

        renderer.render(scene, camera);
    }

    tick();
}

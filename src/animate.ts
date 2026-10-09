import * as THREE from 'three';
import type { World } from 'cannon-es';
import type { PerspectiveCamera } from 'three';
import { cursorUi, dstLighting, resizeRendererToDisplaySize, scene } from './universal';
import { FIXED_TIMESTEP, MAX_SUBSTEPS } from './physicsTiming';

type Updatable = (dt: number) => void;

export const frontTasks: Updatable[] = [];
export const middleTasks: Updatable[] = [];
export const backTasks: Updatable[] = [];

/** Removed tasks also stay inactive if the current frame already captured them. */
export function registerFrontTask(update: Updatable): () => void {
    let active = true;
    const task: Updatable = dt => { if (active) update(dt); };
    frontTasks.push(task);
    return () => {
        if (!active) return;
        active = false;
        const index = frontTasks.indexOf(task);
        if (index >= 0) frontTasks.splice(index, 1);
    };
}

const timer = new THREE.Timer();
export function animate(world: World, camera: PerspectiveCamera) {
    let frameId: number;
    function tick() {
        frameId = requestAnimationFrame(tick);
        timer.update();
        const dt = timer.getDelta();

        [...frontTasks].forEach((listener) => listener(dt));
        middleTasks.forEach((listener) => listener(dt));
        // 当这一帧所有的输入和推力都准备好了，物理世界往前走一步
        world.step(FIXED_TIMESTEP, dt, MAX_SUBSTEPS);
        backTasks.forEach((listener) => listener(dt));
        dstLighting.update(dt);

        const { width, height, needsResize } = resizeRendererToDisplaySize();
        if (needsResize) {
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        }

        dstLighting.render(scene, camera);
        cursorUi.update();
    }

    tick();
    return () => cancelAnimationFrame(frameId);
}

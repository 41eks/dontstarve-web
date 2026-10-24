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

export function animate(world: World, camera: PerspectiveCamera) {
    const timer = new THREE.Timer();
    let active = true;
    let firstFrame = true;
    let resolveReady!: () => void;
    let rejectReady!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    let frameId = requestAnimationFrame(tick);
    function stop() {
        if (!active) return;
        active = false;
        cancelAnimationFrame(frameId);
        timer.dispose();
        if (firstFrame) rejectReady(new Error('Scene stopped before its first frame'));
    }
    function tick() {
        if (!active) return;
        try {
            timer.update();
            const dt = firstFrame ? 0 : timer.getDelta();

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
            if (firstFrame) {
                firstFrame = false;
                resolveReady();
            }
            if (active) frameId = requestAnimationFrame(tick);
        } catch (error) {
            const failedFirstFrame = firstFrame;
            firstFrame = false;
            stop();
            if (failedFirstFrame) rejectReady(error);
            else throw error;
        }
    }

    return { stop, ready };
}

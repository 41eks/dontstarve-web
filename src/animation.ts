// src/animation.ts



import { AnimationMixer, type Group, type AnimationAction, type AnimationClip } from "three";
import { input } from './InputManager';

export default class ModelAnimation {
    // 显式声明属性类型
    private mixer: AnimationMixer;
    private animations: AnimationClip[];
    private actionObj: Record<string, AnimationAction>;
    private currentAct: AnimationAction | null; // 修正了拼写 currnet -> current
    // private previousAct: AnimationAction | null;

    constructor(model: Group) {
        this.mixer = new AnimationMixer(model);
        this.animations = model.animations;
        this.actionObj = {};
        this.currentAct = null;
        // this.previousAct = null;

        // 初始化动作对象
        this.animations.forEach((clip: AnimationClip) => {
            const action = this.mixer.clipAction(clip);
            this.actionObj[clip.name] = action;
        });
    }

    // 在 ModelAnimation 类中添加逻辑
    public start(name: string): void {
        // 1. 检查：如果要切换的动画就是当前正在播放的动画，则直接返回，不要重复 play()
        if (this.currentAct && this.currentAct === this.actionObj[name]) {
            return;
        }

        // 2. 如果之前有动画在播放，平滑地停止（可选：做淡出处理）
        if (this.currentAct) {
            this.currentAct.stop(); // 或者使用 crossFadeTo 实现平滑过渡
        }

        // 3. 切换新动画
        this.actionInit(name);
    }

    /**
     * 初始化动画动作
     */
    private actionInit(name: string = 'idle'): void {
        const nextAction = this.actionObj[name];

        if (!nextAction) {
            console.warn(`Animation "${name}" not found.`);
            return;
        }

        this.currentAct = nextAction;
        this.currentAct.play();

        console.log("Available Actions:", this.actionObj);
    }

    /**
     * 更新动画循环 (在 requestAnimationFrame 中调用)
     * @param dt - 时间增量 (Delta Time)
     */
    public update(dt: number): void {
        this.mixer.update(dt);
    }
}

import type { Key } from "./InputManager";
import * as THREE from 'three';
import { playerBody } from "./player";
export function createAnimationUpdater(model: THREE.Group) {

    const modelAnimathion = new ModelAnimation(model);
    modelAnimathion.start('idle');
    function updateAnimation() {
        const isMoving = (['KeyW', 'KeyA', 'KeyS', 'KeyD'] as Key[]).some((code: Key) => input.isPressed(code));
        const isShift = input.isPressed('ShiftLeft');
        const isJumping = input.isPressed('Space') || !playerBody.canJump;

        let targetState = 'idle';
        if (isJumping) {
            targetState = 'jump'
        } else
            if (isMoving) {
                targetState = isShift ? 'run' : 'walk';
            }

        // 这样只会当状态发生变化时才调用
        modelAnimathion.start(targetState);
    };

    function listener(dt: number) {


        updateAnimation();

        modelAnimathion.update(dt);
    }
    return listener;
}
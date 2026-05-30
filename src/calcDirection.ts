// src/calcDirection.ts
// import { camera } from "./universal";

import * as THREE from "three";
import { input } from "./InputManager";
// import { camera } from "./universal";
import type { PlayerBody } from "./types/Player";

import * as CANNON from "cannon-es";
const target = new THREE.Vector3();
const moveDir = new THREE.Vector3();

const cameraForward = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

export function updateMovement(
    camera: THREE.PerspectiveCamera,
    player: THREE.Group,
    playerBody: PlayerBody
) {
    // 假设你给刚体加的第一个形状就是 Sphere
    const shape = playerBody.shapes[0] as CANNON.Sphere;
    const radius = shape.radius; // 直接拿到了 0.1！
    const positionOffset = new THREE.Vector3(0, radius, 0)

    function updateDir() {

        camera.getWorldDirection(cameraForward);

        cameraForward.y = 0;
        cameraForward.normalize();

        cameraRight.crossVectors(cameraForward, up).normalize();

        moveDir.set(0, 0, 0);

        if (input.isPressed("KeyW")) moveDir.add(cameraForward);
        if (input.isPressed("KeyS")) moveDir.sub(cameraForward);
        if (input.isPressed("KeyA")) moveDir.sub(cameraRight);
        if (input.isPressed("KeyD")) moveDir.add(cameraRight);

        if (moveDir.lengthSq() > 0) {
            moveDir.normalize();
        }
    }

    function updateLookAt() {

        if (moveDir.lengthSq() === 0) return;

        target.copy(player.position).add(moveDir);

        player.lookAt(target);
    };
    // 修改：通过修改速度来控制位移，保留 Y 轴速度以适应重力和跳跃
    function updatePhysicsPosition(length: number) {
        // 设置 X 和 Z 轴的速度
        if (moveDir.lengthSq() > 0) {
            playerBody.velocity.x = moveDir.x * length;
            playerBody.velocity.z = moveDir.z * length;
        } else {
            // 没有按键时，X 和 Z 速度归零（立即停止，没有滑步）
            playerBody.velocity.x = 0;
            playerBody.velocity.z = 0;
        }
    }
    // // 添加跳跃状态变量
    // let canJump = false;

    // // 监听玩家碰撞以检测是否落地
    // playerBody.addEventListener("collide", (e: any) => {
    //     // 简单判断：如果碰到了什么东西，就允许再次跳跃
    //     // 实际项目中可以通过 e.contact.ni (法线) 判断是否是踩在地面上
    //     canJump = true;
    // });
    // // 新增：跳跃逻辑
    function updateJump() {
        if (input.isPressed("Space") && playerBody.canJump) {
            playerBody.velocity.y = 10; // 给一个向上的跳跃初速度
            playerBody.canJump = false; // 在空中不能再次跳跃
        }
    }

    function updateMoveState(length: number, dt: number) {

        // 一帧只算一次
        updateDir();

        updateLookAt();
        updatePhysicsPosition(length);
        // updatePosition(length, dt);
        // updateCamera();
        updateJump();
        player.position.copy(playerBody.position as unknown as THREE.Vector3)
            .sub(positionOffset);

    }

    return updateMoveState;
}


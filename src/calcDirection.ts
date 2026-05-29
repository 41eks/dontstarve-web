// import { camera } from "./universal";

import * as THREE from "three";
import { input } from "./InputManager";
// import { camera } from "./universal";


const target = new THREE.Vector3();
const moveDir = new THREE.Vector3();

const cameraForward = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

export function updateMovement(
    camera: THREE.PerspectiveCamera,
    player: THREE.Group
) {

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
    function updatePosition(length: number, dt: number) {

        if (moveDir.lengthSq() === 0) return;

        player.position.addScaledVector(moveDir, length * dt);
        // camera.position.addScaledVector(moveDir, length);
    }


    function updateMoveState(length: number, dt: number) {

        // 一帧只算一次
        updateDir();

        updateLookAt();

        updatePosition(length, dt);
        // updateCamera();

    }

    return updateMoveState;
}


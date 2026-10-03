import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { Locomotor } from '@three-roaming/prefab/locomotor';
import type { WilsonAnimationController } from '@three-roaming/prefab/player';
import { input } from './InputManager';
import type { PlayerBody } from './types/Player';

export const JUMP_VELOCITY = 10;
const movementKeys = ['KeyW', 'KeyS', 'KeyA', 'KeyD'] as const;

/** Keyboard direction and jump input; Locomotor owns horizontal velocity. */
export function updateMovement(
    camera: THREE.PerspectiveCamera,
    player: THREE.Group,
    playerBody: PlayerBody,
    locomotor: Locomotor,
) {
    const radius = (playerBody.shapes[0] as CANNON.Sphere).radius;
    const positionOffset = new THREE.Vector3(0, radius, 0);
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const target = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    return (speed: number, dt: number) => {
        camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        right.crossVectors(forward, up).normalize();
        direction.set(0, 0, 0);
        if (input.isPressed('KeyW')) direction.add(forward);
        if (input.isPressed('KeyS')) direction.sub(forward);
        if (input.isPressed('KeyA')) direction.sub(right);
        if (input.isPressed('KeyD')) direction.add(right);
        const manual = movementKeys.some((key) => input.isPressed(key));
        const casting = (player.userData.animationController as WilsonAnimationController | undefined)?.isCasting;
        if (casting) locomotor.stop();
        else locomotor.update(speed, dt, manual ? direction : undefined);

        direction.set(playerBody.velocity.x, 0, playerBody.velocity.z);
        if (!player.userData.billboard && direction.lengthSq() > 0) {
            player.lookAt(target.copy(player.position).add(direction));
        }
        if (!casting && input.isPressed('Space') && playerBody.canJump) {
            playerBody.velocity.y = JUMP_VELOCITY;
            playerBody.canJump = false;
        }
        player.position.copy(playerBody.position as unknown as THREE.Vector3).sub(positionOffset);
    };
}

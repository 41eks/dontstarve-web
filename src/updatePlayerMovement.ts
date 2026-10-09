import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { Locomotor } from '@dontstarve-web/prefab/locomotor';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';
import { input } from './InputManager';
import type { PlayerBody } from './types/Player';
import { MAX_PHYSICS_FRAME_TIME } from './physicsTiming';

export const JUMP_VELOCITY = 10;

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
        const manual = input.isManualMovement();
        const interrupting = input.isActionInterrupting();
        const animation = player.userData.animationController as WilsonAnimationController | undefined;
        if (animation?.isEmoting && interrupting) animation.cancelEmote();
        if (animation?.isMining && interrupting) animation.cancelMine();
        if (animation?.isHammering && interrupting) animation.cancelHammer();
        if (animation?.isDigging && interrupting) animation.cancelDig();
        if (animation?.isReskinning && interrupting) animation.cancelReskin();
        const acting = animation?.isCasting || animation?.isNetting || animation?.isEmoting || animation?.isMining || animation?.isHammering || animation?.isDigging || animation?.isReskinning;
        if (acting) locomotor.stop();
        // Match world.step's substep budget when limiting the final travel step.
        else locomotor.update(speed, Math.min(dt, MAX_PHYSICS_FRAME_TIME), manual ? direction : undefined);

        direction.set(playerBody.velocity.x, 0, playerBody.velocity.z);
        if (!player.userData.billboard && direction.lengthSq() > 0) {
            player.lookAt(target.copy(player.position).add(direction));
        }
        if (!acting && input.isPressed('Space') && playerBody.canJump) {
            playerBody.velocity.y = JUMP_VELOCITY;
            playerBody.canJump = false;
        }
        player.position.copy(playerBody.position as unknown as THREE.Vector3).sub(positionOffset);
    };
}

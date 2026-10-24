import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { Locomotor } from '@dontstarve-web/prefab/locomotor';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';
import { input } from './InputManager';
import type { PlayerBody } from './types/Player';
import { MAX_PHYSICS_FRAME_TIME } from './physicsTiming';
import { WORLD_SCALE } from '../packages/prefab/src/standardcomponents';

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
    /** Last horizontal travel direction: the slip states' motor velocity points along it. */
    const heading = new THREE.Vector3(0, 0, 1);

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
        const slipping = animation?.stategraph.isSlipping === true;
        // Locomotor facts the slip states read through the player's host.
        player.userData.runSpeed = speed / WORLD_SCALE;
        player.userData.wantsToMoveForward = manual || locomotor.destination !== undefined;
        if (!slipping && Math.hypot(playerBody.velocity.x, playerBody.velocity.z) > 0.01) {
            heading.set(playerBody.velocity.x, 0, playerBody.velocity.z).normalize();
        }
        if (animation?.isEmoting && interrupting) animation.cancelEmote();
        if (animation?.isMining && interrupting) animation.cancelMine();
        if (animation?.isChopping && interrupting) animation.cancelChop();
        if (animation?.isHammering && interrupting) animation.cancelHammer();
        if (animation?.isDigging && interrupting) animation.cancelDig();
        if (animation?.isReskinning && interrupting) animation.cancelReskin();
        // SGwilson's locomote event leaves the non-busy fishing states.
        if (animation?.isFishing && (interrupting || locomotor.destination)) animation.cancelFishing();
        // Movement while asleep is the locomote event that wakes the sleeper; the sleeper never walks.
        const sleeping = animation?.isSleeping === true;
        if (sleeping && (manual || locomotor.destination)) animation!.wakeFromBed();
        // SGwilson's locomote event: movement input leaves the idle-tagged shell state; the busy ones ignore it.
        const hiding = animation?.stategraph.hasStateTag('shell') === true;
        if (hiding && (manual || locomotor.destination)) animation!.stategraph.pushLocomote();
        const castingBusy = (animation?.isCasting || animation?.isReading || animation?.isPlayingInstrument) && animation.stategraph.hasStateTag('busy');
        // SGwilson's death state has the dead tag: the corpse never moves.
        const dead = animation?.stategraph.isDead === true;
        const acting = dead || slipping || sleeping || hiding || castingBusy || animation?.isNetting || animation?.isEmoting || animation?.isMining || animation?.isChopping || animation?.isHammering || animation?.isDigging || animation?.isReskinning;
        if (slipping && player.userData.wantsToMoveForward) animation!.stategraph.pushLocomote();
        if (acting) locomotor.stop();
        // Match world.step's substep budget when limiting the final travel step.
        else locomotor.update(speed, Math.min(dt, MAX_PHYSICS_FRAME_TIME), manual ? direction : undefined);

        // Physics:GetMotorSpeed is the commanded speed; contact friction lowers the body's measured velocity.
        const commanded = !acting && ((manual && direction.lengthSq() > 0) || locomotor.destination !== undefined);
        // SG Physics:SetMotorVel: slide along the heading at the state's speed.
        const motorSpeed = player.userData.motorSpeed as number | undefined;
        if (animation?.stategraph.isSlipping && motorSpeed !== undefined) {
            playerBody.velocity.x = heading.x * motorSpeed * WORLD_SCALE;
            playerBody.velocity.z = heading.z * motorSpeed * WORLD_SCALE;
        }
        player.userData.currentMotorSpeed = slipping ? motorSpeed ?? 0 : commanded ? speed / WORLD_SCALE : 0;
        direction.set(playerBody.velocity.x, 0, playerBody.velocity.z);
        if (!player.userData.billboard && direction.lengthSq() > 0) {
            player.lookAt(target.copy(player.position).add(direction));
        }
        if (!acting && !animation?.isGhost && input.isPressed('Space') && playerBody.canJump) {
            playerBody.velocity.y = JUMP_VELOCITY;
            playerBody.canJump = false;
        }
        player.position.copy(playerBody.position as unknown as THREE.Vector3).sub(positionOffset);
    };
}

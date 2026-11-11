import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { Locomotor } from '@dontstarve-web/prefab/locomotor';
import { cancelEmote, wakeFromBed, playerInst } from '@dontstarve-web/prefab/player_common';
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
    const instance = playerInst(player);
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
        const slipping = instance.sg.isSlipping === true;
        // Locomotor facts the slip states read through the player's host.
        instance.runSpeed = speed / WORLD_SCALE;
        instance.wantsToMoveForward = manual || locomotor.destination !== undefined;
        if (!slipping && Math.hypot(playerBody.velocity.x, playerBody.velocity.z) > 0.01) {
            heading.set(playerBody.velocity.x, 0, playerBody.velocity.z).normalize();
            instance.worldHeading = Math.atan2(-heading.z, heading.x) * 180 / Math.PI;
        }
        if (instance.emote !== null && interrupting) cancelEmote(instance);
        const sg = instance.sg;
        const reskinning = () => sg?.isPerformingAction('CASTSPELL', 'reskin_tool') === true;
        // The tool actions' looping states yield to movement input.
        if (sg && interrupting) for (const action of ['MINE', 'CHOP', 'HAMMER', 'TERRAFORM'] as const) sg.cancelAction(action);
        if (reskinning() && interrupting) sg!.cancelAction('CASTSPELL');
        // SGwilson's locomote event leaves the non-busy fishing states.
        if (sg && (interrupting || locomotor.destination)) sg.cancelAction('FISH');
        // Movement while asleep is the locomote event that wakes the sleeper; the sleeper never walks.
        const sleeping = instance.sg.isSleeping;
        if (sleeping && (manual || locomotor.destination)) wakeFromBed(instance);
        // SGwilson's locomote event: movement input leaves the idle-tagged shell state; the busy ones ignore it.
        const hiding = instance.sg.hasStateTag('shell') === true;
        if (hiding && (manual || locomotor.destination)) instance.sg.pushLocomote();
        const castingBusy = sg !== undefined && sg.hasStateTag('busy')
            && ((sg.isPerformingAction('CASTSPELL') && !reskinning()) || sg.isPerformingAction('READ') || sg.isPerformingAction('PLAY'));
        // SGwilson's death state has the dead tag: the corpse never moves.
        const dead = instance.sg.isDead === true;
        const acting = sg?.isPerformingAction('BLINK') || dead || slipping || sleeping || hiding || castingBusy || instance.emote !== null
            || reskinning() || (['NET', 'MINE', 'CHOP', 'HAMMER', 'TERRAFORM'] as const).some(action => sg?.isPerformingAction(action));
        if (slipping && instance.wantsToMoveForward) instance.sg.pushLocomote();
        if (acting) locomotor.stop();
        // Match world.step's substep budget when limiting the final travel step.
        else locomotor.update(speed, Math.min(dt, MAX_PHYSICS_FRAME_TIME), manual ? direction : undefined);

        // Physics:GetMotorSpeed is the commanded speed; contact friction lowers the body's measured velocity.
        const commanded = !acting && ((manual && direction.lengthSq() > 0) || locomotor.destination !== undefined);
        // SG Physics:SetMotorVel: slide along the heading at the state's speed.
        const motorSpeed = instance.motorSpeed;
        if (instance.sg.isSlipping && motorSpeed !== undefined) {
            playerBody.velocity.x = heading.x * motorSpeed * WORLD_SCALE;
            playerBody.velocity.z = heading.z * motorSpeed * WORLD_SCALE;
        }
        instance.currentMotorSpeed = slipping ? motorSpeed ?? 0 : commanded ? speed / WORLD_SCALE : 0;
        direction.set(playerBody.velocity.x, 0, playerBody.velocity.z);
        if (!instance.sprite.sprite.peek().billboard && direction.lengthSq() > 0) {
            player.lookAt(target.copy(player.position).add(direction));
        }
        if (!acting && !instance.sg.isGhost && input.isPressed('Space') && playerBody.canJump) {
            playerBody.velocity.y = JUMP_VELOCITY;
            playerBody.canJump = false;
        }
        instance.setPosition(playerBody.position.x - positionOffset.x,
            playerBody.position.y - positionOffset.y, playerBody.position.z - positionOffset.z);
    };
}

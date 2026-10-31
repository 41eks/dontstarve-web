import { findActionEntity } from '../../prefab/src/actionEntity';
import * as THREE from 'three';
import { BufferedAction, type BufferedActionObject } from './bufferedaction.ts';
import type { ActionWorldContext, ActionAnimationController, ActionLocomotor } from './actionContext.ts';
import { bindActionCancellation } from './actionEvents.ts';
import { PlayerActionPicker, type MouseActionCandidate } from './playeractionpicker.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';

export const MACHINE_REACH = 4;
type MachineAction = 'TURNON' | 'TURNOFF';

/** What actions.lua TURNON / TURNOFF read from the target's machine component. */
export interface MachineComponent { IsOn(): boolean; TurnOn(): void; TurnOff(): void }

export interface MachineTarget extends BufferedActionObject {
  readonly model: THREE.Object3D;
  readonly isRemoved: boolean;
  readonly components: { machine?: MachineComponent; inventoryitem?: { readonly owner: unknown } };
  getPosition(): THREE.Vector3;
}

/** componentactions.lua SCENE.machine: an enabled, fuelled machine off cooldown that nobody holds. */
function sceneAction(target: MachineTarget): MachineAction | undefined {
  if (target.isRemoved || !target.components.machine || !target.model.parent) return undefined;
  if (['cooldown', 'fueldepleted', 'alwayson', 'emergency'].some(tag => target.hasTag(tag)) || !target.hasTag('enabled')) return undefined;
  // A held machine is only usable while equipped, and equipped items are not in the scene.
  if (target.components.inventoryitem?.owner) return undefined;
  return target.hasTag('turnedon') ? 'TURNOFF' : 'TURNON';
}

/** Scene actions are discovered from the machine component and its tags, never from the prefab ID. */
export function getMachineActions(model: THREE.Object3D | undefined): MouseActionCandidate[] {
  if (!model) return [];
  const target = findActionEntity(model) as MachineTarget | undefined;
  if (!target?.components.machine) return [];
  const action = sceneAction(target);
  return action ? [{ action: { action, target }, button: 'right', model }] : [];
}

/** TURNON / TURNOFF: walk to the machine, SGwilson's give state, then machine:TurnOn / TurnOff. */
export class MachineActionController {
  private readonly picker: PlayerActionPicker;
  private readonly unregister: () => void;
  private readonly stopActionEvents: () => void;
  private pending?: { action: MachineAction; target: MachineTarget };
  private buffered?: BufferedAction<MachineAction>;
  private version = 0;
  private disposed = false;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly world: ActionWorldContext;
  private readonly animation: ActionAnimationController;
  private readonly locomotor: ActionLocomotor;
  private readonly isManualMovement: () => boolean;

  constructor(world: ActionWorldContext, animation: ActionAnimationController, locomotor: ActionLocomotor, isManualMovement = () => false) {
    this.world = world; this.animation = animation; this.locomotor = locomotor; this.isManualMovement = isManualMovement;
    this.picker = world.mouseActions ?? new PlayerActionPicker(new PointerRaycaster(world));
    this.unregister = this.picker.register(model => getMachineActions(model));
    this.stopActionEvents = bindActionCancellation(world, this, 'harvest', () => this.cancel());
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  request(action: MachineAction, target: MachineTarget): boolean {
    if (this.disposed || sceneAction(target) !== action || this.animation.stategraph.hasStateTag('busy')) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action });
    this.animation.cancelEmote();
    this.pending = { action, target };
    return true;
  }

  cancel(): void {
    this.version++;
    if (this.pending || (this.buffered && this.animation.stategraph.isActionActive(this.buffered))) this.locomotor.stop();
    this.pending = undefined;
    if (this.buffered && this.animation.stategraph.isActionActive(this.buffered)) this.animation.stategraph.cancelAction(this.buffered.action);
    this.buffered = undefined;
  }

  update(): void {
    if (this.disposed) return;
    if (this.isManualMovement()) { this.cancel(); return; }
    if (this.buffered && !this.animation.stategraph.isActionActive(this.buffered)) { this.cancel(); return; }
    const pending = this.pending;
    if (!pending) return;
    const { action, target } = pending;
    if (sceneAction(target) !== action) { this.cancel(); return; }
    const position = target.getPosition();
    if (!this.inReach(position)) {
      this.direction.subVectors(this.world.player.position, position).setY(0).normalize();
      const destination = position.clone().addScaledVector(this.direction, MACHINE_REACH * .8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > .01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    this.faceTarget(position);
    const version = this.version;
    // actions.lua TURNON / TURNOFF: only a machine still in the other state is switched.
    const buffered = new BufferedAction(action, () => {
      const machine = target.components.machine;
      if (!machine || machine.IsOn() === (action === 'TURNON')) return false;
      if (action === 'TURNON') machine.TurnOn(); else machine.TurnOff();
      return true;
    }, () => version === this.version && sceneAction(target) === action && this.inReach(target.getPosition()), { target });
    if (this.animation.stategraph.pushBufferedAction(buffered)) {
      this.buffered = buffered;
      this.pending = undefined;
    }
  }

  private inReach(position: THREE.Vector3): boolean {
    const player = this.world.player.position;
    return (position.x - player.x) ** 2 + (position.z - player.z) ** 2 <= MACHINE_REACH ** 2;
  }

  private faceTarget(position: THREE.Vector3): void {
    this.direction.subVectors(position, this.world.player.position).setY(0);
    if (this.direction.lengthSq() < 1e-8) return;
    this.world.camera.getWorldDirection(this.forward); this.forward.setY(0).normalize();
    this.right.crossVectors(this.forward, new THREE.Vector3(0, 1, 0)).normalize();
    const forward = this.direction.dot(this.forward), side = this.direction.dot(this.right);
    this.animation.setFacing(Math.abs(forward) >= Math.abs(side) ? (forward > 0 ? 'up' : 'down') : 'side',
      Math.abs(side) > Math.abs(forward) && side < 0);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.disposed || event.defaultPrevented || (event.button !== 0 && event.button !== 2)) return;
    this.picker.pointer.trackPointer(event);
    const actions = this.picker.getMouseActions(event), action = event.button === 0 ? actions.left : actions.right;
    const target = action?.target as MachineTarget | undefined;
    if ((action?.action !== 'TURNON' && action?.action !== 'TURNOFF') || !target?.components?.machine) { this.cancel(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    this.request(action.action, target);
  };
  private readonly handleKeyDown = (event: KeyboardEvent): void => { if (event.code === 'Escape') this.cancel(); };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.cancel();
    this.stopActionEvents(); this.unregister();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.picker !== this.world.mouseActions) this.picker.dispose();
  }
}

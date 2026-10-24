import { bindActionCancellation } from './actionEvents.ts';
import { bindHandEquipmentUpdate, type HandEquipmentSignal } from './handEquipment.ts';
import * as THREE from 'three';
import { PointerRaycaster } from './pointerRaycaster.ts';
import type { ActionWorldContext as WorldContext, ActionAnimationController as WilsonAnimationController, ActionLocomotor as Locomotor } from './actionContext.ts';
import { collectEquippedActions, equippedActionEntity, performToolWork, type ComponentActionEntity } from './componentactions.ts';
import type { Worker } from '../../componets/src/workable';

export const PICKAXE_REACH = 4;

export interface PickaxeTarget {
  readonly entity: ComponentActionEntity;
  readonly id: string;
  readonly model: THREE.Group;
  /** Ground contact, independent of the billboard's height or camera rotation. */
  readonly position: THREE.Vector3;
  isValid(): boolean;
}

export type ToolWorkAction = 'MINE' | 'CHOP';

/** componentactions: <action>_tool + <action>_workable (MINE for pickaxes, CHOP for axes), on the right mouse button. */
export class PickaxeActionController {
  private readonly pointer: PointerRaycaster;
  private readonly unregisterHover: () => void;
  private target?: PickaxeTarget;
  private actionVersion = 0;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly world: WorldContext;
  private readonly animation: WilsonAnimationController;
  private readonly locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>;
  private readonly handEquipment: HandEquipmentSignal;
  private readonly stopEquipment: () => void;
  private readonly stopActionEvents: () => void;
  private readonly getTargets: () => readonly PickaxeTarget[];
  private readonly isManualMovement: () => boolean;
  private readonly worker: Worker;
  private readonly action: ToolWorkAction;

  constructor(
    world: WorldContext,
    animation: WilsonAnimationController,
    locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>,
    handEquipment: HandEquipmentSignal,
    getTargets: () => readonly PickaxeTarget[],
    isManualMovement = () => false,
    action: ToolWorkAction = 'MINE',
  ) {
    this.action = action;
    this.world = world;
    this.animation = animation;
    this.locomotor = locomotor;
    this.handEquipment = handEquipment;
    this.worker = {
      PushEvent: (name, data) => world.player.dispatchEvent({ type: name, data } as never),
      getPosition: () => world.player.position,
    };
    this.stopEquipment = bindHandEquipmentUpdate(handEquipment, {
      isEquipped: equipment => this.isEquipped(equipment),
      cancel: () => this.cancel(true),
      update: dt => this.update(dt),
      registerFrameTask: world.registerFrameTask,
    });
    this.getTargets = getTargets;
    this.isManualMovement = isManualMovement;
    this.stopActionEvents = bindActionCancellation(world, this, 'hand', () => this.cancel());
    this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
    // Without the pickaxe equipped no target can be worked, so none is built or ray-tested.
    this.unregisterHover = world.mouseActions?.register(() => !this.isEquipped() ? [] :
      this.getTargets().filter(target => target.isValid()).map(target => ({
        action: { action: this.action, invobject: equippedActionEntity(this.handEquipment.peek()), target: target.entity },
        button: 'right', model: target.model, available: this.canWork(target), source: 'equipped',
      }))) ?? (() => {});
    // Register in capture so a mine click cannot open a container or place a building.
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private isEquipped(equipment = this.handEquipment.peek()): boolean {
    const entity = equippedActionEntity(equipment);
    return !!entity?.components.tool && entity.hasTag(`${this.action}_tool`) && !entity.isRemoved;
  }

  private canWork(target: PickaxeTarget): boolean {
    return target.isValid() && collectEquippedActions(equippedActionEntity(this.handEquipment.peek()), target.entity, true).includes(this.action);
  }

  request(target: PickaxeTarget): boolean {
    if (!this.canWork(target) || this.isActing
      || this.animation.isCasting || this.animation.isNetting) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: this.action });
    this.animation.cancelEmote();
    this.target = target;
    return true;
  }

  cancel(owned = this.isEquipped()): void {
    this.actionVersion++;
    // Only the equipped tool cancels its own action.
    if (this.target || (owned && this.isActing)) this.locomotor.stop();
    this.target = undefined;
    if (owned) {
      if (this.action === 'CHOP') this.animation.cancelChop();
      else this.animation.cancelMine();
    }
  }

  update(_dt: number): void {
    if (!this.isEquipped() || this.isManualMovement()) { this.cancel(); return; }
    if (!this.target) return;
    const target = this.target;
    if (!this.canWork(target)) { this.cancel(); return; }
    const distance = this.distanceSquared(target);
    if (distance > PICKAXE_REACH ** 2) {
      // Stop short of the foot point; do not walk into the billboard's centre.
      const destination = target.position.clone();
      this.direction.subVectors(this.world.player.position, target.position).normalize();
      destination.addScaledVector(this.direction, PICKAXE_REACH * 0.8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > 0.01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    this.faceTarget(target);
    const version = this.actionVersion;
    const play = this.action === 'CHOP' ? this.animation.playChop.bind(this.animation) : this.animation.playMine.bind(this.animation);
    if (play(() => {
      if (version === this.actionVersion && this.canWork(target)
        && this.distanceSquared(target) <= PICKAXE_REACH ** 2) {
        return performToolWork(this.action, target.entity, this.worker, equippedActionEntity(this.handEquipment.peek()));
      }
      return false;
    })) this.target = undefined;
  }

  dispose(): void {
    this.stopActionEvents();
    this.stopEquipment();
    this.cancel();
    this.unregisterHover();
    if (this.pointer !== this.world.mouseActions?.pointer) this.pointer.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  private get isActing(): boolean {
    return this.action === 'CHOP' ? this.animation.isChopping : this.animation.isMining;
  }

  private distanceSquared(target: PickaxeTarget): number {
    return this.world.player.position.distanceToSquared(target.position);
  }

  private faceTarget(target: PickaxeTarget): void {
    this.direction.subVectors(target.position, this.world.player.position);
    if (this.direction.lengthSq() < 1e-8) return;
    this.world.camera.getWorldDirection(this.forward);
    this.forward.setY(0).normalize();
    this.right.crossVectors(this.forward, this.up).normalize();
    const forward = this.direction.dot(this.forward);
    const side = this.direction.dot(this.right);
    this.animation.setFacing(Math.abs(forward) >= Math.abs(side) ? (forward > 0 ? 'up' : 'down') : 'side',
      Math.abs(side) > Math.abs(forward) && side < 0);
  }

  private hitTarget(): PickaxeTarget | undefined {
    const targets = this.isEquipped() ? this.getTargets().filter((target) => this.canWork(target)) : [];
    const hit = this.pointer.raycastPointer(targets.map(({ model }) => model));
    let root: THREE.Object3D | null = hit?.object ?? null;
    while (root && !targets.some(({ model }) => model === root)) root = root.parent;
    return targets.find(({ model }) => model === root);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.defaultPrevented) return;
    if (event.button === 0) { this.cancel(); return; }
    if (event.button !== 2 || !this.isEquipped()) return;
    this.pointer.trackPointer(event);
    const target = this.hitTarget();
    if (!target) { this.cancel(); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.request(target);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') this.cancel();
  };
}

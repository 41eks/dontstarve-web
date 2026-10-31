import { bindActionCancellation } from './actionEvents.ts';
import * as THREE from 'three';
import { PointerRaycaster } from './pointerRaycaster.ts';
import { bindHandEquipmentUpdate, type HandEquipmentSignal } from './handEquipment.ts';
import type { ActionWorldContext as WorldContext, ActionAnimationController as WilsonAnimationController, ActionLocomotor as Locomotor } from './actionContext.ts';
import type { FarmActionWorld } from './farmActions.ts';
import { facePoint } from './facing.ts';
type FarmPlowPlacement = Pick<FarmActionWorld, 'canTill' | 'till'>;

export type FarmHoeTool = 'farm_hoe' | 'golden_farm_hoe';
export function isFarmHoeTool(value: string): value is FarmHoeTool {
  return value === 'farm_hoe' || value === 'golden_farm_hoe';
}

const TILL_REACH = 4;
/** Right-click TILL at the exact pointer point on an existing farming tile. */
export class FarmHoeActionController {
  private readonly pointer: PointerRaycaster;
  private readonly unregisterHover: () => void;
  private target?: THREE.Vector3;
  private version = 0;
  private disposed = false;
  private readonly direction = new THREE.Vector3();
  private readonly world: WorldContext;
  private readonly animation: WilsonAnimationController;
  private readonly locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>;
  private readonly handEquipment: HandEquipmentSignal;
  private readonly stopEquipment: () => void;
  private readonly stopActionEvents: () => void;
  private readonly farm: FarmPlowPlacement;
  private readonly isManualMovement: () => boolean;

  constructor(world: WorldContext, animation: WilsonAnimationController,
    locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>,
    handEquipment: HandEquipmentSignal, farm: FarmPlowPlacement,
    isManualMovement = () => false) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.handEquipment = handEquipment; this.farm = farm; this.isManualMovement = isManualMovement;
    this.stopEquipment = bindHandEquipmentUpdate(handEquipment, {
      isEquipped: equipment => isFarmHoeTool(equipment?.itemId ?? ''),
      cancel: () => this.cancel(),
      update: () => this.update(),
      registerFrameTask: world.registerFrameTask,
    });
    this.stopActionEvents = bindActionCancellation(world, this, 'hand', () => this.cancel());
    this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
    this.unregisterHover = world.mouseActions?.register(() => this.hitTarget()
      ? [{ action: { action: 'TILL' }, button: 'right' }] : []) ?? (() => {});
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  request(point: THREE.Vector3): boolean {
    if (this.disposed || !isFarmHoeTool(this.equipped()?.itemId ?? '') || !this.farm.canTill(point)
      || this.animation.isTilling || this.animation.isCasting || this.animation.isNetting) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'TILL' });
    this.animation.cancelEmote();
    this.target = point.clone().setY(0);
    return true;
  }

  private equipped() { return this.handEquipment.peek(); }

  cancel(): void {
    this.version++;
    if (this.target) this.locomotor.stop();
    this.target = undefined;
    this.animation.cancelTill();
  }

  update(): void {
    if (!isFarmHoeTool(this.equipped()?.itemId ?? '') || this.isManualMovement()) { this.cancel(); return; }
    const target = this.target;
    if (!target) return;
    if (!this.farm.canTill(target)) { this.cancel(); return; }
    if (!this.inReach(target)) {
      this.direction.subVectors(this.world.player.position, target).setY(0).normalize();
      const destination = target.clone().addScaledVector(this.direction, TILL_REACH * 0.8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > 0.01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    facePoint(this.animation, this.world.camera, this.world.player.position, target);
    const version = this.version, tool = this.equipped()!;
    if (this.animation.playTill(() => {
      const current = this.equipped();
      return version === this.version && current?.itemId === tool.itemId && current.skinId === tool.skinId
        && this.inReach(target) && this.farm.till(target);
    })) this.target = undefined;
  }

  private inReach(point: THREE.Vector3): boolean {
    return (point.x - this.world.player.position.x) ** 2 + (point.z - this.world.player.position.z) ** 2 <= TILL_REACH ** 2;
  }
  private hitTarget(): THREE.Vector3 | undefined {
    if (!isFarmHoeTool(this.equipped()?.itemId ?? '')) return undefined;
    const point = this.pointer.groundPoint();
    return point && this.farm.canTill(point) ? point : undefined;
  }
  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.defaultPrevented) return;
    if (event.button === 0) { this.cancel(); return; }
    if (event.button !== 2) return;
    this.pointer.trackPointer(event);
    if (this.world.mouseActions && this.world.mouseActions.getMouseActions(event).right?.action !== 'TILL') { this.cancel(); return; }
    const point = this.hitTarget();
    if (!point) { this.cancel(); return; }
    event.preventDefault(); event.stopImmediatePropagation(); this.request(point);
  };
  private readonly handleKeyDown = (event: KeyboardEvent): void => { if (event.code === 'Escape') this.cancel(); };
  dispose(): void {
    this.stopActionEvents();
    if (this.disposed) return;
    this.disposed = true; this.cancel();
    this.stopEquipment();
    this.unregisterHover();
    if (this.pointer !== this.world.mouseActions?.pointer) this.pointer.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
  }
}

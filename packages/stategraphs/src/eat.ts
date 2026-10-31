import * as THREE from 'three';
import { bindActionCancellation } from './actionEvents.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';
import type { ActionWorldContext as WorldContext, ActionAnimationController as WilsonAnimationController, ActionLocomotor as Locomotor } from './actionContext.ts';
import type { FarmActionWorld, FarmSoilTarget } from './farmActions.ts';
type FarmPlowPlacement = Pick<FarmActionWorld, 'soilTargets' | 'plantSeed'>;

const PLANT_REACH = 4;

export interface FoodSource { readonly itemId?: string; isValid(): boolean; take(): boolean; readonly foodDrink?: boolean; }

/** Inventory food uses timed quick eating/drinking; seeds can also be planted. */
export class FoodActionController {
  private readonly pointer: PointerRaycaster;
  private readonly unregisterHover: () => void;
  private readonly stopActionEvents: () => void;
  private source?: FoodSource;
  private target?: FarmSoilTarget;
  private version = 0;
  private disposed = false;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly world: WorldContext;
  private readonly animation: WilsonAnimationController;
  private readonly locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>;
  private readonly farm: FarmPlowPlacement;
  private readonly isManualMovement: () => boolean;
  private readonly onDeselect: () => void;

  constructor(
    world: WorldContext,
    animation: WilsonAnimationController,
    locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>,
    farm: FarmPlowPlacement,
    isManualMovement = () => false,
    onDeselect = () => {},
  ) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.farm = farm; this.isManualMovement = isManualMovement;
    this.onDeselect = onDeselect;
    this.stopActionEvents = bindActionCancellation(world, this, 'food', () => this.cancel());
    this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
    this.unregisterHover = world.mouseActions?.register(() =>
      this.farm.soilTargets.filter(target => target.isValid()).map(target => ({
        action: { action: 'PLANT' }, button: 'left', model: target.model, available: !!this.source?.isValid(),
      }))) ?? (() => {});
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  begin(source: FoodSource): void {
    if (this.disposed || !source.isValid()) return;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'SEED_SELECT' });
    this.source = source; this.animation.cancelEmote();
  }

  eat(source: FoodSource, onEaten: () => void): boolean {
    if (this.disposed || !source.isValid()) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'EAT' });
    const version = this.version;
    this.locomotor.stop(); this.animation.cancelEmote();
    return this.animation.playQuickEat(() => {
      if (version !== this.version || !source.isValid() || !source.take()) return false;
      onEaten(); return true;
    }, source.foodDrink);
  }

  cancel(): void {
    this.version++;
    if (this.target) this.locomotor.stop();
    this.target = undefined; this.source = undefined;
    this.animation.cancelFoodAction(); this.onDeselect();
  }

  update(): void {
    if (this.isManualMovement()) { this.cancel(); return; }
    if (this.source && !this.source.isValid()) {
      if (this.target) this.cancel();
      else { this.source = undefined; this.onDeselect(); }
      return;
    }
    const target = this.target, source = this.source;
    if (!target || !source) return;
    if (!target.isValid()) { this.cancel(); return; }
    if (!this.inReach(target)) {
      this.direction.subVectors(this.world.player.position, target.position).setY(0).normalize();
      const destination = target.position.clone().addScaledVector(this.direction, PLANT_REACH * 0.8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > 0.01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    this.faceTarget(target.position);
    const version = this.version;
    if (this.animation.playPlant(() => version === this.version && target.isValid() && this.inReach(target)
      && source.isValid() && this.farm.plantSeed(target.id, source.itemId, () => source.take()))) this.target = undefined;
  }

  private inReach(target: FarmSoilTarget): boolean {
    return (target.position.x - this.world.player.position.x) ** 2
      + (target.position.z - this.world.player.position.z) ** 2 <= PLANT_REACH ** 2;
  }

  private hoveredTarget(): FarmSoilTarget | undefined {
    if (!this.source?.isValid()) return undefined;
    const targets = this.farm.soilTargets;
    const hit = this.pointer.raycastPointer(targets.map(({ model }) => model));
    let root: THREE.Object3D | null = hit?.object ?? null;
    while (root && !targets.some(({ model }) => model === root)) root = root.parent;
    return targets.find(({ model }) => model === root);
  }

  private faceTarget(point: THREE.Vector3): void {
    this.direction.subVectors(point, this.world.player.position).setY(0);
    if (this.direction.lengthSq() < 1e-8) return;
    this.world.camera.getWorldDirection(this.forward); this.forward.setY(0).normalize();
    this.right.crossVectors(this.forward, new THREE.Vector3(0, 1, 0)).normalize();
    const forward = this.direction.dot(this.forward), side = this.direction.dot(this.right);
    this.animation.setFacing(Math.abs(forward) >= Math.abs(side) ? (forward > 0 ? 'up' : 'down') : 'side',
      Math.abs(side) > Math.abs(forward) && side < 0);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.defaultPrevented) return;
    this.pointer.trackPointer(event);
    const target = event.button === 0 ? this.hoveredTarget() : undefined;
    if (!target) { if (event.button === 0 || event.button === 2) this.cancel(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    this.version++;
    this.animation.cancelFoodAction(); this.animation.cancelEmote(); this.target = target;
  };
  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') this.cancel();
  };

  dispose(): void {
    if (this.disposed) return;
    this.stopActionEvents();
    this.disposed = true; this.cancel();
    this.unregisterHover();
    if (this.pointer !== this.world.mouseActions?.pointer) this.pointer.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
  }
}

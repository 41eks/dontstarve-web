import * as THREE from 'three';
import { PointerRaycaster } from './pointerRaycaster.ts';
import type { ActionWorldContext as WorldContext, ActionAnimationController as WilsonAnimationController, ActionLocomotor as Locomotor } from './actionContext.ts';
import type { FarmActionWorld, PreparedFarmTill } from './farmActions.ts';
type FarmPlowPlacement = Pick<FarmActionWorld, 'canTill' | 'prepareTill'>;

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
  private prepared?: PreparedFarmTill;
  private loading = false;
  private version = 0;
  private disposed = false;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly world: WorldContext;
  private readonly animation: WilsonAnimationController;
  private readonly locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>;
  private readonly equipped: () => { itemId: string; skinId?: string } | undefined;
  private readonly farm: FarmPlowPlacement;
  private readonly isManualMovement: () => boolean;
  private readonly onRequest: () => void;
  private readonly onError: (error: unknown) => void;

  constructor(world: WorldContext, animation: WilsonAnimationController,
    locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>,
    equipped: () => { itemId: string; skinId?: string } | undefined, farm: FarmPlowPlacement,
    isManualMovement = () => false, onRequest = () => {}, onError: (error: unknown) => void = console.error) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.equipped = equipped; this.farm = farm; this.isManualMovement = isManualMovement;
    this.onRequest = onRequest; this.onError = onError;
    this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
    this.unregisterHover = world.mouseActions?.register(() => this.hitTarget()
      ? [{ action: { action: 'TILL' }, button: 'right' }] : []) ?? (() => {});
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  request(point: THREE.Vector3): boolean {
    if (this.disposed || !isFarmHoeTool(this.equipped()?.itemId ?? '') || !this.farm.canTill(point)
      || this.animation.isTilling || this.animation.isCasting || this.animation.isNetting) return false;
    this.cancel(); this.animation.cancelEmote();
    this.target = point.clone().setY(0); this.onRequest();
    return true;
  }

  cancel(): void {
    this.version++;
    if (this.target) this.locomotor.stop();
    this.target = undefined; this.loading = false;
    this.prepared?.dispose(); this.prepared = undefined;
    this.animation.cancelTill();
  }

  update(): void {
    if (!isFarmHoeTool(this.equipped()?.itemId ?? '') || this.isManualMovement()) { this.cancel(); return; }
    if (this.prepared && !this.target && !this.animation.isTilling) {
      this.prepared.dispose(); this.prepared = undefined;
    }
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
    if (this.loading) return;
    if (!this.prepared) {
      const version = this.version;
      this.loading = true;
      void this.farm.prepareTill(target).then((prepared) => {
        if (this.disposed || version !== this.version) { prepared?.dispose(); return; }
        this.loading = false;
        if (!prepared) this.cancel(); else this.prepared = prepared;
      }).catch((error: unknown) => {
        if (version === this.version) this.cancel();
        this.onError(error);
      });
      return;
    }
    this.faceTarget(target);
    const prepared = this.prepared, version = this.version, tool = this.equipped()!;
    if (this.animation.playTill(() => {
      const current = this.equipped();
      const success = version === this.version && current?.itemId === tool.itemId && current.skinId === tool.skinId
        && this.inReach(target) && prepared.apply();
      prepared.dispose();
      if (this.prepared === prepared) this.prepared = undefined;
      return success;
    })) this.target = undefined;
  }

  private inReach(point: THREE.Vector3): boolean {
    return (point.x - this.world.player.position.x) ** 2 + (point.z - this.world.player.position.z) ** 2 <= TILL_REACH ** 2;
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
    const point = this.hitTarget();
    if (!point) { this.cancel(); return; }
    event.preventDefault(); event.stopImmediatePropagation(); this.request(point);
  };
  private readonly handleKeyDown = (event: KeyboardEvent): void => { if (event.code === 'Escape') this.cancel(); };
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.cancel();
    this.unregisterHover();
    if (this.pointer !== this.world.mouseActions?.pointer) this.pointer.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
  }
}

import * as THREE from 'three';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory, type SpriteAnimationController } from '@dontstarve-web/animation/sprite';
import { createEffect, type ReadonlySignal } from '@dontstarve-web/signals';
import { SlipperyFeetTarget } from '../../componets/src/slipperyfeettarget';
import { WILSON_RUN_SPEED } from '../../componets/src/slipperyfeet';
import { actionEntity } from './actionEntity';
import { WORLD_SCALE } from './standardcomponents';
import { newEntityId } from './saveRecord';

export const POND_ID = 'pond' as const;
/** pond.lua MakePondPhysics(inst, 1.95), in scene units. */
const POND_RADIUS = 1.95 * WORLD_SCALE;
/** pond.lua SlipperyRate: running faster than WILSON_RUN_SPEED slips ten times faster. */
const slipperyRate = (_: unknown, target: unknown) =>
  (target as { getMotorSpeed(): number }).getMotorSpeed() > WILSON_RUN_SPEED ? 50 : 5;

export interface PondRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: Record<string, never>;
}

/** pond.lua OnSnowLevel: snowlevel above this freezes the pond. */
export const POND_FREEZE_SNOWLEVEL = .02;

/** pond.lua: marsh_tile bank/build, looping idle, OnGround background layer; frozen follows snowlevel. */
export class PondManager {
  private factoryRequest?: Promise<AnimatedSpriteFactory>;
  private readonly ponds = new Set<THREE.Group>();
  private readonly scene: THREE.Scene;
  private readonly assetBaseUrl: string;
  private readonly stopSnowLevel?: () => void;
  private frozen = false;
  private disposed = false;

  /** `snowLevel` is the weather's read-only snowlevel (WatchWorldState("snowlevel", OnSnowLevel)). */
  constructor(scene: THREE.Scene, assetBaseUrl: string, snowLevel?: ReadonlySignal<number>) {
    this.scene = scene;
    this.assetBaseUrl = assetBaseUrl;
    if (snowLevel) this.stopSnowLevel = createEffect(() => this.onSnowLevel(snowLevel.get()));
  }

  private onSnowLevel(snowlevel: number): void {
    const frozen = snowlevel > POND_FREEZE_SNOWLEVEL;
    if (frozen === this.frozen) return;
    this.frozen = frozen;
    for (const model of this.ponds) this.applyFrozen(model, true);
  }

  private applyFrozen(model: THREE.Group, animate: boolean): void {
    model.userData.frozen = this.frozen;
    const entity = actionEntity(model, POND_ID), components = entity.components as { slipperyfeettarget?: SlipperyFeetTarget };
    if (this.frozen && !components.slipperyfeettarget) {
      components.slipperyfeettarget = new SlipperyFeetTarget({
        addTag: tag => entity.addTag(tag), removeTag: tag => entity.removeTag(tag),
        getPosition: () => entity.getPosition(), getPhysicsRadius: () => POND_RADIUS,
      });
      components.slipperyfeettarget.SetSlipperyRate(slipperyRate);
    } else if (!this.frozen && components.slipperyfeettarget) {
      components.slipperyfeettarget.OnRemoveFromEntity();
      delete components.slipperyfeettarget;
    }
    const controller = model.userData.animationController as SpriteAnimationController;
    if (this.frozen) controller.playOnce('frozen');
    else controller.start('idle');
    if (!animate) controller.update(0);
  }

  async spawn(position: THREE.Vector3, saved?: PondRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Pond manager has been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid pond position');
    if (!this.factoryRequest) {
      this.factoryRequest = createAnimatedSpriteFactory(this.assetBaseUrl, 'marsh_tile.zip');
      void this.factoryRequest.catch(() => { this.factoryRequest = undefined; });
    }
    const factory = await this.factoryRequest;
    if (this.disposed) throw new Error('Pond manager has been disposed');
    const model = factory.create({ initialAnimation: 'idle', name: POND_ID });
    model.position.set(position.x, 0, position.z);
    model.rotation.x = -Math.PI / 2;
    // Lift only the artwork above terrain; the entity/save origin stays grounded.
    const visual = model.children[0];
    visual.position.z = 0.01;
    // Ground layers share group order 0 and use mesh order. A negative group
    // order would draw the pond before transparent turf, which covers it up.
    visual.children[0].renderOrder = -0.5;
    Object.assign(model.userData, {
      billboard: false, prefab: POND_ID, entityId: saved?.id ?? newEntityId(),
    });
    this.ponds.add(model);
    this.applyFrozen(model, false);
    this.scene.add(model);
    return model;
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const model of this.ponds) {
      (model.userData.animationController as SpriteAnimationController).update(dt);
    }
  }

  exportRecords(): PondRecord[] {
    return [...this.ponds].map((model) => ({
      id: String(model.userData.entityId),
      transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
      components: {},
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopSnowLevel?.();
    for (const model of this.ponds) model.removeFromParent();
    this.ponds.clear();
    void this.factoryRequest?.then((factory) => factory.dispose(), () => undefined);
  }
}

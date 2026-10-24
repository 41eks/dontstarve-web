import * as THREE from 'three';
import { createEffect, createSignal, GameTimeScheduler, WorldContentKey, type GetWatchWorldContent, type WorldContentSignal, type WorldPhase } from '@dontstarve-web/signals';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory, type SpriteAnimationController } from '@dontstarve-web/animation/sprite';
import { setPrefabLightOverride, setPrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';
import { listenInventoryEvents } from './inventoryEvents';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { Workable } from '../../componets/src/workable';
import { ComponentTimer } from '../../componets/src/timer';

export function configureFirefliesEntity(entity: ItemEntity): void {
  entity.components.inventoryitem.canbepickedup = false;
  entity.components.inventoryitem.canbepickedupalive = true;
  entity.addTag('catchable');
  entity.components.workable = entity.component('workable', () => {
    const workable = new Workable(entity);
    workable.SetWorkAction('NET');
    workable.SetWorkLeft(1);
    workable.SetWorkable(false);
    workable.SetOnFinishCallback(worker => {
      worker.components?.inventory?.GiveItem(entity, entity.transform.position.clone());
    });
    entity.ListenForEvent('ondropped', () => workable.SetWorkLeft(1));
    return workable;
  });
}

export const FIREFLIES_ID = 'fireflies';
export const FIREFLIES_LIGHT = {
  radius: TILE_SIZE / 4,
  intensity: 0.5,
  falloff: 1,
  colour: [180 / 255, 195 / 255, 150 / 255] as const,
};

export interface FirefliesWorld {
  getWatchWorldContent?: GetWatchWorldContent;
}

/** fireflies.lua: stationary swarm, playerprox hysteresis and fixed-rate light fades. */
export class FirefliesController {
  private fadeValue = 0;
  private fadeRate = 0;
  private direction = 0;
  private playerClose = false;
  private readonly cycle?: WorldContentSignal<WorldPhase>;
  private readonly playerpositions?: WorldContentSignal<THREE.Vector3[]>;
  private readonly cleanups: (() => void)[] = [];
  private readonly checks = createSignal<readonly ComponentTimer[]>([]);
  private readonly placement = createSignal<{ dropped: boolean } | undefined>(undefined);
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly disableWork: ComponentTimer;
  private canWork = false;
  private canClick = false;
  private disposed = false;
  readonly model: THREE.Group;
  private readonly animation: SpriteAnimationController;
  private readonly random: () => number;
  private readonly transform: ItemEntity['transform'];
  private entity?: ItemEntity;

  constructor(
    model: THREE.Group,
    animation: SpriteAnimationController,
    world: FirefliesWorld,
    transform: ItemEntity['transform'],
    random = Math.random,
  ) {
    this.model = model;
    this.transform = transform;
    this.animation = animation;
    this.random = random;
    this.cycle = world.getWatchWorldContent?.(WorldContentKey.Cycle, stop => this.cleanups.push(stop));
    this.playerpositions = world.getWatchWorldContent?.(WorldContentKey.PlayerPositions, stop => this.cleanups.push(stop));
    const scheduler = this.cycle?.scheduler ?? this.playerpositions?.scheduler;
    this.scheduler = scheduler ?? new GameTimeScheduler();
    this.ownsScheduler = scheduler === undefined;
    this.disableWork = new ComponentTimer(this.scheduler, () => { this.canWork = false; this.refresh(); });
    Object.assign(model.userData, { itemId: FIREFLIES_ID, prefab: FIREFLIES_ID,
      firefliesController: this, rayTestOnBB: true });
    // Source uses the bloom shader; its luminous swarm art stays visible at night.
    setPrefabLightOverride(model, 1);
    model.children[0].visible = false;
    this.refresh();
    if (this.cycle) {
      let previousNight = this.cycle.peek() === 'night';
      createEffect(() => {
        const night = this.cycle!.get() === 'night';
        if (night !== previousNight) {
          previousNight = night;
          if (!this.inInventory) this.scheduleLightCheck();
        }
      });
    }
    let previousPlacement = this.placement.peek();
    let previousChecks = new Map<ComponentTimer, string>();
    const stopLight = createEffect(() => {
      const night = this.cycle?.get() === 'night';
      const placement = this.placement.get();
      const checks = new Map(this.checks.get().map(timer => [timer, timer.snapshot.get().status] as const));
      const expired = [...checks].some(([timer, status]) => status === 'expired' && previousChecks.get(timer) !== 'expired');
      previousChecks = checks;
      const placed = placement !== previousPlacement;
      previousPlacement = placement;
      if (!placement) return;
      if (!night) {
        if (placed && placement.dropped) {
          this.fadeIn();
          this.scheduleLightCheck();
        } else if (placed || expired) this.fadeOut();
        return;
      }
      const positions = this.playerpositions?.get() ?? [];
      const proximityChanged = this.updateProximity(positions);
      if (placed && placement.dropped) {
        this.fadeIn();
        this.scheduleLightCheck();
      } else if (placed || proximityChanged || expired) {
        if (!this.playerClose) this.fadeIn();
        else this.fadeOut();
      }
    });
    // Watched world signals own this effect; standalone visuals only have local inputs.
    if (!this.cycle && !this.playerpositions) this.cleanups.push(stopLight);
  }

  private get inInventory(): boolean { return this.placement.peek() === undefined; }
  get intensity(): number { return this.fadeValue; }
  get workable(): boolean { return !this.disposed && this.canWork; }
  get clickable(): boolean { return !this.disposed && this.canClick; }
  bindEntity(entity: ItemEntity): void { this.entity = entity; this.refresh(); }

  /** Called after assigning the source ground origin, for both drops and restores. */
  place(dropped: boolean): void {
    if (this.disposed) return;
    setPrefabLightOverride(this.model, 1);
    this.placement.set({ dropped });
  }

  update(dt: number): void {
    if (this.disposed || this.inInventory) return;
    if (this.ownsScheduler && Number.isFinite(dt) && dt > 0) this.scheduler.advance(dt);
    const step = Math.max(0, Math.min(dt, 0.1));
    this.animation.update(step);
    if (this.fadeRate !== 0) {
      this.fadeValue = THREE.MathUtils.clamp(this.fadeValue + this.fadeRate * step, 0, FIREFLIES_LIGHT.intensity);
      if ((this.fadeRate > 0 && this.fadeValue >= FIREFLIES_LIGHT.intensity)
        || (this.fadeRate < 0 && this.fadeValue <= 0)) {
        this.fadeRate = 0;
        if (this.fadeValue === 0) this.finishFadeOut();
      }
    }
    this.refresh();
  }

  onPutInInventory(): void {
    this.placement.set(undefined);
    this.canClick = this.canWork = false;
    for (const timer of this.checks.peek()) timer.stop();
    this.checks.set([]);
    this.fadeValue = this.fadeRate = 0;
    this.direction = 0;
    this.disableWork.stop();
    this.model.children[0].visible = false;
    this.refresh();
    setPrefabLocalLight(this.model, null);
    setPrefabLightOverride(this.model, null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cleanups.splice(0).forEach(stop => stop());
    this.onPutInInventory();
    if (this.ownsScheduler) this.scheduler.dispose();
  }

  /** fireflies.lua OnIsNight: defer the light check by 2..3 seconds. */
  private scheduleLightCheck(): void {
    const timer = new ComponentTimer(this.scheduler, () => {});
    timer.start(2 + this.random());
    this.checks.set([...this.checks.peek().filter(check => check.snapshot.peek().status === 'scheduled'), timer]);
  }

  private updateProximity(positions: readonly THREE.Vector3[]): boolean {
    const distance = (this.playerClose ? 5 : 3) * (TILE_SIZE / 4);
    const close = positions.some(player => player.distanceToSquared(this.transform.position) < distance ** 2);
    if (close === this.playerClose) return false;
    this.playerClose = close;
    return true;
  }

  private fadeIn(): void {
    if (this.direction > 0) return;
    this.direction = 1;
    this.canWork = this.canClick = true;
    this.disableWork.stop();
    this.model.children[0].visible = true;
    this.animation.playOnce('swarm_pre', () => {
      if (!this.disposed && this.direction > 0) this.animation.start('swarm_loop');
    });
    const byte = 1 + Math.min(30, Math.floor(this.random() * 31));
    this.fadeRate = (FIREFLIES_LIGHT.intensity - this.fadeValue) / (3 + (byte - 1) / 15);
    this.refresh();
  }

  private fadeOut(): void {
    if (this.direction <= 0) return;
    this.direction = -1;
    this.animation.playOnce('swarm_pst', () => {
      if (!this.disposed && this.direction < 0) this.model.children[0].visible = false;
    });
    const byte = 32 + Math.min(31, Math.floor(this.random() * 32));
    this.fadeRate = -this.fadeValue / (0.75 + (byte - 32) / 31);
    if (this.fadeValue === 0) this.finishFadeOut();
  }

  private finishFadeOut(): void {
    this.canClick = false;
    this.disableWork.start(1.5 + this.random());
    this.model.children[0].visible = false;
  }

  private refresh(): void {
    this.entity?.components.workable?.SetWorkable(!this.disposed && this.canWork);
    if (this.canClick) this.entity?.removeTag('NOCLICK'); else this.entity?.addTag('NOCLICK');
    setPrefabLocalLight(this.model, this.fadeValue > 0 ? { ...FIREFLIES_LIGHT, intensity: this.fadeValue } : null);
    this.model.userData.tags = ['firefly', 'cattoyairborne', 'flying', 'NOBLOCK', ...(this.canClick ? [] : ['NOCLICK'])];
    this.model.userData.firefliesIntensity = this.fadeValue;
  }
}

/** Independent swarm animations share the unmodified source build/atlas. */
export class FirefliesAssets {
  private factory?: Promise<AnimatedSpriteFactory>;
  private disposed = false;
  private readonly assetBaseUrl: string;
  constructor(assetBaseUrl: string) { this.assetBaseUrl = assetBaseUrl; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.factory) void this.factory.then((factory) => factory.dispose(), () => undefined);
  }

  async loadFactory(): Promise<AnimatedSpriteFactory> {
    if (this.disposed) throw new Error('Insect assets have been disposed');
    if (!this.factory) {
      this.factory = createAnimatedSpriteFactory(this.assetBaseUrl, 'fireflies.zip');
      void this.factory.catch(() => { this.factory = undefined; });
    }
    const factory = await this.factory;
    if (this.disposed) throw new Error('Insect assets have been disposed');
    return factory;
  }

  create(world: FirefliesWorld) {
    return createFirefliesGroundSprite(this, world);
  }
}

export async function createFirefliesGroundSprite(assets: FirefliesAssets, world: FirefliesWorld) {
  const factory = await assets.loadFactory();
  const model = factory.create({ initialAnimation: 'swarm_loop', name: 'GroundItem:fireflies' });
  let controller: FirefliesController | undefined;
  const removeInventoryEvents = listenInventoryEvents(model, {
    ondropped: () => controller?.place(true),
    onputininventory: () => controller?.onPutInInventory(),
    onload: () => controller?.place(false),
  });
  return { model, get controller() { return controller; },
    bindEntity(entity: ItemEntity) { controller?.bindEntity(entity); },
    bindTransform(transform: ItemEntity['transform']) {
      controller = new FirefliesController(model, model.userData.animationController, world, transform);
    },
    update: (dt: number) => controller?.update(dt),
    isClickable: () => controller?.clickable ?? false, isWorkable: () => controller?.workable ?? false,
    dispose() { removeInventoryEvents(); controller?.dispose(); factory.disposeSprite(model); } };
}

export function createFirefliesGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  const assets = new FirefliesAssets(context.animationBaseUrl);
  return {
    itemIds: [FIREFLIES_ID], capture: 'net',
    configureEntity: configureFirefliesEntity,
    create: () => createFirefliesGroundSprite(assets, context.firefliesWorld),
    dispose: () => assets.dispose(),
  };
}

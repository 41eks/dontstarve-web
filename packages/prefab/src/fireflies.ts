import * as THREE from 'three';
import { createEffect, createMemo, createSignal, readonlySignal, watchSignal, GameTimeScheduler, WorldContentKey, type GetWatchWorldContent, type PlayerPositionsSignal, type Signal, type WorldContentSignal, type WorldPhase } from '@dontstarve-web/signals';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory, type SpriteAnimationController } from '@dontstarve-web/animation/sprite';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import { setPrefabLightOverride, setPrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';
import { listenInventoryEvents } from './inventoryEvents';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { Workable } from '../../componets/src/workable';
import { ComponentTimer } from '../../componets/src/timer';
import { TileTracker } from '../../componets/src/tileManager';

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
  /** OnEntitySleep: private view of the tickingarea memo that gates the watched world inputs; undefined when ungated. */
  private readonly awake?: Signal<boolean>;
  private readonly activeState;
  readonly active;
  private readonly updatingState = createSignal(false);
  /** StartUpdatingComponent while a fade or the visible swarm animation runs; idle swarms are not visited per frame. */
  readonly updating = readonlySignal(this.updatingState);
  private readonly playerpositions?: PlayerPositionsSignal;
  private readonly cleanups: (() => void)[] = [];
  private readonly checks = createSignal<readonly ComponentTimer[]>([]);
  private readonly placement = createSignal<{ dropped: boolean } | undefined>(undefined);
  /** Private tile key for the tickingarea gate on the watched world inputs. */
  private readonly tracker: TileTracker;
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
    this.tracker = new TileTracker(() => transform.position);
    const options = { tile: this.tracker.tile };
    this.cycle = world.getWatchWorldContent?.(WorldContentKey.Cycle, stop => this.cleanups.push(stop), options);
    this.playerpositions = world.getWatchWorldContent?.(WorldContentKey.PlayerPositions, stop => this.cleanups.push(stop), options);
    const area = this.cycle?.area ?? this.playerpositions?.area;
    if (area) this.awake = watchSignal(area, stop => this.cleanups.push(stop));
    this.activeState = createMemo(() => this.awake?.get() ?? true);
    this.active = readonlySignal(this.activeState);
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
    this.tracker.sync();
    this.placement.set({ dropped });
    this.syncUpdating();
  }

  update(dt: number): void {
    if (this.disposed || this.inInventory || this.awake?.peek() === false) return;
    if (this.ownsScheduler && Number.isFinite(dt) && dt > 0) this.scheduler.advance(dt);
    const step = Math.max(0, Math.min(dt, 0.1));
    if (this.model.children[0].visible) this.animation.update(step);
    if (this.fadeRate !== 0) {
      this.fadeValue = THREE.MathUtils.clamp(this.fadeValue + this.fadeRate * step, 0, FIREFLIES_LIGHT.intensity);
      if ((this.fadeRate > 0 && this.fadeValue >= FIREFLIES_LIGHT.intensity)
        || (this.fadeRate < 0 && this.fadeValue <= 0)) {
        this.fadeRate = 0;
        if (this.fadeValue === 0) this.finishFadeOut();
      }
      this.refresh();
    }
    if (this.fadeRate === 0) this.syncUpdating();
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
    this.activeState.dispose();
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
      if (!this.disposed && this.direction < 0) { this.model.children[0].visible = false; this.syncUpdating(); }
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

  private syncUpdating(): void {
    this.updatingState.set(!this.disposed && !this.inInventory
      && (this.ownsScheduler || this.fadeRate !== 0 || this.model.children[0].visible));
  }

  private refresh(): void {
    this.syncUpdating();
    this.entity?.components.workable?.SetWorkable(!this.disposed && this.canWork);
    if (this.canClick) this.entity?.removeTag('NOCLICK'); else this.entity?.addTag('NOCLICK');
    this.refreshVisual();
  }

  /** Rebuild presentation after waking without changing logical work/fade/timer state. */
  refreshVisual(): void {
    setPrefabLocalLight(this.model, this.fadeValue > 0 ? { ...FIREFLIES_LIGHT, intensity: this.fadeValue } : null);
    this.model.userData.tags = ['firefly', 'cattoyairborne', 'flying', 'NOBLOCK', ...(this.canClick ? [] : ['NOCLICK'])];
    this.model.userData.firefliesIntensity = this.fadeValue;
  }
}

/** Keep the logical clip/callback while its GPU geometry is unloaded. */
class FirefliesAnimation implements SpriteAnimationController {
  private animation?: SpriteAnimationController;
  private clip = { name: 'swarm_loop', loop: true, complete: undefined as (() => void) | undefined, finished: false };

  attach(animation?: SpriteAnimationController): void {
    this.animation = animation;
    if (animation) this.play();
  }

  start(name: string): void {
    this.clip = { name, loop: true, complete: undefined, finished: false };
    this.play();
  }

  playOnce(name: string, complete?: () => void): void {
    this.clip = { name, loop: false, complete, finished: false };
    this.play();
  }

  update(dt: number): void { this.animation?.update(dt); }

  private play(): void {
    const clip = this.clip;
    if (clip.finished) return;
    if (clip.loop) this.animation?.start(clip.name);
    else this.animation?.playOnce(clip.name, () => {
      if (this.clip !== clip) return;
      clip.finished = true;
      clip.complete?.();
    });
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
  // Only the lightweight origin and logical controller survive outside tickingarea.
  // Atlas materials are shared; each active swarm owns its disposable geometry.
  const model = new THREE.Group();
  model.name = 'GroundItem:fireflies';
  model.userData.billboard = true;
  const empty = new THREE.Group();
  model.add(empty);
  registerSpriteRenderGroup(model, empty);
  const animation = new FirefliesAnimation();
  model.userData.animationController = animation;
  const resources = createSignal(false);
  const cleanups: (() => void)[] = [];
  let sprite: THREE.Group | undefined;
  const unload = () => {
    if (!sprite) return;
    animation.attach(undefined);
    const visual = model.children[0];
    empty.visible = visual.visible;
    empty.position.copy(visual.position);
    sprite.add(visual);
    model.add(empty);
    registerSpriteRenderGroup(model, empty);
    factory.disposeSprite(sprite);
    sprite = undefined;
    setPrefabLocalLight(model, null);
    resources.set(false);
  };
  let controller: FirefliesController | undefined;
  const removeInventoryEvents = listenInventoryEvents(model, {
    ondropped: () => controller?.place(true),
    onputininventory: () => controller?.onPutInInventory(),
    onload: () => controller?.place(false),
  });
  return { model, active: readonlySignal(resources), get controller() { return controller; },
    bindEntity(entity: ItemEntity) { controller?.bindEntity(entity); },
    bindTransform(transform: ItemEntity['transform']) {
      controller = new FirefliesController(model, animation, world, transform);
      const active = watchSignal(controller.active, stop => cleanups.push(stop));
      createEffect(() => {
        if (!active.get()) { unload(); return; }
        if (sprite) return;
        sprite = factory.create({ initialAnimation: 'swarm_loop', name: model.name });
        const visual = sprite.children[0];
        visual.visible = empty.visible;
        visual.position.copy(empty.position);
        model.remove(empty);
        model.add(visual);
        registerSpriteRenderGroup(model, visual as THREE.Group);
        animation.attach(sprite.userData.animationController);
        controller?.refreshVisual();
        resources.set(true);
      });
    },
    get updating() { return controller?.updating; },
    update: (dt: number) => controller?.update(dt),
    isClickable: () => controller?.clickable ?? false, isWorkable: () => controller?.workable ?? false,
    dispose() {
      cleanups.splice(0).forEach(stop => stop());
      removeInventoryEvents();
      controller?.dispose();
      unload();
      model.removeFromParent();
    } };
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

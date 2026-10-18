import * as THREE from 'three';
import { createEffect, createMemo, createSignal, readonlySignal, watchSignal, GameTimeScheduler, WorldContentKey, type GetWatchWorldContent, type HandEquipment, type PlayerPositionsSignal, type ReadonlySignal, type Signal, type WorldContentSignal, type WorldPhase } from '@dontstarve-web/signals';
import type { SpriteAnimationController } from '@dontstarve-web/animation/sprite';
import { ArchiveSpriteAssets, createSharedArchiveSprite, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import { setPrefabLightOverride, setPrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';
import { listenInventoryEvents } from './inventoryEvents';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { Workable } from '../../componets/src/workable';
import { ComponentTimer } from '../../componets/src/timer';
import { TileTracker } from '../../componets/src/tileManager';

const FIREFLIES_TAGS = ['firefly', 'cattoyairborne', 'flying', 'NOBLOCK'] as const;

export function configureFirefliesEntity(entity: ItemEntity): void {
  entity.components.inventoryitem.canbepickedup = false;
  entity.components.inventoryitem.canbepickedupalive = true;
  entity.addTag('catchable');
  for (const tag of [...FIREFLIES_TAGS, 'NOCLICK']) entity.addTag(tag);
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
  handEquipment?: ReadonlySignal<HandEquipment | null>;
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
  private readonly handEquipment?: Signal<HandEquipment | null>;
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
    if (world.handEquipment) this.handEquipment = watchSignal(world.handEquipment, stop => this.cleanups.push(stop), this.awake);
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
    if (this.handEquipment) createEffect(() => {
      this.handEquipment!.get();
      this.active.get();
      this.refreshClickability();
    });
    if (this.cycle) {
      let previousNight = this.cycle.peek() === 'night';
      createEffect(() => {
        const phase = this.cycle!.get(), night = phase === 'night';
        if (night !== previousNight) {
          previousNight = night;
          if (!this.inInventory && phase !== 'day') this.scheduleLightCheck();
        }
      });
    }
    let previousPlacement = this.placement.peek();
    let previousChecks = new Map<ComponentTimer, string>();
    const stopLight = createEffect(() => {
      // Wake resyncs the gated world inputs. Recheck daylight even when no
      // placement or delayed check changed while this swarm was asleep.
      if (this.awake?.get() === false) return;
      const phase = this.cycle?.get(), night = phase === 'night';
      const placement = this.placement.get();
      const placed = placement !== previousPlacement;
      previousPlacement = placement;
      // A daytime wake or drop cannot retain an old fade or luminous frame.
      if (phase === 'day') {
        previousChecks = new Map();
        this.hideForDay();
        return;
      }
      const checks = new Map(this.checks.get().map(timer => [timer, timer.snapshot.get().status] as const));
      const expired = [...checks].some(([timer, status]) => status === 'expired' && previousChecks.get(timer) !== 'expired');
      previousChecks = checks;
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
  get clickable(): boolean {
    return !this.disposed && this.canClick && this.active.peek() && this.handEquipment?.peek()?.itemId === 'bugnet';
  }
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

  private hideForDay(): void {
    for (const timer of this.checks.peek()) timer.stop();
    if (this.checks.peek().length) this.checks.set([]);
    this.disableWork.stop();
    this.fadeValue = this.fadeRate = this.direction = 0;
    this.canClick = this.canWork = false;
    this.model.children[0].visible = false;
    this.refresh();
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
    this.refreshVisual();
  }

  private refreshClickability(): void {
    const clickable = this.clickable;
    if (clickable) this.entity?.removeTag('NOCLICK'); else this.entity?.addTag('NOCLICK');
    this.model.userData.tags = [...FIREFLIES_TAGS, ...(clickable ? [] : ['NOCLICK'])];
  }

  /** Rebuild presentation after waking without changing logical work/fade/timer state. */
  refreshVisual(): void {
    setPrefabLocalLight(this.model, this.fadeValue > 0 ? { ...FIREFLIES_LIGHT, intensity: this.fadeValue } : null);
    this.refreshClickability();
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

/** One resource owner for shared frames and instanced swarm loops. */
export class FirefliesAssets {
  private readonly assets: ArchiveSpriteAssets;
  private disposed = false;
  constructor(assetBaseUrl: string) { this.assets = new ArchiveSpriteAssets('fireflies', assetBaseUrl); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.assets.dispose();
  }

  async createSprite(foot: THREE.Group): Promise<ArchiveSprite> {
    const sprite = await createSharedArchiveSprite(this.assets, {
      animationArchive: 'fireflies.zip', buildArchives: ['fireflies.zip'], bank: 'fireflies', animation: 'swarm_loop', loop: true,
    }, { name: foot.name, foot, instancedAnimations: ['swarm_loop'] });
    if (this.disposed) { sprite.dispose(); throw new Error('Insect assets have been disposed'); }
    return sprite;
  }

  create(world: FirefliesWorld) {
    return createFirefliesGroundSprite(this, world);
  }
}

export async function createFirefliesGroundSprite(assets: FirefliesAssets, world: FirefliesWorld) {
  // Only the lightweight origin and logical controller survive outside tickingarea.
  // Source frames, atlas materials and instance batches belong to assets.
  const model = new THREE.Group();
  model.name = 'GroundItem:fireflies';
  model.userData.billboard = true;
  // Ground creation resolves with its first visual ready, preserving immediate
  // drop/capture semantics; an initially sleeping entity releases it on binding.
  let prepared: ArchiveSprite | undefined = await assets.createSprite(model);
  const empty = new THREE.Group();
  model.add(empty);
  registerSpriteRenderGroup(model, empty);
  const animation = new FirefliesAnimation();
  model.userData.animationController = animation;
  const resources = createSignal(false);
  const cleanups: (() => void)[] = [];
  let sprite: ArchiveSprite | undefined;
  let generation = 0;
  let loading = false;
  let disposed = false;
  const unload = () => {
    generation++;
    loading = false;
    prepared?.dispose();
    prepared = undefined;
    if (!sprite) return;
    animation.attach(undefined);
    const visual = model.children[0];
    empty.visible = visual.visible;
    empty.position.copy(visual.position);
    model.add(empty);
    registerSpriteRenderGroup(model, empty);
    sprite.dispose();
    sprite = undefined;
    setPrefabLocalLight(model, null);
    resources.set(false);
  };
  let controller: FirefliesController | undefined;
  const attach = (created: ArchiveSprite) => {
    sprite = created;
    sprite.model.visible = empty.visible;
    sprite.model.position.copy(empty.position);
    model.remove(empty);
    model.add(sprite.model);
    registerSpriteRenderGroup(model, sprite.model.children[0] as THREE.Group);
    animation.attach(sprite);
    controller?.refreshVisual();
    resources.set(true);
  };
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
        if (sprite || loading) return;
        if (prepared) {
          const created = prepared; prepared = undefined;
          attach(created);
          return;
        }
        loading = true;
        const requested = generation;
        void assets.createSprite(model).then(created => {
          if (disposed || requested !== generation || !active.peek()) { created.dispose(); return; }
          loading = false;
          attach(created);
        }).catch(error => {
          if (disposed || requested !== generation) return;
          loading = false;
          console.error('Unable to load fireflies sprite', error);
        });
      });
    },
    get updating() { return controller?.updating; },
    update: (dt: number) => controller?.update(dt),
    isClickable: () => controller?.clickable ?? false, isWorkable: () => controller?.workable ?? false,
    dispose() {
      disposed = true;
      cleanups.splice(0).forEach(stop => stop());
      removeInventoryEvents();
      controller?.dispose();
      unload();
      model.removeFromParent();
    } };
}

export function createFirefliesGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  const assets = new FirefliesAssets(context.animationBaseUrl);
  const world = { ...context.firefliesWorld, handEquipment: context.firefliesWorld.handEquipment ?? context.handEquipment };
  return {
    itemIds: [FIREFLIES_ID], capture: 'net',
    configureEntity: configureFirefliesEntity,
    create: () => createFirefliesGroundSprite(assets, world),
    dispose: () => assets.dispose(),
  };
}

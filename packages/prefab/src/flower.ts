import * as THREE from 'three';
import { ArchiveSpriteAssets, preloadSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { watchTileActivity } from './tileActivity';
import { newEntityId } from './saveRecord';
import type { WorldContext, WorldEventEmitter } from './worldContext';
import { actionEntity } from './actionEntity';
import { BurnableBinding, FireFxHost } from './treeFire';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Pickable } from './components/pickable';
import { TILE_SIZE } from './tile';
import type { ReadonlySignal, SeasonState } from '@dontstarve-web/signals';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import { createArchiveEntity, type PrefabInstance } from './prefabInstance';

/** flower.lua MakeSmallBurnable + MakeSmallPropagator; the scene's game-time scheduler drives them. */
export interface FlowerBurningWorld {
  scheduler: GameTimeScheduler;
  season?: ReadonlySignal<SeasonState>;
  /** DefaultBurntFn: one ash at the burnt flower's position. */
  worldEvents: WorldEventEmitter;
}

// flower.lua chooses f1–f10, with a 1% chance of rose. butterfly.lua's placer
// uses f1; OnDeploy consumes one butterfly and spawns a planted flower.
export const FLOWER_ANIMATIONS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'rose'] as const;
export type FlowerAnimation = typeof FLOWER_ANIMATIONS[number];
export const FLOWER_PICK_SANITY = 5;
export const ROSE_DAMAGE = 1;
export interface FlowerSaveRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { flower: { animation: FlowerAnimation; planted?: true } };
}

interface PlantedFlower {
  id: string;
  model: THREE.Group;
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  stopActivity?: () => void;
  animation: FlowerAnimation;
  pickable: Pickable;
  burn?: BurnableBinding;
  /** DefaultBurnFn clears persists while burning; DefaultExtinguishFn restores it. */
  persists: boolean;
}

/** Persistent flowers prepared for the shared DEPLOY action. */
export class FlowerPlanting {
  private readonly world: WorldContext;
  private readonly random: () => number;
  private readonly flowers = new Map<string, PlantedFlower>();
  private flowerList?: readonly { readonly id: string; readonly position: THREE.Vector3 }[];
  private readonly assets = new ArchiveSpriteAssets();
  private factory?: ReturnType<typeof preloadSharedArchiveSprite>;
  private fireFx?: FireFxHost;
  private readonly burning?: FlowerBurningWorld;
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private disposed = false;

  constructor(world: WorldContext, random = Math.random,
    burning?: FlowerBurningWorld) {
    this.burning = burning;
    this.ownsScheduler = !burning?.scheduler && !world.scheduler;
    this.scheduler = burning?.scheduler ?? world.scheduler ?? new GameTimeScheduler();
    this.world = world;
    this.random = random;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const flower of [...this.flowers.values()]) this.removeFlower(flower);
    if (this.ownsScheduler) this.scheduler.dispose();
    this.fireFx?.dispose();
    this.assets.dispose();
  }

  update(cameraQuaternion: THREE.Quaternion, dt = 0): void {
    if (this.ownsScheduler) this.scheduler.advance(dt);
    this.fireFx?.update(dt, cameraQuaternion);
    for (const { instance } of this.flowers.values()) if (instance.sprite.loaded) instance.sprite.update(dt);
  }

  /** The planted `flower`-tagged entities (butterflybrain FLOWER_TAGS), rebuilt only when one is planted or removed. */
  get plantedFlowers(): readonly { readonly id: string; readonly position: THREE.Vector3 }[] {
    // Planted models are direct scene children, so their position is the world position.
    return this.flowerList ??= [...this.flowers.values()].map(({ id, model }) => ({ id, position: model.position }));
  }

  get renderEntities() {
    const models = [...this.flowers.values()].filter(({ instance }) => instance.sprite.loaded).map(({ model }) => model);
    return [...models.map((object) => ({ object, footPosition: object.position, cameraDepth: 0 })),
      ...(this.fireFx?.renderEntities ?? [])];
  }

  exportRecords(): FlowerSaveRecord[] {
    return [...this.flowers.values()].filter(({ persists }) => persists).map(({ id, model, animation }) => ({
      id, transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
      components: { flower: { animation, ...(model.userData.planted ? { planted: true as const } : {}) } },
    }));
  }

  async spawnFromSave(id: string, animation: FlowerAnimation, position: THREE.Vector3, planted = true): Promise<THREE.Group> {
    const factory = await this.loadFactory();
    if (this.disposed) throw new Error('Flower planting has been disposed');
    const flower = this.createFlower(factory, id, animation, position, planted);
    this.flowers.set(id, flower);
    this.flowerList = undefined;
    this.world.scene.add(flower.model);
    this.bindActivity(flower);
    return flower.model;
  }

  async prepareTransplant(): Promise<{ spawn(position: THREE.Vector3): boolean; dispose(): void }> {
    const factory = await this.loadFactory();
    let available = true;
    return {
      dispose: () => { available = false; },
      spawn: position => {
        if (!available || this.disposed) return false;
        available = false;
        const animation = this.random() < .01 ? 'rose' : FLOWER_ANIMATIONS[Math.floor(this.random() * 10)];
        const flower = this.createFlower(factory, newEntityId(), animation, position);
        this.flowers.set(flower.id, flower);
        this.flowerList = undefined;
        this.world.scene.add(flower.model);
        this.bindActivity(flower);
        flower.model.userData.actionEntity.PushEvent('growfrombutterfly', undefined);
        return true;
      },
    };
  }

  private loadFactory(): ReturnType<typeof preloadSharedArchiveSprite> {
    if (this.disposed) return Promise.reject(new Error('Flower planting has been disposed'));
    if (!this.factory) {
      const baseUrl = `${import.meta.env.BASE_URL}dst/data/anim`;
      this.factory = Promise.allSettled([
        preloadSharedArchiveSprite(this.assets, { animationArchive: 'flowers.zip', buildArchives: ['flowers.zip'], bank: 'flowers' },
          { instancedAnimations: 'all', staticBillboard: true }),
        this.burning ? FireFxHost.load(baseUrl) : undefined,
      ]).then(([source, fire]) => {
        if (source.status === 'rejected') {
          if (fire.status === 'fulfilled') fire.value?.dispose();
          throw source.reason;
        }
        if (fire.status === 'rejected') throw fire.reason;
        this.fireFx = fire.value;
        if (this.disposed) this.fireFx?.dispose();
        return source.value;
      });
      void this.factory.catch(() => { this.factory = undefined; });
    }
    return this.factory;
  }

  private createFlower(factory: Awaited<ReturnType<typeof preloadSharedArchiveSprite>>, id: string, animation: FlowerAnimation, position: THREE.Vector3, planted = true): PlantedFlower {
    const create = (clip: { name: string; loop: boolean }) => factory(clip.name, clip.loop, 'Flower');
    const { instance, display } = createArchiveEntity('flower', { create, initial: create({ name: animation, loop: false }) },
      { name: animation, billboard: true }, 'Flower');
    // PlayAnimation(animname) without loop.
    instance.sprite.playOnce(animation);
    const model = display.model;
    instance.position.set(position.x, 0, position.z);
    instance.entityId = id;
    Object.assign(model.userData, {
      rayTestOnBB: true, planted, flowerAnimation: animation,
      deploySmartRadius: .375 * (TILE_SIZE / 4),
    });
    for (const tag of ['flower', 'cattoy', ...(animation === 'rose' ? ['thorny'] : [])]) instance.addTag(tag);
    const pickable: Pickable = new Pickable(model, 'petals', 10, 1, doer => {
      const picker = doer?.picker;
      if (picker && !picker.hasTag('plantkin')) picker.components.sanity?.DoDelta(FLOWER_PICK_SANITY);
      if (animation === 'rose' && picker?.components.combat
        && !picker.components.inventory?.EquipHasTag('bramble_resistant') && !picker.hasTag('shadowminion')) {
        picker.components.combat.GetAttacked(entity, ROSE_DAMAGE);
        picker.PushEvent?.('thorns');
      }
      (this.world.worldEvents ?? this.burning?.worldEvents)?.emit('plantkilled', { doer: picker, pos: model.position.clone() });
    }, undefined, undefined, { scheduler: this.scheduler, onRemove: () => this.removeFlower(flower) });
    pickable.quickpick = true;
    pickable.picksound = 'dontstarve/wilson/pickup_plants';
    pickable.wildfirestarter = true;
    pickable.remove_when_picked = true;
    const flower: PlantedFlower = { id, model, instance, display, animation, pickable, persists: true };
    const entity = actionEntity(model, 'flower');
    if (this.burning && this.fireFx) {
      flower.burn = new BurnableBinding(actionEntity(model, 'flower'), {
        propagator: 'small', burnTime: 10, fxLevel: 2,
        onIgnite: () => { flower.persists = false; },
        onExtinguish: () => { flower.persists = true; },
        onBurnt: () => {
          this.burning!.worldEvents.emit('spawnAsh', model.position.clone());
          this.removeFlower(flower);
        },
      }, { scheduler: this.burning.scheduler, root: this.world.scene, fire: this.fireFx });
    }
    return flower;
  }

  private bindActivity(flower: PlantedFlower): void {
    flower.stopActivity = watchTileActivity(flower.model, this.world.tickingarea, active => {
      flower.instance.setActive(active);
      flower.burn?.setActive(active);
    });
  }

  private removeFlower(flower: PlantedFlower): void {
    if (this.flowers.get(flower.id) !== flower) return;
    this.flowers.delete(flower.id);
    this.flowerList = undefined;
    flower.stopActivity?.();
    flower.pickable.dispose();
    flower.burn?.dispose();
    flower.model.userData.removed = true;
    flower.instance.remove(); flower.display.dispose();
  }

}

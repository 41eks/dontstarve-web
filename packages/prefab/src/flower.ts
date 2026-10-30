import * as THREE from 'three';
import { watchTileActivity } from './tileActivity';
import { newEntityId } from './saveRecord';
import type { WorldContext, WorldEventEmitter } from './worldContext';
import { actionEntity, findActionEntity } from './actionEntity';
import { BurnableBinding, FireFxHost } from './treeFire';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Pickable } from './components/pickable';
import { TILE_SIZE } from './tile';
import type { ReadonlySignal, SeasonState } from '@dontstarve-web/signals';
import { SpriteResources, type ArchiveSpriteCommands, type PrefabDisplay } from '@dontstarve-web/display';
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
  private readonly resources = new SpriteResources();
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
    this.resources.dispose();
  }

  update(_cameraQuaternion: THREE.Quaternion, dt = 0): void {
    if (this.ownsScheduler) this.scheduler.advance(dt);
    for (const { instance, burn } of this.flowers.values()) {
      if (instance.sprite.loaded) instance.sprite.update(dt);
      burn?.update(dt);
    }
  }

  /** The planted `flower`-tagged entities (butterflybrain FLOWER_TAGS), rebuilt only when one is planted or removed. */
  get plantedFlowers(): readonly { readonly id: string; readonly position: THREE.Vector3 }[] {
    // Planted models are direct scene children, so their position is the world position.
    return this.flowerList ??= [...this.flowers.values()].map(({ id, model }) => ({ id, position: model.position }));
  }

  get renderEntities() {
    const models = [...this.flowers.values()].filter(({ instance }) => instance.sprite.loaded).map(({ model }) => model);
    return [...models.map((object) => ({ object, footPosition: object.position, cameraDepth: 0 })),
      ...[...this.flowers.values()].flatMap(({ display }) => display.fxRenderEntries)];
  }

  exportRecords(): FlowerSaveRecord[] {
    return [...this.flowers.values()].filter(({ persists }) => persists).map(({ id, model, animation }) => ({
      id, transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
      components: { flower: { animation, ...(model.userData.planted ? { planted: true as const } : {}) } },
    }));
  }

  spawnFromSave(id: string, animation: FlowerAnimation, position: THREE.Vector3, planted = true): THREE.Group {
    if (this.disposed) throw new Error('Flower planting has been disposed');
    return this.addFlower(this.createFlower(id, animation, position, planted));
  }

  /** butterfly.lua OnDeploy: SpawnPrefab("flower") with its random f1–f10/rose, then growfrombutterfly; the display loads the art. */
  transplant(position: THREE.Vector3): boolean {
    if (this.disposed) return false;
    const animation = this.random() < .01 ? 'rose' : FLOWER_ANIMATIONS[Math.floor(this.random() * 10)];
    const flower = this.createFlower(newEntityId(), animation, position);
    findActionEntity(this.addFlower(flower))!.PushEvent?.('growfrombutterfly', undefined);
    return true;
  }

  private addFlower(flower: PlantedFlower): THREE.Group {
    this.flowers.set(flower.id, flower);
    this.flowerList = undefined;
    this.world.scene.add(flower.model);
    this.bindActivity(flower);
    return flower.model;
  }

  private createFlower(id: string, animation: FlowerAnimation, position: THREE.Vector3, planted = true): PlantedFlower {
    const { instance, display } = createArchiveEntity('flower', this.resources.archive({ animationArchive: 'flowers.zip',
      buildArchives: ['flowers.zip'], bank: 'flowers' }, { instancedAnimations: 'all', staticBillboard: true }),
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
    if (this.burning) {
      this.fireFx ??= FireFxHost.create(`${import.meta.env.BASE_URL}dst/data/anim`);
      flower.burn = new BurnableBinding(actionEntity(model, 'flower'), {
        propagator: 'small', burnTime: 10, fxLevel: 2,
        onIgnite: () => { flower.persists = false; },
        onExtinguish: () => { flower.persists = true; },
        onBurnt: () => {
          this.burning!.worldEvents.emit('spawnAsh', model.position.clone());
          this.removeFlower(flower);
        },
      }, { scheduler: this.burning.scheduler, fire: this.fireFx });
    }
    return flower;
  }

  private bindActivity(flower: PlantedFlower): void {
    flower.stopActivity = watchTileActivity(flower.model, this.world.tickingarea, active => {
      flower.instance.setActive(active);
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

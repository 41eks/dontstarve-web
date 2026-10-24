import * as THREE from 'three';
import {
  createAnimatedSpriteFactory,
  type AnimatedSpriteFactory,
} from '@dontstarve-web/animation/sprite';
import { newEntityId } from './saveRecord';
import type { WorldContext, WorldEventEmitter } from './worldContext';
import { actionEntity } from './actionEntity';
import { BurnableBinding, FireFxHost } from './treeFire';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Pickable } from './components/pickable';
import { TILE_SIZE } from './tile';
import type { ReadonlySignal, SeasonState } from '@dontstarve-web/signals';

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
  components: { flower: { animation: FlowerAnimation; planted: true } };
}

interface PlantedFlower {
  id: string;
  model: THREE.Group;
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
  private factory?: Promise<AnimatedSpriteFactory>;
  private readyFactory?: AnimatedSpriteFactory;
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
    if (this.readyFactory) this.readyFactory.dispose();
    else if (this.factory) void this.factory.then((factory) => factory.dispose(), () => undefined);
  }

  update(cameraQuaternion: THREE.Quaternion, dt = 0): void {
    this.fireFx?.update(dt, cameraQuaternion);
    for (const { model } of this.flowers.values()) model.quaternion.copy(cameraQuaternion);
  }

  /** The planted `flower`-tagged entities (butterflybrain FLOWER_TAGS), rebuilt only when one is planted or removed. */
  get plantedFlowers(): readonly { readonly id: string; readonly position: THREE.Vector3 }[] {
    // Planted models are direct scene children, so their position is the world position.
    return this.flowerList ??= [...this.flowers.values()].map(({ id, model }) => ({ id, position: model.position }));
  }

  get renderEntities() {
    const models = [...this.flowers.values()].map(({ model }) => model);
    return [...models.map((object) => ({ object, footPosition: object.position, cameraDepth: 0 })),
      ...(this.fireFx?.renderEntities ?? [])];
  }

  exportRecords(): FlowerSaveRecord[] {
    return [...this.flowers.values()].filter(({ persists }) => persists).map(({ id, model, animation }) => ({
      id, transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
      components: { flower: { animation, planted: true } },
    }));
  }

  async spawnFromSave(id: string, animation: FlowerAnimation, position: THREE.Vector3): Promise<THREE.Group> {
    const factory = await this.loadFactory();
    if (this.disposed) throw new Error('Flower planting has been disposed');
    const flower = this.createFlower(factory, id, animation, position);
    this.flowers.set(id, flower);
    this.flowerList = undefined;
    this.world.scene.add(flower.model);
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
        flower.model.userData.actionEntity.PushEvent('growfrombutterfly', undefined);
        return true;
      },
    };
  }

  private loadFactory(): Promise<AnimatedSpriteFactory> {
    if (this.disposed) return Promise.reject(new Error('Flower planting has been disposed'));
    if (!this.factory) {
      const baseUrl = `${import.meta.env.BASE_URL}dst/data/anim`;
      this.factory = Promise.all([
        createAnimatedSpriteFactory(baseUrl, 'flowers.zip'),
        this.burning ? FireFxHost.load(baseUrl) : undefined,
      ]).then(([factory, fireFx]) => {
        this.readyFactory = factory;
        this.fireFx = fireFx;
        return factory;
      });
      void this.factory.catch(() => { this.factory = undefined; });
    }
    return this.factory;
  }

  private createFlower(factory: AnimatedSpriteFactory, id: string, animation: FlowerAnimation, position: THREE.Vector3): PlantedFlower {
    const model = factory.create({ initialAnimation: animation, name: 'Flower' });
    model.position.set(position.x, 0, position.z);
    model.quaternion.copy(this.world.camera.getWorldQuaternion(new THREE.Quaternion()));
    Object.assign(model.userData, {
      entityId: id, prefab: 'flower', planted: true, flowerAnimation: animation,
      deploySmartRadius: .375 * (TILE_SIZE / 4),
      tags: ['flower', 'cattoy', ...(animation === 'rose' ? ['thorny'] : [])],
    });
    const pickable: Pickable = new Pickable(model, 'petals', 10, 1, doer => {
      const picker = doer.picker;
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
    const flower: PlantedFlower = { id, model, animation, pickable, persists: true };
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

  private removeFlower(flower: PlantedFlower): void {
    if (this.flowers.get(flower.id) !== flower) return;
    this.flowers.delete(flower.id);
    this.flowerList = undefined;
    flower.pickable.dispose();
    flower.burn?.dispose();
    flower.model.userData.removed = true;
    flower.model.removeFromParent();
    this.readyFactory?.disposeSprite(flower.model);
  }

}

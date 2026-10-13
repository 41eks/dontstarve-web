import * as THREE from 'three';
import {
  createAnimatedSpriteFactory,
  type AnimatedSpriteFactory,
} from '@dontstarve-web/animation/sprite';
import { BuildCursor } from './buildCursor';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import { newEntityId } from './saveRecord';
import type { WorldContext } from './worldContext';
import { bindActionCancellation } from '@dontstarve-web/stategraphs/actionEvents';
import type { MoonTreeForest } from './moontree';
import { actionEntity } from './actionEntity';
import { BurnableBinding, FireFxHost } from './treeFire';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { ReadonlySignal, SeasonState } from '@dontstarve-web/signals';

/** flower.lua MakeSmallBurnable + MakeSmallPropagator; the scene's game-time scheduler drives them. */
export interface FlowerBurningWorld {
  scheduler: GameTimeScheduler;
  season?: ReadonlySignal<SeasonState>;
  /** DefaultBurntFn: one ash at the burnt flower's position. */
  spawnAsh(position: THREE.Vector3): void;
}

export interface ButterflyPlantingWorld {
  forest: MoonTreeForest;
  canPlant(position: THREE.Vector3): boolean;
  getBlockers(): readonly { position: THREE.Vector3; tags?: readonly string[]; smartRadius?: number; inventoryRadius?: number }[];
}

// flower.lua chooses f1–f10, with a 1% chance of rose. butterfly.lua's placer
// uses f1; OnDeploy consumes one butterfly and spawns a planted flower.
export const FLOWER_ANIMATIONS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'rose'] as const;
export type FlowerAnimation = typeof FLOWER_ANIMATIONS[number];
export interface FlowerSaveRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { flower: { animation: FlowerAnimation; planted: true } };
}

interface PlantedFlower {
  id: string;
  model: THREE.Group;
  animation: FlowerAnimation;
  burn?: BurnableBinding;
  /** DefaultBurnFn clears persists while burning; DefaultExtinguishFn restores it. */
  persists: boolean;
}

/** Owns the butterfly deploy action and persistent flower entities. */
export class FlowerPlanting {
  private readonly world: WorldContext;
  private readonly pointer: PointerRaycaster;
  private readonly cursor: BuildCursor;
  private readonly assetBaseUrl: string;
  private readonly random: () => number;
  private readonly onPlant?: () => void;
  private readonly flowers = new Map<string, PlantedFlower>();
  private factory?: Promise<AnimatedSpriteFactory>;
  private readyFactory?: AnimatedSpriteFactory;
  private fireFx?: FireFxHost;
  private readonly burning?: FlowerBurningWorld;
  private preview?: THREE.Group;
  private previewMaterials: THREE.Material[] = [];
  private takeButterfly?: () => boolean;
  private previewVersion = 0;
  private disposed = false;
  private itemId: 'butterfly' | 'moonbutterfly' = 'butterfly';
  private readonly plantingWorld?: ButterflyPlantingWorld;
  private readonly stopActionEvents: () => void;

  constructor(world: WorldContext, assetBaseUrl: string, onPlant?: () => void, random = Math.random,
    plantingWorld?: ButterflyPlantingWorld, burning?: FlowerBurningWorld) {
    this.plantingWorld = plantingWorld;
    this.burning = burning;
    this.world = world;
    this.assetBaseUrl = assetBaseUrl;
    this.random = random;
    this.onPlant = onPlant;
    this.stopActionEvents = bindActionCancellation(world, this, 'flower', () => this.cancel());
    this.pointer = new PointerRaycaster(world);
    this.cursor = new BuildCursor(world, this.pointer);
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  async begin(takeButterfly: () => boolean, itemId: 'butterfly' | 'moonbutterfly' = 'butterfly'): Promise<void> {
    if (this.disposed) throw new Error('Flower planting has been disposed');
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'FLOWER_PLANT' });
    const version = this.previewVersion;
    this.takeButterfly = takeButterfly;
    this.itemId = itemId;
    this.cursor.show(itemId === 'moonbutterfly' ? ': 种植月树（Esc 取消）' : ': 种植花朵（Esc 取消）', 'right');
    try {
      const factory = itemId === 'butterfly' ? await this.loadFactory() : undefined;
      if (version !== this.previewVersion) return;
      const preview = factory ? factory.create({ initialAnimation: 'f1', name: 'FlowerPlacer' })
        : this.plantingWorld!.forest.createSaplingPreview();
      preview.userData.placer = true;
      // Preview opacity must not change the shared materials of planted flowers.
      preview.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const clone = (material: THREE.Material) => {
          const copy = material.clone();
          copy.opacity = 0.65;
          this.previewMaterials.push(copy);
          return copy;
        };
        object.material = Array.isArray(object.material) ? object.material.map(clone) : clone(object.material);
      });
      this.preview = preview;
      this.world.scene.add(preview);
      // Keep the original DST origin, rather than moving the sprite's bounds.
      this.cursor.setPreview(preview, 0);
      this.cursor.update();
    } catch (error) {
      if (version === this.previewVersion) this.cancel();
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopActionEvents();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.pointer.dispose();
    this.cancel();
    for (const flower of [...this.flowers.values()]) this.removeFlower(flower);
    this.fireFx?.dispose();
    if (this.readyFactory) this.readyFactory.dispose();
    else if (this.factory) void this.factory.then((factory) => factory.dispose(), () => undefined);
  }

  cancel(): void {
    this.previewVersion++;
    this.takeButterfly = undefined;
    this.cursor.hide();
    const preview = this.preview;
    if (preview) {
      if (this.itemId === 'moonbutterfly') this.plantingWorld!.forest.disposeSaplingPreview(preview);
      else this.readyFactory!.disposeSprite(preview);
    }
    this.preview = undefined;
    this.previewMaterials.forEach((material) => material.dispose());
    this.previewMaterials = [];
  }

  update(cameraQuaternion: THREE.Quaternion, dt = 0): void {
    this.cursor.update();
    this.fireFx?.update(dt, cameraQuaternion);
    for (const { model } of this.flowers.values()) model.quaternion.copy(cameraQuaternion);
  }

  get renderEntities() {
    const models = [...this.flowers.values()].map(({ model }) => model);
    if (this.preview?.visible) models.push(this.preview);
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
    this.world.scene.add(flower.model);
    return flower.model;
  }

  private loadFactory(): Promise<AnimatedSpriteFactory> {
    if (this.disposed) return Promise.reject(new Error('Flower planting has been disposed'));
    if (!this.factory) {
      this.factory = Promise.all([
        createAnimatedSpriteFactory(this.assetBaseUrl, 'flowers.zip'),
        this.burning ? FireFxHost.load(this.assetBaseUrl) : undefined,
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
      deploySmartRadius: .375,
      tags: ['flower', 'cattoy', ...(animation === 'rose' ? ['thorny'] : [])],
    });
    const flower: PlantedFlower = { id, model, animation, persists: true };
    if (this.burning && this.fireFx) {
      flower.burn = new BurnableBinding(actionEntity(model, 'flower'), {
        propagator: 'small', burnTime: 10, fxLevel: 2,
        onIgnite: () => { flower.persists = false; },
        onExtinguish: () => { flower.persists = true; },
        onBurnt: () => {
          this.burning!.spawnAsh(model.position.clone());
          this.removeFlower(flower);
        },
      }, { scheduler: this.burning.scheduler, root: this.world.scene, fire: this.fireFx,
        season: this.burning.season ?? this.world.season });
    }
    return flower;
  }

  private removeFlower(flower: PlantedFlower): void {
    if (this.flowers.get(flower.id) !== flower) return;
    this.flowers.delete(flower.id);
    flower.burn?.dispose();
    flower.model.userData.removed = true;
    flower.model.removeFromParent();
    this.readyFactory?.disposeSprite(flower.model);
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 2 || event.defaultPrevented || !this.takeButterfly) return;
    event.preventDefault();
    if (!this.preview) return;
    this.pointer.trackPointer(event);
    const position = this.pointer.groundPoint();
    if (!position) return;
    if (this.itemId === 'moonbutterfly') {
      const planting = this.plantingWorld!;
      if (!planting.canPlant(position)) return;
      const blockers: ReturnType<ButterflyPlantingWorld['getBlockers']> = [...planting.getBlockers(), ...planting.forest.entities.map(entity => ({ position: entity.position, smartRadius: 1.6 })),
        ...planting.forest.saplingPositions.map(position => ({ position, smartRadius: 1.6 }))];
      if (blockers.some(blocker => {
        if (blocker.tags?.some(tag => ['NOBLOCK', 'player', 'FX', 'INLIMBO', 'DECOR', 'walkableplatform', 'walkableperipheral', 'isdead'].includes(tag))) return false;
        const radius = blocker.smartRadius !== undefined ? blocker.smartRadius + 1.6
          : blocker.inventoryRadius !== undefined ? Math.min(3.2, blocker.inventoryRadius + 1.6) : 3.2;
        return blocker.position.distanceToSquared(position) < radius ** 2;
      })) return;
      planting.forest.deploySapling(position, this.takeButterfly);
      this.cancel();
      return;
    }
    // DEPLOYSPACING.LESS is .75; flowers use half this as their smart radius.
    if ([...this.flowers.values()].some(({ model }) =>
      model.position.distanceToSquared(position) < 0.75 ** 2)) return;
    const takeButterfly = this.takeButterfly;
    const factory = this.readyFactory!;
    const animation = this.random() < 0.01 ? 'rose' : FLOWER_ANIMATIONS[Math.floor(this.random() * 10)];
    const flower = this.createFlower(factory, newEntityId(), animation, position);
    let taken: boolean;
    try {
      taken = takeButterfly();
    } catch (error) {
      factory.disposeSprite(flower.model);
      this.cancel();
      throw error;
    }
    if (!taken) {
      factory.disposeSprite(flower.model);
      this.cancel();
      return;
    }
    this.flowers.set(flower.id, flower);
    this.world.scene.add(flower.model);
    this.cancel();
    this.onPlant?.();
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') this.cancel();
  };
}

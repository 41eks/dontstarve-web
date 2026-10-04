import * as THREE from 'three';
import {
  createAnimatedSpriteFactory,
  type AnimatedSpriteFactory,
} from '@three-roaming/animation/sprite';
import { BuildCursor } from './buildCursor';
import { PointerRaycaster } from './pointerRaycaster';
import { newEntityId } from './saveRecord';
import type { WorldContext } from './worldContext';

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
  private preview?: THREE.Group;
  private previewMaterials: THREE.Material[] = [];
  private takeButterfly?: () => boolean;
  private previewVersion = 0;
  private disposed = false;

  constructor(world: WorldContext, assetBaseUrl: string, onPlant?: () => void, random = Math.random) {
    this.world = world;
    this.assetBaseUrl = assetBaseUrl;
    this.random = random;
    this.onPlant = onPlant;
    this.pointer = new PointerRaycaster(world);
    this.cursor = new BuildCursor(world, this.pointer);
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  async begin(takeButterfly: () => boolean): Promise<void> {
    if (this.disposed) throw new Error('Flower planting has been disposed');
    this.cancel();
    const version = this.previewVersion;
    this.takeButterfly = takeButterfly;
    this.cursor.show(': 种植花朵（Esc 取消）', 'right');
    try {
      const factory = await this.loadFactory();
      if (version !== this.previewVersion) return;
      const preview = factory.create({ initialAnimation: 'f1', name: 'FlowerPlacer' });
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
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.pointer.dispose();
    this.cancel();
    this.flowers.clear();
    if (this.readyFactory) this.readyFactory.dispose();
    else if (this.factory) void this.factory.then((factory) => factory.dispose(), () => undefined);
  }

  cancel(): void {
    this.previewVersion++;
    this.takeButterfly = undefined;
    this.cursor.hide();
    const preview = this.preview;
    if (preview) this.readyFactory!.disposeSprite(preview);
    this.preview = undefined;
    this.previewMaterials.forEach((material) => material.dispose());
    this.previewMaterials = [];
  }

  update(cameraQuaternion: THREE.Quaternion): void {
    this.cursor.update();
    for (const { model } of this.flowers.values()) model.quaternion.copy(cameraQuaternion);
  }

  get renderEntities() {
    const models = [...this.flowers.values()].map(({ model }) => model);
    if (this.preview?.visible) models.push(this.preview);
    return models.map((object) => ({ object, footPosition: object.position.clone().setY(0), cameraDepth: 0 }));
  }

  exportRecords(): FlowerSaveRecord[] {
    return [...this.flowers.values()].map(({ id, model, animation }) => ({
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
      this.factory = createAnimatedSpriteFactory(this.assetBaseUrl, 'flowers.zip').then((factory) => {
        this.readyFactory = factory;
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
      tags: ['flower', 'cattoy', ...(animation === 'rose' ? ['thorny'] : [])],
    });
    return { id, model, animation };
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 2 || event.defaultPrevented || !this.takeButterfly) return;
    event.preventDefault();
    if (!this.preview) return;
    this.pointer.trackPointer(event);
    const position = this.pointer.groundPoint();
    if (!position) return;
    // DEPLOYSPACING.LESS is .75; flowers use half this as their smart radius.
    if ([...this.flowers.values()].some(({ model }) =>
      (model.position.x - position.x) ** 2 + (model.position.z - position.z) ** 2 < 0.75 ** 2)) return;
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

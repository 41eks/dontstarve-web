import { loadImageAtlas, type ImageAtlas } from '@three-roaming/animation/imageAtlas';
import * as THREE from 'three';
import { registerSpriteRenderGroup } from '@three-roaming/animation/renderOrder';
import { createHatGroundSprite, HatEquipmentAssets, isHatId, HAT_DEFINITIONS } from '@three-roaming/prefab/hats';
import { nextReskin, type ReskinTarget } from '@three-roaming/prefab/reskin_tool';
import { createGroundItemSprite, GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '@three-roaming/prefab/groundItems';
import { newEntityId } from '@three-roaming/prefab/saveRecord';
import { createLanternGroundSprite } from '@three-roaming/prefab/lantern';
import { createLightbulbGroundSprite } from '@three-roaming/prefab/lightbulb';
import { ButterflyAssets, type ButterflyController, type ButterflyWorld } from '@three-roaming/prefab/butterfly';
import type { NetCaptureTarget } from '@three-roaming/prefab/bugnet';
import { FirefliesAssets, type FirefliesWorld } from '@three-roaming/prefab/fireflies';
import { intersectSpriteEntities } from '@three-roaming/prefab/pointerRaycaster';
import type { SavedEntity } from './save/types';

const DEFAULT_ATLAS = 'images/inventoryimages.xml';
const ITEM_HEIGHT = 4;

export interface GroundItemDefinition {
  itemId: string;
  skinId?: string;
  name: string;
  icon: string;
  atlas?: string;
  count: number;
}

interface GroundItemVisual {
  model: THREE.Group;
  update?(dt: number): void;
  isRemoved?(): boolean;
  onPlaced?(dropped: boolean): void;
  isClickable?(): boolean;
  isWorkable?(): boolean;
  dispose(): void;
}

interface GroundItemRecord extends GroundItemVisual {
  id: string;
  definition: GroundItemDefinition;
  footPosition: THREE.Vector3;
}

export class GroundItemManager {
  private readonly atlasRequests = new Map<string, Promise<ImageAtlas>>();
  private readonly archiveUrl: string;
  private readonly camera: THREE.Camera;
  private readonly items = new Map<THREE.Group, GroundItemRecord>();
  private readonly hatAssets: HatEquipmentAssets;
  private readonly groundAssets: GroundItemAssets;
  private readonly butterflyAssets: ButterflyAssets;
  private readonly butterflyWorld: ButterflyWorld;
  private readonly firefliesAssets: FirefliesAssets;
  private readonly firefliesWorld: FirefliesWorld;
  private readonly onPickup: (item: GroundItemDefinition, action: 'pickup' | 'net') => boolean;
  private onNetCapture?: (target: NetCaptureTarget) => boolean;
  private readonly pointer = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    archiveUrl: string,
    onPickup: (item: GroundItemDefinition, action: 'pickup' | 'net') => boolean,
    animationBaseUrl: string,
    butterflyWorld: ButterflyWorld = { isDay: () => true, getThreatPositions: () => [], getFlowers: () => [] },
    firefliesWorld: FirefliesWorld = { isNight: () => false, getPlayerPositions: () => [] },
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.archiveUrl = archiveUrl;
    this.onPickup = onPickup;
    this.hatAssets = new HatEquipmentAssets(animationBaseUrl);
    this.groundAssets = new GroundItemAssets(animationBaseUrl);
    this.butterflyAssets = new ButterflyAssets(animationBaseUrl);
    this.butterflyWorld = butterflyWorld;
    this.firefliesAssets = new FirefliesAssets(animationBaseUrl);
    this.firefliesWorld = firefliesWorld;
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    for (const item of this.items.values()) item.dispose();
    this.items.clear();
    this.hatAssets.dispose();
    this.groundAssets.dispose();
    this.butterflyAssets.dispose();
    this.firefliesAssets.dispose();
    this.atlasRequests.clear();
  }

  async drop(
    definition: GroundItemDefinition,
    position: THREE.Vector3,
    takeFromInventory: () => boolean,
  ): Promise<boolean> {
    const visuals = await this.createDropVisuals(definition);
    let taken: boolean;
    try {
      taken = takeFromInventory();
    } catch (error) {
      visuals.forEach((visual) => visual.dispose());
      throw error;
    }
    if (!taken) {
      visuals.forEach((visual) => visual.dispose());
      return false;
    }
    for (const visual of visuals) this.addVisual(newEntityId(), this.singleDropDefinition(definition), position, visual, true);
    return true;
  }

  /** Restores an item without removing anything from inventory or playing pickup. */
  async spawnFromSave(
    id: string,
    definition: GroundItemDefinition,
    position: THREE.Vector3,
  ): Promise<THREE.Group> {
    const visuals = await this.createDropVisuals(definition);
    visuals.forEach((visual, index) => this.addVisual(index === 0 ? id : newEntityId(),
      this.singleDropDefinition(definition), position, visual));
    return visuals[0].model;
  }

  private singleDropDefinition(definition: GroundItemDefinition): GroundItemDefinition {
    return { ...definition, count: this.isNetCreature(definition.itemId) ? 1 : definition.count };
  }

  private async createDropVisuals(definition: GroundItemDefinition): Promise<GroundItemVisual[]> {
    if (this.disposed) throw new Error('Ground items have been disposed');
    if (!Number.isSafeInteger(definition.count) || definition.count < 1) throw new RangeError('Invalid ground item count');
    const count = this.isNetCreature(definition.itemId) ? definition.count : 1;
    const visuals: GroundItemVisual[] = [];
    try {
      // Live insects force individual drops from a stack.
      for (let index = 0; index < count; index++) visuals.push(await this.createVisual(this.singleDropDefinition(definition)));
      if (this.disposed) throw new Error('Ground items have been disposed');
      return visuals;
    } catch (error) {
      visuals.forEach((visual) => visual.dispose());
      throw error;
    }
  }

  private addVisual(id: string, definition: GroundItemDefinition, position: THREE.Vector3, visual: GroundItemVisual, dropped = false): void {
    const footPosition = new THREE.Vector3(position.x, dropped ? 0 : position.y, position.z);
    visual.model.position.copy(footPosition);
    visual.model.userData.entityId = id;
    this.items.set(visual.model, { id, definition, footPosition, ...visual });
    this.scene.add(visual.model);
    visual.onPlaced?.(dropped);
  }

  exportRecords(): SavedEntity[] {
    return [...this.items.values()].map(({ id, definition, footPosition }) => ({
      id,
      transform: {
        position: footPosition.toArray(),
        rotationY: 0,
      },
      components: {
        stack: {
          itemId: definition.itemId, count: definition.count,
          ...(definition.skinId === undefined ? {} : { skinId: definition.skinId }),
        },
      },
    }));
  }

  setNetCaptureHandler(handler: (target: NetCaptureTarget) => boolean): void {
    this.onNetCapture = handler;
  }

  get netCaptureTargets(): readonly NetCaptureTarget[] {
    return [...this.items.values()].filter(({ definition }) => this.isNetCreature(definition.itemId))
      .map((record) => this.captureTarget(record));
  }

    get reskinTargets(): readonly ReskinTarget[] {
        return [...this.items.values()].flatMap((record) => {
            const prefabId = record.definition.itemId;
            const skins = Object.keys((isHatId(prefabId) ? HAT_DEFINITIONS[prefabId] : GROUND_ITEM_DEFINITIONS[prefabId])?.skinArchives ?? {});
            if (skins.length === 0) return [];
            const isValid = () => this.items.get(record.model) === record && !record.isRemoved?.();
            return [{
                id: record.id, prefabId, model: record.model, position: record.footPosition, isValid,
                prepareNextSkin: async () => {
                    const skinId = nextReskin(skins, record.definition.skinId);
                    const definition = { ...record.definition };
                    if (skinId === undefined) delete definition.skinId; else definition.skinId = skinId;
                    const visual = await this.createVisual(definition);
                    let used = false;
                    return {
                        apply: () => {
                            if (used || !isValid()) return false;
                            visual.model.position.copy(record.footPosition);
                            visual.model.quaternion.copy(record.model.quaternion);
                            visual.model.userData.entityId = record.id;
                            this.items.delete(record.model);
                            record.dispose();
                            this.items.set(visual.model, { ...record, ...visual, definition });
                            this.scene.add(visual.model);
                            visual.onPlaced?.(false);
                            used = true;
                            return true;
                        },
                        dispose: () => { if (!used) { visual.dispose(); used = true; } },
                    };
                },
            }];
        });
    }

    private isNetCreature(itemId: string): boolean { return itemId === 'butterfly' || itemId === 'fireflies'; }

  private captureTarget(record: GroundItemRecord): NetCaptureTarget {
    const isValid = () => this.items.get(record.model) === record && !record.isRemoved?.() && record.isWorkable?.() !== false;
    return {
      id: record.id, model: record.model, position: record.footPosition, isValid,
      isClickable: () => record.isClickable?.() !== false,
      capture: () => {
        if (!isValid() || !this.onPickup({ ...record.definition }, 'net')) return false;
        this.items.delete(record.model);
        record.dispose();
        return true;
      },
    };
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.defaultPrevented || this.items.size === 0) return;

    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hit = intersectSpriteEntities(this.raycaster, [...this.items.values()]
      .filter(record => record.isClickable?.() !== false).map(record => record.model), true)[0];
    if (!hit) return;
    event.preventDefault();
    let root: THREE.Object3D | null = hit.object;
    while (root && !this.items.has(root as THREE.Group)) root = root.parent;
    const record = root ? this.items.get(root as THREE.Group) : undefined;
    if (!record) return;
    if (this.isNetCreature(record.definition.itemId)) {
      this.onNetCapture?.(this.captureTarget(record));
      return;
    }
    if (!this.onPickup(record.definition, 'pickup')) return;

    this.items.delete(record.model);
    record.dispose();
  };

  get renderEntities(): readonly { object: THREE.Group; footPosition: THREE.Vector3; cameraDepth: number }[] {
    return [...this.items.values()].map(({ model, footPosition }) => ({
      object: model, footPosition, cameraDepth: 0,
    }));
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    for (const item of this.items.values()) {
      item.model.quaternion.copy(cameraQuaternion);
      item.update?.(dt);
      item.footPosition.set(item.model.position.x, 0, item.model.position.z);
      if (item.isRemoved?.()) {
        this.items.delete(item.model);
        item.dispose();
      }
    }
  }

  private async createVisual(definition: GroundItemDefinition): Promise<GroundItemVisual> {
    if (definition.itemId === 'fireflies') {
      const visual = await this.firefliesAssets.create(this.firefliesWorld);
      visual.model.userData.count = 1;
      return visual;
    }
    if (definition.itemId === 'butterfly') {
      let model: THREE.Group | undefined;
      const visual = await this.butterflyAssets.create({
        isDay: () => this.butterflyWorld.isDay(),
        getThreatPositions: () => this.butterflyWorld.getThreatPositions(),
        getFlowers: () => this.butterflyWorld.getFlowers(),
        constrainPosition: (position) => this.butterflyWorld.constrainPosition?.(position),
        isFlowerOccupied: (id) => {
          if (this.butterflyWorld.isFlowerOccupied?.(id)) return true;
          const flower = this.butterflyWorld.getFlowers().find((candidate) => candidate.id === id);
          return flower !== undefined && [...this.items.values()].some((item) => {
            const controller = item.model.userData.butterflyController as ButterflyController | undefined;
            return item.model !== model && controller?.targetFlowerId === id
              && item.footPosition.distanceToSquared(flower.position) < 4;
          });
        },
      });
      model = visual.model;
      model.userData.count = 1;
      return { ...visual, isRemoved: () => visual.controller.removed };
    }
    if (definition.itemId === 'lightbulb') {
      const visual = await createLightbulbGroundSprite(this.groundAssets, { skinId: definition.skinId });
      visual.model.userData.count = definition.count;
      return visual;
    }
    if (definition.itemId === 'lantern') {
      const visual = await createLanternGroundSprite(this.groundAssets, { skinId: definition.skinId });
      visual.model.userData.count = definition.count;
      return visual;
    }
    if (isHatId(definition.itemId)) {
      const visual = await createHatGroundSprite(this.hatAssets, definition.itemId, definition.skinId);
      Object.assign(visual.model.userData, {
        itemId: definition.itemId, skinId: definition.skinId, count: definition.count,
      });
      return visual;
    }
    if (GROUND_ITEM_DEFINITIONS[definition.itemId]) {
      const visual = await createGroundItemSprite(this.groundAssets, definition.itemId, definition.skinId);
      visual.model.userData.count = definition.count;
      return visual;
    }
    const atlasPath = definition.atlas ?? DEFAULT_ATLAS;
    let atlasRequest = this.atlasRequests.get(atlasPath);
    if (!atlasRequest) {
      atlasRequest = loadImageAtlas(this.archiveUrl, atlasPath);
      this.atlasRequests.set(atlasPath, atlasRequest);
      void atlasRequest.catch(() => this.atlasRequests.delete(atlasPath));
    }
    const image = (await atlasRequest).require(definition.icon);
    const texture = new THREE.DataTexture(
      Uint8Array.from(image.pixels),
      image.width,
      image.height,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = true;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.01,
      toneMapped: false,
    }));
    sprite.name = `GroundItem:${definition.itemId}`;
    sprite.scale.set(ITEM_HEIGHT * image.width / image.height, ITEM_HEIGHT, 1);
    sprite.userData.itemId = definition.itemId;
    sprite.userData.skinId = definition.skinId;
    sprite.userData.count = definition.count;
    sprite.position.y = ITEM_HEIGHT / 2;
    const model = new THREE.Group();
    model.name = sprite.name;
    Object.assign(model.userData, sprite.userData);
    const visual = new THREE.Group();
    visual.add(sprite);
    model.add(visual);
    registerSpriteRenderGroup(model, visual);
    return {
      model,
      dispose() {
        model.removeFromParent();
        sprite.material.map?.dispose();
        sprite.material.dispose();
      },
    };
  }
}

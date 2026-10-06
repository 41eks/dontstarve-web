import { loadImageAtlas, type ImageAtlas } from '@dontstarve-web/animation/imageAtlas';
import * as THREE from 'three';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import { isHatId, HAT_DEFINITIONS } from '@dontstarve-web/prefab/hats';
import { nextReskin, type ReskinTarget } from '@dontstarve-web/prefab/reskin_tool';
import { GROUND_ITEM_DEFINITIONS } from '@dontstarve-web/prefab/groundItems';
import { newEntityId } from '@dontstarve-web/prefab/saveRecord';
import type { BernieWorld } from '@dontstarve-web/prefab/bernie';
import type { ButterflyWorld } from '@dontstarve-web/prefab/butterfly';
import { GroundPrefabRegistry } from '@dontstarve-web/prefab/groundPrefabRegistry';
import type { GroundItemDefinition, GroundItemVisual } from '@dontstarve-web/prefab/groundPrefab';
import type { NetCaptureTarget } from '@dontstarve-web/prefab/bugnet';
import type { FirefliesWorld } from '@dontstarve-web/prefab/fireflies';
import { intersectSpriteEntities } from '@dontstarve-web/prefab/pointerRaycaster';
import { isPlayerNearby } from '@dontstarve-web/prefab/playerProximity';
import type { SavedEntity } from './save/types';

export type { GroundItemDefinition } from '@dontstarve-web/prefab/groundPrefab';

const DEFAULT_ATLAS = 'images/inventoryimages.xml';
const ITEM_HEIGHT = 4;

interface GroundItemRecord extends GroundItemVisual {
  id: string;
  definition: GroundItemDefinition;
  footPosition: THREE.Vector3;
  isPlayerNearby: boolean;
}

export class GroundItemManager {
  private readonly atlasRequests = new Map<string, Promise<ImageAtlas>>();
  private readonly archiveUrl: string;
  private readonly camera: THREE.Camera;
  private readonly prefabs: GroundPrefabRegistry;
  private readonly items = new Map<THREE.Group, GroundItemRecord>();
  private readonly onPickup: (item: GroundItemDefinition, action: 'pickup' | 'net', sourcePosition: THREE.Vector3) => boolean;
  private onNetCapture?: (target: NetCaptureTarget) => boolean;
  private readonly pointer = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly player: THREE.Object3D;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    archiveUrl: string,
    onPickup: (item: GroundItemDefinition, action: 'pickup' | 'net', sourcePosition: THREE.Vector3) => boolean,
    animationBaseUrl: string,
    player: THREE.Object3D,
    butterflyWorld: ButterflyWorld = { isDay: () => true, getThreatPositions: () => [], getFlowers: () => [] },
    firefliesWorld: FirefliesWorld = { isNight: () => false, getPlayerPositions: () => [] },
    bernieWorld: BernieWorld = { getSanityPercent: () => 1 },
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.archiveUrl = archiveUrl;
    this.onPickup = onPickup;
    this.player = player;
    this.prefabs = new GroundPrefabRegistry({
      animationBaseUrl, butterflyWorld, firefliesWorld, bernieWorld,
      getNeighbours: () => [...this.items.values()]
        .map(({ model, footPosition }) => ({ model, position: footPosition })),
    });
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    for (const item of this.items.values()) item.dispose();
    this.items.clear();
    this.atlasRequests.clear();
    this.prefabs.dispose();
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
    const record = { id, definition, footPosition, isPlayerNearby: false, ...visual };
    this.updateProximity(record);
    this.items.set(visual.model, record);
    this.scene.add(visual.model);
    visual.model.dispatchEvent({ type: dropped ? 'ondropped' : 'onload' });
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
                            visual.model.dispatchEvent({ type: 'onload' });
                            used = true;
                            return true;
                        },
                        dispose: () => { if (!used) { visual.dispose(); used = true; } },
                    };
                },
            }];
        });
    }

    private isNetCreature(itemId: string): boolean { return this.prefabs.get(itemId)?.capture === 'net'; }

  private captureTarget(record: GroundItemRecord): NetCaptureTarget {
    const isValid = () => this.items.get(record.model) === record && !record.isRemoved?.() && record.isWorkable?.() !== false;
    return {
      id: record.id, model: record.model, position: record.footPosition, isValid,
      isClickable: () => record.isClickable?.() !== false,
      capture: () => {
        return isValid() && this.putInInventory(record, 'net');
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
    this.putInInventory(record, 'pickup');
  };

  private putInInventory(record: GroundItemRecord, action: 'pickup' | 'net'): boolean {
    if (action === 'pickup') {
      this.updateProximity(record);
      if (!record.isPlayerNearby) return false;
    }
    if (!this.onPickup({ ...record.definition }, action, record.footPosition.clone())) return false;
    try {
      record.model.dispatchEvent({ type: 'onputininventory' });
    } finally {
      this.items.delete(record.model);
      record.dispose();
    }
    return true;
  }

  get renderEntities(): readonly { object: THREE.Group; footPosition: THREE.Vector3; cameraDepth: number }[] {
    return [...this.items.values()].map(({ model, footPosition }) => ({
      object: model, footPosition, cameraDepth: 0,
    }));
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    for (const item of this.items.values()) {
      item.model.quaternion.copy(cameraQuaternion);
      item.update?.(dt);
      item.footPosition.copy(item.model.position);
      this.updateProximity(item);
      if (item.isRemoved?.()) {
        this.items.delete(item.model);
        item.dispose();
      }
    }
  }

  private updateProximity(record: GroundItemRecord): void {
    record.isPlayerNearby = isPlayerNearby(this.player.position, record.footPosition, record.isPlayerNearby);
  }

  private async createVisual(definition: GroundItemDefinition): Promise<GroundItemVisual> {
    const factory = this.prefabs.get(definition.itemId);
    const visual = await (factory ? factory.create(definition) : this.createIconVisual(definition));
    Object.assign(visual.model.userData, {
      itemId: definition.itemId, skinId: definition.skinId, count: definition.count,
    });
    return visual;
  }

  private async createIconVisual(definition: GroundItemDefinition): Promise<GroundItemVisual> {
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

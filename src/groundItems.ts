import { loadImageAtlas, type ImageAtlas } from '@three-roaming/animation/imageAtlas';
import * as THREE from 'three';
import { registerSpriteRenderGroup } from '@three-roaming/animation/renderOrder';
import { createHatGroundSprite, HatEquipmentAssets, isHatId } from '@three-roaming/prefab/hats';
import { createGroundItemSprite, GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '@three-roaming/prefab/groundItems';
import { newEntityId } from '@three-roaming/prefab/saveRecord';
import { createLanternGroundSprite } from '@three-roaming/prefab/lantern';
import { createLightbulbGroundSprite } from '@three-roaming/prefab/lightbulb';
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
  private readonly onPickup: (item: GroundItemDefinition) => boolean;
  private readonly pointer = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    archiveUrl: string,
    onPickup: (item: GroundItemDefinition) => boolean,
    animationBaseUrl: string,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.archiveUrl = archiveUrl;
    this.onPickup = onPickup;
    this.hatAssets = new HatEquipmentAssets(animationBaseUrl);
    this.groundAssets = new GroundItemAssets(animationBaseUrl);
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
  }

  async drop(
    definition: GroundItemDefinition,
    position: THREE.Vector3,
    takeFromInventory: () => boolean,
  ): Promise<boolean> {
    const visual = await this.createVisual(definition);
    if (!takeFromInventory()) {
      visual.dispose();
      return false;
    }

    const footPosition = new THREE.Vector3(position.x, 0, position.z);
    visual.model.position.copy(footPosition);
    const record = { id: newEntityId(), definition: { ...definition }, footPosition, ...visual };
    visual.model.userData.entityId = record.id;
    this.items.set(visual.model, record);
    this.scene.add(visual.model);
    return true;
  }

  /** Restores an item without removing anything from inventory or playing pickup. */
  async spawnFromSave(
    id: string,
    definition: GroundItemDefinition,
    position: THREE.Vector3,
  ): Promise<THREE.Group> {
    const visual = await this.createVisual(definition);
    visual.model.position.copy(position);
    visual.model.userData.entityId = id;
    this.items.set(visual.model, { id, definition: { ...definition }, footPosition: position.clone(), ...visual });
    this.scene.add(visual.model);
    return visual.model;
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

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.defaultPrevented || this.items.size === 0) return;

    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hit = this.raycaster.intersectObjects([...this.items.keys()], true)[0];
    if (!hit) return;
    event.preventDefault();
    let root: THREE.Object3D | null = hit.object;
    while (root && !this.items.has(root as THREE.Group)) root = root.parent;
    const record = root ? this.items.get(root as THREE.Group) : undefined;
    if (!record || !this.onPickup(record.definition)) return;

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
    }
  }

  private async createVisual(definition: GroundItemDefinition): Promise<GroundItemVisual> {
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

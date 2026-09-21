import { loadImageAtlas, type ImageAtlas } from '@three-roaming/wilson/imageAtlas';
import * as THREE from 'three';

const DEFAULT_ATLAS = 'images/inventoryimages.xml';
const ITEM_HEIGHT = 4;

export interface GroundItemDefinition {
  itemId: string;
  name: string;
  icon: string;
  atlas?: string;
  count: number;
}

interface GroundItemRecord {
  definition: GroundItemDefinition;
  sprite: THREE.Sprite;
}

export class GroundItemManager {
  private readonly atlasRequests = new Map<string, Promise<ImageAtlas>>();
  private readonly archiveUrl: string;
  private readonly camera: THREE.Camera;
  private readonly items = new Map<THREE.Sprite, GroundItemRecord>();
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
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.archiveUrl = archiveUrl;
    this.onPickup = onPickup;
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
  }

  async drop(
    definition: GroundItemDefinition,
    position: THREE.Vector3,
    takeFromInventory: () => boolean,
  ): Promise<boolean> {
    const sprite = await this.createSprite(definition);
    if (!takeFromInventory()) {
      this.disposeSprite(sprite);
      return false;
    }

    sprite.position.set(position.x, ITEM_HEIGHT / 2, position.z);
    const record = { definition: { ...definition }, sprite };
    this.items.set(sprite, record);
    this.scene.add(sprite);
    return true;
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || this.items.size === 0) return;

    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hit = this.raycaster.intersectObjects([...this.items.keys()], false)[0];
    if (!hit) return;
    const sprite = hit.object as THREE.Sprite;
    const record = this.items.get(sprite);
    if (!record || !this.onPickup(record.definition)) return;

    this.items.delete(sprite);
    this.scene.remove(sprite);
    this.disposeSprite(sprite);
  };

  private async createSprite(definition: GroundItemDefinition): Promise<THREE.Sprite> {
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
    sprite.userData.count = definition.count;
    return sprite;
  }

  private disposeSprite(sprite: THREE.Sprite): void {
    const material = sprite.material;
    material.map?.dispose();
    material.dispose();
  }
}

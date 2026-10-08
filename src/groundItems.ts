import { ItemEntity, ItemEntityRegistry } from '@dontstarve-web/inventory';
import { loadImageAtlas, type ImageAtlas } from '@dontstarve-web/animation/imageAtlas';
import * as THREE from 'three';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import { isHatId, HAT_DEFINITIONS } from '@dontstarve-web/prefab/hats';
import { nextReskin } from '@dontstarve-web/prefab/reskin_tool';
import { type ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import { GROUND_ITEM_DEFINITIONS } from '@dontstarve-web/prefab/groundItems';
import { newEntityId } from '@dontstarve-web/prefab/saveRecord';
import type { BernieWorld } from '@dontstarve-web/prefab/bernie';
import type { ButterflyWorld } from '@dontstarve-web/prefab/butterfly';
import { GroundPrefabRegistry } from '@dontstarve-web/prefab/groundPrefabRegistry';
import type { GroundItemDefinition, GroundItemVisual } from '@dontstarve-web/prefab/groundPrefab';
import type { NetCaptureTarget } from '@dontstarve-web/stategraphs/bugnet';
import type { FirefliesWorld } from '@dontstarve-web/prefab/fireflies';
import { intersectSpriteEntities } from '@dontstarve-web/stategraphs/pointerRaycaster';
import { isPlayerNearby } from '@dontstarve-web/prefab/playerProximity';
import { LootFling } from '@dontstarve-web/prefab/lootFling';
import { PHONOGRAPH_ID, RECORD_ID, RECORD_SONGS, PhonographController } from '@dontstarve-web/prefab/phonograph';
import type { HammerTarget } from '@dontstarve-web/stategraphs/hammer';
import { PlaySound } from '@dontstarve-web/prefab/sound';
import { createArchiveSprite, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { GroundItemAssets } from '@dontstarve-web/prefab/groundItems';
import type { SavedEntity } from './save/types';

export type { GroundItemDefinition } from '@dontstarve-web/prefab/groundPrefab';

const DEFAULT_ATLAS = 'images/inventoryimages.xml';
const ITEM_HEIGHT = 4;

interface GroundItemRecord extends GroundItemVisual {
  id: string;
  entity: ItemEntity;
  definition: GroundItemDefinition;
  footPosition: THREE.Vector3;
  isPlayerNearby: boolean;
  fling?: LootFling;
}

export class GroundItemManager {
  readonly entities: ItemEntityRegistry;
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
  private readonly effects = new Set<ArchiveSprite>();
  private readonly effectAssets: GroundItemAssets;
  private readonly inserting = new Set<GroundItemRecord>();
  private recordSource?: () => { skinId?: string; take(): boolean } | undefined;

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
    entities = new ItemEntityRegistry(),
  ) {
    this.entities = entities;
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.archiveUrl = archiveUrl;
    this.onPickup = onPickup;
    this.player = player;
    this.effectAssets = new GroundItemAssets(animationBaseUrl);
    this.prefabs = new GroundPrefabRegistry({
      animationBaseUrl, butterflyWorld, firefliesWorld, bernieWorld, inventoryOwnerPosition: player.position,
      getNeighbours: () => [...this.items.values()]
        .map(({ model, footPosition }) => ({ model, position: footPosition })),
    });
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    for (const item of this.items.values()) { this.entities.destroy(item.entity); item.dispose(); }
    for (const effect of this.effects) effect.dispose();
    this.effects.clear();
    this.effectAssets.dispose();
    this.items.clear();
    this.atlasRequests.clear();
    this.prefabs.dispose();
  }

  async drop(
    definition: GroundItemDefinition,
    position: THREE.Vector3,
    takeFromInventory: () => boolean | ItemEntity,
  ): Promise<boolean> {
    const visuals = await this.createDropVisuals(definition);
    let taken: boolean | ItemEntity;
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
    if (taken instanceof ItemEntity) {
      const state = taken.snapshot();
      for (const [index, visual] of visuals.entries()) {
        const count = visuals.length === 1 ? state.count : 1;
        const entity = index === 0 ? taken : this.entities.create({ ...state, entityId: undefined, count });
        if (index === 0 && visuals.length > 1) entity.apply({ ...state, count });
        this.addVisual(entity.id, { ...definition, ...entity.snapshot(), entity }, position, visual, true);
      }
    } else {
      for (const visual of visuals) this.addVisual(newEntityId(), this.singleDropDefinition(definition), position, visual, true);
    }
    return true;
  }

  /** DropLoot spawns each recipe ingredient separately, then FlingItem launches it. */
  async flingLoot(definitions: readonly GroundItemDefinition[], position: THREE.Vector3): Promise<void> {
    if (this.disposed) throw new Error('Ground items have been disposed');
    const origin = position.clone();
    const pieces = definitions.flatMap((definition) => {
      if (!Number.isSafeInteger(definition.count) || definition.count < 1) throw new RangeError('Invalid loot count');
      return Array.from({ length: definition.count }, () => ({ ...definition, count: 1 }));
    });
    // Prepare every piece before launching, so asynchronous asset loads cannot
    // stagger one building's scatter or leave a partially spawned batch.
    const results = await Promise.allSettled(pieces.map((definition) => this.createVisual(definition)));
    const failed = results.find((result) => result.status === 'rejected');
    if (failed || this.disposed) {
      for (const result of results) if (result.status === 'fulfilled') result.value.dispose();
      if (failed?.status === 'rejected') throw failed.reason;
      throw new Error('Ground items have been disposed');
    }
    for (const [index, result] of results.entries()) {
      if (result.status !== 'fulfilled') continue;
      const fling = new LootFling(origin);
      this.addVisual(newEntityId(), pieces[index], fling.position, result.value, true);
      this.items.get(result.value.model)!.fling = fling;
    }
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
    const entity = definition.entity ?? (definition.entityId ? this.entities.get(definition.entityId) : undefined)
      ?? this.entities.create({ ...definition, entityId: id });
    this.entities.adopt(entity);
    definition = { ...definition, ...entity.snapshot(), entity };
    id = entity.id;
    const footPosition = new THREE.Vector3(position.x, dropped ? 0 : position.y, position.z);
    entity.transform.position = footPosition.toArray();
    visual.model.position.copy(footPosition);
    visual.model.userData.entityId = id;
    visual.setDefinition?.(definition);
    const record = { id, entity, definition, footPosition, isPlayerNearby: false, ...visual };
    this.updateProximity(record);
    this.items.set(visual.model, record);
    this.scene.add(visual.model);
    visual.model.dispatchEvent({ type: dropped ? 'ondropped' : 'onload' });
  }

  exportRecords(): SavedEntity[] {
    return [...this.items.values()].flatMap<SavedEntity>((record) => {
      const { id, footPosition } = record;
      const definition = this.currentDefinition(record);
      if (record.entity.isRemoved || record.isRemoved?.()) return [];
      return [{
        id,
        transform: {
          position: footPosition.toArray(),
          rotationY: 0,
        },
        components: {
          stack: {
            itemId: definition.itemId, count: definition.count,
            ...(definition.remainingUses === undefined ? {} : { remainingUses: definition.remainingUses }),
            ...(definition.remainingFuel === undefined ? {} : { remainingFuel: definition.remainingFuel }),
            ...(definition.skinId === undefined ? {} : { skinId: definition.skinId }),
            ...(definition.phonographRecord === undefined ? {} : { phonographRecord: definition.phonographRecord }),
          },
          ...(definition.playbackRemaining === undefined ? {} : { phonograph: { remainingSeconds: definition.playbackRemaining } }),
          ...(definition.torchLit ? { torch: { lit: true as const } } : {}),
        },
      }];
    });
  }

  /** Slot selection supplies one record; the take callback validates and consumes it atomically. */
  setPhonographRecordSource(source: () => { skinId?: string; take(): boolean } | undefined): void {
    this.recordSource = source;
  }

  private currentDefinition(record: GroundItemRecord): GroundItemDefinition {
    record.entity.flush();
    const definition = { ...record.definition, ...record.entity.snapshot(), ...record.getDefinition?.(), entity: record.entity };
    if (!record.entity.isRemoved) record.entity.apply(definition);
    return definition;
  }

  async insertPhonographRecord(model: THREE.Group, source: { skinId?: string; take(): boolean }): Promise<boolean> {
    const record = this.items.get(model);
    const controller = model.userData.phonograph as PhonographController | undefined;
    if (!record || !controller || this.inserting.has(record) || !Object.hasOwn(RECORD_SONGS, source.skinId ?? RECORD_ID)
      || !isPlayerNearby(this.player.position, record.footPosition, false)) return false;
    this.inserting.add(record);
    let ejected: GroundItemVisual | undefined;
    try {
      const oldRecord = controller.record;
      const skinId = oldRecord === RECORD_ID ? undefined : oldRecord;
      const spec = GROUND_ITEM_DEFINITIONS.record;
      const definition = { itemId: RECORD_ID, count: 1, name: spec.name, icon: spec.icon, atlas: spec.atlas,
        ...(skinId ? { skinId } : {}) };
      if (oldRecord) ejected = await this.createVisual(definition);
      if (this.disposed || this.items.get(model) !== record || controller.record !== oldRecord
        || !isPlayerNearby(this.player.position, record.footPosition, false) || !source.take()) return false;
      controller.insert(source.skinId ?? RECORD_ID);
      if (ejected) {
        const fling = new LootFling(record.footPosition);
        this.addVisual(newEntityId(), definition, fling.position, ejected, true);
        this.items.get(ejected.model)!.fling = fling;
        ejected = undefined;
      }
      return true;
    } finally { ejected?.dispose(); this.inserting.delete(record); }
  }

  get hammerTargets(): readonly HammerTarget[] {
    return [...this.items.values()].filter((record) => record.definition.itemId === PHONOGRAPH_ID).map((record) => ({
      id: record.id, model: record.model, position: record.footPosition,
      isValid: () => !this.disposed && this.items.get(record.model) === record && !this.inserting.has(record),
      playHit: () => {
        if (this.items.get(record.model) !== record || this.inserting.has(record)) return;
        const controller = record.model.userData.phonograph as PhonographController;
        const position = record.footPosition.clone();
        const loaded = controller.record;
        controller.stop();
        this.items.delete(record.model); this.entities.destroy(record.entity); record.dispose();
        if (loaded) {
          const spec = GROUND_ITEM_DEFINITIONS.record;
          void this.flingLoot([{ itemId: RECORD_ID, count: 1, name: spec.name, icon: spec.icon, atlas: spec.atlas,
            ...(loaded === RECORD_ID ? {} : { skinId: loaded }) }], position)
            .catch((error: unknown) => console.error('Unable to drop record', error));
        }
        PlaySound('dontstarve/common/destroy_smoke', position);
        PlaySound('dontstarve/common/destroy_wood', position);
        void createArchiveSprite(this.effectAssets, {
          animationArchive: 'structure_collapse_fx.zip', buildArchives: ['structure_collapse_fx.zip'],
          bank: 'collapse', animation: 'collapse_small', loop: false,
        }).then((effect) => {
          if (this.disposed) { effect.dispose(); return; }
          effect.model.position.copy(position); this.scene.add(effect.model); this.effects.add(effect);
          effect.playOnce('collapse_small', () => { effect.dispose(); this.effects.delete(effect); });
        }).catch((error: unknown) => console.error('Unable to play collapse effect', error));
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
            const isValid = () => this.items.get(record.model) === record && !record.entity.isRemoved && !record.isRemoved?.();
            return [{
                id: record.id, prefabId, model: record.model, position: record.footPosition, isValid,
                prepareNextSkin: async () => {
                    const skinId = nextReskin(skins, record.definition.skinId);
                    const definition = this.currentDefinition(record);
                    if (skinId === undefined) delete definition.skinId; else definition.skinId = skinId;
                    const visual = await this.createVisual(definition);
                    let used = false;
                    return {
                        apply: () => {
                            if (used || !isValid()) return false;
                            // The machine may have advanced while skin assets were loading.
                            const oldMachine = record.model.userData.phonograph as PhonographController | undefined;
                            const newMachine = visual.model.userData.phonograph as PhonographController | undefined;
                            if (oldMachine && newMachine) {
                              newMachine.record = oldMachine.record;
                              definition.phonographRecord = oldMachine.record;
                              definition.playbackRemaining = oldMachine.isPlaying ? oldMachine.remainingSeconds : undefined;
                            }
                            if (record.definition.itemId === 'torch') {
                              const current = this.currentDefinition(record);
                              if (!isValid()) return false;
                              definition.remainingFuel = current.remainingFuel;
                              definition.torchLit = current.torchLit;
                            }
                            record.entity.apply({ ...record.entity.snapshot(), skinId: definition.skinId });
                            visual.setDefinition?.(definition);
                            visual.model.position.copy(record.footPosition);
                            visual.model.quaternion.copy(record.model.quaternion);
                            if (record.fling) visual.model.children[0].position.y = record.fling.height;
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
    const isValid = () => this.items.get(record.model) === record && !record.entity.isRemoved && !record.isRemoved?.() && record.isWorkable?.() !== false;
    return {
      id: record.id, model: record.model, position: record.footPosition, isValid,
      isClickable: () => record.isClickable?.() !== false,
      capture: () => {
        return isValid() && this.putInInventory(record, 'net');
      },
    };
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if ((event.button !== 0 && event.button !== 2) || event.defaultPrevented || this.items.size === 0) return;

    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hit = intersectSpriteEntities(this.raycaster, [...this.items.values()]
      .filter(record => record.isClickable?.() !== false).map(record => record.model), true)[0];
    if (!hit) return;
    let root: THREE.Object3D | null = hit.object;
    while (root && !this.items.has(root as THREE.Group)) root = root.parent;
    const record = root ? this.items.get(root as THREE.Group) : undefined;
    if (!record) return;
    const machine = record.model.userData.phonograph as PhonographController | undefined;
    if (event.button === 2) {
      if (!machine || !machine.record || !isPlayerNearby(this.player.position, record.footPosition, false)) return;
      event.preventDefault();
      if (machine.isPlaying) machine.stop(); else machine.play();
      return;
    }
    event.preventDefault();
    const source = this.recordSource?.();
    if (machine && source) {
      void this.insertPhonographRecord(record.model, source)
        .catch((error: unknown) => console.error('Unable to insert record', error));
      return;
    }
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
    if (this.inserting.has(record)) return false;
    const definition = this.currentDefinition(record);
    if (record.entity.isRemoved || record.isRemoved?.()) return false;
    delete definition.playbackRemaining;
    delete definition.torchLit;
    if (!this.onPickup(definition, action, record.footPosition.clone())) return false;
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
    })).concat([...this.effects].map(({ model }) => ({ object: model, footPosition: model.position, cameraDepth: 0 })));
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    for (const effect of this.effects) { effect.model.quaternion.copy(cameraQuaternion); effect.update(dt); }
    for (const item of this.items.values()) {
      item.model.quaternion.copy(cameraQuaternion);
      item.update?.(dt);
      if (item.fling) {
        item.fling.update(dt);
        item.model.position.copy(item.fling.position);
        item.model.children[0].position.y = item.fling.height;
        if (item.fling.settled) item.fling = undefined;
      }
      item.footPosition.copy(item.model.position);
      item.entity.transform.position = item.footPosition.toArray();
      this.updateProximity(item);
      if (item.entity.isRemoved || item.isRemoved?.()) {
        this.entities.destroy(item.entity);
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

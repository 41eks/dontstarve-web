import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createArchiveSprite, ArchiveSpriteAssets, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { PickaxeTarget } from '@dontstarve-web/stategraphs/pickaxe';
import { LootDropper } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import { modelEntries } from './modelRecords';
import { MiniMapEntity } from './minimapEntity';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { MakeObstaclePhysics } from './standardcomponents';
import type { GroundItemDefinition, PreparedGroundSpawn } from './groundPrefab';
import { PlaySound, PreloadSounds } from './sound';
import catalog from './groundItems.json' with { type: 'json' };

export const CAVE_ENTRANCE_ID = 'cave_entrance' as const;
export const CAVE_ENTRANCE_OPEN_ID = 'cave_entrance_open' as const;
export const CAVE_ENTRANCE_IDS = [CAVE_ENTRANCE_ID, CAVE_ENTRANCE_OPEN_ID] as const;
export type CaveEntranceId = typeof CAVE_ENTRANCE_IDS[number];

/** tuning.lua ROCKS_MINE. */
const ROCKS_MINE = 6;
/** cave_entrance.lua MakeObstaclePhysics(inst, 1). */
const PHYSICS_RADIUS = 1;
/** cave_entrance.lua closed_fn SetLoot. */
const CLOSED_LOOT = ['rocks', 'rocks', 'flint', 'flint', 'flint'] as const;
/** LAYER_BACKGROUND with sort order 3: drawn under the world entities. */
export const CAVE_ENTRANCE_OPEN_RENDER_LAYER = -1;

/** workable.savestate defaults to false and worldmigrator is not connected yet: records carry only identity and position. */
export interface CaveEntranceRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: Record<string, never>;
}

export interface CaveEntranceWorld {
  physics?: CANNON.World;
  prepareSpawn(definition: GroundItemDefinition, fling?: boolean): Promise<PreparedGroundSpawn>;
}

export function isCaveEntranceId(value: string): value is CaveEntranceId {
  return (CAVE_ENTRANCE_IDS as readonly string[]).includes(value);
}

interface Entrance {
  prefab: CaveEntranceId;
  sprite: ArchiveSprite;
  minimap: MiniMapEntity;
  body?: CANNON.Body;
  workable?: Workable;
  loot: Map<string, PreparedGroundSpawn[]>;
  /** Closed entrances keep the prepared open art that replaces them when the last work is done. */
  openSprite?: ArchiveSprite;
  removed: boolean;
}

/** cave_entrance.lua: a MINE-able sealed entrance that becomes `cave_entrance_open` (worldmigrator and bats are not connected). */
export class CaveEntranceManager {
  private readonly scene: THREE.Scene;
  private readonly world: CaveEntranceWorld;
  private readonly assets = new ArchiveSpriteAssets();
  private readonly entrances = new Map<THREE.Group, Entrance>();
  private disposed = false;

  constructor(scene: THREE.Scene, world: CaveEntranceWorld) {
    this.scene = scene; this.world = world;
  }

  async spawn(prefab: CaveEntranceId, position: THREE.Vector3, saved?: CaveEntranceRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Cave entrances have been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid cave entrance position');
    const closed = prefab === CAVE_ENTRANCE_ID;
    const sprites = await Promise.allSettled([this.createSprite(prefab), closed ? this.createSprite(CAVE_ENTRANCE_OPEN_ID) : undefined] as const);
    const loot = new Map<string, PreparedGroundSpawn[]>();
    const resources = await Promise.allSettled([
      PreloadSounds('dontstarve/wilson/rock_break'),
      ...closed ? CLOSED_LOOT.map(itemId => this.world.prepareSpawn({ ...catalog.items[itemId], itemId, count: 1 }, true)) : [],
    ]);
    resources.slice(1).forEach((result, index) => {
      if (result.status !== 'fulfilled') return;
      const itemId = CLOSED_LOOT[index];
      loot.set(itemId, [...loot.get(itemId) ?? [], result.value as PreparedGroundSpawn]);
    });
    const sprite = sprites[0].status === 'fulfilled' ? sprites[0].value : undefined;
    const openSprite = sprites[1].status === 'fulfilled' ? sprites[1].value : undefined;
    const failed = [...sprites, ...resources].find(result => result.status === 'rejected');
    if (failed || this.disposed || !sprite) {
      sprite?.dispose(); openSprite?.dispose();
      for (const outputs of loot.values()) outputs.forEach(output => output.dispose());
      throw failed?.status === 'rejected' ? failed.reason : new Error('Cave entrances have been disposed');
    }
    return this.create(prefab, sprite, openSprite, loot, position, saved);
  }

  /** closed: idle_closed; open: `no_access` loop, since no destination shard is active yet. */
  private createSprite(prefab: CaveEntranceId): Promise<ArchiveSprite> {
    const open = prefab === CAVE_ENTRANCE_OPEN_ID;
    return createArchiveSprite(this.assets, { animationArchive: 'cave_entrance.zip', buildArchives: ['cave_entrance.zip'],
      bank: 'cave_entrance', animation: open ? 'no_access' : 'idle_closed', loop: open }, { name: prefab });
  }

  private create(prefab: CaveEntranceId, sprite: ArchiveSprite, openSprite: ArchiveSprite | undefined,
    loot: Map<string, PreparedGroundSpawn[]>, position: THREE.Vector3, saved: CaveEntranceRecord | undefined): THREE.Group {
    const model = sprite.model;
    model.position.set(position.x, 0, position.z);
    Object.assign(model.userData, { entityId: saved?.id ?? newEntityId(), prefab, tags: ['antlion_sinkhole_blocker'],
      physicsRadius: PHYSICS_RADIUS });
    const inst = actionEntity(model, prefab);
    const entrance: Entrance = { prefab, sprite, loot, openSprite, removed: false,
      minimap: new MiniMapEntity(model.position) };
    entrance.minimap.SetIcon(prefab === CAVE_ENTRANCE_ID ? 'cave_closed.png' : 'cave_open.png');
    if (this.world.physics) {
      entrance.body = MakeObstaclePhysics(model.position, PHYSICS_RADIUS);
      model.userData.physicsBody = entrance.body;
      this.world.physics.addBody(entrance.body);
    }
    if (prefab === CAVE_ENTRANCE_ID) this.createWorkable(entrance, inst);
    this.entrances.set(model, entrance);
    this.scene.add(model);
    return model;
  }

  /** closed_fn: MINE for ROCKS_MINE work, OnWork shows low/med/idle_closed and finally drops the loot and opens. */
  private createWorkable(entrance: Entrance, inst: ReturnType<typeof actionEntity>): void {
    const { sprite } = entrance, model = sprite.model;
    const workable = new Workable(inst);
    entrance.workable = workable;
    workable.SetWorkAction('MINE');
    workable.SetWorkLeft(ROCKS_MINE);
    const lootdropper = new LootDropper(inst, (itemId, point) => {
      const prepared = entrance.loot.get(itemId)?.shift();
      if (!prepared) return undefined;
      const spawned = prepared.spawn(new THREE.Vector3(point.x, point.y, point.z));
      if (!spawned) prepared.dispose();
      return spawned ? prepared.spawnedEntity : undefined;
    });
    lootdropper.SetLoot(CLOSED_LOOT);
    workable.SetOnWorkCallback((_worker, workleft) => {
      if (workleft > 0) {
        sprite.playOnce(workleft < ROCKS_MINE / 3 ? 'low' : workleft < ROCKS_MINE * 2 / 3 ? 'med' : 'idle_closed');
        return;
      }
      // rock_break_fx, DropLoot, then cave_entrance_open takes the closed entrance's place.
      PlaySound('dontstarve/wilson/rock_break', model.position);
      lootdropper.DropLoot();
      const open = entrance.openSprite!;
      entrance.openSprite = undefined;
      const record: CaveEntranceRecord = { id: newEntityId(), transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 }, components: {} };
      this.remove(model);
      this.create(CAVE_ENTRANCE_OPEN_ID, open, undefined, new Map(), model.position, record);
    });
    Object.assign(model.userData.components, { workable, lootdropper });
  }

  update(dt: number, quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    for (const { sprite } of this.entrances.values()) { sprite.model.quaternion.copy(quaternion); sprite.update(dt); }
  }

  get renderEntities() {
    return [...this.entrances.values()].map(({ prefab, sprite }) => ({
      object: sprite.model, footPosition: sprite.model.position, cameraDepth: 0,
      ...prefab === CAVE_ENTRANCE_OPEN_ID ? { renderLayer: CAVE_ENTRANCE_OPEN_RENDER_LAYER } : {},
    }));
  }

  get miniMapEntities(): MiniMapEntity[] { return [...this.entrances.values()].map(({ minimap }) => minimap); }

  get mineTargets(): PickaxeTarget[] { return this.getMineTargets(); }

  getMineTargets(model?: THREE.Object3D): PickaxeTarget[] {
    return modelEntries(this.entrances, model).filter(([, entrance]) => entrance.workable?.CanBeWorked()).map(([model, entrance]) => ({
      id: String(model.userData.entityId), model, position: model.position, entity: actionEntity(model, entrance.prefab),
      isValid: () => this.entrances.get(model) === entrance && !!entrance.workable?.CanBeWorked(),
    }));
  }

  exportRecords(): { prefabId: CaveEntranceId; record: CaveEntranceRecord }[] {
    return [...this.entrances].map(([model, { prefab }]) => ({ prefabId: prefab, record: {
      id: String(model.userData.entityId),
      transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
      components: {},
    } }));
  }

  private remove(model: THREE.Group): void {
    const entrance = this.entrances.get(model); if (!entrance) return;
    this.entrances.delete(model); model.userData.removed = true; entrance.removed = true;
    if (entrance.body) this.world.physics?.removeBody(entrance.body);
    entrance.minimap.dispose(); entrance.workable?.dispose();
    for (const outputs of entrance.loot.values()) outputs.forEach(output => output.dispose());
    entrance.loot.clear(); entrance.openSprite?.dispose(); entrance.sprite.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of [...this.entrances.keys()]) this.remove(model);
    this.assets.dispose();
  }
}

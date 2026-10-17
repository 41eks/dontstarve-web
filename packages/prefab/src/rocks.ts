import { ModelRecords } from './modelRecords';
import * as THREE from 'three';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory, type SpriteAnimationController } from '@dontstarve-web/animation/sprite';
import { newEntityId } from './saveRecord';
import type { PickaxeTarget } from '@dontstarve-web/stategraphs/pickaxe';
import { Workable } from '../../componets/src/workable';
import { LootDropper, SetSharedLootTable, type ChanceLootTable } from '../../componets/src/lootdropper';
import { actionEntity } from './actionEntity';
import type { GroundItemDefinition, PreparedGroundSpawn } from './groundPrefab';
import catalog from './groundItems.json' with { type: 'json' };
import { PlaySound, PreloadSounds } from './sound';

export const ROCK_PREFABS = ['rock1', 'rock2', 'rock_flintless', 'rock_flintless_med', 'rock_flintless_low'] as const;
export type RockPrefabId = typeof ROCK_PREFABS[number];
export function isRockPrefab(value: string): value is RockPrefabId {
  return (ROCK_PREFABS as readonly string[]).includes(value);
}

/** workable.savestate defaults to false: surviving rocks reload with their source work count. */
export interface RockRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: Record<string, never>;
}

interface RockDefinition {
  /** Shared anim/build/texture archive; rock_flintless*.zip serve three prefabs. */
  archive: string;
  initialAnimation: 'full' | 'med' | 'low';
  workLeft: number;
  loot: ChanceLootTable;
}

const ROCK_DEFINITIONS: Readonly<Record<RockPrefabId, RockDefinition>> = {
  rock1: { archive: 'rock.zip', initialAnimation: 'full', workLeft: 6,
    loot: [['rocks', 1], ['rocks', 1], ['rocks', 1], ['nitre', 1], ['flint', 1], ['nitre', .25], ['flint', .6]] },
  rock2: { archive: 'rock2.zip', initialAnimation: 'full', workLeft: 6,
    loot: [['rocks', 1], ['rocks', 1], ['rocks', 1], ['goldnugget', 1], ['flint', 1], ['goldnugget', .25], ['flint', .6]] },
  rock_flintless: { archive: 'rock_flintless.zip', initialAnimation: 'full', workLeft: 6,
    loot: [['rocks', 1], ['rocks', 1], ['rocks', 1], ['rocks', 1], ['rocks', .6]] },
  rock_flintless_med: { archive: 'rock_flintless.zip', initialAnimation: 'med', workLeft: 4,
    loot: [['rocks', 1], ['rocks', 1], ['rocks', 1], ['rocks', .4]] },
  rock_flintless_low: { archive: 'rock_flintless.zip', initialAnimation: 'low', workLeft: 2,
    loot: [['rocks', 1], ['rocks', 1], ['rocks', .2]] },
};

for (const prefab of ROCK_PREFABS) SetSharedLootTable(prefab, ROCK_DEFINITIONS[prefab].loot);

export interface RockWorld {
  prepareSpawn(definition: GroundItemDefinition, fling?: boolean): Promise<PreparedGroundSpawn>;
}

/** rocks.lua OnWork: update the full/med/low pose, then drop source loot and remove. */
export class RockController {
  private disposed = false;
  readonly entity: ReturnType<typeof actionEntity>;
  readonly workable: Workable;

  constructor(model: THREE.Group, prefab: RockPrefabId, lootdropper: LootDropper, remove: () => void) {
    Object.assign(model.userData, { tags: ['boulder'], rockController: this });
    this.entity = actionEntity(model, prefab);
    this.workable = new Workable(this.entity);
    model.userData.components.workable = this.workable;
    model.userData.components.lootdropper = lootdropper;
    this.workable.SetWorkAction('MINE');
    this.workable.SetWorkLeft(ROCK_DEFINITIONS[prefab].workLeft);
    this.workable.SetOnWorkCallback((_worker, workleft) => {
      if (workleft <= 0) {
        PlaySound('dontstarve/wilson/rock_break', model.position);
        lootdropper.DropLoot();
        remove();
      } else {
        const animation = model.userData.animationController as SpriteAnimationController;
        animation.start(workleft < 2 ? 'low' : workleft < 4 ? 'med' : 'full');
      }
    });
  }

  get canMine(): boolean { return !this.disposed && this.workable.CanBeWorked(); }

  dispose(): void {
    this.disposed = true;
    this.entity.model.userData.removed = true;
    this.workable.dispose();
  }
}

interface Rock {
  prefabId: RockPrefabId;
  model: THREE.Group;
  controller: RockController;
  factory: AnimatedSpriteFactory;
  outputs: Map<string, PreparedGroundSpawn[]>;
}

/** Shared per-archive sprites, prefab-owned work and loot, and stable foot points. */
export class RockManager {
  private readonly factories = new Map<string, Promise<AnimatedSpriteFactory>>();
  private readonly mouseRecords = new ModelRecords<Rock>();
  private readonly rocks = new Set<Rock>();
  private readonly scene: THREE.Scene;
  private readonly assetBaseUrl: string;
  private readonly world: RockWorld;
  private disposed = false;

  constructor(scene: THREE.Scene, assetBaseUrl: string, world: RockWorld) {
    this.scene = scene;
    this.assetBaseUrl = assetBaseUrl;
    this.world = world;
  }

  async spawn(prefabId: RockPrefabId, position: THREE.Vector3, saved?: RockRecord): Promise<THREE.Group> {
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid rock position');
    const definition = ROCK_DEFINITIONS[prefabId];
    let request = this.factories.get(definition.archive);
    if (!request) {
      request = createAnimatedSpriteFactory(this.assetBaseUrl, definition.archive);
      this.factories.set(definition.archive, request);
      void request.catch(() => this.factories.delete(definition.archive));
    }
    const resources = await Promise.allSettled([request,
      PreloadSounds('dontstarve/wilson/rock_break'),
      ...definition.loot.map(([itemId]) => this.world.prepareSpawn({
        ...catalog.items[itemId as keyof typeof catalog.items], itemId, count: 1,
      }, true)),
    ]);
    const outputs = new Map<string, PreparedGroundSpawn[]>();
    definition.loot.forEach(([prefab], index) => {
      const result = resources[index + 2] as PromiseSettledResult<PreparedGroundSpawn>;
      if (result.status === 'fulfilled') outputs.set(prefab, [...outputs.get(prefab) ?? [], result.value]);
    });
    const failure = resources.find(result => result.status === 'rejected');
    if (failure || this.disposed) {
      for (const pieces of outputs.values()) pieces.forEach(piece => piece.dispose());
      throw failure?.status === 'rejected' ? failure.reason : new Error('Rock manager has been disposed');
    }
    const factory = (resources[0] as PromiseFulfilledResult<AnimatedSpriteFactory>).value;
    const model = factory.create({
      initialAnimation: definition.initialAnimation,
      initialFrame: 'first',
      name: prefabId,
    });
    model.position.set(position.x, 0, position.z);
    model.userData.entityId = saved?.id ?? newEntityId();
    model.userData.prefab = prefabId;
    const inst = actionEntity(model, prefabId);
    const lootdropper = new LootDropper(inst, (prefab, position) => {
      const output = outputs.get(prefab)?.shift();
      if (!output) return undefined;
      const spawned = output.spawn(new THREE.Vector3(position.x, position.y, position.z));
      if (!spawned) output.dispose();
      return spawned ? output.spawnedEntity : undefined;
    });
    lootdropper.SetChanceLootTable(prefabId);
    const controller = new RockController(model, prefabId, lootdropper, () => this.remove(rock));
    const rock = { prefabId, model, controller, factory, outputs };
    this.rocks.add(rock); this.mouseRecords.set(rock.model, rock);
    this.scene.add(model);
    return model;
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    for (const rock of this.rocks) {
      rock.model.quaternion.copy(cameraQuaternion);
      (rock.model.userData.animationController as SpriteAnimationController).update(dt);
    }
  }

  get mineTargets(): PickaxeTarget[] { return this.getMineTargets(); }

  getMineTargets(model?: THREE.Object3D): PickaxeTarget[] {
    return this.mouseRecords.select(model, this.rocks).filter((rock) => rock.controller.canMine).map((rock) => ({
      id: String(rock.model.userData.entityId),
      model: rock.model,
      position: rock.model.position,
      entity: rock.controller.entity,
      isValid: () => rock.controller.canMine,
    }));
  }

  get renderEntities() {
    return [...this.rocks].map(({ model }) => ({ object: model, footPosition: model.position, cameraDepth: 0 }));
  }

  exportRecords(): { prefabId: RockPrefabId; record: RockRecord }[] {
    return [...this.rocks].map(({ prefabId, model }) => ({
      prefabId,
      record: {
        id: String(model.userData.entityId),
        transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
        components: {},
      },
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const rock of this.rocks) this.remove(rock);
    for (const factory of this.factories.values()) void factory.then((value) => value.dispose(), () => undefined);
  }

  private remove(rock: Rock): void {
    if (!this.rocks.delete(rock)) return;
    rock.controller.dispose();
    rock.factory.disposeSprite(rock.model);
    for (const pieces of rock.outputs.values()) pieces.forEach(piece => piece.dispose());
    rock.outputs.clear();
  }
}

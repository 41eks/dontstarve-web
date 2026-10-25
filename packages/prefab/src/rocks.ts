import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import { MakeObstaclePhysics, RemovePhysicsColliders } from './standardcomponents';
import { ModelRecords } from './modelRecords';
import * as THREE from 'three';
import { ArchiveSpriteAssets, preloadSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import { createArchiveEntity, prefabInstance, type PrefabInstance } from './prefabInstance';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { watchTileActivity } from './tileActivity';
import { newEntityId } from './saveRecord';
import type { PickaxeTarget } from '@dontstarve-web/stategraphs/pickaxe';
import { Workable } from '../../componets/src/workable';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ErodeAway } from '../../componets/src/erodeaway';
import { LootDropper, SetSharedLootTable, type ChanceLootTable } from '../../componets/src/lootdropper';
import { actionEntity } from './actionEntity';
import type { GroundItemDefinition, PreparedGroundSpawn } from './groundPrefab';
import catalog from './groundItems.json' with { type: 'json' };
import { PlaySound, PreloadSounds } from './sound';

export const ROCK_PREFABS = ['rock1', 'rock2', 'rock_flintless', 'rock_flintless_med', 'rock_flintless_low',
  'cavein_boulder', 'rock_moon_shell', 'rock_moon'] as const;
export const MINEABLE_ROCK_PREFABS = ROCK_PREFABS;
export type RockPrefabId = typeof ROCK_PREFABS[number];
/** The seed remains static ground art; every rock has its source mining behavior. */
export const ROCK_ENTITY_IDS = [...ROCK_PREFABS, 'moonrockseed'] as const;
export type RockEntityId = typeof ROCK_ENTITY_IDS[number];
export function isRockPrefab(value: string): value is RockPrefabId {
  return (ROCK_PREFABS as readonly string[]).includes(value);
}

/** cavein_boulder.lua: symbol variation and the saved ground/raised formation pose. */
export interface CaveinBoulderSave { variation: number; raised?: true; formed?: true }
/** workable.savestate defaults to false: surviving mineable rocks reload with their source work count. */
export interface RockRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { caveinBoulder?: CaveinBoulderSave };
}

interface RockDefinition {
  /** Shared anim/build/texture archive; rock_flintless*.zip serve three prefabs. */
  archive: string;
  buildArchive?: string;
  bank: string;
  initialAnimation: 'full' | 'med' | 'low' | 'idle';
  workLeft?: number;
  loot?: ChanceLootTable;
}

const ROCK_DEFINITIONS: Readonly<Record<RockEntityId, RockDefinition>> = {
  rock1: { archive: 'rock.zip', bank: 'rock', initialAnimation: 'full', workLeft: 6,
    loot: [['rocks', 1], ['rocks', 1], ['rocks', 1], ['nitre', 1], ['flint', 1], ['nitre', .25], ['flint', .6]] },
  rock2: { archive: 'rock2.zip', bank: 'rock2', initialAnimation: 'full', workLeft: 6,
    loot: [['rocks', 1], ['rocks', 1], ['rocks', 1], ['goldnugget', 1], ['flint', 1], ['goldnugget', .25], ['flint', .6]] },
  rock_flintless: { archive: 'rock_flintless.zip', bank: 'rock_flintless', initialAnimation: 'full', workLeft: 6,
    loot: [['rocks', 1], ['rocks', 1], ['rocks', 1], ['rocks', 1], ['rocks', .6]] },
  rock_flintless_med: { archive: 'rock_flintless.zip', bank: 'rock_flintless', initialAnimation: 'med', workLeft: 4,
    loot: [['rocks', 1], ['rocks', 1], ['rocks', 1], ['rocks', .4]] },
  rock_flintless_low: { archive: 'rock_flintless.zip', bank: 'rock_flintless', initialAnimation: 'low', workLeft: 2,
    loot: [['rocks', 1], ['rocks', 1], ['rocks', .2]] },
  cavein_boulder: { archive: 'cavein_boulder.zip', buildArchive: 'swap_cavein_boulder.zip', bank: 'cavein_boulder', initialAnimation: 'idle', workLeft: 3,
    loot: [['rocks', 1], ['rocks', 1], ['rocks', .4], ['flint', .1]] },
  rock_moon_shell: { archive: 'moonrock_shell.zip', bank: 'moonrock_shell', initialAnimation: 'full', workLeft: 6,
    loot: [['rocks', 1], ['flint', 1], ['moonrocknugget', 1], ['moonrocknugget', 1], ['moonrocknugget', 1], ['moonrocknugget', .3]] },
  rock_moon: { archive: 'rock7.zip', bank: 'rock5', initialAnimation: 'full', workLeft: 6,
    loot: [['rocks', 1], ['flint', 1], ['moonrocknugget', 1], ['moonrocknugget', 1], ['moonrocknugget', .6], ['moonrocknugget', .3]] },
  moonrockseed: { archive: 'moonrock_seed.zip', bank: 'moonrock_seed', initialAnimation: 'idle' },
};

for (const prefab of MINEABLE_ROCK_PREFABS) SetSharedLootTable(prefab, ROCK_DEFINITIONS[prefab].loot!);

export function rockArchives(prefab: RockEntityId) {
  const definition = ROCK_DEFINITIONS[prefab];
  return [{ animation: definition.archive, build: definition.buildArchive ?? definition.archive },
    ...(prefab === 'rock_moon_shell' ? [{ animation: 'moonrock_seed.zip', build: 'moonrock_seed.zip' }] : [])];
}

export interface RockWorld extends ToolMouseTargetWorld {
  physics?: import('cannon-es').World;
  scheduler?: GameTimeScheduler;
  tickingarea?: TileStateQuery;
  prepareSpawn(definition: GroundItemDefinition, fling?: boolean): Promise<PreparedGroundSpawn>;
}

/** rocks.lua OnWork: update the full/med/low pose, then drop source loot and remove. */
export class RockController {
  private disposed = false;
  readonly entity: ReturnType<typeof actionEntity>;
  readonly workable: Workable;
  private readonly erode?: ErodeAway;
  private readonly onWorkFinished?: () => void;

  constructor(model: THREE.Group, prefab: RockPrefabId, lootdropper: LootDropper, remove: () => void,
    context: { scheduler: GameTimeScheduler; caveinBoulder?: CaveinBoulderSave; spawnSeed(): void; setErosion(amount: number): void }) {
    model.userData.rockController = this;
    this.entity = actionEntity(model, prefab);
    this.workable = new Workable(this.entity);
    model.userData.components.workable = this.workable;
    model.userData.components.lootdropper = lootdropper;
    this.workable.SetWorkAction('MINE');
    this.workable.SetWorkLeft(ROCK_DEFINITIONS[prefab].workLeft);
    if (prefab === 'cavein_boulder') {
      this.workable.SetWorkable(!context.caveinBoulder?.raised);
      this.workable.SetOnFinishCallback(worker => {
        PlaySound('dontstarve/wilson/rock_break', model.position);
        if (context.caveinBoulder?.raised) lootdropper.DropLoot(new THREE.Vector3(model.position.x, 6, model.position.z));
        else if (context.caveinBoulder?.formed && worker.sg?.HasStateTag('working') && worker.getPosition) {
          const target = worker.getPosition();
          for (const loot of lootdropper.GenerateLoot()) lootdropper.SpawnLootPrefab(loot)?.PushEvent('launch', {
            angle: Math.atan2(target.z - model.position.z, target.x - model.position.x) + (Math.random() * 2 - 1) * Math.PI / 6,
            height: 1, speed: { min: 1, range: 2 }, ySpeed: { min: 6, range: 2 },
          });
        } else lootdropper.DropLoot();
        remove();
      });
      return;
    }
    if (prefab === 'rock_moon_shell') {
      this.erode = new ErodeAway(context.scheduler, context.setErosion, remove);
      model.userData.rockMiningState = { breakDelay: this.erode.delay, erosion: this.erode.timer };
      this.onWorkFinished = () => {
        context.spawnSeed();
        this.entity.addTag('NOCLICK');
        const instance = prefabInstance(model)!;
        RemovePhysicsColliders(instance);
        instance.persists = false;
        (model.userData.animationController as ArchiveSpriteCommands).playOnce('break');
        this.erode!.start(2);
      };
      model.addEventListener('workfinished' as never, this.onWorkFinished);
    }
    this.workable.SetOnWorkCallback((_worker, workleft) => {
      if (workleft <= 0) {
        PlaySound('dontstarve/wilson/rock_break', model.position);
        lootdropper.DropLoot();
        if (prefab !== 'rock_moon_shell') remove();
      } else {
        const animation = model.userData.animationController as ArchiveSpriteCommands;
        animation.playOnce(workleft < 2 ? 'low' : workleft < 4 ? 'med' : 'full');
      }
    });
  }

  get canMine(): boolean { return !this.disposed && this.workable.CanBeWorked(); }
  get persistent(): boolean { return !this.erode?.active.peek(); }
  update(): void { this.erode?.update(); }

  dispose(): void {
    this.disposed = true;
    if (this.onWorkFinished) this.entity.model.removeEventListener('workfinished' as never, this.onWorkFinished);
    this.erode?.dispose();
    this.entity.model.userData.removed = true;
    this.workable.dispose();
  }
}

type RockSource = Awaited<ReturnType<typeof preloadSharedArchiveSprite>>;

interface Rock {
  prefabId: RockEntityId;
  model: THREE.Group;
  controller?: RockController;
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  sprite: ArchiveSpriteCommands;
  caveinBoulder?: CaveinBoulderSave;
  stopActivity?: () => void;
  outputs: Map<string, PreparedGroundSpawn[]>;
  preparedSeed?: RockSource;
}

/** Shared per-archive sprites, prefab-owned work and loot, and stable foot points. */
export class RockManager {
  private readonly assets: ArchiveSpriteAssets;
  private readonly sources = new Map<RockEntityId, ReturnType<typeof preloadSharedArchiveSprite>>();
  private readonly pendingSpawns = new Set<Promise<unknown>>();
  private readonly mouseRecords = new ModelRecords<Rock>();
  private readonly rocks = new Set<Rock>();
  private readonly scene: THREE.Scene;
  private readonly world: RockWorld;
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private disposed = false;

  constructor(scene: THREE.Scene, assetBaseUrl: string, world: RockWorld) {
    this.scene = scene;
    this.world = world;
    this.assets = new ArchiveSpriteAssets('rock', assetBaseUrl);
    this.scheduler = world.scheduler ?? new GameTimeScheduler();
    this.ownsScheduler = !world.scheduler;
  }

  async spawn(prefabId: RockEntityId, position: THREE.Vector3, saved?: RockRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Rock manager has been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid rock position');
    const definition = ROCK_DEFINITIONS[prefabId];
    const caveinBoulder: CaveinBoulderSave | undefined = prefabId === 'cavein_boulder'
      ? saved?.components.caveinBoulder ?? { variation: 1 + Math.floor(Math.random() * 8) } : undefined;
    const tinted = prefabId !== 'cavein_boulder' && prefabId !== 'moonrockseed';
    const colour = tinted ? .5 + Math.random() * .5 : 1;
    const request = this.getSource(prefabId);
    const resourcesRequest = Promise.allSettled([request,
      definition.loot ? PreloadSounds('dontstarve/wilson/rock_break') : Promise.resolve(),
      prefabId === 'rock_moon_shell' ? this.getSource('moonrockseed') : Promise.resolve(undefined),
      ...(definition.loot ?? []).map(([itemId]) => this.world.prepareSpawn({
        ...catalog.items[itemId as keyof typeof catalog.items], itemId, count: 1,
      }, true)),
    ]);
    this.pendingSpawns.add(resourcesRequest);
    const resources = await resourcesRequest;
    this.pendingSpawns.delete(resourcesRequest);
    const outputs = new Map<string, PreparedGroundSpawn[]>();
    definition.loot?.forEach(([prefab], index) => {
      const result = resources[index + 3] as PromiseSettledResult<PreparedGroundSpawn>;
      if (result.status === 'fulfilled') outputs.set(prefab, [...outputs.get(prefab) ?? [], result.value]);
    });
    const failure = resources.find(result => result.status === 'rejected');
    if (failure || this.disposed) {
      for (const pieces of outputs.values()) pieces.forEach(piece => piece.dispose());
      throw failure?.status === 'rejected' ? failure.reason : new Error('Rock manager has been disposed');
    }
    const source = (resources[0] as PromiseFulfilledResult<RockSource>).value;
    const seedSource = (resources[2] as PromiseFulfilledResult<RockSource | undefined>).value;
    const sprite = this.createSprite(source, prefabId, caveinBoulder?.raised ? 'idle_raised' : definition.initialAnimation);
    const seed = seedSource;
    return this.create(prefabId, sprite, outputs, position, saved, caveinBoulder, seed, colour);
  }

  /** One shared source per rock archive/bank; every rock builds its own sprite in the logical clip. */
  private getSource(prefabId: RockEntityId): Promise<RockSource> {
    let request = this.sources.get(prefabId);
    if (!request) {
      const definition = ROCK_DEFINITIONS[prefabId];
      request = preloadSharedArchiveSprite(this.assets, {
        animationArchive: definition.archive, buildArchives: [definition.buildArchive ?? definition.archive], bank: definition.bank,
        hiddenSymbols: prefabId !== 'cavein_boulder' && prefabId !== 'moonrockseed' ? ['snow'] : undefined,
      }, { instancedAnimations: 'all' }).catch(error => { this.sources.delete(prefabId); throw error; });
      this.sources.set(prefabId, request);
    }
    return request;
  }

  private createSprite(source: RockSource, prefabId: RockEntityId, animation: string): ReturnType<typeof createArchiveEntity> {
    const create = (clip: { name: string; loop: boolean }) => source(clip.name, clip.loop, prefabId, { colour: [1, 1, 1] });
    const clip = { name: animation, loop: false };
    const entity = createArchiveEntity(prefabId, { create, initial: create(clip) }, { name: animation, billboard: true }, prefabId);
    entity.instance.sprite.playOnce(animation);
    return entity;
  }

  private create(prefabId: RockEntityId, { instance, display }: ReturnType<typeof createArchiveEntity>, outputs: Map<string, PreparedGroundSpawn[]>,
    position: THREE.Vector3, saved?: RockRecord, caveinBoulder?: CaveinBoulderSave, preparedSeed?: RockSource, colour = 1): THREE.Group {
    const sprite = instance.sprite;
    if (prefabId === 'moonrockseed') sprite.setPaused(true);
    const model = display.model;
    model.position.set(position.x, 0, position.z);
    if (prefabId !== 'cavein_boulder' && (MINEABLE_ROCK_PREFABS as readonly string[]).includes(prefabId)) {
      MakeObstaclePhysics(instance, 1);
      if (this.world.physics) instance.bindPhysics(this.world.physics);
    }
    instance.entityId = saved?.id ?? newEntityId();
    model.userData.animationController = sprite;
    for (const tag of prefabId === 'cavein_boulder' ? ['heavy', 'boulder', 'caveindebris']
      : prefabId === 'moonrockseed' ? ['irreplaceable', 'nonpotatable', 'celestial_station']
      : ['boulder', 'SnowCovered', ...(prefabId === 'rock_moon_shell' ? ['meteor_protection'] : [])]) instance.addTag(tag);
    const inst = actionEntity(model, prefabId);
    const rock: Rock = { prefabId, model, instance, display, sprite, caveinBoulder, outputs, preparedSeed };
    if ((MINEABLE_ROCK_PREFABS as readonly string[]).includes(prefabId)) {
      const lootdropper = new LootDropper(inst, (prefab, position) => {
        const output = outputs.get(prefab)?.shift();
        if (!output) return undefined;
        const spawned = output.spawn(new THREE.Vector3(position.x, position.y, position.z));
        if (!spawned) output.dispose();
        return spawned ? output.spawnedEntity : undefined;
      });
      lootdropper.SetChanceLootTable(prefabId);
      rock.controller = new RockController(model, prefabId as RockPrefabId, lootdropper, () => this.remove(rock), {
        scheduler: this.scheduler, caveinBoulder,
        setErosion: amount => sprite.setErosion(amount),
        spawnSeed: () => {
          const seed = rock.preparedSeed;
          if (!seed) throw new Error('Moon shell seed has not been prepared');
          rock.preparedSeed = undefined;
          this.create('moonrockseed', this.createSprite(seed, 'moonrockseed', 'idle'), new Map(), model.position);
        },
      });
      new ToolMouseTarget(inst, instance, rock.controller.workable, this.world.handEquipment);
    }
    sprite.setColour([colour, colour, colour]);
    if (caveinBoulder && caveinBoulder.variation > 1) {
      sprite.setSymbolOverride('swap_boulder', 'swap_cavein_boulder.zip', `swap_boulder${caveinBoulder.variation}`);
    }
    this.rocks.add(rock); this.mouseRecords.set(rock.model, rock);
    this.scene.add(model);
    rock.stopActivity = watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active));
    return model;
  }

  update(dt: number, _cameraQuaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    if (this.ownsScheduler) this.scheduler.advance(dt);
    for (const rock of this.rocks) {
      if (rock.sprite.loaded) rock.sprite.update(dt);
      rock.controller?.update();
    }
  }

  get mineTargets(): PickaxeTarget[] { return this.getMineTargets(); }

  getMineTargets(model?: THREE.Object3D): PickaxeTarget[] {
    return this.mouseRecords.select(model, this.rocks).flatMap((rock) => {
      const controller = rock.controller;
      return controller?.canMine ? [{
        id: String(rock.instance.entityId),
        model: rock.model,
        position: rock.model.position,
        entity: controller.entity,
        isValid: () => controller.canMine,
      }] : [];
    });
  }

  get renderEntities() {
    return [...this.rocks].filter(({ sprite }) => sprite.loaded).map(({ model }) => ({ object: model, footPosition: model.position, cameraDepth: 0 }));
  }

  exportRecords(): { prefabId: RockEntityId; record: RockRecord }[] {
    return [...this.rocks].filter(rock => rock.controller?.persistent ?? true).map(({ prefabId, model, caveinBoulder, instance }) => ({
      prefabId,
      record: {
        id: String(instance.entityId),
        transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
        components: caveinBoulder ? { caveinBoulder: { ...caveinBoulder } } : {},
      },
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const rock of this.rocks) this.remove(rock);
    if (this.ownsScheduler) this.scheduler.dispose();
    // Pending spawns release their sprite and prepared loot before the common frame/atlas owner.
    if (this.pendingSpawns.size) void Promise.allSettled(this.pendingSpawns).then(() => this.assets.dispose());
    else this.assets.dispose();
  }

  private remove(rock: Rock): void {
    if (!this.rocks.delete(rock)) return;
    rock.model.userData.removed = true;
    rock.stopActivity?.();
    rock.controller?.dispose();
    rock.instance.remove();
    for (const pieces of rock.outputs.values()) pieces.forEach(piece => piece.dispose());
    rock.outputs.clear();
  }
}

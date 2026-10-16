import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createArchiveSprite, ArchiveSpriteAssets, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { PickaxeTarget } from '@dontstarve-web/stategraphs/pickaxe';
import { createEffect, WorldContentKey, type GetWatchWorldContent } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Growable, type GrowableSave } from '../../componets/src/growable';
import { LootDropper } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import { MiniMapEntity } from './minimapEntity';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { MakeObstaclePhysics } from './standardcomponents';
import type { GroundItemDefinition, PreparedGroundSpawn } from './groundPrefab';
import { PlaySound, PreloadSounds, type SoundEventPath, type SoundHandle } from './sound';
import catalog from './groundItems.json' with { type: 'json' };

export const MARBLESHRUB_ID = 'marbleshrub' as const;
/** The Lua prefab names marbleshrub_short/normal/tall only choose the starting growth stage. */
export const MARBLESHRUB_SPAWN_IDS = [MARBLESHRUB_ID, 'marbleshrub_short', 'marbleshrub_normal', 'marbleshrub_tall'] as const;
export type MarbleShrubSpawnId = typeof MARBLESHRUB_SPAWN_IDS[number];

const NUM_BUILDS = 3;
const DAY_TIME = 300; // tuning.lua day_time, as in the other tree growth tables.
// tuning.lua MARBLESHRUB_GROW_TIME: {base = 9 * day_time, random = 1 * day_time} for each stage.
export const MARBLESHRUB_GROW_TIME = { base: 9 * DAY_TIME, random: DAY_TIME } as const;
export const MARBLESHRUB_MAX_GROW_TIME = MARBLESHRUB_GROW_TIME.base + MARBLESHRUB_GROW_TIME.random;
const MED_MARBLEBEAN_CHANCE = .75;
const TALL_MARBLEBEAN_CHANCE = .5;
const PHYSICS_RADIUS = .1;

interface StageData {
  idle: string; hit: string; broken: string; grow: string; growsound: SoundEventPath;
  workleft: number; loot(roll: (chance: number) => boolean): string[];
}
// marbleshrub.lua statedata; TryLuckRoll(worker, chance) without luck is a plain roll.
const STAGES: readonly StageData[] = [
  { idle: 'idle_short', hit: 'hit_short', broken: 'mined_short', grow: 'grow_tall_to_short',
    growsound: 'dontstarve/common/together/marble_shrub/wilt_to_grow', workleft: 6, loot: () => ['marble'] },
  { idle: 'idle_normal', hit: 'hit_normal', broken: 'mined_normal', grow: 'grow_short_to_normal',
    growsound: 'dontstarve/common/together/marble_shrub/grow', workleft: 8,
    loot: roll => roll(MED_MARBLEBEAN_CHANCE) ? ['marble'] : ['marble', 'marblebean'] },
  { idle: 'idle_tall', hit: 'hit_tall', broken: 'mined_tall', grow: 'grow_normal_to_tall',
    growsound: 'dontstarve/common/together/marble_shrub/grow', workleft: 10,
    loot: roll => ['marble', roll(TALL_MARBLEBEAN_CHANCE) ? 'marble' : 'marblebean'] },
];
const LOOT_PREPARATIONS = ['marble', 'marble', 'marblebean'] as const;

/** marbleshrub.lua OnSave: shapenumber is written only when it is not 1; color is always written. */
export interface MarbleShrubSaveState { shapenumber?: number; color: number; }
export interface MarbleShrubRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { growable: GrowableSave; marbleShrub: MarbleShrubSaveState };
}

export interface MarbleShrubWorld {
  scheduler?: GameTimeScheduler;
  physics?: CANNON.World;
  /** Snow level is read through a lifecycle-managed bridge owned by each shrub. */
  getWatchWorldContent?: GetWatchWorldContent;
  prepareSpawn(definition: GroundItemDefinition, fling?: boolean): Promise<PreparedGroundSpawn>;
}

interface Shrub {
  sprite: ArchiveSprite;
  growable: Growable;
  workable: Workable;
  loot: Map<string, PreparedGroundSpawn[]>;
  shapenumber: number;
  color: number;
  stage: StageData;
  /** Mined: the shrub plays its break animation and is gone at animover (persists = false). */
  broken: boolean;
  body?: CANNON.Body;
  minimap: MiniMapEntity;
  stopSnow?: () => void;
  sounds: Set<SoundHandle>;
}

/** marbleshrub.lua: growable loop, MINE workable, stage-dependent loot and shape/colour persistence. */
export class MarbleShrubManager {
  private readonly scene: THREE.Scene;
  private readonly world: MarbleShrubWorld;
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly assets = new ArchiveSpriteAssets();
  private readonly shrubs = new Map<THREE.Group, Shrub>();
  private disposed = false;

  constructor(scene: THREE.Scene, world: MarbleShrubWorld) {
    this.scene = scene; this.world = world;
    this.scheduler = world.scheduler ?? new GameTimeScheduler();
    this.ownsScheduler = !world.scheduler;
  }

  /** `c_spawn("marbleshrub_<stage>")`, or a saved record; the saved growable restores the stage and its remaining time. */
  async spawn(prefabId: MarbleShrubSpawnId, position: THREE.Vector3, saved?: MarbleShrubRecord): Promise<THREE.Group> {
    const stage = Math.max(1, MARBLESHRUB_SPAWN_IDS.indexOf(prefabId));
    const prepared = await this.prepare(saved?.components.marbleShrub.shapenumber ?? 1,
      saved?.components.marbleShrub.color ?? 1);
    return prepared.spawn(position, stage, saved);
  }

  /** marbleshrub.lua growfromseed: random shape and colour, stage 1, then `grow_seed_to_short`. */
  async prepareGrowFromSeed(): Promise<{ spawn(position: THREE.Vector3): THREE.Group; dispose(): void }> {
    const prepared = await this.prepare(1 + Math.floor(Math.random() * NUM_BUILDS), .5 + Math.random() * .5);
    return { dispose: prepared.dispose, spawn: position => prepared.spawn(position, 1, undefined, true) };
  }

  private async prepare(shapenumber: number, color: number) {
    if (!Number.isInteger(shapenumber) || shapenumber < 1 || shapenumber > NUM_BUILDS) throw new RangeError('Invalid marble shrub shape');
    const resources = await Promise.allSettled([
      createArchiveSprite(this.assets, {
        animationArchive: 'marbleshrub.zip', buildArchives: ['marbleshrub.zip', 'marbleshrub_build.zip', 'snow.zip'],
        bank: 'marbleshrub', animation: STAGES[0].idle, loop: false,
        // MakeSnowCovered: the shared snow build overlays the animation's `snow` symbol while the snow level is high enough.
        hiddenSymbols: ['snow'],
        symbolOverrides: {
          snow: { archive: 'snow.zip', symbol: 'snow' },
          ...shapenumber === 1 ? {} : { marbleshrub_top1: { archive: 'marbleshrub_build.zip', symbol: `marbleshrub_top${shapenumber}` } },
        },
      }, { name: MARBLESHRUB_ID, colour: [color, color, color] }),
      PreloadSounds('dontstarve/wilson/rock_break', ...new Set(STAGES.map(({ growsound }) => growsound))),
      ...LOOT_PREPARATIONS.map(itemId => this.world.prepareSpawn({
        ...catalog.items[itemId], itemId, count: 1,
      }, true)),
    ] as const);
    const loot = new Map<string, PreparedGroundSpawn[]>();
    LOOT_PREPARATIONS.forEach((itemId, index) => {
      const result = resources[index + 2];
      if (result.status === 'fulfilled') loot.set(itemId, [...loot.get(itemId) ?? [], result.value as PreparedGroundSpawn]);
    });
    const disposeResources = () => {
      if (resources[0].status === 'fulfilled') resources[0].value.dispose();
      for (const outputs of loot.values()) outputs.forEach(output => output.dispose());
    };
    const failed = resources.find(result => result.status === 'rejected');
    if (failed || this.disposed) {
      disposeResources();
      throw failed?.status === 'rejected' ? failed.reason : new Error('Marble shrubs disposed');
    }
    const sprite = (resources[0] as PromiseFulfilledResult<ArchiveSprite>).value;
    let used = false;
    return {
      dispose: () => { if (!used) { used = true; disposeResources(); } },
      spawn: (position: THREE.Vector3, startStage: number, saved?: MarbleShrubRecord, fromSeed = false): THREE.Group => {
        if (used || this.disposed) throw new Error('Prepared marble shrub is unavailable');
        if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid marble shrub position');
        used = true;
        return this.create(sprite, loot, position, shapenumber, color, startStage, saved, fromSeed);
      },
    };
  }

  private create(sprite: ArchiveSprite, loot: Map<string, PreparedGroundSpawn[]>, position: THREE.Vector3, shapenumber: number, color: number,
    startStage: number, saved: MarbleShrubRecord | undefined, fromSeed: boolean): THREE.Group {
    const model = sprite.model;
    model.position.set(position.x, 0, position.z);
    Object.assign(model.userData, { entityId: saved?.id ?? newEntityId(), prefab: MARBLESHRUB_ID, tags: ['boulder', 'SnowCovered'], deploySmartRadius: 1,
      physicsRadius: PHYSICS_RADIUS });
    const inst = actionEntity(model, MARBLESHRUB_ID);
    const shrub: Shrub = { sprite, loot, shapenumber, color, stage: STAGES[0], broken: false, sounds: new Set(), minimap: new MiniMapEntity(model.position), workable: undefined!, growable: undefined! };
    const play = (clip: string, then?: string) => sprite.playOnce(clip, then ? () => sprite.playOnce(then) : undefined);
    const lootdropper = new LootDropper(inst, (prefab, point) => {
      const prepared = shrub.loot.get(prefab)?.shift();
      if (!prepared) return undefined;
      const spawned = prepared.spawn(new THREE.Vector3(point.x, point.y, point.z));
      if (!spawned) prepared.dispose();
      return spawned ? prepared.spawnedEntity : undefined;
    });
    // marbleshrub.lua SetGrowth: stage data, idle pose and a fresh mining workload.
    const setGrowth = (stage: number) => {
      shrub.stage = STAGES[stage - 1];
      play(shrub.stage.idle);
      shrub.workable.SetWorkLeft(shrub.stage.workleft);
    };
    const growTime = () => MARBLESHRUB_GROW_TIME.base + (Math.random() * 2 - 1) * MARBLESHRUB_GROW_TIME.random;
    // DoGrow: the stage's grow animation and sound, then its idle pose.
    const stages = STAGES.map((_, index) => ({
      time: growTime, fn: () => setGrowth(index + 1),
      growfn: () => {
        play(shrub.stage.grow, shrub.stage.idle);
        shrub.sounds.add(PlaySound(shrub.stage.growsound, model.position));
      },
    }));
    shrub.growable = new Growable(this.scheduler, stages);
    shrub.growable.loopstages = true;
    shrub.workable = new Workable(inst);
    shrub.workable.SetWorkAction('MINE');
    shrub.workable.SetWorkLeft(STAGES[0].workleft);
    shrub.workable.SetOnWorkCallback((_worker, workleft) => {
      if (workleft > 0) { play(shrub.stage.hit); return; }
      // onworked: break pose, rock_break_fx, loot at the shrub, then no collision, NOCLICK and removal at animover.
      shrub.broken = true;
      sprite.playOnce(shrub.stage.broken, () => this.remove(model));
      shrub.sounds.add(PlaySound('dontstarve/wilson/rock_break', model.position));
      for (const prefab of shrub.stage.loot(chance => Math.random() <= chance)) lootdropper.SpawnLootPrefab(prefab, inst.getPosition());
      this.releaseBody(shrub);
    });
    Object.assign(model.userData.components, { growable: shrub.growable, workable: shrub.workable, lootdropper });
    this.shrubs.set(model, shrub);
    // SetupShrubShape: shape 1 keeps the constructor icon, others use marbleshrub<n>.png.
    shrub.minimap.SetIcon(`marbleshrub${shapenumber}.png`); shrub.minimap.SetPriority(-1);
    // weather.lua SNOW_COVERED_THRESHOLD.
    const snowLevel = this.world.getWatchWorldContent?.(WorldContentKey.SnowLevel, stop => { shrub.stopSnow = stop; });
    if (snowLevel) createEffect(() => sprite.setSymbolHidden('snow', snowLevel.get() < .015));
    if (this.world.physics) {
      shrub.body = MakeObstaclePhysics(model.position, PHYSICS_RADIUS);
      model.userData.physicsBody = shrub.body;
      this.world.physics.addBody(shrub.body);
    }
    if (saved) {
      // OnLoad restores shape/colour through the sprite; growable:OnLoad re-enters the saved stage.
      shrub.growable.OnLoad(saved.components.growable);
    } else {
      shrub.growable.SetStage(startStage); shrub.growable.StartGrowing();
      if (fromSeed) {
        // GrowFromSeed: stage 1 again, the seed-to-short animation and the grow sound.
        shrub.growable.SetStage(1);
        play('grow_seed_to_short', shrub.stage.idle);
        shrub.sounds.add(PlaySound('dontstarve/common/together/marble_shrub/grow', model.position));
      }
    }
    this.scene.add(model);
    return model;
  }

  update(dt: number, quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    if (this.ownsScheduler) this.scheduler.advance(dt);
    for (const { sprite } of this.shrubs.values()) { sprite.model.quaternion.copy(quaternion); sprite.update(dt); }
  }

  get renderEntities() {
    return [...this.shrubs.values()].map(({ sprite }) => ({ object: sprite.model, footPosition: sprite.model.position, cameraDepth: 0 }));
  }

  get miniMapEntities(): MiniMapEntity[] { return [...this.shrubs.values()].map(({ minimap }) => minimap); }

  get mineTargets(): PickaxeTarget[] {
    return [...this.shrubs].filter(([, shrub]) => !shrub.broken && shrub.workable.CanBeWorked()).map(([model, shrub]) => ({
      id: String(model.userData.entityId), model, position: model.position, entity: actionEntity(model, MARBLESHRUB_ID),
      isValid: () => this.shrubs.get(model) === shrub && !shrub.broken && shrub.workable.CanBeWorked(),
    }));
  }

  /** persists = false once mined: the breaking shrub is not exported. */
  exportRecords(): MarbleShrubRecord[] {
    this.scheduler.advanceTo(this.scheduler.now);
    return [...this.shrubs].filter(([, shrub]) => !shrub.broken).map(([model, shrub]) => ({
      id: String(model.userData.entityId),
      transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
      components: { growable: shrub.growable.OnSave(),
        marbleShrub: { ...shrub.shapenumber === 1 ? {} : { shapenumber: shrub.shapenumber }, color: shrub.color } },
    }));
  }

  private releaseBody(shrub: Shrub): void {
    if (shrub.body) this.world.physics?.removeBody(shrub.body);
    shrub.body = undefined;
  }

  private remove(model: THREE.Group): void {
    const shrub = this.shrubs.get(model); if (!shrub) return;
    this.shrubs.delete(model); model.userData.removed = true;
    this.releaseBody(shrub);
    shrub.stopSnow?.(); shrub.minimap.dispose();
    shrub.growable.dispose(); shrub.workable.dispose();
    for (const sound of shrub.sounds) sound.stop();
    for (const outputs of shrub.loot.values()) outputs.forEach(output => output.dispose());
    shrub.loot.clear(); shrub.sprite.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of [...this.shrubs.keys()]) this.remove(model);
    this.assets.dispose();
    if (this.ownsScheduler) this.scheduler.dispose();
  }
}

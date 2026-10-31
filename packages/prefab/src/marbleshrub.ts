import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import { modelEntries } from './modelRecords';
import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { SpriteResources, type ArchiveSpriteCommands, type PrefabDisplay } from '@dontstarve-web/display';
import { createArchiveEntity, type PrefabInstance, prefabInstance } from './prefabInstance';
import { watchTileActivity } from './tileActivity';
import { ComponentTimer } from '../../componets/src/timer';
import type { PickaxeTarget } from '@dontstarve-web/stategraphs/mine';
import { createRenderEffect, WorldContentKey, type GetWatchWorldContent, type TileStateQuery } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Growable, type GrowableSave } from '../../componets/src/growable';
import { LootDropper } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import type { MiniMapState } from '../../map/src/minimapState';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { MakeObstaclePhysics, RemovePhysicsColliders } from './standardcomponents';
import type { SpawnGroundItem } from './groundPrefab';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
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
  /** The `broken` clip's length in marbleshrub.zip; its animover removes the mined shrub. */
  brokenSeconds: number;
  workleft: number; loot(roll: (chance: number) => boolean): string[];
}
// marbleshrub.lua statedata; TryLuckRoll(worker, chance) without luck is a plain roll.
const STAGES: readonly StageData[] = [
  { idle: 'idle_short', hit: 'hit_short', broken: 'mined_short', brokenSeconds: 32 / 30, grow: 'grow_tall_to_short',
    growsound: 'dontstarve/common/together/marble_shrub/wilt_to_grow', workleft: 6, loot: () => ['marble'] },
  { idle: 'idle_normal', hit: 'hit_normal', broken: 'mined_normal', brokenSeconds: 32 / 30, grow: 'grow_short_to_normal',
    growsound: 'dontstarve/common/together/marble_shrub/grow', workleft: 8,
    loot: roll => roll(MED_MARBLEBEAN_CHANCE) ? ['marble'] : ['marble', 'marblebean'] },
  { idle: 'idle_tall', hit: 'hit_tall', broken: 'mined_tall', brokenSeconds: 32 / 30, grow: 'grow_normal_to_tall',
    growsound: 'dontstarve/common/together/marble_shrub/grow', workleft: 10,
    loot: roll => ['marble', roll(TALL_MARBLEBEAN_CHANCE) ? 'marble' : 'marblebean'] },
];

/** marbleshrub.lua OnSave: shapenumber is written only when it is not 1; color is always written. */
export interface MarbleShrubSaveState { shapenumber?: number; color: number; }
export interface MarbleShrubRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { growable: GrowableSave; marbleShrub: MarbleShrubSaveState };
}

export interface MarbleShrubWorld extends ToolMouseTargetWorld {
  scheduler?: GameTimeScheduler;
  tickingarea?: TileStateQuery;
  physics?: CANNON.World;
  /** Snow level is read through a lifecycle-managed bridge owned by each shrub. */
  getWatchWorldContent?: GetWatchWorldContent;
  /** lootdropper:SpawnLootPrefab when the shrub is mined; the loot's display loads its art. */
  spawnGroundItem: SpawnGroundItem;
}

interface Shrub {
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  sprite: ArchiveSpriteCommands;
  completion: ComponentTimer;
  stopActivity?: () => void;
  stopAppearance?: () => void;
  growable: Growable;
  workable: Workable;
  shapenumber: number;
  color: number;
  stage: StageData;
  /** Mined: the shrub plays its break animation and is gone at animover (persists = false). */
  broken: boolean;
  minimap: MiniMapState;
  stopSnow?: () => void;
  sounds: Set<SoundHandle>;
}

/** marbleshrub.lua: growable loop, MINE workable, stage-dependent loot and shape/colour persistence. */
export class MarbleShrubManager {
  private readonly displays: PrefabDisplayGroup;
  private readonly world: MarbleShrubWorld;
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly resources = new SpriteResources();
  private readonly shrubs = new Map<THREE.Group, Shrub>();
  private disposed = false;

  constructor(scene: THREE.Scene, world: MarbleShrubWorld) {
    this.displays = new PrefabDisplayGroup(scene); this.world = world;
    this.scheduler = world.scheduler ?? new GameTimeScheduler();
    this.ownsScheduler = !world.scheduler;
  }

  /** `c_spawn("marbleshrub_<stage>")`, or a saved record; the saved growable restores the stage and its remaining time. */
  spawn(prefabId: MarbleShrubSpawnId, position: THREE.Vector3, saved?: MarbleShrubRecord): THREE.Group {
    const stage = Math.max(1, MARBLESHRUB_SPAWN_IDS.indexOf(prefabId));
    return this.createShrub(position, saved?.components.marbleShrub.shapenumber ?? 1, saved?.components.marbleShrub.color ?? 1, stage, saved);
  }

  /** marbleshrub.lua growfromseed: random shape and colour, stage 1, then `grow_seed_to_short`; the display loads the art. */
  growFromSeed(position: THREE.Vector3): THREE.Group {
    return this.createShrub(position, 1 + Math.floor(Math.random() * NUM_BUILDS), .5 + Math.random() * .5, 1, undefined, true);
  }

  private createShrub(position: THREE.Vector3, shapenumber: number, color: number, startStage: number, saved?: MarbleShrubRecord, fromSeed = false): THREE.Group {
    if (this.disposed) throw new Error('Marble shrubs disposed');
    if (!Number.isInteger(shapenumber) || shapenumber < 1 || shapenumber > NUM_BUILDS) throw new RangeError('Invalid marble shrub shape');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid marble shrub position');
    // Each shrub owns its colour (setColour), so its sprites are created with one.
    const entity = createArchiveEntity(MARBLESHRUB_ID, this.resources.archive({
      animationArchive: 'marbleshrub.zip', buildArchives: ['marbleshrub.zip', 'marbleshrub_build.zip', 'snow.zip'],
      bank: 'marbleshrub', hiddenSymbols: ['snow'],
    }, { instancedAnimations: 'all', staticBillboard: true, colour: [1, 1, 1] }), { name: STAGES[0].idle, billboard: true }, MARBLESHRUB_ID);
    return this.create(entity, position, shapenumber, color, startStage, saved, fromSeed);
  }

  private create({ instance, display }: ReturnType<typeof createArchiveEntity>, position: THREE.Vector3, shapenumber: number, color: number,
    startStage: number, saved: MarbleShrubRecord | undefined, fromSeed: boolean): THREE.Group {
    const model = display.model;
    const sprite = instance.sprite;

    model.position.set(position.x, 0, position.z);
    instance.entityId = saved?.id ?? newEntityId();
    Object.assign(model.userData, { deploySmartRadius: 1 });
    for (const tag of ['boulder', 'SnowCovered']) instance.addTag(tag);
    const inst = actionEntity(model, MARBLESHRUB_ID);
    const shrub: Shrub = { instance, display, sprite, completion: new ComponentTimer(this.scheduler, () => this.remove(model)), shapenumber, color, stage: STAGES[0], broken: false, sounds: new Set(), minimap: instance.minimap, workable: undefined!, growable: undefined! };
    const play = (clip: string, then?: string) => sprite.playOnce(clip, then ? () => sprite.playOnce(then) : undefined);
    const lootdropper = new LootDropper(inst, (prefab, point) => this.world.spawnGroundItem(
      { ...catalog.items[prefab as keyof typeof catalog.items], itemId: prefab, count: 1 }, new THREE.Vector3(point.x, point.y, point.z), { fling: true }));
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
      inst.addTag('NOCLICK');
      shrub.instance.persists = false;
      sprite.playOnce(shrub.stage.broken);
      shrub.completion.start(STAGES[shrub.growable.GetStage() - 1].brokenSeconds);
      shrub.sounds.add(PlaySound('dontstarve/wilson/rock_break', model.position));
      for (const prefab of shrub.stage.loot(chance => Math.random() <= chance)) lootdropper.SpawnLootPrefab(prefab, inst.getPosition());
      RemovePhysicsColliders(instance);
    });
    Object.assign(prefabInstance(model)!.components, { growable: shrub.growable, workable: shrub.workable, lootdropper });
    new ToolMouseTarget(inst, instance, shrub.workable, this.world.handEquipment);
    this.shrubs.set(model, shrub);
    // SetupShrubShape: shape 1 keeps the constructor icon, others use marbleshrub<n>.png.
    shrub.minimap.SetIcon(`marbleshrub${shapenumber}.png`); shrub.minimap.SetPriority(-1);
    // weather.lua SNOW_COVERED_THRESHOLD.
    const snowLevel = this.world.getWatchWorldContent?.(WorldContentKey.SnowLevel, stop => { shrub.stopSnow = stop; });
    sprite.setColour([color, color, color]);
    sprite.setSymbolOverride('snow', 'snow.zip', 'snow');
    sprite.setSymbolOverride('marbleshrub_top1', shapenumber === 1 ? undefined : 'marbleshrub_build.zip', `marbleshrub_top${shapenumber}`);
    shrub.stopAppearance = createRenderEffect(() => sprite.setSymbolHidden('snow', (snowLevel?.get() ?? 0) < .015));
    MakeObstaclePhysics(instance, PHYSICS_RADIUS);
    if (this.world.physics) instance.bindPhysics(this.world.physics);
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
    this.displays.mount(prefabDisplay(model)!);
    shrub.stopActivity = watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active));
    return model;
  }

  update(dt: number, _quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    if (this.ownsScheduler) this.scheduler.advance(dt);
    this.displays.update(dt);
  }

  get renderEntities() {
    return [...this.shrubs].filter(([, { sprite }]) => sprite.loaded).map(([model]) => ({ object: model, footPosition: model.position, cameraDepth: 0 }));
  }


  get mineTargets(): PickaxeTarget[] { return this.getMineTargets(); }

  getMineTargets(model?: THREE.Object3D): PickaxeTarget[] {
    return modelEntries(this.shrubs, model).filter(([, shrub]) => !shrub.broken && shrub.workable.CanBeWorked()).map(([model, shrub]) => ({
      id: String(shrub.instance.entityId), model, position: model.position, entity: actionEntity(model, MARBLESHRUB_ID),
      isValid: () => this.shrubs.get(model) === shrub && !shrub.broken && shrub.workable.CanBeWorked(),
    }));
  }

  /** persists = false once mined: the breaking shrub is not exported. */
  exportRecords(): MarbleShrubRecord[] {
    this.scheduler.advanceTo(this.scheduler.now);
    return [...this.shrubs].filter(([, shrub]) => !shrub.broken).map(([model, shrub]) => ({
      id: String(shrub.instance.entityId),
      transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
      components: { growable: shrub.growable.OnSave(),
        marbleShrub: { ...shrub.shapenumber === 1 ? {} : { shapenumber: shrub.shapenumber }, color: shrub.color } },
    }));
  }

  private remove(model: THREE.Group): void {
    const shrub = this.shrubs.get(model); if (!shrub) return;
    this.shrubs.delete(model); model.userData.removed = true;
    shrub.stopActivity?.(); shrub.stopAppearance?.();
    shrub.stopSnow?.(); shrub.completion.stop();
    shrub.growable.dispose(); shrub.workable.dispose();
    for (const sound of shrub.sounds) sound.stop();
    shrub.instance.remove();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of [...this.shrubs.keys()]) this.remove(model);
    this.displays.dispose(); this.resources.dispose();
    if (this.ownsScheduler) this.scheduler.dispose();

  }
}

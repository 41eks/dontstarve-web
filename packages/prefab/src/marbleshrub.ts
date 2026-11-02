import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { SpriteResources, SpriteState, type PrefabDisplayGroup } from '@dontstarve-web/display';
import { createRenderEffect, WorldContentKey, type GetWatchWorldContent, type TileStateQuery } from '@dontstarve-web/signals';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Growable, type GrowableSave } from '../../componets/src/growable';
import { LootDropper } from '../../componets/src/lootdropper';
import { ComponentTimer } from '../../componets/src/timer';
import { Workable } from '../../componets/src/workable';
import { actionEntity } from './actionEntity';
import type { SpawnGroundItem } from './groundPrefab';
import { bindInstance, PrefabInstance } from './prefabInstance';
import { newEntityId } from './saveRecord';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
import { MakeObstaclePhysics, RemovePhysicsColliders } from './standardcomponents';
import { watchTileActivity } from './tileActivity';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
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
  scheduler: GameTimeScheduler;
  tickingarea?: TileStateQuery;
  physics?: CANNON.World;
  /** Snow level is read through a lifecycle-managed bridge owned by each shrub. */
  getWatchWorldContent?: GetWatchWorldContent;
  /** lootdropper:SpawnLootPrefab when the shrub is mined; the loot's display loads its art. */
  spawnGroundItem: SpawnGroundItem;
}

/** marbleshrub.lua MakeShrub's fn(): growable loop, MINE workable, stage-dependent loot and shape/colour persistence. */
export class MarbleShrubInstance extends PrefabInstance {
  shapenumber = 1;
  color = 1;
  private statedata: StageData;
  private readonly sounds = new Set<SoundHandle>();
  /** The `animover` that removes a mined shrub, as a game-time task. */
  private readonly brokenTask: ComponentTimer;

  constructor(position: THREE.Vector3, world: MarbleShrubWorld, growthstage: number) {
    super(MARBLESHRUB_ID, new SpriteState({ name: 'idle_short', billboard: true }),
      { position: new THREE.Vector3(position.x, 0, position.z), scale: new THREE.Vector3(1, 1, 1) });
    const { scheduler, getWatchWorldContent, spawnGroundItem } = world;
    this.statedata = STAGES[growthstage - 1];
    this.brokenTask = new ComponentTimer(scheduler, () => this.remove());

    MakeObstaclePhysics(this, PHYSICS_RADIUS);
    this.deploySmartRadius = 1;
    this.minimap.SetIcon('marbleshrub1.png'); this.minimap.SetPriority(-1);
    for (const tag of ['boulder', 'SnowCovered']) this.addTag(tag);

    // MakeSnowCovered, with weather.lua's SNOW_COVERED_THRESHOLD.
    let stopWatchingSnow: (() => void) | undefined;
    const snowLevel = getWatchWorldContent?.(WorldContentKey.SnowLevel, stop => { stopWatchingSnow = stop; });
    this.sprite.setSymbolOverride('snow', 'snow.zip', 'snow');
    const stopSnow = createRenderEffect(() => this.sprite.setSymbolHidden('snow', (snowLevel?.get() ?? 0) < .015));

    const growTime = () => MARBLESHRUB_GROW_TIME.base + (Math.random() * 2 - 1) * MARBLESHRUB_GROW_TIME.random;
    const growable = new Growable(scheduler, STAGES.map((_, index) => ({
      time: growTime, fn: () => this.SetGrowth(index + 1), growfn: () => this.DoGrow(),
    })));
    growable.loopstages = true;

    const lootdropper = new LootDropper(this, (prefab, point) => spawnGroundItem(
      { ...catalog.items[prefab as keyof typeof catalog.items], itemId: prefab, count: 1 }, new THREE.Vector3(point.x, point.y, point.z), { fling: true }));

    const workable = new Workable(this);
    workable.SetWorkAction('MINE');
    workable.SetWorkLeft(STAGES[0].workleft);
    workable.SetOnWorkCallback((_inst, _worker, workleft) => this.onworked(workleft));
    Object.assign(this.components, { growable, lootdropper, workable });

    growable.SetStage(growthstage);
    growable.StartGrowing();

    this.onRemove(() => {
      stopSnow(); stopWatchingSnow?.();
      this.brokenTask.stop();
      growable.dispose(); workable.dispose();
      for (const sound of this.sounds) sound.stop();
    });
  }

  private SetGrowth(stage: number): void {
    this.statedata = STAGES[stage - 1];
    this.sprite.playOnce(this.statedata.idle);
    this.components.workable!.SetWorkLeft(this.statedata.workleft);
  }

  private DoGrow(): void {
    this.sprite.playOnce(this.statedata.grow);
    this.sprite.pushAnimation(this.statedata.idle, false);
    this.sounds.add(PlaySound(this.statedata.growsound, this.position));
  }

  private SetupShrubShape(buildnum: number): void {
    this.shapenumber = buildnum;
    if (buildnum === 1) return;
    this.sprite.setSymbolOverride('marbleshrub_top1', 'marbleshrub_build.zip', `marbleshrub_top${buildnum}`);
    this.minimap.SetIcon(`marbleshrub${buildnum}.png`);
  }

  private SetMultColour(color: number): void {
    this.color = color;
    this.sprite.setColour([color, color, color]);
  }

  /** inst.growfromseed, called by the sapling that this shrub replaces. */
  growfromseed(): void {
    this.SetupShrubShape(1 + Math.floor(Math.random() * NUM_BUILDS));
    this.SetMultColour(.5 + Math.random() * .5);
    this.components.growable!.SetStage(1);
    this.sprite.playOnce('grow_seed_to_short');
    this.sprite.pushAnimation('idle_short', false);
    this.sounds.add(PlaySound('dontstarve/common/together/marble_shrub/grow', this.position));
  }

  private onworked(workleft: number): void {
    if (workleft > 0) { this.sprite.playOnce(this.statedata.hit); return; }
    this.sprite.playOnce(this.statedata.broken);
    this.sounds.add(PlaySound('dontstarve/wilson/rock_break', this.position));
    for (const prefab of this.statedata.loot(chance => Math.random() <= chance)) this.components.lootdropper!.SpawnLootPrefab(prefab, this.position);
    RemovePhysicsColliders(this);
    this.addTag('NOCLICK');
    this.persists = false;
    this.brokenTask.start(this.statedata.brokenSeconds);
  }

  /** onsave, with the growable's own save. */
  saveComponents(): MarbleShrubRecord['components'] {
    return { growable: this.components.growable!.OnSave(),
      marbleShrub: { ...this.shapenumber === 1 ? {} : { shapenumber: this.shapenumber }, color: this.color } };
  }

  /** onload, then growable:OnLoad re-entering the saved stage, which SetGrowth makes the shrub's statedata (onloadpostpass). */
  loadComponents({ growable, marbleShrub }: MarbleShrubRecord['components']): void {
    this.SetupShrubShape(marbleShrub.shapenumber ?? 1);
    this.SetMultColour(marbleShrub.color);
    this.components.growable!.OnLoad(growable);
  }
}

/** The shrubs of a world: their collection, injected world and shared marbleshrub art. */
export class MarbleShrubManager {
  private readonly displays: PrefabDisplayGroup;
  private readonly world: MarbleShrubWorld;
  private readonly resources = new SpriteResources();
  private readonly shrubs = new Set<MarbleShrubInstance>();
  private disposed = false;

  /** `displays` is the display-layer owner of the shrubs' scene membership, injected and disposed by the application. */
  constructor(displays: PrefabDisplayGroup, world: MarbleShrubWorld) {
    this.displays = displays; this.world = world;
  }

  /** `c_spawn("marbleshrub_<stage>")`, or a saved record; the shrub exists now and its display loads the art. */
  spawn(prefabId: MarbleShrubSpawnId, position: THREE.Vector3, saved?: MarbleShrubRecord): MarbleShrubInstance {
    if (this.disposed) throw new Error('Marble shrubs disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid marble shrub position');
    const shapenumber = saved?.components.marbleShrub.shapenumber ?? 1;
    if (!Number.isInteger(shapenumber) || shapenumber < 1 || shapenumber > NUM_BUILDS) throw new RangeError('Invalid marble shrub shape');
    const instance = new MarbleShrubInstance(position, this.world, Math.max(1, MARBLESHRUB_SPAWN_IDS.indexOf(prefabId)));
    instance.entityId = saved?.id ?? newEntityId();
    if (saved) instance.loadComponents(saved.components);
    // Each shrub owns its colour (setColour), so its sprites are created with one.
    const display = this.displays.add({ name: MARBLESHRUB_ID, status: instance.status, sprite: instance.sprite, light: instance.light, staticTransform: true,
      archive: this.resources.archive({ animationArchive: 'marbleshrub.zip', buildArchives: ['marbleshrub.zip', 'marbleshrub_build.zip', 'snow.zip'],
        bank: 'marbleshrub', hiddenSymbols: ['snow'] }, { instancedAnimations: 'all', staticBillboard: true, colour: [1, 1, 1] }) });
    bindInstance(display.model, instance);
    if (this.world.physics) instance.bindPhysics(this.world.physics);
    new ToolMouseTarget(actionEntity(display.model, MARBLESHRUB_ID), instance, instance.components.workable, this.world.handEquipment);
    this.shrubs.add(instance);
    const stopActivity = watchTileActivity(display.model, this.world.tickingarea, active => instance.setActive(active));
    instance.onRemove(() => { stopActivity(); this.shrubs.delete(instance); });
    return instance;
  }

  /** The sapling's growtree: SpawnPrefab("marbleshrub_short") at its position, then tree:growfromseed(). */
  growFromSeed(position: THREE.Vector3): MarbleShrubInstance {
    const shrub = this.spawn('marbleshrub_short', position);
    shrub.growfromseed();
    return shrub;
  }

  /** The display group advances the awake shrubs' clips; growth runs on the world's scheduler. */
  update(dt: number): void {
    if (!this.disposed) this.displays.update(dt);
  }

  get renderEntities() { return this.displays.renderEntities; }

  /** persists = false once mined: the breaking shrub is not exported. */
  exportRecords(): MarbleShrubRecord[] {
    return [...this.shrubs].filter(shrub => shrub.persists).map(shrub => ({
      id: String(shrub.entityId),
      transform: { position: [shrub.position.x, 0, shrub.position.z], rotationY: 0 },
      components: shrub.saveComponents(),
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const shrub of [...this.shrubs]) shrub.remove();
    // Every shrub's display is released above, before the shared resources.
    this.resources.dispose();
  }
}

import { Transform } from './transform';
import * as THREE from 'three';
import { SpriteState } from '@dontstarve-web/display';
import { createRenderEffect, WorldContentKey, type GetWatchWorldContent } from '@dontstarve-web/signals';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Growable } from '../../componets/src/growable';
import { LootDropper } from '../../componets/src/lootdropper';
import { ComponentTimer } from '../../componets/src/timer';
import { Workable } from '../../componets/src/workable';
import { actionEntity } from './actionEntity';
import type { SpawnGroundItem } from './groundPrefab';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
import { MakeObstaclePhysics, RemovePhysicsColliders } from './standardcomponents';
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

export interface MarbleShrubWorld extends ToolMouseTargetWorld {
  scheduler: GameTimeScheduler;
  /** Snow level is read through a lifecycle-managed bridge owned by each shrub. */
  getWatchWorldContent?: GetWatchWorldContent;
  /** lootdropper:SpawnLootPrefab when the shrub is mined; the loot's display loads its art. */
  spawnGroundItem: SpawnGroundItem;
}

/**
 * marbleshrub.lua MakeShrub's fn(): growable loop, MINE workable, stage-dependent loot and shape/colour persistence.
 * SetPrefabName("marbleshrub"): every spawn ID saves as marbleshrub; the ID only chooses the starting stage.
 */
export class MarbleShrubInstance extends PrefabInstance {
  shapenumber = 1;
  color = 1;
  private statedata: StageData;
  private readonly sounds = new Set<SoundHandle>();
  /** The `animover` that removes a mined shrub, as a game-time task. */
  private readonly brokenTask: ComponentTimer;

  constructor(position: ReadonlyVector3, world: MarbleShrubWorld, growthstage: number) {
    super(MARBLESHRUB_ID, new SpriteState({ name: 'idle_short', billboard: true }),
      Transform.stationary());
    this.setPosition(position.x, 0, position.z);
    const { scheduler, getWatchWorldContent, spawnGroundItem } = world;
    this.statedata = STAGES[growthstage - 1];
    this.brokenTask = new ComponentTimer(scheduler, () => this.remove());

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

    // onsave: shapenumber only when it is not 1, color always; the growable saves itself.
    this.OnSave = (_inst, data) => {
      data.marbleShrub = { ...this.shapenumber === 1 ? {} : { shapenumber: this.shapenumber }, color: this.color };
    };
    // onload; growable:OnLoad (run first by SetPersistData) re-enters the saved stage, which SetGrowth makes the statedata.
    this.OnLoad = (_inst, data) => {
      if (!data.marbleShrub) return;
      const shapenumber = data.marbleShrub.shapenumber ?? 1;
      if (!Number.isInteger(shapenumber) || shapenumber < 1 || shapenumber > NUM_BUILDS) throw new RangeError('Invalid marble shrub shape');
      this.SetupShrubShape(shapenumber);
      this.SetMultColour(data.marbleShrub.color);
    };
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

}

/** The Prefabs marbleshrub.lua returns: MakeShrub("marbleshrub") and its short / normal / tall stages. */
export function marbleShrubPrefabs(world: MarbleShrubWorld): Readonly<Record<MarbleShrubSpawnId, PrefabEntityDefinition<MarbleShrubInstance>>> {
  const define = (prefab: MarbleShrubSpawnId): PrefabEntityDefinition<MarbleShrubInstance> => ({
    fn: position => new MarbleShrubInstance(position, world, Math.max(1, MARBLESHRUB_SPAWN_IDS.indexOf(prefab))),
    // Each shrub owns its colour (SetMultColour), so its sprites are created with one.
    assets: { animationArchive: 'marbleshrub.zip', buildArchives: ['marbleshrub.zip', 'marbleshrub_build.zip', 'snow.zip'],
      bank: 'marbleshrub', hiddenSymbols: ['snow'] },
    assetOptions: { instancedAnimations: 'all', staticBillboard: true, colour: [1, 1, 1] },
    physics: { make: MakeObstaclePhysics, radius: PHYSICS_RADIUS },
    onSpawned: inst => { new ToolMouseTarget(actionEntity(inst.transform.model, MARBLESHRUB_ID), inst, inst.components.workable, world.handEquipment); },
  });
  return Object.fromEntries(MARBLESHRUB_SPAWN_IDS.map(prefab => [prefab, define(prefab)])) as Record<MarbleShrubSpawnId, PrefabEntityDefinition<MarbleShrubInstance>>;
}

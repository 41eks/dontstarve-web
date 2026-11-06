import * as THREE from 'three';
import { SpriteState } from '@dontstarve-web/display';
import { createRenderEffect, WorldContentKey, type GetWatchWorldContent } from '@dontstarve-web/signals';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import { MakeObstaclePhysics, RemovePhysicsColliders } from './standardcomponents';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ErodeAway } from '../../componets/src/erodeaway';
import { LootDropper, SetSharedLootTable, type ChanceLootTable } from '../../componets/src/lootdropper';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { LunarHailBuildup } from '../../componets/src/pandoraschestSignatures';
import { FRAMES } from '../../stategraphs/src/stategraph';
import { actionEntity } from './actionEntity';
import { addComponent } from './components';
import { Transform } from './transform';
import type { SpawnGroundItem } from './groundPrefab';
import catalog from './groundItems.json' with { type: 'json' };
import { PlaySound } from './sound';
import { MOONROCKSEED_ID } from './moonrockseed';

export const ROCK_PREFABS = ['rock1', 'rock2', 'rock_flintless', 'rock_flintless_med', 'rock_flintless_low',
  'rock_moon_shell', 'rock_moon'] as const;
export type RockPrefabId = typeof ROCK_PREFABS[number];

/** tuning.lua ROCKS_MINE, ROCKS_MINE_MED and ROCKS_MINE_LOW. */
const ROCKS_MINE = 6, ROCKS_MINE_MED = 4, ROCKS_MINE_LOW = 2;

/** baserock_fn's bank, build, anim, minimap icon and tag per Prefab, with each fn's work and loot table. */
interface RockDefinition {
  bank: string;
  build: string;
  anim: 'full' | 'med' | 'low';
  minimapicon: string;
  tag?: string;
  workleft: number;
  loot: ChanceLootTable;
}

const ROCKS: Readonly<Record<RockPrefabId, RockDefinition>> = {
  rock1: { bank: 'rock', build: 'rock', anim: 'full', minimapicon: 'rock.png', workleft: ROCKS_MINE,
    loot: [['rocks', 1], ['rocks', 1], ['rocks', 1], ['nitre', 1], ['flint', 1], ['nitre', .25], ['flint', .6]] },
  rock2: { bank: 'rock2', build: 'rock2', anim: 'full', minimapicon: 'rock_gold.png', workleft: ROCKS_MINE,
    loot: [['rocks', 1], ['rocks', 1], ['rocks', 1], ['goldnugget', 1], ['flint', 1], ['goldnugget', .25], ['flint', .6]] },
  rock_flintless: { bank: 'rock_flintless', build: 'rock_flintless', anim: 'full', minimapicon: 'rock_flintless.png', workleft: ROCKS_MINE,
    loot: [['rocks', 1], ['rocks', 1], ['rocks', 1], ['rocks', 1], ['rocks', .6]] },
  rock_flintless_med: { bank: 'rock_flintless', build: 'rock_flintless', anim: 'med', minimapicon: 'rock_flintless.png', workleft: ROCKS_MINE_MED,
    loot: [['rocks', 1], ['rocks', 1], ['rocks', 1], ['rocks', .4]] },
  rock_flintless_low: { bank: 'rock_flintless', build: 'rock_flintless', anim: 'low', minimapicon: 'rock_flintless.png', workleft: ROCKS_MINE_LOW,
    loot: [['rocks', 1], ['rocks', 1], ['rocks', .2]] },
  rock_moon_shell: { bank: 'moonrock_shell', build: 'moonrock_shell', anim: 'full', minimapicon: 'rock_moon.png', tag: 'meteor_protection', workleft: ROCKS_MINE,
    loot: [['rocks', 1], ['flint', 1], ['moonrocknugget', 1], ['moonrocknugget', 1], ['moonrocknugget', 1], ['moonrocknugget', .3]] },
  rock_moon: { bank: 'rock5', build: 'rock7', anim: 'full', minimapicon: 'rock_moon.png', workleft: ROCKS_MINE,
    loot: [['rocks', 1], ['flint', 1], ['moonrocknugget', 1], ['moonrocknugget', 1], ['moonrocknugget', .6], ['moonrocknugget', .3]] },
};

for (const prefab of ROCK_PREFABS) SetSharedLootTable(prefab, ROCKS[prefab].loot);

export function isRockPrefab(value: string): value is RockPrefabId {
  return (ROCK_PREFABS as readonly string[]).includes(value);
}

/** The archives a save scan warms for a rock prefab; the moon shell also drops its orb. */
export function rockArchives(prefab: RockPrefabId) {
  return [{ animation: `${ROCKS[prefab].build}.zip`, build: `${ROCKS[prefab].build}.zip` },
    ...(prefab === 'rock_moon_shell' ? [{ animation: 'moonrock_seed.zip', build: 'moonrock_seed.zip' }] : [])];
}

export interface RockWorld extends ToolMouseTargetWorld {
  scheduler: GameTimeScheduler;
  getWatchWorldContent?: GetWatchWorldContent;
  /** lootdropper:SpawnLootPrefab when the rock is mined out; the loot's display loads its art. */
  spawnGroundItem: SpawnGroundItem;
}

export interface RockShellWorld extends RockWorld {
  /** SpawnPrefab("moonrockseed") where the shell breaks. */
  spawnPrefab(prefab: typeof MOONROCKSEED_ID, position: THREE.Vector3): PrefabInstance;
}

/** rocks.lua baserock_fn: MakeObstaclePhysics is the definition's `physics`, the minimap icon its `minimapIcon`. */
export class RockInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { lootdropper: LootDropper; hauntable: Hauntable };
  /** inst.doNotRemoveOnWorkDone: OnWork drops the loot and leaves the entity to its workfinished listener. */
  doNotRemoveOnWorkDone = false;

  constructor(prefab: string, world: RockWorld, anim: string, tag?: string, multcolour = .5) {
    super(prefab, new SpriteState({ name: anim, billboard: true }), Transform.stationary());
    this.sprite.playOnce(anim); // PlayAnimation(anim), never looping.
    // MakeSnowCoveredPristine, then MakeSnowCovered with weather.lua's SNOW_COVERED_THRESHOLD.
    this.sprite.setSymbolOverride('snow', 'snow.zip', 'snow');
    this.addTag('SnowCovered');
    this.addTag('boulder');
    if (tag) this.addTag(tag);

    const lootdropper = new LootDropper(this, (loot, position) => world.spawnGroundItem(
      { ...catalog.items[loot as keyof typeof catalog.items], itemId: loot, count: 1 },
      new THREE.Vector3(position.x, position.y, position.z), { fling: true }));
    const workable = addComponent(this as RockInstance, 'workable');
    workable.SetWorkAction('MINE'); workable.SetWorkLeft(ROCKS_MINE);
    workable.SetOnWorkCallback(OnWork);
    if (0 <= multcolour && multcolour < 1) {
      const colour = multcolour + Math.random() * (1 - multcolour);
      this.sprite.setColour([colour, colour, colour]);
    }
    let stopWatchingSnow: (() => void) | undefined;
    const snowLevel = world.getWatchWorldContent?.(WorldContentKey.SnowLevel, stop => { stopWatchingSnow = stop; });
    const stopSnow = createRenderEffect(() => this.sprite.setSymbolHidden('snow', (snowLevel?.get() ?? 0) < .015));
    const hauntable = new Hauntable(this, world.scheduler);
    hauntable.SetOnHauntFn(() => false); // MakeHauntableWork's work code is commented out in source.
    // Constructor-only dependencies: inspectable's tag is its source constructor's, and nameoverride and
    // SetLunarHailBuildupAmountSmall configure behavior these classes do not have yet.
    this.addTag('inspectable');
    Object.assign(this.components, { lootdropper, hauntable, inspectable: new Inspectable(this), lunarhailbuildup: new LunarHailBuildup(this) });
    this.onRemove(() => { stopSnow(); stopWatchingSnow?.(); hauntable.dispose(); });
  }
}

/** rocks.lua OnWork; worker.components.spooked is skipped because no worker has that component yet. */
function OnWork(inst: RockInstance, _worker: unknown, workleft: number): void {
  if (workleft <= 0) {
    // rock_break_fx.lua has no art: its local proxy only plays this sound.
    PlaySound('dontstarve/wilson/rock_break', inst.position);
    inst.components.lootdropper.DropLoot(inst.position);
    if (!inst.doNotRemoveOnWorkDone) inst.remove();
  } else {
    inst.sprite.playOnce(workleft < ROCKS_MINE / 3 ? 'low' : workleft < ROCKS_MINE * 2 / 3 ? 'med' : 'full');
  }
}

/** rocks.lua rock_moon_shell: the shell outlives its work to break open around a celestial orb. */
export class RockMoonShellInstance extends RockInstance {
  private readonly world: RockShellWorld;
  /** DoTaskInTime(2, ErodeAway), once the shell breaks. */
  readonly erode: ErodeAway;

  constructor(world: RockShellWorld) {
    const { anim, tag } = ROCKS.rock_moon_shell;
    super('rock_moon_shell', world, anim, tag);
    this.world = world;
    this.components.lootdropper.SetChanceLootTable('rock_moon_shell');
    this.doNotRemoveOnWorkDone = true;
    this.erode = new ErodeAway(world.scheduler, amount => this.sprite.setErosion(amount), () => this.remove(), FRAMES);
    this.onRemove(() => this.erode.dispose());
    this.ListenForEvent('workfinished', () => OnRockMoonCapsuleWorkFinished(this));
  }

  spawnSeed(): void { this.world.spawnPrefab(MOONROCKSEED_ID, this.position.clone()); }
}

/** rocks.lua OnRockMoonCapsuleWorkFinished; moonrockseed has no OnSpawned yet. */
function OnRockMoonCapsuleWorkFinished(inst: RockMoonShellInstance): void {
  RemovePhysicsColliders(inst);
  inst.spawnSeed();
  inst.persists = false;
  inst.addTag('NOCLICK');
  inst.sprite.playOnce('break');
  inst.erode.start(2);
}

const rockAssets = (prefab: RockPrefabId) => {
  const { bank, build } = ROCKS[prefab];
  return { animationArchive: `${build}.zip`, buildArchives: [`${build}.zip`, 'snow.zip'], bank, hiddenSymbols: ['snow'] };
};

/** The rock entries in the Prefab table rocks.lua returns, besides the moon glass rock below. */
export function rockPrefabs(world: RockShellWorld): Readonly<Record<RockPrefabId, PrefabEntityDefinition<RockInstance>>> {
  const prefabs = {} as Record<RockPrefabId, PrefabEntityDefinition<RockInstance>>;
  for (const prefab of ROCK_PREFABS) {
    const { anim, tag, workleft, minimapicon } = ROCKS[prefab];
    prefabs[prefab] = {
      fn: () => {
        if (prefab === 'rock_moon_shell') return new RockMoonShellInstance(world);
        const inst = new RockInstance(prefab, world, anim, tag);
        inst.components.lootdropper.SetChanceLootTable(prefab);
        inst.components.workable!.SetWorkLeft(workleft);
        return inst;
      },
      assets: rockAssets(prefab),
      // colour: [1,1,1] gives each instance its own tint in the batch, without changing the shared frames.
      assetOptions: { instancedAnimations: 'all', colour: [1, 1, 1] },
      physics: { make: MakeObstaclePhysics, radius: 1 },
      minimapIcon: minimapicon,
      onSpawned: inst => { new ToolMouseTarget(actionEntity(inst.transform.model, prefab), inst, inst.components.workable!, world.handEquipment); },
    };
  }
  return prefabs;
}

export const MOONGLASS_ROCK_ID = 'moonglass_rock' as const;
/** rocks.lua set_moonglass_type: math.random(4) picks the bank and build, and OnSave keeps the pick. */
export type MoonglassRockType = 1 | 2 | 3 | 4;
SetSharedLootTable('rock_moon_glass', [['moonglass', 1], ['moonglass', 1], ['moonglass', .25]]);

const moonglassRockBank = (type: MoonglassRockType): string => type === 1 ? 'moonglass_rock' : `moonglass_rock${type}`;

/** The saved rocks' banks, so a scan of the save warms their decoders; an unsaved type is only rolled at spawn. */
export function moonglassRockArchives(records: readonly unknown[]) {
  const types = new Set((records as { components?: { rock_type?: MoonglassRockType } }[]).flatMap(record => record.components?.rock_type ?? []));
  return [...types].map(type => ({ animation: `${moonglassRockBank(type)}.zip`, build: `${moonglassRockBank(type)}.zip` }));
}

export type MoonglassRockWorld = RockWorld;

/** rocks.lua rock_moon_glass: multcolour 1.0 leaves the rock untinted. No skin, and SetPrefabName keeps its own name. */
export class MoonglassRockInstance extends RockInstance {
  rock_type!: MoonglassRockType;

  constructor(world: MoonglassRockWorld) {
    super(MOONGLASS_ROCK_ID, world, 'full', 'moonglass', 1);
    this.components.lootdropper.SetChanceLootTable('rock_moon_glass');
    set_moonglass_type(this, 1 + Math.floor(Math.random() * 4) as MoonglassRockType);
    this.OnSave = (_inst, data) => { data.rock_type = this.rock_type; };
    this.OnLoad = (_inst, data) => { if (data.rock_type) set_moonglass_type(this, data.rock_type); };
  }
}

/** The display builds its sprite from this choice: SetBuild and SetBank are the `instanceAssets` declaration below. */
function set_moonglass_type(inst: MoonglassRockInstance, new_type: MoonglassRockType): void {
  inst.rock_type = new_type;
}

/** The moon glass rock's entry in the Prefab table rocks.lua returns; the other rocks are rockPrefabs above. */
export function moonglassRockPrefabs(world: MoonglassRockWorld): Readonly<Record<typeof MOONGLASS_ROCK_ID, PrefabEntityDefinition<MoonglassRockInstance>>> {
  return {
    [MOONGLASS_ROCK_ID]: {
      fn: () => new MoonglassRockInstance(world),
      instanceAssets: inst => {
        const bank = moonglassRockBank(inst.rock_type);
        return { animationArchive: `${bank}.zip`, buildArchives: [`${bank}.zip`, 'snow.zip'], bank, hiddenSymbols: ['snow'] };
      },
      assetOptions: { instancedAnimations: 'all', staticBillboard: true },
      physics: { make: MakeObstaclePhysics, radius: 1 },
      minimapIcon: 'rock_moonglass.png',
      onSpawned: inst => { new ToolMouseTarget(actionEntity(inst.transform.model, MOONGLASS_ROCK_ID), inst, inst.components.workable!, world.handEquipment); },
    },
  };
}

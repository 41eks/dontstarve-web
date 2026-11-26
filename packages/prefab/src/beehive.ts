import { definePrefabIds } from './prefabRegistration';
import { SpriteState } from '@dontstarve-web/display';
import { WorldContentKey, type GetWatchWorldContent, type WorldSeason } from '@dontstarve-web/signals';
import { WorldSettingsTimer } from '../../componets/src/atriumGateSignatures';
import { Burnable } from '../../componets/src/burnable';
import { ChildSpawner, type ChildSpawnerChild } from '../../componets/src/childspawner';
import { Combat } from '../../componets/src/combat';
import { Freezable } from '../../componets/src/freezable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Hauntable } from '../../componets/src/hauntable';
import { Health } from '../../componets/src/health';
import { Inspectable } from '../../componets/src/inspectable';
import { LootDropper } from '../../componets/src/lootdropper';
import { LunarHailBuildup } from '../../componets/src/pandoraschestSignatures';
import { Propagator, PROPAGATOR_CANT_TAGS } from '../../componets/src/propagator';
import { addComponent } from './components';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { type EntityPersistData, structureHealth } from './saveRecord';
import {
  MakeMediumFreezableCharacter,
  MakeObstaclePhysics,
  MakeSnowCovered,
  MakeSnowCoveredPristine,
} from './standardcomponents';
import { TILE_SIZE } from './tile';

export const BEEHIVE_ID = 'beehive' as const;
/**
 * beehive.lua assets: one archive holds the beehive bank and build; MakeSnowCovered's symbol comes from snow.zip and
 * OnFreeze's swap_frozen from frozen.zip.
 */
export const BEEHIVE_ARCHIVES = ['beehive.zip', 'snow.zip', 'frozen.zip'];
/** tuning.lua: seg_time 30, day_time 240. */
const BEEHIVE_BEES = 5;
const BEEHIVE_EMERGENCY_BEES = 8;
const BEEHIVE_EMERGENCY_RADIUS = 20;
const BEEHIVE_RELEASE_TIME = 240 / 6;
const BEEHIVE_REGEN_TIME = 30;
const SPRING_COMBAT_MOD = 1.33;
/** The most bees SeasonalSpawnChanges allows: math.ceil(BEEHIVE_BEES * SPRING_COMBAT_MOD) in spring. */
export const BEEHIVE_MAX_BEES = Math.ceil(BEEHIVE_BEES * SPRING_COMBAT_MOD);
export const BEEHIVE_HEALTH = 200;
/** tuning.lua HAUNT_SMALL. */
const HAUNT_SMALL = 3;
/** MakeLargeBurnable's default burn time. */
const LARGE_BURN_TIME = 30;
const UNIT = TILE_SIZE / 4;

/** What the scene injects into every hive. */
export interface HiveWorld {
  scheduler: GameTimeScheduler;
  getWatchWorldContent?: GetWatchWorldContent;
  /** SpawnPrefab("shatter") for the beehive's MakeMediumFreezableCharacter shatter fx. */
  fx?: Pick<import('./world_fx').WorldFx, 'shatter'>;
}

type HiveChildSpawner<Inst> = ChildSpawner<Inst, ChildSpawnerChild<Inst>>;

/** beehive.lua fn: the components it adds. */
export class BeehiveInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    health: Health;
    childspawner: HiveChildSpawner<BeehiveInstance>;
    worldsettingstimer: WorldSettingsTimer;
    lootdropper: LootDropper;
    burnable: Burnable;
    freezable: Freezable;
    combat: Combat;
    propagator: Propagator;
    lunarhailbuildup: LunarHailBuildup;
    hauntable: Hauntable;
    inspectable: Inspectable;
  };
  scrapbook_anim = 'cocoon_small';
}

/** beehive.lua has no OnSave; health:OnSave writes the current health, kept as the record's `{ current, maximum }`. */
export function saveHiveHealth(
  inst: PrefabInstance & { components: { health: Health } },
  data: EntityPersistData,
): void {
  const { health } = inst.components;
  data.health = { current: health.currenthealth, maximum: health.maxhealth };
}

/** health:OnLoad of the record's `{ current, maximum }`. */
export function loadHiveHealth(
  inst: PrefabInstance & { components: { health: Health } },
  data: EntityPersistData,
): void {
  const saved = structureHealth(data);
  if (saved) {
    inst.components.health.OnLoad({ health: saved.current, maxhealth: saved.maximum });
  }
}

function SeasonalSpawnChanges(inst: BeehiveInstance, season: WorldSeason | undefined): void {
  const childspawner = inst.components.childspawner;
  if (season === 'spring') {
    childspawner.SetRegenPeriod(BEEHIVE_REGEN_TIME / SPRING_COMBAT_MOD);
    childspawner.SetSpawnPeriod(BEEHIVE_RELEASE_TIME / SPRING_COMBAT_MOD);
    childspawner.SetMaxChildren(BEEHIVE_MAX_BEES);
  } else {
    childspawner.SetRegenPeriod(BEEHIVE_REGEN_TIME);
    childspawner.SetSpawnPeriod(BEEHIVE_RELEASE_TIME);
    childspawner.SetMaxChildren(BEEHIVE_BEES);
  }
}

/**
 * beehive.lua fn, for loading, drawing and saving, with the freezable's shatter fx and freeze listeners. Not ported:
 * OnEntitySleep / OnEntityWake's loop sound, the season watch (WatchWorldState("season", SeasonalSpawnChanges): fn's own call applies the season the hive
 * spawns in), OnInit's isday watch with StartSpawning / StopSpawning, so no bee leaves the hive, OnPreLoad
 * (WorldSettings_ChildSpawner_PreLoad), WorldSettings_ChildSpawner_*'s external timers, burnable's AddBurnFX and
 * OnIgnite / DefaultExtinguishFn / DefaultBurntFn, combat's SetOnHit (OnHit), the death listener (OnKilled), propagator's
 * SetOnFlashPoint, SetLunarHailBuildupAmountSmall and hauntable's SetOnHauntFn (OnHaunt).
 */
/**
 * OnFreeze / OnThaw / OnUnFreeze: the frozen clips with swap_frozen from frozen.zip and the freeze sounds. Their
 * StopSpawning / StartSpawning have nothing to stop or start: the hive's spawning is not ported.
 */
function OnFreeze(inst: BeehiveInstance): void {
  inst.SoundEmitter?.PlaySound('dontstarve/common/freezecreature');
  inst.sprite.start('frozen');
  inst.sprite.setSymbolOverride('swap_frozen', 'frozen.zip', 'frozen');
}

function OnThaw(inst: BeehiveInstance): void {
  inst.sprite.start('frozen_loop_pst');
  inst.SoundEmitter?.PlaySound('dontstarve/common/freezethaw', 'thawing');
  inst.sprite.setSymbolOverride('swap_frozen', 'frozen.zip', 'frozen');
}

function OnUnFreeze(inst: BeehiveInstance): void {
  inst.sprite.start('cocoon_small');
  inst.SoundEmitter?.KillSound('thawing');
  inst.sprite.setSymbolOverride('swap_frozen');
}

function fn(world: HiveWorld): BeehiveInstance {
  const inst = new BeehiveInstance(BEEHIVE_ID, new SpriteState({ name: 'cocoon_small', billboard: true }));
  // MakeObstaclePhysics(inst, .5): the tag here, the body from the definition's physics.
  inst.AddSoundEmitter();
  inst.addTag('blocker');
  // SetBank / SetBuild("beehive"), PlayAnimation("cocoon_small", true).
  inst.scrapbook_anim = 'cocoon_small';

  inst.addTag('structure');
  inst.addTag('lifedrainable');
  inst.addTag('beaverchewable');
  inst.addTag('hive');
  inst.addTag('beehive');

  MakeSnowCoveredPristine(inst);

  addComponent(inst, 'health', Health, undefined, world.scheduler).SetMaxHealth(BEEHIVE_HEALTH);

  const childspawner = addComponent(
    inst,
    'childspawner',
    ChildSpawner<BeehiveInstance, ChildSpawnerChild<BeehiveInstance>>,
    world.scheduler,
  );
  childspawner.childname = 'bee';
  const season = world.getWatchWorldContent?.(WorldContentKey.Season, stop => inst.onRemove(stop));
  SeasonalSpawnChanges(inst, season?.value.season);
  childspawner.emergencychildname = 'bee';
  childspawner.emergencychildrenperplayer = 1;
  childspawner.canemergencyspawn = true; // TUNING.BEEHIVE_ENABLED
  childspawner.SetMaxEmergencyChildren(BEEHIVE_EMERGENCY_BEES);
  childspawner.SetEmergencyRadius(BEEHIVE_EMERGENCY_RADIUS);
  // WorldSettings_ChildSpawner_SpawnPeriod / _RegenPeriod add the component; TUNING.BEEHIVE_ENABLED is true, so
  // childreninside is kept.
  addComponent(inst, 'worldsettingstimer', WorldSettingsTimer);

  addComponent(inst, 'lootdropper', LootDropper, () => undefined).SetLoot(['honey', 'honey', 'honey', 'honeycomb']);

  // MakeLargeBurnable(inst), without its fx and callbacks.
  const burnable = addComponent(inst, 'burnable', Burnable, world.scheduler);
  burnable.SetFXLevel(4);
  burnable.SetBurnTime(LARGE_BURN_TIME);

  MakeMediumFreezableCharacter(inst, world);
  inst.ListenForEvent('freeze', () => OnFreeze(inst));
  inst.ListenForEvent('onthaw', () => OnThaw(inst));
  inst.ListenForEvent('unfreeze', () => OnUnFreeze(inst));

  addComponent(inst, 'combat', Combat, () => world.scheduler.now);

  // MakeLargePropagator(inst), without SetOnFlashPoint.
  addComponent(
    inst,
    'propagator',
    Propagator,
    'large',
    radius => inst.TheSim.FindEntities(inst.position, radius, undefined, PROPAGATOR_CANT_TAGS),
    UNIT,
    world.scheduler,
    world.getWatchWorldContent,
  );
  MakeSnowCovered(inst);
  // MakeSnowCovered's MakeLunarHailBuildup.
  addComponent(inst, 'lunarhailbuildup', LunarHailBuildup);

  addComponent(inst, 'hauntable', Hauntable, world.scheduler).SetHauntValue(HAUNT_SMALL);

  addComponent(inst, 'inspectable', Inspectable);

  inst.OnSave = saveHiveHealth;
  inst.OnLoad = loadHiveHealth;
  return inst;
}

/** The Prefab beehive.lua returns. */
export function beehivePrefabs(
  world: HiveWorld,
): Readonly<Record<typeof BEEHIVE_ID, PrefabEntityDefinition<BeehiveInstance>>> {
  return {
    [BEEHIVE_ID]: {
      fn: () => fn(world),
      assets: {
        animationArchive: 'beehive.zip',
        buildArchives: BEEHIVE_ARCHIVES,
        bank: 'beehive',
        hiddenLayers: ['snow'],
      },
      physics: { make: MakeObstaclePhysics, radius: 0.5 },
      minimapIcon: 'beehive.png',
    },
  };
}

export const beehiveRegistration = {
  create: beehivePrefabs,
  families: { beehives: definePrefabIds([BEEHIVE_ID], true) },
};

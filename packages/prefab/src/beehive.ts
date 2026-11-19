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
import type { EntityPersistData } from './saveRecord';
import { MakeObstaclePhysics, MakeSnowCovered, MakeSnowCoveredPristine } from './standardcomponents';
import { TILE_SIZE } from './tile';

export const BEEHIVE_ID = 'beehive' as const;
/** beehive.lua assets: one archive holds the beehive bank and build; MakeSnowCovered's symbol comes from snow.zip. */
export const BEEHIVE_ARCHIVES = ['beehive.zip', 'snow.zip'];
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
}

type HiveChildSpawner<Inst> = ChildSpawner<Inst, ChildSpawnerChild<Inst>>;

/** beehive.lua fn: the components it adds. */
export class BeehiveInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    health: Health; childspawner: HiveChildSpawner<BeehiveInstance>; worldsettingstimer: WorldSettingsTimer;
    lootdropper: LootDropper; burnable: Burnable; freezable: Freezable; combat: Combat; propagator: Propagator;
    lunarhailbuildup: LunarHailBuildup; hauntable: Hauntable; inspectable: Inspectable;
  };
  scrapbook_anim = 'cocoon_small';
}

/** beehive.lua has no OnSave; health:OnSave writes the current health, kept as the record's `{ current, maximum }`. */
export function saveHiveHealth(inst: PrefabInstance & { components: { health: Health } }, data: EntityPersistData): void {
  const { health } = inst.components;
  data.health = { current: health.currenthealth, maximum: health.maxhealth };
}

/** health:OnLoad of the record's `{ current, maximum }`. */
export function loadHiveHealth(inst: PrefabInstance & { components: { health: Health } }, data: EntityPersistData): void {
  if (data.health) inst.components.health.OnLoad({ health: data.health.current, maxhealth: data.health.maximum });
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
 * beehive.lua fn, for loading, drawing and saving. Not ported: the SoundEmitter and OnEntitySleep / OnEntityWake's
 * loop, the season watch (WatchWorldState("season", SeasonalSpawnChanges): fn's own call applies the season the hive
 * spawns in), OnInit's isday watch with StartSpawning / StopSpawning, so no bee leaves the hive, OnPreLoad
 * (WorldSettings_ChildSpawner_PreLoad), WorldSettings_ChildSpawner_*'s external timers, burnable's AddBurnFX and
 * OnIgnite / DefaultExtinguishFn / DefaultBurntFn, freezable's shatter fx and the freeze / onthaw / unfreeze listeners
 * (OnFreeze, OnThaw, OnUnFreeze), combat's SetOnHit (OnHit), the death listener (OnKilled), propagator's
 * SetOnFlashPoint, SetLunarHailBuildupAmountSmall and hauntable's SetOnHauntFn (OnHaunt).
 */
function fn(world: HiveWorld): BeehiveInstance {
  const inst = new BeehiveInstance(BEEHIVE_ID, new SpriteState({ name: 'cocoon_small', billboard: true }));
  // MakeObstaclePhysics(inst, .5): the tag here, the body from the definition's physics.
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

  const childspawner = addComponent(inst, 'childspawner', ChildSpawner<BeehiveInstance, ChildSpawnerChild<BeehiveInstance>>, world.scheduler);
  childspawner.childname = 'bee';
  const season = world.getWatchWorldContent?.(WorldContentKey.Season, stop => inst.onRemove(stop));
  SeasonalSpawnChanges(inst, season?.peek().season);
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

  // MakeMediumFreezableCharacter(inst), without its shatter fx.
  addComponent(inst, 'freezable', Freezable, world.scheduler).resistance = 2;

  addComponent(inst, 'combat', Combat, () => world.scheduler.now);

  // MakeLargePropagator(inst), without SetOnFlashPoint.
  addComponent(inst, 'propagator', Propagator, 'large', radius =>
    inst.TheSim.FindEntities(inst.position, radius, undefined, PROPAGATOR_CANT_TAGS), UNIT, world.scheduler, world.getWatchWorldContent);
  MakeSnowCovered(inst, world.getWatchWorldContent);
  // MakeSnowCovered's MakeLunarHailBuildup.
  addComponent(inst, 'lunarhailbuildup', LunarHailBuildup);

  addComponent(inst, 'hauntable', Hauntable, world.scheduler).SetHauntValue(HAUNT_SMALL);

  addComponent(inst, 'inspectable', Inspectable);

  inst.OnSave = saveHiveHealth;
  inst.OnLoad = loadHiveHealth;
  return inst;
}

/** The Prefab beehive.lua returns. */
export function beehivePrefabs(world: HiveWorld): Readonly<Record<typeof BEEHIVE_ID, PrefabEntityDefinition<BeehiveInstance>>> {
  return {
    [BEEHIVE_ID]: {
      fn: () => fn(world),
      assets: { animationArchive: 'beehive.zip', buildArchives: BEEHIVE_ARCHIVES, bank: 'beehive', hiddenLayers: ['snow'] },
      physics: { make: MakeObstaclePhysics, radius: .5 },
      minimapIcon: 'beehive.png',
    },
  };
}

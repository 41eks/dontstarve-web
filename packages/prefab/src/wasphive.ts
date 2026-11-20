import { SpriteState } from '@dontstarve-web/display';
import { WorldSettingsTimer } from '../../componets/src/atriumGateSignatures';
import { Burnable } from '../../componets/src/burnable';
import { ChildSpawner, type ChildSpawnerChild } from '../../componets/src/childspawner';
import { Combat } from '../../componets/src/combat';
import { Hauntable } from '../../componets/src/hauntable';
import { Health } from '../../componets/src/health';
import { Inspectable } from '../../componets/src/inspectable';
import { LootDropper } from '../../componets/src/lootdropper';
import { LunarHailBuildup } from '../../componets/src/pandoraschestSignatures';
import { PlayerProx } from '../../componets/src/playerprox';
import { Propagator, PROPAGATOR_CANT_TAGS } from '../../componets/src/propagator';
import { loadHiveHealth, saveHiveHealth, type HiveWorld } from './beehive';
import { addComponent } from './components';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { MakeObstaclePhysics, MakeSnowCovered, MakeSnowCoveredPristine } from './standardcomponents';
import { TILE_SIZE } from './tile';

export const WASPHIVE_ID = 'wasphive' as const;
/** wasphive.lua assets: one archive holds the wasphive bank and build; MakeSnowCovered's symbol comes from snow.zip. */
export const WASPHIVE_ARCHIVES = ['wasphive.zip', 'snow.zip'];
/** tuning.lua WASPHIVE_*. */
const WASPHIVE_RELEASE_TIME = 20;
const WASPHIVE_REGEN_TIME = 20;
export const WASPHIVE_WASPS = 5;
const WASPHIVE_EMERGENCY_WASPS = 8;
const WASPHIVE_EMERGENCY_RADIUS = 25;
export const WASPHIVE_HEALTH = 250;
/** tuning.lua HAUNT_MEDIUM. */
const HAUNT_MEDIUM = 5;
/** MakeLargeBurnable's default burn time. */
const LARGE_BURN_TIME = 30;
const UNIT = TILE_SIZE / 4;

/** wasphive.lua fn: the components it adds. */
export class WasphiveInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    health: Health;
    childspawner: ChildSpawner<WasphiveInstance, ChildSpawnerChild<WasphiveInstance>>;
    worldsettingstimer: WorldSettingsTimer;
    lootdropper: LootDropper;
    burnable: Burnable;
    playerprox: PlayerProx<WasphiveInstance>;
    combat: Combat;
    propagator: Propagator;
    lunarhailbuildup: LunarHailBuildup;
    inspectable: Inspectable;
    hauntable: Hauntable;
  };
  scrapbook_anim = 'cocoon_small';
}

/**
 * wasphive.lua fn, for loading, drawing and saving. Not ported: the SoundEmitter and OnEntitySleep / OnEntityWake's
 * loop, OnPreLoad (WorldSettings_ChildSpawner_PreLoad), WorldSettings_ChildSpawner_*'s external timers, burnable's
 * AddBurnFX and OnIgnite / DefaultExtinguishFn / DefaultBurntFn, playerprox's SetOnPlayerNear (onnear) and
 * SetPlayerAliveMode(AliveOnly), combat's SetOnHit (onhitbyplayer), the death listener (OnKilled), propagator's
 * SetOnFlashPoint and hauntable's SetOnHauntFn (OnHaunt). Nothing starts spawning, so no killer bee leaves the hive.
 */
function fn(world: HiveWorld): WasphiveInstance {
  const inst = new WasphiveInstance(WASPHIVE_ID, new SpriteState({ name: 'cocoon_small', billboard: true }));
  // MakeObstaclePhysics(inst, 0.5): the tag here, the body from the definition's physics.
  inst.addTag('blocker');
  // SetBank / SetBuild("wasphive"), PlayAnimation("cocoon_small", true).
  inst.scrapbook_anim = 'cocoon_small';

  inst.addTag('structure');
  inst.addTag('hive');
  inst.addTag('WORM_DANGER');

  MakeSnowCoveredPristine(inst);

  addComponent(inst, 'health', Health, undefined, world.scheduler).SetMaxHealth(WASPHIVE_HEALTH);

  const childspawner = addComponent(
    inst,
    'childspawner',
    ChildSpawner<WasphiveInstance, ChildSpawnerChild<WasphiveInstance>>,
    world.scheduler,
  );
  // `childspawner.childspawner = "killerbee"` sets an unused field, so childname keeps childspawner.lua's "".
  childspawner.childname = '';
  childspawner.SetRegenPeriod(WASPHIVE_REGEN_TIME);
  childspawner.SetSpawnPeriod(WASPHIVE_RELEASE_TIME);
  childspawner.SetMaxChildren(WASPHIVE_WASPS);
  childspawner.emergencychildname = 'killerbee';
  childspawner.emergencychildrenperplayer = 1;
  childspawner.canemergencyspawn = true; // TUNING.WASPHIVE_ENABLED
  childspawner.SetMaxEmergencyChildren(WASPHIVE_EMERGENCY_WASPS);
  childspawner.SetEmergencyRadius(WASPHIVE_EMERGENCY_RADIUS);
  // WorldSettings_ChildSpawner_SpawnPeriod / _RegenPeriod add the component; TUNING.WASPHIVE_ENABLED is true, so
  // childreninside is kept.
  addComponent(inst, 'worldsettingstimer', WorldSettingsTimer);

  addComponent(inst, 'lootdropper', LootDropper, () => undefined).SetLoot(['honey', 'honey', 'honey', 'honeycomb']);

  // MakeLargeBurnable(inst), without its fx and callbacks.
  const burnable = addComponent(inst, 'burnable', Burnable, world.scheduler);
  burnable.SetFXLevel(4);
  burnable.SetBurnTime(LARGE_BURN_TIME);

  addComponent(inst, 'playerprox', PlayerProx<WasphiveInstance>, world.getWatchWorldContent).SetDist(
    10 * UNIT,
    13 * UNIT,
  );

  addComponent(inst, 'combat', Combat, () => world.scheduler.now);

  // MakeMediumPropagator(inst), without SetOnFlashPoint.
  addComponent(
    inst,
    'propagator',
    Propagator,
    'medium',
    radius => inst.TheSim.FindEntities(inst.position, radius, undefined, PROPAGATOR_CANT_TAGS),
    UNIT,
    world.scheduler,
    world.getWatchWorldContent,
  );
  MakeSnowCovered(inst, world.getWatchWorldContent);
  // MakeSnowCovered's MakeLunarHailBuildup.
  addComponent(inst, 'lunarhailbuildup', LunarHailBuildup);

  addComponent(inst, 'inspectable', Inspectable);

  addComponent(inst, 'hauntable', Hauntable, world.scheduler).SetHauntValue(HAUNT_MEDIUM);

  inst.OnSave = saveHiveHealth;
  inst.OnLoad = loadHiveHealth;
  return inst;
}

/** The Prefab wasphive.lua returns. */
export function wasphivePrefabs(
  world: HiveWorld,
): Readonly<Record<typeof WASPHIVE_ID, PrefabEntityDefinition<WasphiveInstance>>> {
  return {
    [WASPHIVE_ID]: {
      fn: () => fn(world),
      assets: {
        animationArchive: 'wasphive.zip',
        buildArchives: WASPHIVE_ARCHIVES,
        bank: 'wasphive',
        hiddenLayers: ['snow'],
      },
      physics: { make: MakeObstaclePhysics, radius: 0.5 },
      minimapIcon: 'wasphive.png',
    },
  };
}

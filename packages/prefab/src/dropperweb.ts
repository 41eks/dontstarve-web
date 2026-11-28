import { definePrefabIds } from './prefabRegistration';
import { SpriteState } from '@dontstarve-web/display';
import { WorldSettingsTimer } from '../../componets/src/atriumGateSignatures';
import { ChildSpawner, type ChildSpawnerChild } from '../../componets/src/childspawner';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { GroundCreepEntity, type GroundCreep } from '../../componets/src/groundcreep';
import { Health } from '../../componets/src/health';
import { addComponent } from './components';
import { loadHiveHealth, saveHiveHealth } from './beehive';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { WORLD_SCALE } from './tile';

export const DROPPERWEB_ID = 'dropperweb' as const;

// tuning.lua, with total_day_time = 480 seconds.
const DROPPERWEB_RELEASE_TIME = 480 / 2;
const DROPPERWEB_REGEN_TIME = 480 / 4;
export const DROPPERWEB_MIN_CHILDREN = 2;
export const DROPPERWEB_MAX_CHILDREN = 3;
/** health.lua's default maxhealth: dropperweb.lua never sets one. */
export const DROPPERWEB_HEALTH = 100;
/** GroundCreepEntity:SetRadius(5), in DST units. */
const DROPPERWEB_CREEP_RADIUS = 5;

/** What the scene injects into every dropper web. */
export interface DropperwebWorld {
  scheduler: GameTimeScheduler;
  /** TheWorld.GroundCreep, which the web's GroundCreepEntity feeds. */
  groundCreep?: GroundCreep;
  /** math.random(DROPPERWEB_MIN_CHILDREN, DROPPERWEB_MAX_CHILDREN)'s source. */
  random?: () => number;
}

/** dropperweb.lua fn: an artless spider den in the ruins whose creep and minimap icon are all that shows. */
export class DropperwebInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    health: Health;
    childspawner: ChildSpawner<DropperwebInstance, ChildSpawnerChild<DropperwebInstance>>;
    worldsettingstimer: WorldSettingsTimer;
  };
  /** inst.entity:AddGroundCreepEntity(), when the world has a GroundCreep. */
  GroundCreepEntity?: GroundCreepEntity;
}

/**
 * dropperweb.lua fn. Its spider_dropper children are not ported, so SpawnInvestigators (creepactivate),
 * SummonChildren and OnGoHome have nothing to release; OnEntityWake's mushtree webbing and OnPreLoad's
 * WorldSettings_ChildSpawner_PreLoad are not ported either.
 */
function fn(world: DropperwebWorld): DropperwebInstance {
  const inst = new DropperwebInstance(DROPPERWEB_ID, new SpriteState({ name: '' }));
  inst.BindScheduler(world.scheduler);
  if (world.groundCreep) {
    const creep = new GroundCreepEntity(inst, world.groundCreep);
    inst.GroundCreepEntity = creep;
    inst.onRemove(() => creep.OnRemoveFromEntity());
    creep.SetRadius(DROPPERWEB_CREEP_RADIUS * WORLD_SCALE);
  }
  inst.addTag('cavedweller');
  inst.addTag('spiderden');
  inst.minimap.SetIcon('whitespider_den.png');

  addComponent(inst, 'health', Health, undefined, world.scheduler).nofadeout = true;

  const childspawner = addComponent(
    inst,
    'childspawner',
    ChildSpawner<DropperwebInstance, ChildSpawnerChild<DropperwebInstance>>,
    world.scheduler,
  );
  childspawner.SetRegenPeriod(DROPPERWEB_REGEN_TIME);
  childspawner.SetSpawnPeriod(DROPPERWEB_RELEASE_TIME);
  // WorldSettings_ChildSpawner_SpawnPeriod / _RegenPeriod add this signature component; their external timers are not
  // ported, and TUNING.DROPPERWEB_ENABLED is true so childreninside is kept.
  addComponent(inst, 'worldsettingstimer', WorldSettingsTimer);
  const random = world.random ?? Math.random;
  childspawner.SetMaxChildren(
    DROPPERWEB_MIN_CHILDREN + Math.floor(random() * (DROPPERWEB_MAX_CHILDREN - DROPPERWEB_MIN_CHILDREN + 1)),
  );
  childspawner.childname = 'spider_dropper';
  childspawner.emergencychildname = 'spider_dropper';
  childspawner.emergencychildrenperplayer = 1;
  childspawner.canemergencyspawn = true; // TUNING.DROPPERWEB_ENABLED

  // health:OnSave / OnLoad, as the record's `{ current, maximum }` like the hives.
  inst.OnSave = saveHiveHealth;
  inst.OnLoad = loadHiveHealth;
  return inst;
}

/** The Prefab dropperweb.lua returns. It has no AnimState: nothing is drawn but its creep and minimap icon. */
export function dropperwebPrefabs(
  world: DropperwebWorld,
): Readonly<Record<typeof DROPPERWEB_ID, PrefabEntityDefinition<DropperwebInstance>>> {
  return {
    [DROPPERWEB_ID]: {
      fn: () => fn(world),
      minimapIcon: 'whitespider_den.png',
    },
  };
}

export const dropperwebRegistration = {
  create: dropperwebPrefabs,
  families: { dropperwebs: definePrefabIds([DROPPERWEB_ID], true) },
};

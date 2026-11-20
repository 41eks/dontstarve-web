import { SpriteState, type SpriteResources } from '@dontstarve-web/display';
import type { GetWatchWorldContent } from '@dontstarve-web/signals';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ChildSpawner, type ChildSpawnerChild, type ChildSpawnerSave } from '../../componets/src/childspawner';
import { Inspectable } from '../../componets/src/inspectable';
import { PlayerProx } from '../../componets/src/playerprox';
import { Timer, type NamedTimerSave } from '../../componets/src/timer';
import {
  CanopyLightRays,
  CanopyShadows,
  DistanceFade,
  LightningBlocker,
  WaterPhysics,
  WorldSettingsTimer,
} from '../../componets/src/watertreePillarSignatures';
import { addComponent } from './components';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { EntityPersistData } from './saveRecord';
import { MakeWaterObstaclePhysics } from './standardcomponents';

export const WATERTREE_PILLAR_ID = 'watertree_pillar' as const;
/** Asset("ANIM", ...): the bank's archive, SetBuild's and AddOverrideBuild's. */
export const WATERTREE_PILLAR_ARCHIVES = [
  'oceantree_pillar.zip',
  'oceantree_pillar_build1.zip',
  'oceantree_pillar_build2.zip',
];

/** tuning.lua: seg_time is 30. */
const GRASSGATOR_REGEN_TIME = 30 * 4,
  GRASSGATOR_RELEASE_TIME = 30,
  GRASSGATOR_MAXCHILDREN = 1;
const SHADE_CANOPY_RANGE = 28,
  WATERTREE_PILLAR_CANOPY_BUFFER = 1;
const MIN = SHADE_CANOPY_RANGE;
const MAX = MIN + WATERTREE_PILLAR_CANOPY_BUFFER;
const START_NUM_OCEANTREENUTS = 1;

/** OnSave's fields, with the childspawner and timer records GetPersistData writes beside them. */
export interface WatertreePillarSaveState {
  num_oceantreenuts: number;
  last_ram_time?: number;
  cocoons_to_regrow?: number;
  /** The grassgator children are not ported, so none is ever outside. */
  childspawner: Pick<ChildSpawnerSave, 'childreninside' | 'childrenoutside'>;
  timer?: NamedTimerSave;
}

export interface WatertreePillarWorld {
  scheduler: GameTimeScheduler;
  getWatchWorldContent?: GetWatchWorldContent;
}

/** watertree_pillar.lua fn: the fields it sets on inst. */
export class WatertreePillarInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    waterphysics: WaterPhysics;
    distancefade: DistanceFade;
    canopyshadows: CanopyShadows;
    canopylightrays: CanopyLightRays;
    playerprox: PlayerProx<WatertreePillarInstance>;
    inspectable: Inspectable;
    childspawner: ChildSpawner<WatertreePillarInstance, ChildSpawnerChild<WatertreePillarInstance>>;
    worldsettingstimer: WorldSettingsTimer;
    timer: Timer;
    lightningblocker: LightningBlocker;
  };
  declare num_oceantreenuts: number;
  declare last_ram_time?: number;
  declare _cocoons_to_regrow?: number;
  /** inst.players: the players OnNear has counted; OnNear is not ported. */
  declare players: Set<unknown>;
}

function OnSave(inst: WatertreePillarInstance, data: EntityPersistData): void {
  const { childreninside, childrenoutside } = data.childspawner ?? inst.components.childspawner.OnSave();
  data.watertreePillar = {
    num_oceantreenuts: inst.num_oceantreenuts,
    ...(inst.last_ram_time !== undefined ? { last_ram_time: inst.last_ram_time } : {}),
    ...(inst._cocoons_to_regrow !== undefined ? { cocoons_to_regrow: inst._cocoons_to_regrow } : {}),
    childspawner: { childreninside, childrenoutside },
    ...(data.timer ? { timer: data.timer } : {}),
  };
  delete data.childspawner;
  delete data.timer;
}

/** The childspawner and timer components' OnLoad, which run before inst.OnLoad in the source, then OnLoad. */
function OnLoad(inst: WatertreePillarInstance, data: EntityPersistData): void {
  const saved = data.watertreePillar;
  if (!saved) {
    return;
  }
  inst.components.childspawner.OnLoad(saved.childspawner);
  inst.components.timer.OnLoad(saved.timer);
  inst.num_oceantreenuts = saved.num_oceantreenuts;
  if (saved.last_ram_time !== undefined) {
    inst.last_ram_time = saved.last_ram_time;
  }
  if (saved.cocoons_to_regrow !== undefined) {
    inst._cocoons_to_regrow = saved.cocoons_to_regrow;
  }
}

/**
 * watertree_pillar.lua fn, for loading, drawing and saving. Not ported: the watertree_pillar_ripples and
 * watertree_pillar_roots children, OnPreLoad, OnRemoveEntity, the on_collide / timerdone / cocoon_destroyed / phasechanged
 * listeners, playerprox's target mode and OnNear / OnFar, childspawner's overridespawnlocation and SetSpawnedFn,
 * WorldSettings_ChildSpawner_*'s external timers, lightningblocker's OnLightningStrike, SetDeployExtraSpacing, SetAABB and
 * the SoundEmitter. The signature components take no configuration.
 */
function fn(world: WatertreePillarWorld, sprites: SpriteResources): WatertreePillarInstance {
  // SetBank("oceantree_pillar"), SetBuild("oceantree_pillar_build1"), PlayAnimation("idle", true).
  const inst = new WatertreePillarInstance(WATERTREE_PILLAR_ID, new SpriteState({ name: 'idle', billboard: true }));
  // MakeWaterObstaclePhysics(inst, 4, 2, 0.75): the tag and component here, the body from the definition's physics.
  inst.addTag('blocker');
  addComponent(inst, 'waterphysics', WaterPhysics);
  inst.addTag('cocoon_home');
  inst.addTag('shadecanopy');
  inst.addTag('ignorewalkableplatforms');
  inst.AnimState.AddOverrideBuild('oceantree_pillar_build2');
  inst.sprite.setAnimState(inst.AnimState.json, sprites.archives);
  addComponent(inst, 'distancefade', DistanceFade);
  addComponent(inst, 'canopyshadows', CanopyShadows);
  inst.num_oceantreenuts = START_NUM_OCEANTREENUTS;
  inst._cocoons_to_regrow = 0;
  addComponent(inst, 'canopylightrays', CanopyLightRays);
  inst.players = new Set();
  const playerprox = addComponent(inst, 'playerprox', PlayerProx<WatertreePillarInstance>, world.getWatchWorldContent);
  playerprox.SetDist(MIN, MAX);
  addComponent(inst, 'inspectable', Inspectable);
  const childspawner = addComponent(
    inst,
    'childspawner',
    ChildSpawner<WatertreePillarInstance, ChildSpawnerChild<WatertreePillarInstance>>,
    world.scheduler,
  );
  childspawner.childname = 'grassgator';
  childspawner.SetRegenPeriod(GRASSGATOR_REGEN_TIME);
  childspawner.SetSpawnPeriod(GRASSGATOR_RELEASE_TIME);
  childspawner.SetMaxChildren(GRASSGATOR_MAXCHILDREN);
  // WorldSettings_ChildSpawner_SpawnPeriod / _RegenPeriod add the component; TUNING.GRASSGATOR_ENABLED is true.
  addComponent(inst, 'worldsettingstimer', WorldSettingsTimer);
  addComponent(inst, 'timer', Timer, world.scheduler);
  addComponent(inst, 'lightningblocker', LightningBlocker);
  childspawner.StartSpawning();
  inst.OnSave = OnSave;
  inst.OnLoad = OnLoad;
  return inst;
}

/** The watertree_pillar Prefab watertree_pillar.lua returns; watertree_pillar_ripples and _roots are not ported. */
export function watertreePillarPrefabs(
  world: WatertreePillarWorld,
): Readonly<Record<typeof WATERTREE_PILLAR_ID, PrefabEntityDefinition<WatertreePillarInstance>>> {
  return {
    [WATERTREE_PILLAR_ID]: {
      fn: (_position, sprites) => fn(world, sprites),
      assets: {
        animationArchive: 'oceantree_pillar.zip',
        buildArchives: ['oceantree_pillar_build1.zip'],
        bank: 'oceantree_pillar',
      },
      // Not instanced: the canopy's idle frame (SetAABB(60, 20)) is larger than the 4096 px instanced sprite atlas.
      physics: { make: MakeWaterObstaclePhysics, radius: 4, height: 2 },
      minimapIcon: 'oceantree_pillar.png',
    },
  };
}

import { SpriteState } from '@dontstarve-web/display';
import { Fishable } from '../../componets/src/fishable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/inspectable';
import { Oasis, WaterSource } from '../../componets/src/oasislakeSignatures';
import { PointOfInterest } from '../../componets/src/statueglommerSignatures';
import { addComponent } from './components';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { EntityPersistData } from './saveRecord';
import { MakeObstaclePhysics } from './standardcomponents';
import { TILE_SIZE } from './tile';

export const OASISLAKE_ID = 'oasislake' as const;
/** oasislake.lua assets: the oasis_tile bank and build, and splash.zip, which no ported code plays. */
export const OASISLAKE_ARCHIVES = ['oasis_tile.zip'];
/** tuning.lua OASISLAKE_MAX_FISH. */
export const OASISLAKE_MAX_FISH = 15;
/** tuning.lua OASISLAKE_FISH_RESPAWN_TIME = seg_time * 3. */
const OASISLAKE_FISH_RESPAWN_TIME = 30 * 3;
/** tuning.lua HAUNT_TINY. */
const HAUNT_TINY = 1;
const WATER_RADIUS = 3.8;
const PHYSICS_RADIUS = 6;
const UNIT = TILE_SIZE / 4;
/** LAYER_BACKGROUND with SetSortOrder(-3), on the ground under the turf-level art. */
const MESH_ORDER = -.5 + (-3 - 3) * .01;

/** OnSave's field: data.regrowth, written only as false. */
export interface OasislakeSaveState {
  regrowth?: false;
}

export interface OasislakeWorld { scheduler: GameTimeScheduler }

/** oasislake.lua fn: the fields it sets on inst. */
export class OasislakeInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    pointofinterest: PointOfInterest; inspectable: Inspectable; fishable: Fishable; hauntable: Hauntable; oasis: Oasis;
    watersource: WaterSource;
  };
  no_wet_prefix = true;
  scrapbook_inspectonseen = true;
  isdamp = false;
  driedup = false;
  regrowth = false;
}

function OnSave(inst: OasislakeInstance, data: EntityPersistData): void {
  if (!inst.regrowth) { data.oasislake = { regrowth: false }; }
}

/** `data == nil or data.regrowth ~= false`: a record without the field loads as regrowing. */
function OnLoad(inst: OasislakeInstance, data: EntityPersistData): void {
  inst.regrowth = data.oasislake?.regrowth !== false;
}

/**
 * oasislake.lua fn, for loading, drawing and saving. Not ported: the SoundEmitter, pointofinterest:SetHeight(320),
 * fishable:SetGetFishFn(GetFish), oasis.radius, TheWorld:PushEvent("ms_registeroasis"), and the DoTaskInTime(0, OnInit)
 * task with its ms_stormchanged listener, OnSandstormChanged, TryFillLake, OnIsWet / OnIsWetChanged, SpawnOasisBugs
 * and SpawnSucculents, so the lake keeps fn's idle loop and never dries up.
 */
function fn(world: OasislakeWorld): OasislakeInstance {
  // SetBuild / SetBank("oasis_tile"), PlayAnimation("idle", true).
  const inst = new OasislakeInstance(OASISLAKE_ID, new SpriteState({ name: 'idle' }));
  inst.setRotation(45);
  // MakeObstaclePhysics(inst, 6): the tag here, the body from the definition's physics.
  inst.addTag('blocker');
  // SetOrientation(OnGround), SetLayer(LAYER_BACKGROUND), SetSortOrder(-3).
  inst.sprite.setGround(0);
  inst.sprite.setMeshOrder(MESH_ORDER);

  inst.addTag('watersource');
  inst.addTag('birdblocker');
  inst.addTag('antlion_sinkhole_blocker');
  inst.addTag('allow_casting');

  inst.no_wet_prefix = true;
  inst.deploySmartRadius = WATER_RADIUS * UNIT;

  addComponent(inst, 'pointofinterest', PointOfInterest);
  inst.scrapbook_inspectonseen = true;

  addComponent(inst, 'inspectable', Inspectable);

  const fishable = addComponent(inst, 'fishable', Fishable, world.scheduler);
  fishable.maxfish = OASISLAKE_MAX_FISH;
  fishable.SetRespawnTime(OASISLAKE_FISH_RESPAWN_TIME);

  addComponent(inst, 'hauntable', Hauntable, world.scheduler).SetHauntValue(HAUNT_TINY);

  addComponent(inst, 'oasis', Oasis);
  addComponent(inst, 'watersource', WaterSource);

  inst.isdamp = false;
  inst.driedup = false;
  inst.regrowth = false;

  inst.OnSave = OnSave;
  inst.OnLoad = OnLoad;
  return inst;
}

/** The Prefab oasislake.lua returns. */
export function oasislakePrefabs(world: OasislakeWorld): Readonly<Record<typeof OASISLAKE_ID, PrefabEntityDefinition<OasislakeInstance>>> {
  return {
    [OASISLAKE_ID]: {
      fn: () => fn(world),
      assets: { animationArchive: 'oasis_tile.zip', buildArchives: OASISLAKE_ARCHIVES, bank: 'oasis_tile' },
      physics: { make: MakeObstaclePhysics, radius: PHYSICS_RADIUS },
      minimapIcon: 'oasis.png',
    },
  };
}

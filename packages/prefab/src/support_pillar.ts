import { SpriteState } from '@dontstarve-web/display';
import { ConstructionSite } from '../../componets/src/constructionsite';
import { Inspectable } from '../../componets/src/inspectable';
import { LootDropper } from '../../componets/src/lootdropper';
import { DeployHelper } from '../../componets/src/supportPillarSignatures';
import { Workable } from '../../componets/src/workable';
import { addComponent } from './components';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { EntityPersistData } from './saveRecord';
import { MakeObstaclePhysics } from './standardcomponents';
import { TILE_SIZE } from './tile';

export const SUPPORT_PILLAR_ID = 'support_pillar' as const;
/** MakePillar("support_pillar", "support_pillar", "support_pillar"): Asset("ANIM", "anim/support_pillar.zip"), bank and build. */
export const SUPPORT_PILLAR_ARCHIVES = ['support_pillar.zip'];
/** tuning.lua SUPPORT_PILLAR_REINFORCED_LEVELS. */
export const SUPPORT_PILLAR_REINFORCED_LEVELS = 10;
const PHYSICS_RADIUS = 1.45;
const DEPLOY_SMART_RADIUS = 2;
const UNIT = TILE_SIZE / 4;

/** OnSave's field: data.reinforced when not 0. data.regen is only written by the dreadstone pillar's regen task. */
export interface SupportPillarSaveState {
  reinforced?: number;
}

/** support_pillar.lua MakePillar's fn: the fields it sets on inst. */
export class SupportPillarInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    deployhelper: DeployHelper; constructionsite: ConstructionSite; inspectable: Inspectable; lootdropper: LootDropper;
    workable: Workable;
  };
  /** inst._level (net_tinybyte): 0 full of material .. 4 empty. */
  _level = 4;
  /** inst.suffix: the idle / hit / quake / repair clips' level suffix. */
  suffix = '_4';
  /** inst.reinforced: the levels above a full pillar. */
  reinforced = 0;
}

/** UpdateLevel. OnLevelDirty's SetPrefabNameOverride and SetEnableWatchQuake's startquake listener are not ported. */
function UpdateLevel(inst: SupportPillarInstance): void {
  const num = inst.components.constructionsite.GetSlotCount(1);
  inst._level = num >= 40 ? 0 : num >= 20 ? 1 : num >= 10 ? 2 : num > 0 ? 3 : 4;
  inst.suffix = inst._level > 0 ? `_${inst._level}` : '';
  if (inst.suffix === '_4') inst.removeTag('quake_blocker');
  else {
    inst.addTag('quake_blocker');
    if (inst.suffix === '') inst.components.constructionsite.Disable();
  }
}

function OnSave(inst: SupportPillarInstance, data: EntityPersistData): void {
  // data.regen: the rock pillar never has a _regentask.
  if (inst.reinforced !== 0) data.supportPillar = { reinforced: inst.reinforced };
}

/** OnLoad, after constructionsite's OnLoad restored the materials. */
function OnLoad(inst: SupportPillarInstance, data: EntityPersistData): void {
  inst.reinforced = data.supportPillar?.reinforced ?? 0;
  UpdateLevel(inst);
  // ToggleOrRestartRegen only acts when GetMaterial(inst.prefab) is "dreadstone"; this pillar takes rocks.
  inst.sprite.playOnce(`idle${inst.suffix}`);
}

/**
 * support_pillar.lua MakePillar("support_pillar", ...) fn, for loading, drawing and saving. Not ported: the
 * SoundEmitter, RegisterPathFinding's walls, SetPrefabNameOverride, the deployhelper's OnEnableHelper radius circle,
 * the debris fx (_debrisfx), constructionsite's SetOnConstructedFn (OnConstructed), lootdropper's SetLootSetupFn
 * (LootSetupFn), workable's onhit / onhammered, the animover (OnAnimOver) and onsink listeners, OnEntitySleep /
 * OnEntityWake's quake watching, and inst.MakeReinforced, which only the unported scaffold calls.
 */
function fn(): SupportPillarInstance {
  // SetBank / SetBuild("support_pillar"), PlayAnimation("idle_4") without looping.
  const inst = new SupportPillarInstance(SUPPORT_PILLAR_ID, new SpriteState({ name: 'idle_4', held: true, billboard: true }));
  // MakeObstaclePhysics(inst, PHYSICS_RADIUS, 6): the tag here, the body from the definition's physics.
  inst.addTag('blocker');
  inst.deploySmartRadius = DEPLOY_SMART_RADIUS * UNIT;
  // Transform:SetEightFaced, at rotation 0.
  inst.sprite.setFacingRotation(0);
  inst.addTag('structure');
  inst.addTag('antlion_sinkhole_blocker');
  inst.addTag('constructionsite');
  inst.addTag('repairconstructionsite');

  addComponent(inst, 'deployhelper', DeployHelper);

  inst.suffix = '_4';
  inst.reinforced = 0;

  addComponent(inst, 'constructionsite', ConstructionSite).SetConstructionPrefab('construction_repair_container');

  addComponent(inst, 'inspectable', Inspectable);
  addComponent(inst, 'lootdropper', LootDropper, () => undefined).y_speed = 4;

  const workable = addComponent(inst, 'workable', Workable);
  workable.SetWorkAction('HAMMER');
  workable.SetWorkLeft(5);
  // SetRequiresToughWork(GetMaterial(name) == "dreadstone"): CONSTRUCTION_PLANS.support_pillar takes rocks.
  workable.SetRequiresToughWork(false);

  inst.OnSave = OnSave;
  inst.OnLoad = OnLoad;
  return inst;
}

/** The support_pillar Prefab support_pillar.lua returns; the dreadstone pillar, the scaffolds and placers are not ported. */
export function supportPillarPrefabs(): Readonly<Record<typeof SUPPORT_PILLAR_ID, PrefabEntityDefinition<SupportPillarInstance>>> {
  return {
    [SUPPORT_PILLAR_ID]: {
      fn,
      assets: { animationArchive: 'support_pillar.zip', buildArchives: SUPPORT_PILLAR_ARCHIVES, bank: 'support_pillar' },
      physics: { make: MakeObstaclePhysics, radius: PHYSICS_RADIUS, height: 6 },
      minimapIcon: 'support_pillar.png',
    },
  };
}

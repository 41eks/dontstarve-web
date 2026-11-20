import { SpriteState } from '@dontstarve-web/display';
import type { GetWatchWorldContent } from '@dontstarve-web/signals';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/inspectable';
import { LootDropper } from '../../componets/src/lootdropper';
import { LunarHailBuildup } from '../../componets/src/pandoraschestSignatures';
import { Prototyper } from '../../componets/src/prototyper';
import { CreateTechTree } from '../../componets/src/techtree';
import { Workable } from '../../componets/src/workable';
import { addComponent } from './components';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { MakeObstaclePhysics, MakeSnowCovered, MakeSnowCoveredPristine, WORLD_SCALE } from './standardcomponents';

export const SHADOW_FORGE_ID = 'shadow_forge' as const;
/** shadow_forge.lua assets: one archive holds the shadow_forge bank and build; MakeSnowCovered's symbol comes from snow.zip. */
export const SHADOW_FORGE_ARCHIVES = ['shadow_forge.zip', 'snow.zip'];
/** MakeObstaclePhysics(inst, 0.4). */
const PHYSICS_RADIUS = 0.4;
/** SetDeploySmartRadius(DEPLOYSPACING_RADIUS[DEPLOYSPACING.DEFAULT] / 2), in DST units. */
const DEPLOY_SMART_RADIUS = 2 / 2;
/** tuning.lua HAUNT_TINY. */
const HAUNT_TINY = 1;
/** tuning.lua PROTOTYPER_TREES.SHADOW_FORGE. */
const SHADOW_FORGE_TREES = { SHADOWFORGING: 2 };

/** What the scene injects: the hauntable's scheduler and MakeSnowCovered's snow level. */
export interface ShadowForgeWorld {
  scheduler: GameTimeScheduler;
  getWatchWorldContent?: GetWatchWorldContent;
}

/** shadow_forge.lua fn: the fields it sets on inst and the components it adds. */
export class ShadowForgeInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    inspectable: Inspectable;
    prototyper: Prototyper;
    lootdropper: LootDropper;
    workable: Workable;
    hauntable: Hauntable;
    lunarhailbuildup: LunarHailBuildup;
  };
  /** inst._activecount / inst._activetask: onactivate's pending uses, which are not ported. */
  _activecount = 0;
}

/**
 * shadow_forge.lua fn, for loading, drawing and saving. Not ported (components are configured, callbacks are not
 * registered): prototyper's onturnon / onturnoff / onactivate, workable's SetOnFinishCallback (on_finished_hammering) and
 * SetOnWorkCallback (onhit), the "onbuilt" listener (onbuilt), the SoundEmitter and its sounds, scrapbook data, and the
 * kit item and placer.
 */
function fn(world: ShadowForgeWorld): ShadowForgeInstance {
  // SetBank / SetBuild("shadow_forge"), PlayAnimation("idle") without looping.
  const inst = new ShadowForgeInstance(SHADOW_FORGE_ID, new SpriteState({ name: 'idle', held: true, billboard: true }));
  inst.deploySmartRadius = DEPLOY_SMART_RADIUS * WORLD_SCALE;
  // MakeObstaclePhysics(inst, 0.4): the tag here, the body from the definition's physics.
  inst.addTag('blocker');
  inst.minimap.SetPriority(5);

  inst.addTag('structure');
  inst.addTag('shadow_forge');
  // prototyper (from prototyper component) added to pristine state for optimization
  inst.addTag('prototyper');
  MakeSnowCoveredPristine(inst);

  inst._activecount = 0;

  addComponent(inst, 'inspectable', Inspectable);

  const prototyper = addComponent(inst, 'prototyper', Prototyper, 4 * WORLD_SCALE);
  prototyper.trees = CreateTechTree(SHADOW_FORGE_TREES);

  // Lootdropper to drop recipe components on hammer
  addComponent(inst, 'lootdropper', LootDropper, () => undefined);

  const workable = addComponent(inst, 'workable', Workable);
  workable.SetWorkAction('HAMMER');
  workable.SetWorkLeft(4);

  addComponent(inst, 'hauntable', Hauntable, world.scheduler).SetHauntValue(HAUNT_TINY);

  MakeSnowCovered(inst, world.getWatchWorldContent);
  // MakeSnowCovered's MakeLunarHailBuildup: a constructor-only signature.
  addComponent(inst, 'lunarhailbuildup', LunarHailBuildup);
  return inst;
}

/** The shadow_forge Prefab shadow_forge.lua returns; shadow_forge_kit and its placer are not ported. */
export function shadowForgePrefabs(
  world: ShadowForgeWorld,
): Readonly<Record<typeof SHADOW_FORGE_ID, PrefabEntityDefinition<ShadowForgeInstance>>> {
  return {
    [SHADOW_FORGE_ID]: {
      fn: () => fn(world),
      assets: {
        animationArchive: 'shadow_forge.zip',
        buildArchives: SHADOW_FORGE_ARCHIVES,
        bank: 'shadow_forge',
        hiddenLayers: ['snow'],
      },
      physics: { make: MakeObstaclePhysics, radius: PHYSICS_RADIUS },
      minimapIcon: 'shadow_forge.png',
    },
  };
}

import { addComponent } from './components';
import type { PrefabEntityDefinition } from './prefabInstance';
import { SpriteState } from '@dontstarve-web/display';
import { Pickable } from './components/pickable';
import { BurnableBinding } from './treeFire';
import { DefaultBurnFn, DefaultExtinguishFn, DefaultBurntFn } from './standardcomponents';
import { PickablePlantInstance, type PickablePlantRecord, type PickablePlantWorld } from './pickablePlant';

export const CAVE_FERN_ID = 'cave_fern' as const;
export const CAVE_FERN_WITHERED_ID = 'cave_fern_withered' as const;
export const CAVE_FERN_IDS = [CAVE_FERN_ID, CAVE_FERN_WITHERED_ID] as const;
export type CaveFernId = typeof CAVE_FERN_IDS[number];
/** cave_fern.lua / cave_fern_withered.lua `names`. */
export const CAVE_FERN_ANIMATIONS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10'] as const;
export const CAVE_FERN_ANIM_ARCHIVE = 'cave_ferns.zip';
/** AnimState:SetBuild of each fern prefab. */
export const CAVE_FERN_BUILD_ARCHIVES: Readonly<Record<CaveFernId, string>> = {
  cave_fern: 'cave_ferns.zip',
  cave_fern_withered: 'cave_ferns_withered_build.zip',
};
/** pickable:SetUp(product, 10), moot because remove_when_picked removes the fern. */
const CAVE_FERN_REGROW_TIME = 10;
const PRODUCTS: Readonly<Record<CaveFernId, string>> = { cave_fern: 'foliage', cave_fern_withered: 'cutgrass' };

export type CaveFernRecord = PickablePlantRecord;
export type CaveFernWorld = PickablePlantWorld;

/** cave_fern.lua's field on the inst. */
export class CaveFernInstance extends PickablePlantInstance {
  /** inst.animname: the pose clip. */
  animname!: string;
}

function onsave(inst: CaveFernInstance, data: PickablePlantRecord['components']): void {
  data.variant = { anim: inst.animname };
}

function onload(inst: CaveFernInstance, data: PickablePlantRecord['components']): void {
  const anim = data.variant?.anim;
  if (anim === undefined) return;
  if (!CAVE_FERN_ANIMATIONS.some(known => known === anim)) throw new Error(`Unsupported ${inst.prefab} variant: ${anim}`);
  inst.animname = anim;
  inst.AnimState.PlayAnimation(inst.animname);
}

/**
 * cave_fern.lua / cave_fern_withered.lua fn: a random pose, PICK foliage / cutgrass with quickpick and
 * remove_when_picked, small burnable and propagator. MakeHauntableIgnite is not ported.
 */
function fn(prefab: CaveFernId, world: PickablePlantWorld): CaveFernInstance {
  const animname = CAVE_FERN_ANIMATIONS[Math.floor(Math.random() * CAVE_FERN_ANIMATIONS.length)];
  const inst = new CaveFernInstance(prefab, new SpriteState({ name: animname, billboard: true }));
  inst.BindScheduler(world.scheduler);
  inst.animname = animname;
  inst.AnimState.PlayAnimation(inst.animname);

  const pickable = addComponent(inst, 'pickable', Pickable, PRODUCTS[prefab], CAVE_FERN_REGROW_TIME, 1, undefined, undefined, undefined,
    { scheduler: world.scheduler, onRemove: () => inst.remove() });
  pickable.picksound = 'dontstarve/wilson/pickup_plants';
  pickable.remove_when_picked = true;
  pickable.quickpick = true;

  // MakeSmallBurnable + MakeSmallPropagator.
  const burn = new BurnableBinding(inst, { propagator: 'small', burnTime: 10, fxLevel: 2,
    onIgnite: () => DefaultBurnFn(inst), onExtinguish: () => DefaultExtinguishFn(inst), onBurnt: () => DefaultBurntFn(inst, world) }, world);
  inst.onRemove(() => burn.dispose());

  inst.OnSave = (_inst, data) => onsave(inst, data);
  inst.OnLoad = (_inst, data) => onload(inst, data);
  return inst;
}

/** cave_fern.lua / cave_fern_withered.lua: Prefab(name, fn, assets). */
export function caveFernPrefabs(world: PickablePlantWorld): Readonly<Record<CaveFernId, PrefabEntityDefinition<PickablePlantInstance>>> {
  const prefab = (id: CaveFernId): PrefabEntityDefinition<PickablePlantInstance> => ({
    fn: () => fn(id, world),
    assets: { animationArchive: CAVE_FERN_ANIM_ARCHIVE, buildArchives: [CAVE_FERN_BUILD_ARCHIVES[id]], bank: 'ferns' },
    assetOptions: { instancedAnimations: 'all', staticBillboard: true },
    rayTestOnBB: true,
  });
  return { cave_fern: prefab(CAVE_FERN_ID), cave_fern_withered: prefab(CAVE_FERN_WITHERED_ID) };
}

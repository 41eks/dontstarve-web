import type { PrefabEntityDefinition } from './prefabInstance';
import { Pickable } from './components/pickable';
import { Workable } from '../../componets/src/workable';
import { DefaultBurnFn, DefaultExtinguishFn, DefaultBurntFn, MakeNoGrowInWinter } from './standardcomponents';
import { TILE_SIZE } from './tile';
import { plantEntityDefinition, PickablePlantInstance, type PickablePlantContext, type PickablePlantDefinition, type PickablePlantRecord, type PickablePlantWorld } from './pickablePlant';

export const SAPLING_PREFABS = ['sapling', 'sapling_moon'] as const;
export type SaplingPrefabId = typeof SAPLING_PREFABS[number];
/** TUNING.SAPLING_REGROW_TIME = total_day_time * 4. */
export const SAPLING_REGROW_TIME = 4 * 480;

export type SaplingRecord = PickablePlantRecord;
export type SaplingWorld = PickablePlantWorld;

/** sapling.lua: this prefab owns and registers its component callbacks. */
export class SaplingInstance extends PickablePlantInstance {
  constructor(prefab: SaplingPrefabId, context: PickablePlantContext) {
    super(SAPLING_DEFINITIONS[prefab], context);
    new Pickable(this, 'twigs', SAPLING_REGROW_TIME, 1, () => onpickedfn(this), () => onregenfn(this), context.saved?.components.pickable, {
      scheduler: context.scheduler, growthDuration: context.growthDuration,
      onTransplant: () => ontransplantfn(this), onBarren: wasEmpty => makebarrenfn(this, wasEmpty), onEmpty: () => makeemptyfn(this),
    });
    this.bindBurnable({ propagator: 'small', burnTime: 20, fxLevel: 3,
      onIgnite: () => DefaultBurnFn(this), onExtinguish: () => DefaultExtinguishFn(this), onBurnt: () => DefaultBurntFn(this, context.world) });
    const workable = this.components.workable = new Workable(this);
    workable.SetWorkAction('DIG'); workable.SetWorkLeft(1); workable.SetOnFinishCallback(dig_up);
    this.bindWitherable();
    MakeNoGrowInWinter(this, context.getWatchWorldContent);
  }
}

function onpickedfn(inst: PickablePlantInstance): void {
  inst.play(['picked']);
}
function onregenfn(inst: PickablePlantInstance): void { inst.play(['grow', 'sway'], true); }
function makeemptyfn(inst: PickablePlantInstance): void {
  inst.play(inst.components.witherable?.IsWithered() || inst.sprite.currentAnimation === 'idle_dead'
    ? ['dead_to_empty', 'empty'] : ['empty']);
}
function makebarrenfn(inst: PickablePlantInstance, wasEmpty: boolean): void {
  inst.play(inst.components.witherable?.IsWithered() ? [wasEmpty ? 'empty_to_dead' : 'full_to_dead', 'idle_dead'] : ['idle_dead']);
}
function ontransplantfn(inst: PickablePlantInstance): void { inst.components.pickable.MakeEmpty(); }
function dig_up(inst: PickablePlantInstance): void {
  const { pickable, lootdropper, witherable } = inst.components;
  if (pickable.canBePicked) lootdropper.SpawnLootPrefab(pickable.product!);
  lootdropper.SpawnLootPrefab(witherable?.IsWithered() ? 'twigs' : `dug_${inst.prefab}`);
  inst.remove();
}

/** sapling.lua sapling_common: bank/build share the prefab name; is_moon digs up dug_sapling_moon. */
function saplingDefinition(prefab: SaplingPrefabId): PickablePlantDefinition {
  return {
    prefab,
    createInstance: context => new SaplingInstance(prefab, context),
    minimapIcon: 'sapling.png',
    animArchive: `${prefab}.zip`,
    buildArchive: `${prefab}.zip`,
    archiveSprite: { bank: prefab, instancedAnimations: 'all' },
    tags: ['plant', 'renewable', 'silviculture', 'lunarplant_target'],
    barren: 'idle_dead',
    idle: { name: 'sway', randomFrame: true },
    empty: { name: 'empty', frame: 'first' },
    deploySmartRadius: .5 * (TILE_SIZE / 4),
  };
}
export const SAPLING_DEFINITIONS: Readonly<Record<SaplingPrefabId, PickablePlantDefinition>> = {
  sapling: saplingDefinition('sapling'),
  sapling_moon: saplingDefinition('sapling_moon'),
};

/** sapling.lua: PICK twigs, DIG, burning and winter-paused regrowth. */
export function saplingPrefabs(world: PickablePlantWorld): Readonly<Record<SaplingPrefabId, PrefabEntityDefinition<PickablePlantInstance>>> {
  return Object.fromEntries(SAPLING_PREFABS.map(id => [id, plantEntityDefinition(SAPLING_DEFINITIONS[id], world)])) as Record<SaplingPrefabId, PrefabEntityDefinition<PickablePlantInstance>>;
}

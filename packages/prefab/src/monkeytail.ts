import type { PrefabEntityDefinition } from './prefabInstance';
import { Pickable } from './components/pickable';
import { Workable } from '../../componets/src/workable';
import { DefaultBurnFn, DefaultExtinguishFn, DefaultBurntFn, MakeNoGrowInWinter } from './standardcomponents';
import { plantEntityDefinition, PickablePlantInstance, type PickablePlantContext, type PickablePlantWorld, type PickablePlantDefinition } from './pickablePlant';

export const MONKEYTAIL_ID = 'monkeytail' as const;
export const MONKEYTAIL_REGROW_TIME = 3 * 480;
/** monkeytail.lua: this prefab owns and registers its component callbacks. */
export class MonkeytailInstance extends PickablePlantInstance {
  constructor(context: PickablePlantContext) {
    super(MONKEYTAIL_DEFINITION, context);
    new Pickable(this, 'cutreeds', MONKEYTAIL_REGROW_TIME, 1, () => onpickedfn(this), () => onregenfn(this), context.saved?.components.pickable, {
      scheduler: context.scheduler, growthDuration: context.growthDuration, maxCycles: 5 + Math.floor(Math.random() * 3),
      onTransplant: () => ontransplantfn(this), onBarren: wasEmpty => makebarrenfn(this, wasEmpty), onEmpty: () => makeemptyfn(this),
    });
    this.bindBurnable({ propagator: 'small', burnTime: 15, fxLevel: 2,
      onIgnite: () => DefaultBurnFn(this), onExtinguish: () => DefaultExtinguishFn(this), onBurnt: () => DefaultBurntFn(this, context.world) });
    const workable = this.components.workable = new Workable(this);
    workable.SetWorkAction('DIG'); workable.SetWorkLeft(1); workable.SetOnFinishCallback(dig_up);
    this.bindWitherable();
    MakeNoGrowInWinter(this, context.getWatchWorldContent);
  }
}

function onpickedfn(inst: PickablePlantInstance): void {
  inst.playPickSound('dontstarve/wilson/pickup_reeds');
  inst.play(inst.components.pickable.IsBarren() ? ['picking', 'empty_to_dead', 'idle_dead'] : ['picking', 'picked']);
}
function onregenfn(inst: PickablePlantInstance): void { inst.play(['grow', 'idle'], true); }
function makeemptyfn(inst: PickablePlantInstance): void {
  inst.play(inst.components.witherable?.IsWithered() || inst.sprite.currentAnimation === 'idle_dead'
    ? ['dead_to_empty', 'picked'] : ['picked']);
}
function makebarrenfn(inst: PickablePlantInstance, wasEmpty: boolean): void {
  inst.play(inst.components.witherable?.IsWithered() ? [wasEmpty ? 'empty_to_dead' : 'full_to_dead', 'idle_dead'] : ['idle_dead']);
}
function ontransplantfn(inst: PickablePlantInstance): void { inst.components.pickable.MakeBarren(); }
function dig_up(inst: PickablePlantInstance): void {
  const { pickable, lootdropper, witherable } = inst.components;
  if (pickable.canBePicked) lootdropper.SpawnLootPrefab(pickable.product!);
  lootdropper.SpawnLootPrefab(witherable?.IsWithered() ? 'cutreeds' : 'dug_monkeytail');
  inst.remove();
}

export const MONKEYTAIL_DEFINITION: PickablePlantDefinition = {
  createInstance: context => new MonkeytailInstance(context),
  prefab: MONKEYTAIL_ID, animArchive: 'grass.zip', buildArchive: 'reeds_monkeytails.zip',
  archiveSprite: { bank: 'grass', instancedAnimations: 'all' },
  tags: ['plant', 'silviculture', 'witherable'],
  idle: { name: 'idle', randomFrame: true },
  empty: { name: 'picked', frame: 'last' }, barren: 'idle_dead', deploySmartRadius: 1.5,
};

/** monkeytail.lua: wild reeds regrow indefinitely; transplanted plants require fertilizer. */
export function monkeytailPrefabs(world: PickablePlantWorld): Readonly<Record<typeof MONKEYTAIL_ID, PrefabEntityDefinition<PickablePlantInstance>>> {
  return { [MONKEYTAIL_ID]: plantEntityDefinition(MONKEYTAIL_DEFINITION, world) };
}

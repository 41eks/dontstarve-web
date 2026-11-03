import { Pickable } from './components/pickable';
import { Workable } from '../../componets/src/workable';
import { DefaultBurnFn, DefaultExtinguishFn, DefaultBurntFn, MakeNoGrowInWinter } from './standardcomponents';
import type * as THREE from 'three';
import { PickablePlantManager, PickablePlantInstance, type PickablePlantContext, type PickablePlantDefinition, type PickablePlantRecord, type PickablePlantWorld } from './pickablePlant';

export const GRASS_ID = 'grass' as const;
export const GRASS_REGROW_TIME = 3 * 480;
/** TUNING.GRASS_CYCLES: picks a transplanted tuft gives before it goes barren. */
export const GRASS_CYCLES = 20;

export type GrassRecord = PickablePlantRecord;
export type GrassWorld = PickablePlantWorld;

/** grass.lua: this prefab owns and registers its component callbacks. */
export class GrassInstance extends PickablePlantInstance {
  constructor(context: PickablePlantContext) {
    super(GRASS_DEFINITION, context);
    new Pickable(this, 'cutgrass', GRASS_REGROW_TIME, 1, () => onpickedfn(this), () => onregenfn(this), context.saved?.components.pickable, {
      scheduler: context.scheduler, growthDuration: context.growthDuration, maxCycles: GRASS_CYCLES,
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
  lootdropper.SpawnLootPrefab(witherable?.IsWithered() ? 'cutgrass' : 'dug_grass');
  inst.remove();
}

/** grass.lua: grass bank with the grass1 build, picking → picked, and dug_grass loot. */
export const GRASS_DEFINITION: PickablePlantDefinition = {
  createInstance: context => new GrassInstance(context),
  prefab: GRASS_ID,
  minimapIcon: 'grass.png',
  animArchive: 'grass.zip',
  buildArchive: 'grass1.zip',
  archiveSprite: { bank: 'grass', instancedAnimations: 'all' },
  tags: ['plant', 'renewable', 'silviculture', 'lunarplant_target'],
  barren: 'idle_dead',
  idle: { name: 'idle' },
  empty: { name: 'picked', frame: 'last' },
};

/** grass.lua's native grass, with source component ownership for PICK, DIG and burning. */
export class GrassManager extends PickablePlantManager {
  spawn(position: THREE.Vector3, saved?: GrassRecord): THREE.Group {
    return this.spawnPlant(GRASS_DEFINITION, position, saved);
  }

  exportRecords(): GrassRecord[] { return this.exportPlants().map(({ record }) => record); }
}

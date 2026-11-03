import { Pickable } from './components/pickable';
import { DefaultBurnFn, DefaultExtinguishFn, DefaultBurntFn, MakeNoGrowInWinter } from './standardcomponents';
import type * as THREE from 'three';
import { PickablePlantManager, PickablePlantInstance, type PickablePlantContext, type PickablePlantDefinition, type PickablePlantRecord, type PickablePlantWorld } from './pickablePlant';

export const LICHEN_ID = 'lichen' as const;
/** TUNING.LICHEN_REGROW_TIME: total_day_time * 5. */
export const LICHEN_REGROW_TIME = 5 * 480;

export type LichenRecord = PickablePlantRecord;
export type LichenWorld = PickablePlantWorld;

export class LichenInstance extends PickablePlantInstance {
  constructor(context: PickablePlantContext) {
    super(LICHEN_DEFINITION, context);
    new Pickable(this, 'cutlichen', LICHEN_REGROW_TIME, 1, () => onpickedfn(this), () => onregenfn(this), context.saved?.components.pickable, {
      scheduler: context.scheduler, growthDuration: context.growthDuration, onEmpty: () => makeemptyfn(this),
    });
    this.bindBurnable({ propagator: 'small', burnTime: 10, fxLevel: 2,
      onIgnite: () => DefaultBurnFn(this), onExtinguish: () => DefaultExtinguishFn(this), onBurnt: () => DefaultBurntFn(this, context.world) });
    MakeNoGrowInWinter(this, context.getWatchWorldContent);
  }
}
function onpickedfn(inst: PickablePlantInstance): void {
  inst.playPickSound('dontstarve/wilson/pickup_lichen'); inst.play(['picking', 'picked']);
}
function onregenfn(inst: PickablePlantInstance): void { inst.play(['grow', 'idle'], true); }
function makeemptyfn(inst: PickablePlantInstance): void { inst.play(['picked']); }

/**
 * lichen.lua: bank/build `algae_bush`, a looping idle started on a random frame with a random grey tint, PICK cutlichen
 * (picking -> picked, grow -> idle), small burnable and propagator, MakeNoGrowInWinter. No workable, so it cannot be dug.
 */
export const LICHEN_DEFINITION: PickablePlantDefinition = {
  prefab: LICHEN_ID,
  createInstance: context => new LichenInstance(context),
  animArchive: 'algae_bush.zip',
  buildArchive: 'algae_bush.zip',
  archiveSprite: { bank: 'algae_bush', instancedAnimations: 'all' },
  tags: ['lichen'],
  // fn: PlayAnimation("idle", true), then SetFrame(math.random(numframes) - 1).
  idle: { name: 'idle', randomFrame: true },
  multColour: () => .75 + Math.random() * .25,
  // makeemptyfn: PlayAnimation("picked").
  empty: { name: 'picked', frame: 'last' },
  minimapIcon: 'lichen.png',
};

/** lichen.lua's cave lichen, with source component ownership for PICK and burning. */
export class LichenManager extends PickablePlantManager {
  spawn(position: THREE.Vector3, saved?: LichenRecord): THREE.Group {
    return this.spawnPlant(LICHEN_DEFINITION, position, saved);
  }

  exportRecords(): LichenRecord[] { return this.exportPlants().map(({ record }) => record); }
}

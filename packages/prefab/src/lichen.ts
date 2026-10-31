import type * as THREE from 'three';
import { PickablePlantManager, type PickablePlantDefinition, type PickablePlantRecord, type PickablePlantWorld } from './pickablePlant';

export const LICHEN_ID = 'lichen' as const;
/** TUNING.LICHEN_REGROW_TIME: total_day_time * 5. */
export const LICHEN_REGROW_TIME = 5 * 480;

export type LichenRecord = PickablePlantRecord;
export type LichenWorld = PickablePlantWorld;

/**
 * lichen.lua: bank/build `algae_bush`, a looping idle started on a random frame with a random grey tint, PICK cutlichen
 * (picking -> picked, grow -> idle), small burnable and propagator, MakeNoGrowInWinter. No workable, so it cannot be dug.
 */
export const LICHEN_DEFINITION: PickablePlantDefinition = {
  prefab: LICHEN_ID,
  animArchive: 'algae_bush.zip',
  buildArchive: 'algae_bush.zip',
  archiveSprite: { bank: 'algae_bush', instancedAnimations: 'all' },
  tags: ['lichen'],
  product: 'cutlichen',
  regrowTime: LICHEN_REGROW_TIME,
  // fn: PlayAnimation("idle", true), then SetFrame(math.random(numframes) - 1).
  idle: { name: 'idle', randomFrame: true },
  multColour: () => .75 + Math.random() * .25,
  // onpickedfn: PlaySound("dontstarve/wilson/pickup_lichen"), PlayAnimation("picking"), PushAnimation("picked", false).
  picked: { sound: 'dontstarve/wilson/pickup_lichen', clips: ['picking', 'picked'] },
  // makeemptyfn: PlayAnimation("picked").
  empty: { name: 'picked', frame: 'last' },
  // onregenfn: PlayAnimation("grow"), PushAnimation("idle", true).
  grow: 'grow',
  burnTime: 10,
  burnFxLevel: 2,
  propagatorSize: 'small',
  minimapIcon: 'lichen.png',
};

/** lichen.lua's cave lichen, with source component ownership for PICK and burning. */
export class LichenManager extends PickablePlantManager {
  spawn(position: THREE.Vector3, saved?: LichenRecord): THREE.Group {
    return this.spawnPlant(LICHEN_DEFINITION, position, saved);
  }

  exportRecords(): LichenRecord[] { return this.exportPlants().map(({ record }) => record); }
}

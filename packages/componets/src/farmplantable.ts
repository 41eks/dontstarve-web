import type { Vector3 } from 'three';

export interface FarmPlantWorld {
  spawnFarmPlant(prefab: string, position: Vector3): { PushEvent(name: string, data: unknown): void };
  worldEvents?: { emit(name: 'itemplanted', data: { doer: unknown; pos: Vector3 }): void };
}
export interface FarmSoil {
  readonly worldServices?: Partial<FarmPlantWorld>;
  readonly isRemoved: boolean;
  hasTag(tag: string): boolean;
  getPosition(): Vector3;
  remove(): void;
}
interface Seed {
  remove(): boolean;
}

/** farmplantable.lua: Plant replaces the soil, notifies the new plant, then removes the detached seed inst. */
export class FarmPlantable {
  plant?: string;
  private readonly inst: Seed;
  constructor(inst: Seed) { this.inst = inst; }

  Plant(target: FarmSoil, planter: unknown): boolean {
    const world = target.worldServices;
    if (!this.plant || target.isRemoved || !target.hasTag('soil') || !world?.spawnFarmPlant) return false;
    const position = target.getPosition().clone();
    target.remove();
    const plant = world.spawnFarmPlant(this.plant, position);
    plant.PushEvent('on_planted', { doer: planter, seed: this.inst, in_soil: true });
    world.worldEvents?.emit('itemplanted', { doer: planter, pos: position });
    this.inst.remove();
    return true;
  }
}

import type { ItemEntity } from '@dontstarve-web/inventory';
import { FarmPlantable } from '../../componets/src/farmplantable';
import { VEGGIE_SEED_IDS } from './veggies';

// seeds.lua: CALORIES_TINY / 2, health 0, default edible sanity 0.
export const SEEDS_HUNGER = 4.6875;

/** seeds.lua fn / veggies.lua fn_seeds: each seed declares its farmplantable product. */
export function configureSeedEntity(inst: ItemEntity): void {
  if (inst.prefab !== 'seeds' && !(VEGGIE_SEED_IDS as readonly string[]).includes(inst.prefab)) return;
  if (!inst.components.farmplantable) {
    const plantable = new FarmPlantable(inst);
    plantable.plant = inst.prefab === 'seeds' ? 'farm_plant_randomseed' : `farm_plant_${inst.prefab.slice(0, -6)}`;
    inst.components.farmplantable = plantable;
  }
}

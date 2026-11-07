import { addComponent } from './components';
import { groundItemPrefab, type ItemPrefabDefinition } from './groundItems';
import { type PrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';
import type { ItemPrefabWorld } from './groundPrefab';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { Fuel } from '../../componets/src/fuel';

export const LIGHTBULB_ID = 'lightbulb';
/** tuning.lua MED_LARGE_FUEL = seg_time * 3. */
export const LIGHTBULB_FUEL = 90;

export function configureLightbulbEntity(entity: ItemEntity): void {
  for (const tag of ['lightbattery', 'vasedecoration', 'light']) entity.addTag(tag);
  if (entity.components.fuel) return;
  const fuel = addComponent(entity, 'fuel', Fuel);
  fuel.fueltype = 'CAVE';
  fuel.fuelvalue = LIGHTBULB_FUEL;
}

/** lightbulb.lua's Light values, with source radius converted to scene units. */
export const LIGHTBULB_LIGHT: PrefabLocalLight = {
  radius: 0.5 * (TILE_SIZE / 4),
  intensity: 0.5,
  falloff: 0.7,
  colour: [237 / 255, 237 / 255, 209 / 255],
};

/** lightbulb.lua: its Light is on while it is in the scene; RemoveFromScene turns it off while it is held. */
export function lightbulbPrefabs(world: ItemPrefabWorld): Record<string, ItemPrefabDefinition> {
  return { [LIGHTBULB_ID]: groundItemPrefab(LIGHTBULB_ID, world, { configure: inst => inst.light.set(LIGHTBULB_LIGHT) }) };
}

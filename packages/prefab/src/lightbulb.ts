import type { SpriteState } from '@dontstarve-web/display';
import { createResidentGroundItem } from './groundItems';
import { type PrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';
import { listenInventoryEvents } from './inventoryEvents';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { Fuel } from '../../componets/src/fuel';
import { prefabInstance } from './prefabInstance';

export const LIGHTBULB_ID = 'lightbulb';
/** tuning.lua MED_LARGE_FUEL = seg_time * 3. */
export const LIGHTBULB_FUEL = 90;

export function configureLightbulbEntity(entity: ItemEntity): void {
  for (const tag of ['lightbattery', 'vasedecoration', 'light']) entity.addTag(tag);
  const fuel = entity.component('fuel', () => new Fuel(entity));
  fuel.fueltype = 'CAVE';
  fuel.fuelvalue = LIGHTBULB_FUEL;
  entity.components.fuel = fuel;
}

/** lightbulb.lua's Light values, with source radius converted to scene units. */
export const LIGHTBULB_LIGHT: PrefabLocalLight = {
  radius: 0.5 * (TILE_SIZE / 4),
  intensity: 0.5,
  falloff: 0.7,
  colour: [237 / 255, 237 / 255, 209 / 255],
};

/** Ground lightbulbs glow until picked up; they use bulb.zip's idle world art. */
/** `sprite` is the item's own sprite json, whose skin it keeps; without one the visual has a sprite of its own in `skinId`. */
export function createLightbulbGroundSprite(context: Pick<GroundPrefabContext, 'assets' | 'tickingarea'>,
  options: { lit?: boolean; skinId?: string; sprite?: SpriteState } = {}) {
  const { visual } = createResidentGroundItem(context, { itemId: LIGHTBULB_ID, skinId: options.skinId, sprite: options.sprite });
  const setLit = (lit: boolean) => prefabInstance(visual.model)!.light.set(lit ? LIGHTBULB_LIGHT : null);
  setLit(options.lit ?? true);
  const removeInventoryEvents = listenInventoryEvents(visual.model, {
    ondropped: () => setLit(true),
    onputininventory: () => setLit(false),
    onload: () => setLit(options.lit ?? true),
  });
  return {
    ...visual,
    setLit,
    dispose() { removeInventoryEvents(); setLit(false); visual.dispose(); },
  };
}

export function createLightbulbGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  return {
    itemIds: [LIGHTBULB_ID],
    configureEntity: configureLightbulbEntity,
    create: (_item, entity) => createLightbulbGroundSprite(context, { sprite: entity.sprite }),
  };
}

import { createGroundItemSprite, GroundItemAssets } from './groundItems';
import { setPrefabLocalLight, type PrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';
import { listenInventoryEvents } from './inventoryEvents';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';

export const LIGHTBULB_ID = 'lightbulb';

/** lightbulb.lua's Light values, with source radius converted to scene units. */
export const LIGHTBULB_LIGHT: PrefabLocalLight = {
  radius: 0.5 * (TILE_SIZE / 4),
  intensity: 0.5,
  falloff: 0.7,
  colour: [237 / 255, 237 / 255, 209 / 255],
};

/** Ground lightbulbs glow until picked up; they use bulb.zip's idle world art. */
export async function createLightbulbGroundSprite(assets: GroundItemAssets, options: { lit?: boolean; skinId?: string } = {}) {
  const sprite = await createGroundItemSprite(assets, LIGHTBULB_ID, options.skinId);
  const setLit = (lit: boolean) => setPrefabLocalLight(sprite.model, lit ? LIGHTBULB_LIGHT : null);
  setLit(options.lit ?? true);
  const removeInventoryEvents = listenInventoryEvents(sprite.model, {
    ondropped: () => setLit(true),
    onputininventory: () => setLit(false),
    onload: () => setLit(options.lit ?? true),
  });
  return {
    ...sprite,
    setLit,
    dispose() { removeInventoryEvents(); setLit(false); sprite.dispose(); },
  };
}

export function createLightbulbGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  return {
    itemIds: [LIGHTBULB_ID],
    create: (item) => createLightbulbGroundSprite(context.assets, { skinId: item.skinId }),
  };
}

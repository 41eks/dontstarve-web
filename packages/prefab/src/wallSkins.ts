/** prefabskins.lua order and skinprefabs.lua's actual build names. */
export const WALL_SKIN_ARCHIVES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  wall_stone: {
    wall_stone_an: 'dynamic/wall_stone_an.zip',
    wall_stone_ancient: 'dynamic/wall_stone_ancient.zip',
    wall_stone_ancient_alt: 'dynamic/wall_stone_ancient.zip',
    wall_stone_gothic: 'dynamic/wall_stone_gothic.zip',
    wall_stone_rose: 'dynamic/wall_stone_rose.zip',
    wall_stone_shell: 'dynamic/wall_stone_shell.zip',
    wall_stone_victorian: 'dynamic/wall_stone_victorian.zip',
  },
  wall_wood: { wall_wood_ornate: 'dynamic/wall_wood_ornate.zip' },
  wall_hay: { wall_hay_corn: 'dynamic/wall_hay_corn.zip' },
  wall_ruins: {
    wall_ruins_thulecite: 'dynamic/wall_ruins_thulecite.zip',
    wall_ruins_thulecite2: 'dynamic/wall_ruins_thulecite2.zip',
    wall_ruins_thulecite2_alt: 'dynamic/wall_ruins_thulecite2.zip',
    wall_ruins_thulecite_alt: 'dynamic/wall_ruins_thulecite.zip',
    wall_ruins_victorian: 'dynamic/wall_ruins_victorian.zip',
  },
  wall_moonrock: { wall_moonrock_victorian: 'dynamic/wall_moonrock_victorian.zip' },
  wall_dreadstone: { wall_dreadstone_relic: 'dynamic/wall_dreadstone_relic.zip' },
};

/** Inventory skin IDs differ from the linked world prefab's IDs. */
const ITEM_SKINS: Readonly<Record<string, string>> = {
  wall_stone_anitem: 'wall_stone_an',
  wall_stone_ancientitem: 'wall_stone_ancient',
  wall_stone_ancient_alt_item: 'wall_stone_ancient_alt',
  wall_stone_gothicitem: 'wall_stone_gothic',
  wall_stone_roseitem: 'wall_stone_rose',
  wall_stone_shellitem: 'wall_stone_shell',
  wall_stone_victorianitem: 'wall_stone_victorian',
  wall_wood_ornateitem: 'wall_wood_ornate',
  wall_hay_cornitem: 'wall_hay_corn',
  wall_ruins_thuleciteitem: 'wall_ruins_thulecite',
  wall_ruins_thulecite2item: 'wall_ruins_thulecite2',
  wall_ruins_thulecite2item_alt: 'wall_ruins_thulecite2_alt',
  wall_ruins_thulecite_alt_item: 'wall_ruins_thulecite_alt',
  wall_ruins_victorianitem: 'wall_ruins_victorian',
  wall_moonrock_victorianitem: 'wall_moonrock_victorian',
  wall_dreadstone_relicitem: 'wall_dreadstone_relic',
};

export function wallWorldPrefab(prefabId: string): string {
  return prefabId.endsWith('_item') ? prefabId.slice(0, -'_item'.length) : prefabId;
}

export function wallWorldSkin(prefabId: string, skinId?: string): string | undefined {
  if (skinId === undefined) return undefined;
  const skins = WALL_SKIN_ARCHIVES[wallWorldPrefab(prefabId)] ?? {};
  const worldSkin = prefabId.endsWith('_item') ? ITEM_SKINS[skinId] ?? skinId : skinId;
  if (!worldSkin || !Object.hasOwn(skins, worldSkin)) throw new Error(`Unsupported ${prefabId} skin: ${skinId}`);
  return worldSkin;
}

export interface WallSaveState { skinId?: string }

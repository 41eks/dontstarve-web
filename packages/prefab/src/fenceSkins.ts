/** prefabs/fence.lua prefab IDs: `fence` is the placed world prefab, `fence_item` the deployable stack. */
export const FENCE_ID = 'fence';
export const FENCE_ITEM_ID = 'fence_item';
export const FENCE_IDS = [FENCE_ID, FENCE_ITEM_ID] as const;
export type FenceId = typeof FENCE_IDS[number];

export function isFenceId(value: string): value is FenceId {
  return (FENCE_IDS as readonly string[]).includes(value);
}

/** prefabskins.lua `fence` order; skinprefabs.lua gives each skin the build of the same name. */
export const FENCE_SKIN_ARCHIVES: Readonly<Record<string, string>> = Object.fromEntries([
  'fence_ancient', 'fence_factory', 'fence_fantasy', 'fence_gingerbread', 'fence_gothic', 'fence_picketbrown',
  'fence_pickettan', 'fence_picketwhite', 'fence_rose', 'fence_shell', 'fence_victorianblack', 'fence_victorianbrass',
  'fence_victorianbronze',
].map(skin => [skin, `dynamic/${skin}.zip`]));

/** Inventory skins are `<skin>_item`; the linked world skin drops the suffix. */
export function fenceWorldSkin(buildId: FenceId, skinId?: string): string | undefined {
  if (skinId === undefined) return undefined;
  const worldSkin = buildId === FENCE_ITEM_ID ? skinId.replace(/_item$/, '') : skinId;
  if (!Object.hasOwn(FENCE_SKIN_ARCHIVES, worldSkin)) throw new Error(`Unsupported ${buildId} skin: ${skinId}`);
  return worldSkin;
}

export interface FenceSaveState { rot?: number; skinId?: string }

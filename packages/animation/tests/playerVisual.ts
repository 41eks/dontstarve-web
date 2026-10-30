import { prefabDisplay } from '@dontstarve-web/display';
import { createWilsonPlayer as createPlayer, createWilsonPlayerPrefab as createPrefab } from '../../prefab/src/player';
import type { PrefabDisplay } from '../../display/src';
export * from '../../prefab/src/player';

/** Rendering tests explicitly wait for display art; the prefab itself is created synchronously. */
export async function createWilsonPlayer(...args: Parameters<typeof createPlayer>) {
  const model = createPlayer(...args);
  await (prefabDisplay(model) as PrefabDisplay).artLoaded();
  return model;
}

export async function createWilsonPlayerPrefab(...args: Parameters<typeof createPrefab>) {
  const prefab = createPrefab(...args);
  await prefab.display.artLoaded();
  return prefab;
}

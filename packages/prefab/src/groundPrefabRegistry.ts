import { GroundItemAssets, createGroundItemFactory } from './groundItems';
import { createHatGroundFactory } from './hats';
import { createBernieGroundFactory } from './bernie';
import { createFirefliesGroundFactory } from './fireflies';
import { createButterflyGroundFactory } from './butterfly';
import { createLightbulbGroundFactory } from './lightbulb';
import { createLanternGroundFactory } from './lantern';
import { createPhonographGroundFactory } from './phonograph';
import type { GroundItemFactory, GroundPrefabOptions } from './groundPrefab';

// Shared catalog factories come first; specialized prefabs override their IDs.
const PREFAB_MODULES = [
  createGroundItemFactory, createHatGroundFactory, createBernieGroundFactory,
  createFirefliesGroundFactory, createButterflyGroundFactory,
  createLightbulbGroundFactory, createLanternGroundFactory, createPhonographGroundFactory,
];

/** One registry and resource lifetime per ground-item manager. */
export class GroundPrefabRegistry {
  private readonly factories = new Map<string, GroundItemFactory>();
  private readonly modules: GroundItemFactory[];
  private readonly assets: GroundItemAssets;

  constructor(options: GroundPrefabOptions) {
    this.assets = new GroundItemAssets(options.animationBaseUrl);
    const context = { ...options, assets: this.assets };
    this.modules = PREFAB_MODULES.map((createFactory) => createFactory(context));
    for (const factory of this.modules) {
      for (const id of factory.itemIds) this.factories.set(id, factory);
    }
  }

  get(itemId: string): GroundItemFactory | undefined {
    return this.factories.get(itemId);
  }

  dispose(): void {
    this.factories.clear();
    for (const factory of [...this.modules].reverse()) factory.dispose?.();
    this.assets.dispose();
  }
}

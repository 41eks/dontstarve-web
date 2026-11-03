import type { PrefabDisplayGroup } from '@dontstarve-web/display';
import type { TileStateQuery } from '@dontstarve-web/signals';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { World } from 'cannon-es';
import { PrefabEntityManager, type PrefabInstance, type PrefabEntityDefinition } from '../../prefab/src/prefabInstance';

const displayGroups = new WeakMap<object, PrefabDisplayGroup>();

/** Tests advance their world's injected display owner directly. */
export function prefabDisplays(manager: object): PrefabDisplayGroup {
  const displays = displayGroups.get(manager);
  if (!displays) throw new Error('No display group registered for this test manager');
  return displays;
}

/** An isolated world in a test owns one generic manager, populated with source prefab declarations. */
export function prefabManager<Environment extends { scheduler: GameTimeScheduler; tickingarea?: TileStateQuery; physics?: World },
  Id extends string, Instance extends PrefabInstance>(displays: PrefabDisplayGroup, baseUrl: string | undefined,
  world: Environment, define: (world: Environment) => Readonly<Record<Id, PrefabEntityDefinition<Instance>>>) {
  const manager = new PrefabEntityManager<Id, Instance>(displays, baseUrl, world, define(world));
  displayGroups.set(manager, displays);
  return manager;
}

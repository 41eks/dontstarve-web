import type { PrefabDisplayGroup } from '@dontstarve-web/display';
import type { TileStateQuery } from '@dontstarve-web/signals';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { World } from 'cannon-es';
import { PrefabEntityManager, type PrefabInstance, type PrefabEntityDefinition } from '../../prefab/src/prefabInstance';

/** An isolated world in a test owns one generic manager, populated with source prefab declarations. */
export function prefabManager<Environment extends { scheduler: GameTimeScheduler; tickingarea?: TileStateQuery; physics?: World },
  Id extends string, Instance extends PrefabInstance>(displays: PrefabDisplayGroup, baseUrl: string | undefined,
  world: Environment, define: (world: Environment) => Readonly<Record<Id, PrefabEntityDefinition<Instance>>>) {
  return new PrefabEntityManager<Id, Instance>(displays, baseUrl, world, define(world));
}

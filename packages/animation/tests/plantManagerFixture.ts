import { afterEach } from 'vitest';
import { getBoundWatchWorldContent, WorldContentKey } from '../../signals/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { FireFxHost } from '../../prefab/src/treeFire';
import type { PickablePlantInstance, PickablePlantWorld } from '../../prefab/src/pickablePlant';
import { PrefabEntityManager, type PrefabEntityDefinition } from '../../prefab/src/prefabInstance';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import type { Scene } from 'three';

const plantFixtures = new Set<() => void>();
afterEach(() => { for (const dispose of plantFixtures) dispose(); plantFixtures.clear(); });

/** Own the injected display/fire resources in tests; return the actual generic manager without adapting its API. */
export function plantManager<Id extends string, Instance extends PickablePlantInstance>(
  define: (world: PickablePlantWorld) => Readonly<Record<Id, PrefabEntityDefinition<Instance>>>,
  scene: Scene, options: Omit<PickablePlantWorld, 'scheduler' | 'fire' | 'getWatchWorldContent'>,
): PrefabEntityManager<Id, Instance> {
  const displays = new PrefabDisplayGroup(scene), fire = FireFxHost.create('/dst/data/anim');
  const getWatchWorldContent = getBoundWatchWorldContent();
  let stopSeason: (() => void) | undefined;
  const season = getWatchWorldContent?.(WorldContentKey.Season, stop => { stopSeason = stop; });
  const scheduler = season?.scheduler ?? new GameTimeScheduler();
  const world = { ...options, scheduler, fire, getWatchWorldContent };
  const manager = new PrefabEntityManager(displays, '/dst/data/anim', world, define(world));
  plantFixtures.add(() => { manager.dispose(); displays.dispose(); fire.dispose(); stopSeason?.(); if (!season) scheduler.dispose(); });
  return manager;
}

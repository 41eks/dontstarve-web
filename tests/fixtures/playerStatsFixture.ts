import { SpriteState } from '@dontstarve-web/display';
import { PrefabInstance } from '../../packages/prefab/src/prefabInstance';
import { createPlayerStats, type PlayerStatsSave } from '../../packages/prefab/src/player_common';

/** Logic-only player for stats tests, without loading the application world or art. */
export function playerStatsFixture(saved: PlayerStatsSave) {
  const instance = new PrefabInstance('wortox', new SpriteState({ name: '' }));
  return Object.assign(instance, { stats: createPlayerStats(instance, saved) });
}

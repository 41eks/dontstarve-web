import { createSignal } from '@dontstarve-web/signals';
import { WILSON_MAX_SANITY } from '@dontstarve-web/prefab/player_common';
import { playerInstance } from './player';
import type { SavedPlayer } from './save/types';
import type { FoodEffects } from '@dontstarve-web/prefab/food';

export { WILSON_MAX_HEALTH, WILSON_MAX_HUNGER, WILSON_MAX_SANITY } from '@dontstarve-web/prefab/player_common';
export const playerStats = playerInstance.stats;

/** player_classified isghostmode: set by OnMakePlayerGhost, read by playervision and the save. */
export const playerGhostMode = createSignal(false);

/** Persist numerical stats rather than runtime signals and subscriptions. */
export function getPlayerStats(): NonNullable<SavedPlayer['stats']> {
  return { health: playerStats.health.currenthealth, hunger: playerStats.hunger.peek(), sanity: playerStats.sanity.peek(),
    ...playerStats.health.penalty > 0 ? { penalty: playerStats.health.penalty } : {} };
}

export function applyPlayerFoodEffects(effects: FoodEffects, cause?: string): void {
  playerStats.health.DoDelta(effects.health, false, cause);
  playerStats.hunger.set(playerStats.hunger.peek() + effects.hunger);
  playerStats.sanity.set(playerStats.sanity.peek() + effects.sanity);
}

export function setPlayerSanityPercent(percent: number): void {
  if (!Number.isFinite(percent) || percent < 0 || percent > 1) {
    throw new Error('理智比例必须是 0 到 1 的数字');
  }
  playerStats.sanity.set(percent * WILSON_MAX_SANITY);
}

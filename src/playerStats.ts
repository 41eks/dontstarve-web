import { createHealthState, createHungerState, createSanityState, createSignal, type HealthState, type HungerState, type SanityState } from '@dontstarve-web/signals';
import { initialSave } from './save/initialSave';
import type { SavedPlayer } from './save/types';
import type { FoodEffects } from '@dontstarve-web/prefab/food';

// Wilson's maximum stats from DST tuning.lua. Keep the existing HUD defaults
// for older saves that do not yet contain player stats.
export const WILSON_MAX_SANITY = 200;
export const WILSON_MAX_HEALTH = 150;
export const WILSON_MAX_HUNGER = 150;
export const playerStats: { readonly health: HealthState; readonly hunger: HungerState; readonly sanity: SanityState } = {
  health: createHealthState(initialSave.players.local.stats?.health ?? 150, WILSON_MAX_HEALTH, initialSave.players.local.stats?.penalty),
  hunger: createHungerState(initialSave.players.local.stats?.hunger ?? 105, WILSON_MAX_HUNGER),
  sanity: createSanityState(initialSave.players.local.stats?.sanity ?? 35, WILSON_MAX_SANITY),
};

/** player_classified isghostmode: set by OnMakePlayerGhost, read by playervision and the save. */
export const playerGhostMode = createSignal(false);

/** Persist numerical stats rather than runtime signals and subscriptions. */
export function getPlayerStats(): NonNullable<SavedPlayer['stats']> {
  return { health: playerStats.health.peek(), hunger: playerStats.hunger.peek(), sanity: playerStats.sanity.peek(),
    ...playerStats.health.penalty > 0 ? { penalty: playerStats.health.penalty } : {} };
}

export function applyPlayerFoodEffects(effects: FoodEffects): void {
  playerStats.health.set(playerStats.health.peek() + effects.health);
  playerStats.hunger.set(playerStats.hunger.peek() + effects.hunger);
  playerStats.sanity.set(playerStats.sanity.peek() + effects.sanity);
}

export function setPlayerSanityPercent(percent: number): void {
  if (!Number.isFinite(percent) || percent < 0 || percent > 1) {
    throw new Error('理智比例必须是 0 到 1 的数字');
  }
  playerStats.sanity.set(percent * WILSON_MAX_SANITY);
}

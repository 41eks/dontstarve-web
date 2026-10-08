import { createSanityState, type SanityState } from '@dontstarve-web/signals';
import { initialSave } from './save/initialSave';
import type { SavedPlayer } from './save/types';
import type { FoodEffects } from '@dontstarve-web/prefab/food';

// Wilson's maximum sanity from DST tuning.lua. Keep the existing HUD defaults
// for older saves that do not yet contain player stats.
export const WILSON_MAX_SANITY = 200;
export const playerStats: { health: number; hunger: number; readonly sanity: SanityState } = {
  health: initialSave.players.local.stats?.health ?? 150,
  hunger: initialSave.players.local.stats?.hunger ?? 105,
  sanity: createSanityState(initialSave.players.local.stats?.sanity ?? 35, WILSON_MAX_SANITY),
};

/** Persist numerical stats rather than runtime signals and subscriptions. */
export function getPlayerStats(): NonNullable<SavedPlayer['stats']> {
  return { health: playerStats.health, hunger: playerStats.hunger, sanity: playerStats.sanity.peek() };
}

export function applyPlayerFoodEffects(effects: FoodEffects): void {
  playerStats.health = Math.max(0, Math.min(150, playerStats.health + effects.health));
  playerStats.hunger = Math.max(0, Math.min(150, playerStats.hunger + effects.hunger));
  playerStats.sanity.set(playerStats.sanity.peek() + effects.sanity);
}

export function setPlayerSanityPercent(percent: number): void {
  if (!Number.isFinite(percent) || percent < 0 || percent > 1) {
    throw new Error('理智比例必须是 0 到 1 的数字');
  }
  playerStats.sanity.set(percent * WILSON_MAX_SANITY);
}

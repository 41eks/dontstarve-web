import { initialSave } from './save/initialSave';

// Wilson's maximum sanity from DST tuning.lua. Keep the existing HUD defaults
// for older saves that do not yet contain player stats.
export const WILSON_MAX_SANITY = 200;
export const playerStats = {
  health: initialSave.players.local.stats?.health ?? 150,
  hunger: initialSave.players.local.stats?.hunger ?? 105,
  sanity: Math.max(0, Math.min(WILSON_MAX_SANITY, initialSave.players.local.stats?.sanity ?? 35)),
};

export function setPlayerSanityPercent(percent: number): void {
  if (!Number.isFinite(percent) || percent < 0 || percent > 1) {
    throw new Error('理智比例必须是 0 到 1 的数字');
  }
  playerStats.sanity = percent * WILSON_MAX_SANITY;
}

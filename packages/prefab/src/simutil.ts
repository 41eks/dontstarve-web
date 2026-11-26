import { WorldContentKey, type GetWatchWorldContent } from '@dontstarve-web/signals';
import type { PrefabInstance } from './prefabInstance';

/** simutil.lua SpringGrowthMod: a growth task set in spring takes TUNING.SPRING_GROWTH_MODIFIER (.75) of its time. */
export function SpringGrowthMod(
  inst: Pick<PrefabInstance, 'onRemove'>,
  watch: GetWatchWorldContent | undefined,
): (seconds: number) => number {
  const season = watch?.(WorldContentKey.Season, stop => inst.onRemove(stop));
  return seconds => (season?.value.season === 'spring' ? seconds * 0.75 : seconds);
}

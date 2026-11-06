import { SpriteState } from '@dontstarve-web/display';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { Transform } from './transform';

export const MOONROCKSEED_ID = 'moonrockseed' as const;

/**
 * moonrockseed.lua, as far as it is ported: the orb's held idle pose and source tags. Its inventory item,
 * celestial station prototyper and OnSpawned are not ported, so it is static art without mining or loot.
 */
export class MoonrockSeedInstance extends PrefabInstance {
  constructor() {
    super(MOONROCKSEED_ID, new SpriteState({ name: 'idle', billboard: true }), Transform.stationary());
    this.sprite.playOnce('idle');
    this.sprite.setPaused(true);
    for (const tag of ['irreplaceable', 'nonpotatable', 'celestial_station']) this.addTag(tag);
  }
}

/** The Prefab moonrockseed.lua returns. */
export function moonrockseedPrefabs(): Readonly<Record<typeof MOONROCKSEED_ID, PrefabEntityDefinition<MoonrockSeedInstance>>> {
  return {
    [MOONROCKSEED_ID]: {
      fn: () => new MoonrockSeedInstance(),
      assets: { animationArchive: 'moonrock_seed.zip', buildArchives: ['moonrock_seed.zip'], bank: 'moonrock_seed' },
      assetOptions: { instancedAnimations: 'all' },
    },
  };
}

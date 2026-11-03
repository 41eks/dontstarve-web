import { SpriteState, type PrefabDisplayGroup } from '@dontstarve-web/display';
import type { TileStateQuery } from '@dontstarve-web/signals';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Hauntable, HAUNT_COOLDOWN_MEDIUM } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import type { SpawnGroundItem } from './groundPrefab';
import { PrefabEntityManager, PrefabInstance } from './prefabInstance';
import { DefaultBurnFn, DefaultBurntFn, DefaultExtinguishFn } from './standardcomponents';
import { Transform } from './transform';
import { BurnableBinding, type FireFxHost } from './treeFire';

export const MARSH_PLANT_ID = 'marsh_plant' as const;
/** MakeMediumBurnable's defaults. */
const BURN_TIME = 20;
const BURN_FX_LEVEL = 3;

/** What the scene injects into every plant. */
export interface MarshPlantWorld {
  scheduler: GameTimeScheduler;
  /** The fire art's owner, injected and disposed by the application. */
  fire: FireFxHost;
  spawnGroundItem: SpawnGroundItem;
  tickingarea?: TileStateQuery;
}

/** marsh_plant.lua fn("marsh_plant", "marsh_plant"). */
export class MarshPlantInstance extends PrefabInstance {
  constructor(world: MarshPlantWorld) {
    super(MARSH_PLANT_ID, new SpriteState({ name: 'idle', billboard: true }), Transform.stationary());
    this.addTag('plant');
    // MakeMediumBurnable(inst) + MakeSmallPropagator(inst).
    const burn = new BurnableBinding(this, { propagator: 'small', burnTime: BURN_TIME, fxLevel: BURN_FX_LEVEL,
      onIgnite: () => DefaultBurnFn(this), onExtinguish: () => DefaultExtinguishFn(this), onBurnt: () => DefaultBurntFn(this, world) }, world);
    // MakeHauntableIgnite: the source's #HAUNTFIX comments out igniting, so a haunt only fails.
    const hauntable = new Hauntable(this, world.scheduler);
    hauntable.SetCooldown(HAUNT_COOLDOWN_MEDIUM);
    hauntable.SetOnHauntFn(() => false);
    Object.assign(this.components, { hauntable, inspectable: new Inspectable(this) });
    this.addTag('inspectable');
    this.onRemove(() => { burn.dispose(); hauntable.dispose(); });
  }
}

/** The Prefab table marsh_plant.lua returns, as far as it is ported: pond_algae belongs to the unported pond_cave. */
export function createMarshPlantManager(displays: PrefabDisplayGroup, animationBaseUrl: string, world: MarshPlantWorld) {
  return new PrefabEntityManager<typeof MARSH_PLANT_ID, MarshPlantInstance>(displays, animationBaseUrl, world, {
    [MARSH_PLANT_ID]: {
      fn: () => new MarshPlantInstance(world),
      assets: { animationArchive: 'marsh_plant.zip', buildArchives: ['marsh_plant.zip'], bank: 'marsh_plant' },
      assetOptions: { instancedAnimations: 'all', staticBillboard: true },
    },
  });
}

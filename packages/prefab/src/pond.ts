import { SpriteState, type PrefabDisplayGroup } from '@dontstarve-web/display';
import { createEffect, WorldContentKey, type GetWatchWorldContent, type TileStateQuery } from '@dontstarve-web/signals';
import type * as CANNON from 'cannon-es';
import { Fishable } from '../../componets/src/fishable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { SlipperyFeetTarget } from '../../componets/src/slipperyfeettarget';
import { WILSON_RUN_SPEED } from '../../componets/src/slipperyfeet';
import { COLLISION } from '../../componets/src/physicsState';
import { PrefabEntityManager, PrefabInstance, type PrefabComponents } from './prefabInstance';
import { MakePondPhysics } from './standardcomponents';

export const POND_ID = 'pond' as const;
/** tuning.lua FISH_RESPAWN_TIME = day_time / 3, day_time = 8 * 60 * 0.5 * 2 / 2. */
const FISH_RESPAWN_TIME = 480 / 3;
/** pondfish.lua `inst.build`: the build SGwilson's catchfish swaps into fish01. */
const POND_FISH = { prefab: 'pondfish', build: 'fish01' } as const;
/** pond.lua OnSnowLevel: snowlevel above this freezes the pond. */
const POND_FREEZE_SNOWLEVEL = .02;

/** pond.lua SlipperyRate: running faster than WILSON_RUN_SPEED slips ten times faster. */
const slipperyRate = (_: unknown, target: unknown) =>
  (target as { getMotorSpeed(): number }).getMotorSpeed() > WILSON_RUN_SPEED ? 50 : 5;

/** What the scene injects into every pond. */
export interface PondWorld {
  scheduler: GameTimeScheduler;
  tickingarea?: TileStateQuery;
  getWatchWorldContent?: GetWatchWorldContent;
  physics?: CANNON.World;
}

interface PondComponents extends PrefabComponents {
  fishable?: Fishable;
  slipperyfeettarget?: SlipperyFeetTarget;
}

/** pond.lua's commonfn("") and pondfrog(): marsh_tile art, fishable pondfish, and frozen following snowlevel. */
export class PondInstance extends PrefabInstance<SpriteState, PondComponents> {
  frozen = false;
  private readonly getWatchWorldContent?: GetWatchWorldContent;
  private stopWatching?: () => void;

  constructor({ scheduler, getWatchWorldContent }: PondWorld) {
    super(POND_ID, new SpriteState({ name: 'idle' }));
    this.getWatchWorldContent = getWatchWorldContent;
    // OnGround: lift only the artwork above terrain; the entity/save origin stays grounded. Ground layers share
    // group order 0 and use mesh order. A negative group order would draw the pond before transparent turf, which covers it up.
    this.sprite.setGround(0); this.sprite.setMeshOrder(-.5);
    for (const tag of ['watersource', 'pond', 'antlion_sinkhole_blocker', 'birdblocker']) this.addTag(tag);

    const fishable = this.components.fishable = new Fishable(this, scheduler);
    fishable.AddFish(POND_FISH.prefab, POND_FISH.build);
    fishable.SetRespawnTime(FISH_RESPAWN_TIME);

    this.onRemove(() => {
      this.stopWatching?.();
      fishable.OnRemoveFromEntity();
    });
  }

  /** pond.lua OnInit: WatchWorldState("snowlevel", OnSnowLevel) once the pond is in the world, through its own watched signal. */
  OnInit(): void {
    const snowLevel = this.getWatchWorldContent?.(WorldContentKey.SnowLevel, stop => { this.stopWatching = stop; });
    if (snowLevel) createEffect(() => this.OnSnowLevel(snowLevel.get()));
  }

  private OnSnowLevel(snowlevel: number): void {
    if (snowlevel > POND_FREEZE_SNOWLEVEL) {
      if (this.frozen) return;
      this.frozen = true;
      this.sprite.playOnce('frozen');
      this.components.fishable!.Freeze();
      this.physics.SetCollisionGroup(COLLISION.LAND_OCEAN_LIMITS);
      this.physics.SetCollisionMask(COLLISION.WORLD, COLLISION.ITEMS);
      const slipperyfeettarget = this.components.slipperyfeettarget = new SlipperyFeetTarget(this);
      slipperyfeettarget.SetSlipperyRate(slipperyRate);
    } else if (this.frozen) {
      this.frozen = false;
      this.sprite.start('idle');
      this.components.fishable!.Unfreeze();
      this.physics.SetCollisionGroup(COLLISION.OBSTACLES);
      this.physics.SetCollisionMask(COLLISION.ITEMS, COLLISION.CHARACTERS, COLLISION.GIANTS);
      this.components.slipperyfeettarget!.OnRemoveFromEntity();
      delete this.components.slipperyfeettarget;
    }
  }
}

/** The Prefab table pond.lua returns, as far as it is ported. */
export function createPondManager(displays: PrefabDisplayGroup, animationBaseUrl: string, world: PondWorld) {
  return new PrefabEntityManager<typeof POND_ID, PondInstance>(displays, animationBaseUrl, world, {
    [POND_ID]: {
      fn: () => new PondInstance(world),
      assets: { animationArchive: 'marsh_tile.zip', buildArchives: ['marsh_tile.zip'], bank: 'marsh_tile' },
      physics: { make: MakePondPhysics, radius: 1.95 },
      minimapIcon: 'pond.png',
      onSpawned: pond => pond.OnInit(),
    },
  });
}

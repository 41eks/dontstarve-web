import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { SpriteState } from '@dontstarve-web/display';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ComponentTimer } from '../../componets/src/timer';
import { NightmareRockStateGraph, type NightmareRockSound, type NightmareRockStateInst } from '../../stategraphs/src/SGnightmarerock';
import { PlaySound } from './sound';
import { MakeObstaclePhysics, WORLD_SCALE } from './standardcomponents';
import type { WorldFxPrefab } from './world_fx';
import { COLLISION } from '../../componets/src/physicsState';

export const NIGHTMAREROCK_IDS = ['sanityrock', 'insanityrock'] as const;
export type NightmareRockId = typeof NIGHTMAREROCK_IDS[number];

/** What nightmarerock.lua reads from AllPlayers. */
export interface NightmareRockPlayer {
  readonly position: ReadonlyVector3;
  readonly sanity: { IsSane(): boolean; IsInsane(): boolean };
}

export interface NightmareRockWorld {
  scheduler: GameTimeScheduler;
  /** AllPlayers. */
  getPlayers(): readonly NightmareRockPlayer[];
  fx: { spawn(prefab: WorldFxPrefab, position: ReadonlyVector3): void };
}

// nightmarerock.lua constants, DST units converted to scene units.
const COLLISION_SIZE = 1;
const NEAR_DIST_SQ = (10 * WORLD_SCALE) ** 2;
const FAR_DIST_SQ = (11 * WORLD_SCALE) ** 2;
const UPDATE_INTERVAL = .2;
const FRAMES = 1 / 30;
/** Used to stagger periodic updates across entities: a file-level local of nightmarerock.lua, advanced by each AddRefreshTask. */
let UPDATE_OFFSET = 0;

export function isNightmareRockId(value: string): value is NightmareRockId {
  return (NIGHTMAREROCK_IDS as readonly string[]).includes(value);
}

/** nightmarerock.lua: rises while a player of the matching sanity is near, lowers when none is. */
export class NightmareRockInstance extends PrefabInstance implements NightmareRockStateInst {
  active = false;
  active_queue = false;
  conceal = false;
  conceal_queued = false;
  declare readonly sg: NightmareRockStateGraph['sg'];
  readonly activeonsane: boolean;
  private refreshTimer?: ComponentTimer;
  private cancelTransition?: () => void;
  private readonly world: NightmareRockWorld;

  /** commonfn; MakeObstaclePhysics and updatephysics come from the prefab's `physics`. */
  constructor(world: NightmareRockWorld, id: NightmareRockId) {
    super(id, new SpriteState({ name: 'idle_inactive', billboard: true }));
    this.world = world;
    this.activeonsane = id === 'sanityrock';
    for (const tag of ['antlion_sinkhole_blocker', id]) this.addTag(tag);
    this.sg = new NightmareRockStateGraph(this, world.scheduler).sg;
    this.AddRefreshTask();
    this.onRemove(() => {
      this.cancelTransition?.();
      this.refreshTimer?.stop();
      this.sg.dispose();
    });
  }

  // --- NightmareRockStateInst ---------------------------------------------------------------------

  playAnimation(name: string): void {
    this.sprite.playOnce(name, () => this.sg?.pushEvent('animover'));
  }
  playSound(path: NightmareRockSound): void { PlaySound(path, this.position); }
  spawnFx(prefab: 'sanity_raise' | 'sanity_lower'): void { this.world.fx.spawn(prefab, this.position); }
  Hide(): void { this.sprite.setVisible(false); }
  Show(): void { this.sprite.setVisible(true); }

  OnActiveStateChanged(): void {
    this.active = this.active_queue;
    this.updatePhysics();
  }

  OnConcealStateChanged(): void {
    this.conceal = this.conceal_queued;
    this.OnActiveStateChanged();
  }

  /** AddRefreshTask: DoPeriodicTask(UPDATE_INTERVAL, refresh, UPDATE_OFFSET), then stagger the next spawned entity. */
  private AddRefreshTask(): void {
    if (this.refreshTimer) return;
    const timer = this.refreshTimer = new ComponentTimer(this.world.scheduler, () => { this.refresh(); timer.start(UPDATE_INTERVAL); });
    timer.start(UPDATE_OFFSET);
    UPDATE_OFFSET += FRAMES;
    if (UPDATE_OFFSET > UPDATE_INTERVAL) UPDATE_OFFSET = 0;
  }

  /** nightmarerock.lua updatephysics: characters collide only with a raised, revealed rock. */
  updatePhysics(): void {
    this.physics.SetCollisionGroup(COLLISION.OBSTACLES);
    let mask: number = COLLISION.WORLD;
    if (!this.conceal) {
      mask |= COLLISION.ITEMS;
      if (this.active) mask |= COLLISION.CHARACTERS;
    }
    this.physics.SetCollisionMask(mask);
  }

  /** ConcealForMinigame(inst, conceal) */
  ConcealForMinigame(conceal: boolean): void {
    this.conceal_queued = conceal;
    this.active_queue = false;
  }

  // --- refresh -------------------------------------------------------------------------------------

  private matchesPlayer(player: NightmareRockPlayer): boolean {
    return (player.sanity.IsSane() && this.activeonsane) || (player.sanity.IsInsane() && !this.activeonsane);
  }

  private refresh(): void {
    if (this.isRemoved) return;
    if (this.conceal || this.conceal_queued) {
      // nothing to do here
    } else {
      // A raised rock lets go only beyond FAR_DIST, a lowered one rises within NEAR_DIST.
      const limit = this.active ? FAR_DIST_SQ : NEAR_DIST_SQ;
      this.active_queue = this.world.getPlayers().some(player => this.matchesPlayer(player)
        && player.position.distanceToSquared(this.position) < limit);
    }
    if ((this.conceal !== this.conceal_queued || this.active_queue !== this.active) && !this.cancelTransition) {
      this.cancelTransition = this.world.scheduler.schedule(Math.random(), () => { this.cancelTransition = undefined; this.doTransition(); });
    }
  }

  private doTransition(): void {
    if (this.isRemoved) return;
    if (this.conceal !== this.conceal_queued) {
      if (!this.sg.hasStateTag('busy')) {
        if (this.conceal_queued) this.sg.goToState('conceal', this.active);
        else this.sg.goToState('reveal');
      }
    } else if (this.active !== this.active_queue && !this.conceal_queued) {
      this.sg.goToState(this.active_queue ? 'raise' : 'lower');
    }
  }

}

/** nightmarerock.lua sanityrock / insanityrock: obelisks that rise and lower with the nearby player's sanity. */
export function nightmareRockPrefabs(world: NightmareRockWorld): Readonly<Record<NightmareRockId, PrefabEntityDefinition<NightmareRockInstance>>> {
  const prefab = (id: NightmareRockId): PrefabEntityDefinition<NightmareRockInstance> => ({
    fn: () => new NightmareRockInstance(world, id),
    assets: { animationArchive: 'blocker_sanity.zip', buildArchives: ['blocker_sanity.zip'], bank: 'blocker_sanity' },
    // MakeObstaclePhysics(inst, COLLISION_SIZE), then updatephysics for the lowered rock.
    physics: { make: (inst, radius) => { MakeObstaclePhysics(inst, radius); inst.updatePhysics(); }, radius: COLLISION_SIZE },
    minimapIcon: 'obelisk.png',
  });
  return { sanityrock: prefab('sanityrock'), insanityrock: prefab('insanityrock') };
}

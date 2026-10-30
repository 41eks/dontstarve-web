import { PrefabDisplayGroup } from '@dontstarve-web/display';
import type * as CANNON from 'cannon-es';
import * as THREE from 'three';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { SpriteResources, SpriteState } from '@dontstarve-web/display';
import { bindInstance, PrefabInstance } from './prefabInstance';
import { watchTileActivity } from './tileActivity';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ComponentTimer } from '../../componets/src/timer';
import { NightmareRockStateGraph, type NightmareRockSound, type NightmareRockStateInst } from '../../stategraphs/src/SGnightmarerock';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { PlaySound } from './sound';
import { MakeObstaclePhysics, WORLD_SCALE } from './standardcomponents';
import type { WorldFxPrefab } from './world_fx';
import { COLLISION } from '../../componets/src/physicsState';

export const NIGHTMAREROCK_IDS = ['sanityrock', 'insanityrock'] as const;
export type NightmareRockId = typeof NIGHTMAREROCK_IDS[number];

export interface NightmareRockRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: Record<string, never>;
}

/** What nightmarerock.lua reads from AllPlayers. */
export interface NightmareRockPlayer {
  readonly position: THREE.Vector3;
  readonly sanity: { IsSane(): boolean; IsInsane(): boolean };
}

export interface NightmareRockWorld {
  tickingarea?: TileStateQuery;
  scheduler?: GameTimeScheduler;
  physics: CANNON.World;
  getPlayers(): readonly NightmareRockPlayer[];
  fx: { spawn(prefab: WorldFxPrefab, position: THREE.Vector3): void };
}

// nightmarerock.lua constants, DST units converted to scene units.
const COLLISION_SIZE = 1;
const NEAR_DIST_SQ = (10 * WORLD_SCALE) ** 2;
const FAR_DIST_SQ = (11 * WORLD_SCALE) ** 2;
const UPDATE_INTERVAL = .2;
const FRAMES = 1 / 30;

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
  private readonly refreshTimer?: ComponentTimer;
  private cancelTransition?: () => void;
  private readonly world: NightmareRockWorld;

  constructor(world: NightmareRockWorld, id: NightmareRockId, staggerOffset: number) {
    super(id, new SpriteState({ name: 'idle_inactive', billboard: true }));
    this.world = world;
    this.activeonsane = id === 'sanityrock';
    for (const tag of ['antlion_sinkhole_blocker', id]) this.addTag(tag);
    MakeObstaclePhysics(this, COLLISION_SIZE);
    this.updatePhysics();
    this.sg = new NightmareRockStateGraph(this, world.scheduler).sg;
    if (world.scheduler) {
      // DoPeriodicTask(UPDATE_INTERVAL, refresh, UPDATE_OFFSET)
      this.refreshTimer = new ComponentTimer(world.scheduler, () => { this.refresh(); this.refreshTimer!.start(UPDATE_INTERVAL); });
      this.refreshTimer.start(staggerOffset);
    }
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

  /** nightmarerock.lua updatephysics: characters collide only with a raised, revealed rock. */
  private updatePhysics(): void {
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
      const scheduler = this.world.scheduler;
      if (scheduler) {
        const cancel = scheduler.schedule(Math.random(), () => { this.cancelTransition = undefined; this.doTransition(); });
        this.cancelTransition = cancel;
      }
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
export class NightmareRockManager {
  private readonly resources: SpriteResources;
  private readonly rocks = new Map<THREE.Group, NightmareRockInstance>();
  private readonly displays: PrefabDisplayGroup;
  private readonly world: NightmareRockWorld;
  private staggerOffset = 0;
  private disposed = false;

  constructor(scene: THREE.Scene, assetBaseUrl: string, world: NightmareRockWorld) {
    this.displays = new PrefabDisplayGroup(scene); this.resources = new SpriteResources(assetBaseUrl); this.world = world;
  }

  spawn(id: NightmareRockId, position: THREE.Vector3, saved?: NightmareRockRecord): THREE.Group {
    if (this.disposed) throw new Error('Nightmare rocks have been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid nightmare rock position');
    const instance = new NightmareRockInstance(this.world, id, this.staggerOffset);
    const display = this.displays.add({ name: id, source: this.resources.factory({ animationArchive: 'blocker_sanity.zip', buildArchive: 'blocker_sanity.zip' }),
      status: instance.status, sprite: instance.sprite, light: instance.light });
    const model = display.model;
    bindInstance(model, instance);
    instance.position.set(position.x, 0, position.z);
    instance.entityId = saved?.id ?? newEntityId();
    instance.saveRecord = saved;
    instance.bindPhysics(this.world.physics);
    actionEntity(model, id, instance);
    // UPDATE_OFFSET staggers the periodic refresh of each spawned entity by one frame.
    this.staggerOffset += FRAMES;
    if (this.staggerOffset > UPDATE_INTERVAL) this.staggerOffset = 0;
    this.rocks.set(model, instance);
    instance.onRemove(() => { this.rocks.delete(model); display.dispose(); });
    instance.onRemove(watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active)));
    return model;
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    for (const instance of this.rocks.values()) instance.sg.update(dt);
    this.displays.update(dt, cameraQuaternion);
  }

  get renderEntities() {
    return this.displays.renderEntities.filter(({ object }) => this.rocks.get(object)?.sprite.loaded);
  }

  /** The rocks' state is derived from the nearby player on load, so only identity and position are saved. */
  exportRecords(): { prefabId: NightmareRockId; record: NightmareRockRecord }[] {
    return [...this.rocks.values()].filter(instance => instance.persists).map(instance => ({ prefabId: instance.prefab as NightmareRockId, record: {
      id: String(instance.entityId),
      transform: { position: [instance.position.x, 0, instance.position.z], rotationY: 0 },
      components: {},
    } }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const instance of [...this.rocks.values()]) instance.remove();
    this.rocks.clear();
    this.displays.dispose();
    this.resources.dispose();
  }
}

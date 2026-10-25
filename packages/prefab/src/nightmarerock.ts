import type * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory } from '@dontstarve-web/animation/sprite';
import type { TileStateQuery } from '@dontstarve-web/signals';
import type { PrefabDisplay, SpriteState } from '@dontstarve-web/display';
import { createPrefabEntity, type PrefabInstance } from './prefabInstance';
import { watchTileActivity } from './tileActivity';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ComponentTimer } from '../../componets/src/timer';
import { NightmareRockStateGraph, type NightmareRockSound, type NightmareRockStateInst } from '../../stategraphs/src/SGnightmarerock';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { PlaySound, PreloadSounds } from './sound';
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
  fx: { prepare(prefab: WorldFxPrefab): Promise<void>; spawn(prefab: WorldFxPrefab, position: THREE.Vector3): void };
}

// nightmarerock.lua constants, DST units converted to scene units.
const COLLISION_SIZE = 1;
const NEAR_DIST_SQ = (10 * WORLD_SCALE) ** 2;
const FAR_DIST_SQ = (11 * WORLD_SCALE) ** 2;
const UPDATE_INTERVAL = .2;
const FRAMES = 1 / 30;
const SOUNDS: readonly NightmareRockSound[] = ['dontstarve/sanity/shadowrock_up', 'dontstarve/sanity/shadowrock_down',
  'dontstarve/sanity/shadowrock_conseal', 'dontstarve/sanity/shadowrock_reveal'];

export function isNightmareRockId(value: string): value is NightmareRockId {
  return (NIGHTMAREROCK_IDS as readonly string[]).includes(value);
}

/** nightmarerock.lua: rises while a player of the matching sanity is near, lowers when none is. */
class NightmareRock implements NightmareRockStateInst {
  active = false;
  active_queue = false;
  conceal = false;
  conceal_queued = false;
  readonly model: THREE.Group;
  readonly sg: NightmareRockStateGraph;
  readonly activeonsane: boolean;
  readonly instance: PrefabInstance;
  readonly display: PrefabDisplay;
  private readonly controller: SpriteState;
  private stopActivity?: () => void;
  private readonly refreshTimer?: ComponentTimer;
  private cancelTransition?: () => void;
  private disposed = false;
  private readonly world: NightmareRockWorld;

  constructor(world: NightmareRockWorld, id: NightmareRockId, { instance, display }: ReturnType<typeof createPrefabEntity>, staggerOffset: number) {
    this.world = world; this.model = display.model;
    this.instance = instance; this.display = display;
    const model = this.model;
    this.controller = instance.sprite;
    this.activeonsane = id === 'sanityrock';
    const entity = actionEntity(model, id);
    for (const tag of ['antlion_sinkhole_blocker', id]) entity.addTag(tag);
    MakeObstaclePhysics(instance, COLLISION_SIZE);
    this.updatePhysics();
    instance.bindPhysics(world.physics);
    this.sg = new NightmareRockStateGraph(this, world.scheduler);
    if (world.scheduler) {
      // DoPeriodicTask(UPDATE_INTERVAL, refresh, UPDATE_OFFSET)
      this.refreshTimer = new ComponentTimer(world.scheduler, () => { this.refresh(); this.refreshTimer!.start(UPDATE_INTERVAL); });
      this.refreshTimer.start(staggerOffset);
    }
    this.stopActivity = watchTileActivity(model, world.tickingarea, active => instance.setActive(active));
  }

  // --- NightmareRockStateInst ---------------------------------------------------------------------

  playAnimation(name: string): void {
    this.controller.playOnce(name, () => this.sg.pushEvent('animover'));
  }
  playSound(path: NightmareRockSound): void { PlaySound(path, this.model.position); }
  spawnFx(prefab: 'sanity_raise' | 'sanity_lower'): void { this.world.fx.spawn(prefab, this.model.position); }
  Hide(): void { this.controller.setVisible(false); }
  Show(): void { this.controller.setVisible(true); }

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
    this.instance.physics.SetCollisionGroup(COLLISION.OBSTACLES);
    let mask: number = COLLISION.WORLD;
    if (!this.conceal) {
      mask |= COLLISION.ITEMS;
      if (this.active) mask |= COLLISION.CHARACTERS;
    }
    this.instance.physics.SetCollisionMask(mask);
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
    if (this.disposed) return;
    if (this.conceal || this.conceal_queued) {
      // nothing to do here
    } else {
      // A raised rock lets go only beyond FAR_DIST, a lowered one rises within NEAR_DIST.
      const limit = this.active ? FAR_DIST_SQ : NEAR_DIST_SQ;
      this.active_queue = this.world.getPlayers().some(player => this.matchesPlayer(player)
        && player.position.distanceToSquared(this.model.position) < limit);
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
    if (this.disposed) return;
    if (this.conceal !== this.conceal_queued) {
      if (!this.sg.hasStateTag('busy')) {
        if (this.conceal_queued) this.sg.goToState('conceal', this.active);
        else this.sg.goToState('reveal');
      }
    } else if (this.active !== this.active_queue && !this.conceal_queued) {
      this.sg.goToState(this.active_queue ? 'raise' : 'lower');
    }
  }

  update(dt: number): void {
    if (this.controller.loaded) this.controller.update(dt);
    this.sg.update(dt);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopActivity?.();
    this.cancelTransition?.();
    this.refreshTimer?.stop();
    this.sg.dispose();
    this.model.userData.removed = true;
    this.instance.remove();
  }
}

/** nightmarerock.lua sanityrock / insanityrock: obelisks that rise and lower with the nearby player's sanity. */
export class NightmareRockManager {
  private factoryRequest?: Promise<AnimatedSpriteFactory>;
  private readonly rocks = new Map<THREE.Group, { id: NightmareRockId; rock: NightmareRock }>();
  private readonly scene: THREE.Scene;
  private readonly assetBaseUrl: string;
  private readonly world: NightmareRockWorld;
  private staggerOffset = 0;
  private disposed = false;

  constructor(scene: THREE.Scene, assetBaseUrl: string, world: NightmareRockWorld) {
    this.scene = scene; this.assetBaseUrl = assetBaseUrl; this.world = world;
  }

  async spawn(id: NightmareRockId, position: THREE.Vector3, saved?: NightmareRockRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Nightmare rocks have been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid nightmare rock position');
    if (!this.factoryRequest) {
      this.factoryRequest = createAnimatedSpriteFactory(this.assetBaseUrl, 'blocker_sanity.zip');
      void this.factoryRequest.catch(() => { this.factoryRequest = undefined; });
    }
    const [factory] = await Promise.all([this.factoryRequest, PreloadSounds(...SOUNDS),
      this.world.fx.prepare('sanity_raise'), this.world.fx.prepare('sanity_lower')]);
    if (this.disposed) throw new Error('Nightmare rocks have been disposed');
    const entity = createPrefabEntity(id, { create: (animation, frame) => factory.create({ initialAnimation: animation, initialFrame: frame, name: id }),
      release: drawn => factory.disposeSprite(drawn) }, { name: 'idle_inactive', billboard: true }, id);
    const model = entity.display.model;
    model.position.set(position.x, 0, position.z);
    entity.instance.entityId = saved?.id ?? newEntityId();
    // UPDATE_OFFSET staggers the periodic refresh of each spawned entity by one frame.
    const rock = new NightmareRock(this.world, id, entity, this.staggerOffset);
    this.staggerOffset += FRAMES;
    if (this.staggerOffset > UPDATE_INTERVAL) this.staggerOffset = 0;
    model.userData.nightmareRock = rock;
    this.rocks.set(model, { id, rock });
    this.scene.add(model);
    return model;
  }

  update(dt: number, _cameraQuaternion: THREE.Quaternion): void {
    for (const { rock } of this.rocks.values()) rock.update(dt);
  }

  get renderEntities() {
    return [...this.rocks].filter(([, { rock }]) => rock.instance.sprite.loaded).map(([model]) => ({ object: model, footPosition: model.position, cameraDepth: 0 }));
  }

  /** The rocks' state is derived from the nearby player on load, so only identity and position are saved. */
  exportRecords(): { prefabId: NightmareRockId; record: NightmareRockRecord }[] {
    return [...this.rocks].map(([model, { id, rock }]) => ({ prefabId: id, record: {
      id: String(rock.instance.entityId),
      transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
      components: {},
    } }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { rock } of this.rocks.values()) { rock.dispose(); }
    this.rocks.clear();
    void this.factoryRequest?.then(factory => factory.dispose(), () => undefined);
  }
}

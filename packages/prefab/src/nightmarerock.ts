import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { SpriteState } from '@dontstarve-web/display';
import { AnimState } from '../../componets/src/animstate';
import { animationLengths } from './animationTimings';
import { PrefabInstance, type EntityTask, type PrefabEntityDefinition } from './prefabInstance';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { NightmareRockStateGraph, type NightmareRockStateInst } from '../../stategraphs/src/SGnightmarerock';
import type { SoundEmitter } from './soundEmitter';
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
  /** SpawnPrefab(prefab) placed at `position`, for the sanity_raise / sanity_lower fx. */
  spawnPrefab(prefab: WorldFxPrefab, position: ReadonlyVector3): PrefabInstance;
}

/** blocker_sanity's clips, from the source anim.bin. */
const ANIMATION_LENGTHS = animationLengths('blocker_sanity.zip');

// nightmarerock.lua constants, DST units converted to scene units.
const COLLISION_SIZE = 1;
const NEAR_DIST_SQ = (10 * WORLD_SCALE) ** 2;
const FAR_DIST_SQ = (11 * WORLD_SCALE) ** 2;
const UPDATE_INTERVAL = .2;
const FRAMES = 1 / 30;
/** Used to stagger periodic updates across entities: a file-level local of nightmarerock.lua, advanced by each AddRefreshTask. */
let UPDATE_OFFSET = 0;

export function isNightmareRockId(value: string): value is NightmareRockId {
  return NIGHTMAREROCK_IDS.some(known => known === value);
}

/**
 * nightmarerock.lua's fields on the inst: rises while a player of the matching sanity is near, lowers when none is. The
 * callbacks are this module's functions, registered by `commonfn`; the AnimState calls SGnightmarerock makes are the
 * stategraph's adapter below.
 */
export class NightmareRockInstance extends PrefabInstance implements NightmareRockStateInst {
  active = false;
  active_queue = false;
  conceal = false;
  conceal_queued = false;
  activeonsane = false;
  transition_task?: EntityTask;
  _refreshtask?: EntityTask;
  declare sg: NightmareRockStateGraph['sg'];
  /** inst.AnimState's playback: clips end after their source length in game time, whether or not their art is drawn. */
  animstate!: AnimState;
  /** TheWorld and AllPlayers, as this rock's callbacks reach them. */
  world!: NightmareRockWorld;
  OnActiveStateChanged!: (inst: NightmareRockInstance) => void;
  OnConcealStateChanged!: (inst: NightmareRockInstance) => void;
  ConcealForMinigame!: (inst: NightmareRockInstance, conceal: boolean) => void;

  /** SGnightmarerock's AnimState:PlayAnimation: the logical clip's end is the stategraph's animover. */
  playAnimation(name: string): void {
    this.animstate.PlayAnimation(name);
    this.sprite.playOnce(name);
  }
  declare SoundEmitter: SoundEmitter;
}

/** updatephysics: characters collide only with a raised, revealed rock. */
function updatephysics(inst: NightmareRockInstance): void {
  inst.physics.SetCollisionGroup(COLLISION.OBSTACLES);
  let mask: number = COLLISION.WORLD;
  if (!inst.conceal) {
    mask |= COLLISION.ITEMS;
    if (inst.active) { mask |= COLLISION.CHARACTERS; }
  }
  inst.physics.SetCollisionMask(mask);
}

/** The pathfinding walls (_ispathfinding) are not ported. */
function OnActiveStateChanged(inst: NightmareRockInstance): void {
  inst.active = inst.active_queue;
  updatephysics(inst);
}

/** LaunchAndClearArea on reveal is not ported. */
function OnConcealStateChanged(inst: NightmareRockInstance): void {
  inst.conceal = inst.conceal_queued;
  OnActiveStateChanged(inst);
}

function dotransition(inst: NightmareRockInstance): void {
  inst.transition_task = undefined;
  if (inst.conceal !== inst.conceal_queued) {
    if (!inst.sg.hasStateTag('busy')) {
      if (inst.conceal_queued) { inst.sg.goToState('conceal', inst.active); }
      else { inst.sg.goToState('reveal'); }
    }
  } else if (inst.active !== inst.active_queue && !inst.conceal_queued) {
    inst.sg.goToState(inst.active_queue ? 'raise' : 'lower');
  }
}

function matchessanity(inst: NightmareRockInstance, player: NightmareRockPlayer): boolean {
  return (player.sanity.IsSane() && inst.activeonsane) || (player.sanity.IsInsane() && !inst.activeonsane);
}

function refresh(inst: NightmareRockInstance): void {
  if (inst.conceal || inst.conceal_queued) {
    // nothing to do here
  } else {
    // A raised rock lets go only beyond FAR_DIST, a lowered one rises within NEAR_DIST.
    const limit = inst.active ? FAR_DIST_SQ : NEAR_DIST_SQ;
    inst.active_queue = inst.world.getPlayers().some(player => matchessanity(inst, player)
      && player.position.distanceToSquared(inst.position) < limit);
  }
  if ((inst.conceal !== inst.conceal_queued || inst.active_queue !== inst.active) && inst.transition_task === undefined) {
    inst.transition_task = inst.DoTaskInTime(Math.random(), dotransition);
  }
}

/** DoPeriodicTask(UPDATE_INTERVAL, refresh, UPDATE_OFFSET), then stagger the next spawned entity. */
function AddRefreshTask(inst: NightmareRockInstance): void {
  if (inst._refreshtask) { return; }
  inst._refreshtask = inst.DoPeriodicTask(UPDATE_INTERVAL, refresh, UPDATE_OFFSET);
  UPDATE_OFFSET += FRAMES;
  if (UPDATE_OFFSET > UPDATE_INTERVAL) { UPDATE_OFFSET = 0; }
}

function ConcealForMinigame(inst: NightmareRockInstance, conceal: boolean): void {
  inst.conceal_queued = conceal;
  inst.active_queue = false;
}

/** commonfn(tags); MakeObstaclePhysics and updatephysics come from the prefab's `physics`. */
function commonfn(world: NightmareRockWorld, id: NightmareRockId): NightmareRockInstance {
  const inst = new NightmareRockInstance(id, new SpriteState({ name: 'idle_inactive', billboard: true }));
  inst.AddSoundEmitter();
  inst.world = world;
  inst.BindScheduler(world.scheduler);
  inst.animstate = new AnimState(world.scheduler, ANIMATION_LENGTHS, event => inst.sg?.pushEvent(event));
  inst.onRemove(() => inst.animstate.dispose());
  inst.addTag('antlion_sinkhole_blocker');
  inst.addTag(id);
  inst.activeonsane = id === 'sanityrock';
  inst.SetStateGraph(inst => new NightmareRockStateGraph(inst, world.scheduler).sg);
  AddRefreshTask(inst);
  inst.OnActiveStateChanged = OnActiveStateChanged;
  inst.OnConcealStateChanged = OnConcealStateChanged;
  inst.ConcealForMinigame = ConcealForMinigame;
  return inst;
}

/** nightmarerock.lua sanityrock / insanityrock: obelisks that rise and lower with the nearby player's sanity. */
export function nightmareRockPrefabs(world: NightmareRockWorld): Readonly<Record<NightmareRockId, PrefabEntityDefinition<NightmareRockInstance>>> {
  const prefab = (id: NightmareRockId): PrefabEntityDefinition<NightmareRockInstance> => ({
    fn: () => commonfn(world, id),
    assets: { animationArchive: 'blocker_sanity.zip', buildArchives: ['blocker_sanity.zip'], bank: 'blocker_sanity' },
    // MakeObstaclePhysics(inst, COLLISION_SIZE), then updatephysics for the lowered rock.
    physics: { make: (inst, radius) => { MakeObstaclePhysics(inst, radius); updatephysics(inst); }, radius: COLLISION_SIZE },
    minimapIcon: 'obelisk.png',
  });
  return { sanityrock: prefab('sanityrock'), insanityrock: prefab('insanityrock') };
}

import { definePrefabIds } from './prefabRegistration';
import { Vector3 } from 'three';
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
import { Inspectable } from '../../componets/src/inspectable';
import { addComponent } from './components';
import type { Pathfinder } from './pathfinder';

export const NIGHTMAREROCK_IDS = ['sanityrock', 'insanityrock'] as const;
export type NightmareRockId = (typeof NIGHTMAREROCK_IDS)[number];

/** What nightmarerock.lua reads from AllPlayers. */
export interface NightmareRockPlayer {
  readonly position: ReadonlyVector3;
  hasTag(tag: string): boolean;
  readonly components: { readonly sanity?: { IsSane(): boolean; IsInsane(): boolean } };
}

export interface NightmareRockWorld {
  scheduler: GameTimeScheduler;
  /** AllPlayers. */
  getPlayers(): readonly NightmareRockPlayer[];
  /** SpawnPrefab(prefab) placed at `position`, for the sanity_raise / sanity_lower fx. */
  spawnPrefab(prefab: WorldFxPrefab, position: ReadonlyVector3): PrefabInstance;
  /** TheWorld.Pathfinder. */
  pathfinder?: Pick<Pathfinder, 'AddWall' | 'RemoveWall'>;
}

/** blocker_sanity's clips, from the source anim.bin. */
const ANIMATION_LENGTHS = animationLengths('blocker_sanity.zip');

// nightmarerock.lua constants, DST units converted to scene units.
const COLLISION_SIZE = 1;
const NEAR_DIST_SQ = (10 * WORLD_SCALE) ** 2;
const FAR_DIST_SQ = (11 * WORLD_SCALE) ** 2;
const UPDATE_INTERVAL = 0.2;
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
  /** inst._ispathfinding: a raised, revealed rock walls off the pathfinder. */
  _ispathfinding = false;
  /** inst._pftable: the walls OnIsPathFindingDirty registered. */
  _pftable?: ReadonlyVector3[];
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
    if (inst.active) {
      mask |= COLLISION.CHARACTERS;
    }
  }
  inst.physics.SetCollisionMask(mask);
}

/** Rounds a scene coordinate to 0.01 DST units, as OnIsPathFindingDirty does. */
const roundToHundredth = (value: number) => (Math.floor((value / WORLD_SCALE) * 100 + 0.5) / 100) * WORLD_SCALE;

/**
 * OnIsPathFindingDirty: walls on the (2 * COLLISION_SIZE + 1)² grid of DST units around the rock. Lua's PF_SHARED keeps
 * a point walled while any rock still claims it, because the engine's walls are not counted; Pathfinder counts AddWall
 * per path tile, so each rock adds and removes its own. GetCurrentPlatform is always nil because boats are not ported.
 */
function OnIsPathFindingDirty(inst: NightmareRockInstance): void {
  const pathfinder = inst.world.pathfinder;
  if (inst._ispathfinding) {
    if (inst._pftable === undefined) {
      const x = roundToHundredth(inst.position.x),
        z = roundToHundredth(inst.position.z);
      inst._pftable = [];
      for (let dx = -COLLISION_SIZE; dx <= COLLISION_SIZE; dx++) {
        for (let dz = -COLLISION_SIZE; dz <= COLLISION_SIZE; dz++) {
          const wall = new Vector3(x + dx * WORLD_SCALE, 0, z + dz * WORLD_SCALE);
          pathfinder?.AddWall(wall);
          inst._pftable.push(wall);
        }
      }
    }
  } else if (inst._pftable !== undefined) {
    for (const wall of inst._pftable) {
      pathfinder?.RemoveWall(wall);
    }
    inst._pftable = undefined;
  }
}

/** inst._ispathfinding:set(value): its dirty event runs OnIsPathFindingDirty on the master. */
function setIsPathfinding(inst: NightmareRockInstance, value: boolean): void {
  if (inst._ispathfinding !== value) {
    inst._ispathfinding = value;
    OnIsPathFindingDirty(inst);
  }
}

function OnActiveStateChanged(inst: NightmareRockInstance): void {
  inst.active = inst.active_queue;
  setIsPathfinding(inst, inst.active_queue && !inst.conceal);
  updatephysics(inst);
}

/** LaunchAndClearArea on reveal is not ported: only pigking.lua's minigame, itself not ported, conceals the rocks. */
function OnConcealStateChanged(inst: NightmareRockInstance): void {
  inst.conceal = inst.conceal_queued;
  OnActiveStateChanged(inst);
}

function dotransition(inst: NightmareRockInstance): void {
  inst.transition_task = undefined;
  if (inst.conceal !== inst.conceal_queued) {
    if (!inst.sg.hasStateTag('busy')) {
      if (inst.conceal_queued) {
        inst.sg.goToState('conceal', inst.active);
      } else {
        inst.sg.goToState('reveal');
      }
    }
  } else if (inst.active !== inst.active_queue && !inst.conceal_queued) {
    inst.sg.goToState(inst.active_queue ? 'raise' : 'lower');
  }
}

function matchessanity(inst: NightmareRockInstance, player: NightmareRockPlayer): boolean {
  const sanity = player.components.sanity;
  return (
    !player.hasTag('notarget') &&
    sanity !== undefined &&
    ((sanity.IsSane() && inst.activeonsane) || (sanity.IsInsane() && !inst.activeonsane))
  );
}

function refresh(inst: NightmareRockInstance): void {
  if (inst.conceal || inst.conceal_queued) {
    // nothing to do here
  } else {
    // A raised rock lets go only beyond FAR_DIST, a lowered one rises within NEAR_DIST.
    const limit = inst.active ? FAR_DIST_SQ : NEAR_DIST_SQ;
    inst.active_queue = inst.world
      .getPlayers()
      .some(player => matchessanity(inst, player) && player.position.distanceToSquared(inst.position) < limit);
  }
  if (
    (inst.conceal !== inst.conceal_queued || inst.active_queue !== inst.active) &&
    inst.transition_task === undefined
  ) {
    inst.transition_task = inst.DoTaskInTime(Math.random(), dotransition);
  }
}

/** DoPeriodicTask(UPDATE_INTERVAL, refresh, UPDATE_OFFSET), then stagger the next spawned entity. */
function AddRefreshTask(inst: NightmareRockInstance): void {
  if (inst._refreshtask) {
    return;
  }
  inst._refreshtask = inst.DoPeriodicTask(UPDATE_INTERVAL, refresh, UPDATE_OFFSET);
  UPDATE_OFFSET += FRAMES;
  if (UPDATE_OFFSET > UPDATE_INTERVAL) {
    UPDATE_OFFSET = 0;
  }
}

function ConcealForMinigame(inst: NightmareRockInstance, conceal: boolean): void {
  inst.conceal_queued = conceal;
  inst.active_queue = false;
}

function getstatus(inst: NightmareRockInstance): string {
  return inst.active ? 'ACTIVE' : 'INACTIVE';
}

/** onremove, its inst.OnRemoveEntity: _ispathfinding:set_local(false), then OnIsPathFindingDirty. */
function onremove(inst: NightmareRockInstance): void {
  inst._ispathfinding = false;
  OnIsPathFindingDirty(inst);
}

/**
 * commonfn(tags). MakeRoseTarget_CreateFuel is not ported: roseinspectable waits for Winona's roseglasses.
 * MakeObstaclePhysics and updatephysics come from the prefab's `physics`. */
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
  // InitializePathFinding(inst, TheWorld.ismastersim) is ready on the master, so it applies the lowered rock's state now.
  OnIsPathFindingDirty(inst);
  inst.onRemove(() => onremove(inst));
  addComponent(inst, 'inspectable', Inspectable).getstatus = () => getstatus(inst);
  inst.SetStateGraph(inst => new NightmareRockStateGraph(inst, world.scheduler).sg);
  AddRefreshTask(inst);
  inst.OnActiveStateChanged = OnActiveStateChanged;
  inst.OnConcealStateChanged = OnConcealStateChanged;
  inst.ConcealForMinigame = ConcealForMinigame;
  return inst;
}

/** nightmarerock.lua sanityrock / insanityrock: obelisks that rise and lower with the nearby player's sanity. */
export function nightmareRockPrefabs(
  world: NightmareRockWorld,
): Readonly<Record<NightmareRockId, PrefabEntityDefinition<NightmareRockInstance>>> {
  const prefab = (id: NightmareRockId): PrefabEntityDefinition<NightmareRockInstance> => ({
    fn: () => commonfn(world, id),
    assets: { animationArchive: 'blocker_sanity.zip', buildArchives: ['blocker_sanity.zip'], bank: 'blocker_sanity' },
    // MakeObstaclePhysics(inst, COLLISION_SIZE), then updatephysics for the lowered rock.
    physics: {
      make: (inst, radius) => {
        MakeObstaclePhysics(inst, radius);
        updatephysics(inst);
      },
      radius: COLLISION_SIZE,
    },
    minimapIcon: 'obelisk.png',
  });
  return { sanityrock: prefab('sanityrock'), insanityrock: prefab('insanityrock') };
}

export const nightmareRockRegistration = {
  create: nightmareRockPrefabs,
  families: { nightmareRocks: definePrefabIds(NIGHTMAREROCK_IDS, true) },
};

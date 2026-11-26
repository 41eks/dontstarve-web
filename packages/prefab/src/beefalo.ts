import { definePrefabIds } from './prefabRegistration';
import { addComponent } from './components';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import * as CANNON from 'cannon-es';
import { getRegisteredPhysicsBodies } from '../../componets/src/physicsWorld';
import * as THREE from 'three';
import { SpriteState } from '@dontstarve-web/display';
import {
  createRenderEffect,
  untrack,
  type ReadonlySignal,
  type WorldContentContext,
  type WorldPhase,
} from '@dontstarve-web/signals';
import { AnimState } from '../../componets/src/animstate';
import { Beard, type BeardSave } from '../../componets/src/beard';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { ComponentUpdates } from '../../componets/src/componentUpdates';
import { Sleeper } from '../../componets/src/sleeper';
import { Health } from '../../componets/src/health';
import { TOTAL_DAY_TIME } from '../../componets/src/perishable';
import type { LocoMotorPathfinder } from '../../componets/src/locomotor';
import { LocoMotor } from '../../componets/src/locomotor';
import { KnownLocations } from '../../componets/src/knownlocations';
import { PeriodicSpawner } from '../../componets/src/periodicspawner';
import { BeefaloBrain } from '../../brains/src/beefalobrain';
import type { FaceEntityInst } from '../../brains/src/behaviours/faceentity';
import type { BrainEntity, BrainWorld } from '../../brains/src/types';
import { BeefaloStateGraph, type BeefaloStateName } from '../../stategraphs/src/SGBeefalo';
import { PrefabInstance, type PrefabComponents, type PrefabEntityDefinition } from './prefabInstance';
import type { EntityPersistData } from './saveRecord';
import { animationLengths } from './animationTimings';
import { MakeCharacterPhysics, WORLD_SCALE } from './standardcomponents';

export const BEEFALO_ID = 'beefalo' as const;

/** beefalo.lua, beefalobrain.lua and SGBeefalo.lua; distances use this world's scale. */
export const BEEFALO_BEHAVIOR = {
  radius: 0.5 * WORLD_SCALE,
  walkSpeed: 1 * WORLD_SCALE,
  wanderDay: 20 * WORLD_SCALE,
  wanderNight: 5 * WORLD_SCALE,
  faceDistance: 4 * WORLD_SCALE,
  keepFaceDistance: 6 * WORLD_SCALE,
  poopMinSeconds: 40,
  poopMaxSeconds: 100,
  poopSpacing: 8 * WORLD_SCALE,
  poopDensityRadius: 20 * WORLD_SCALE,
} as const;

/** TUNING.BEEFALO_BEARD_BITS / BEEFALO_HAIR_GROWTH_DAYS. */
export const BEEFALO_BEARD_BITS = 3;
export const BEEFALO_HAIR_GROWTH_DAYS = 3;
export const BEEFALO_PRIZE = 'beefalowool';

export interface BeefaloWorld extends Pick<WorldContentContext, 'getWatchWorldContent'> {
  scheduler: GameTimeScheduler;
  /** StartUpdatingComponent: the stategraph, brain and locomotor run each frame, after the physics step. */
  componentUpdates: ComponentUpdates;
  clock: ReadonlySignal<{ phase: WorldPhase }>;
  /** Seconds from scheduler time `now` to the world's next day boundary; the world owns the day length. */
  secondsUntilNextDay(now: number): number;
  /** beard.lua SpawnPrefab(prize) launched from the beefalo's position. */
  spawnPrize(prefab: string, count: number, position: THREE.Vector3): void;
  /** TheWorld.Pathfinder. */
  pathfinder: LocoMotorPathfinder;
  /** Whether a beefalo can stand here: on land and clear of colliders. */
  isWalkable(point: THREE.Vector3): boolean;
  constrainPosition(position: THREE.Vector3): void;
  /** Logical ground/pending manure positions for periodicspawner's density and spacing rules. */
  getPoopPositions(): Iterable<ReadonlyVector3>;
  spawnPoop(position: THREE.Vector3): void;
  /** math.random. */
  random?: () => number;
}

/** The record saves from before the components saved themselves kept under `components.beefalo`; it loads once and is not written. */
export interface LegacyBeefaloSave {
  home: [number, number, number];
  knownlocations?: { locations: { name: string; x: number; y: number; z: number }[] };
  heading: number;
  poopRemainingSeconds: number;
  beard?: BeardSave;
}

export type BeefaloState = BeefaloStateName;

type BeefaloComponents = PrefabComponents & {
  locomotor: LocoMotor;
  knownlocations: KnownLocations;
  periodicspawner: PeriodicSpawner;
  beard: Beard;
  sleeper: Sleeper;
  health: Health;
};

/** tuning.lua BEEFALO_HEALTH (500 * 2, harder for multiplayer), BEEFALO_HEALTH_REGEN and BEEFALO_HEALTH_REGEN_PERIOD. */
export const BEEFALO_HEALTH = 500 * 2;
const BEEFALO_HEALTH_REGEN_PERIOD = 10;
const BEEFALO_HEALTH_REGEN = (BEEFALO_HEALTH / (TOTAL_DAY_TIME * 3)) * BEEFALO_HEALTH_REGEN_PERIOD;

/** The source banks the stategraph's clips come from, first match wins, as the sprite factory merges them. */
const BEEFALO_BANKS = ['beefalo_basic.zip', 'beefalo_actions.zip', 'beefalo_actions_domestic.zip'] as const;
const BEEFALO_CLIP_LENGTHS: ReadonlyMap<string, number> = new Map(
  BEEFALO_BANKS.flatMap(bank => [...animationLengths(bank)]).reverse(),
);

/** beefalo.lua: the fields it keeps on inst, and the engine's Physics and AnimState the stategraph and locomotor drive. */
export class BeefaloInstance extends PrefabInstance implements FaceEntityInst {
  declare readonly components: BeefaloComponents;
  declare sg: BeefaloStateGraph['sg'] | undefined;
  /** The brain's TheWorld: its day and its entity queries. */
  world!: BrainWorld;
  randomSource: () => number = Math.random;
  /** inst.hairGrowthPending, set by OnHairGrowth. */
  hairGrowthPending = false;
  /** The engine's AnimState queue: the stategraph's animover/animqueueover come from game time, not from drawing. */
  readonly animstate: AnimState;
  /** SetStateGraph("SGBeefalo"). */
  stategraph!: BeefaloStateGraph;
  declare brain: BeefaloBrain | undefined;

  constructor(scheduler: GameTimeScheduler) {
    super(BEEFALO_ID, new SpriteState({ name: 'idle_loop', billboard: true }));
    this.animstate = new AnimState(scheduler, BEEFALO_CLIP_LENGTHS, event => this.PushEvent(event));
  }

  get state(): BeefaloState {
    return this.stategraph.stateName;
  }

  // conventions-allow instance-method: GetTime(), which the brain and its behaviours call on inst.
  getTime(): number {
    return this.GetTime();
  }
  // conventions-allow instance-method: math.random, which the brain's behaviours call on inst.
  random(): number {
    return this.randomSource();
  }

  /** Transform:SetRotation; Transform:SetSixFaced draws the heading with six facings. */
  // conventions-allow instance-method: the engine's Transform:SetRotation, which locomotor and FaceEntity call on inst.
  override setRotation(degrees: number): void {
    super.setRotation(degrees);
    this.sprite.setFacingRotation(degrees, 6);
  }

  /** Physics:SetMotorVel along the heading. */
  // conventions-allow instance-method: the engine's Physics:SetMotorVel, which locomotor calls on inst.
  setMotorSpeed(speed: number): void {
    const body = this.physicsBody;
    if (!body) {
      return;
    }
    const heading = THREE.MathUtils.degToRad(this.transform.rotation);
    body.velocity.x = Math.cos(heading) * speed;
    body.velocity.z = -Math.sin(heading) * speed;
  }
}

/** OnResetBeard; brushable, domestication and skins are not ported. has_beard and the shaved build follow the beard's hairy memo. */
function OnResetBeard(inst: BeefaloInstance): void {
  if (inst.components.sleeper.IsAsleep()) {
    inst.stategraph.sg.statemem.continuesleeping = true;
  }
  inst.stategraph.goToState('shaved');
}

/** CanShaveTest; health and the beef bell owner are not ported. */
function CanShaveTest(inst: BeefaloInstance): { ok: true } | { ok: false; reason?: string } {
  return inst.components.sleeper.IsAsleep() ? { ok: true } : { ok: false, reason: 'AWAKEBEEFALO' };
}

/** OnShaved: ApplyBuildOverrides, which the hairy memo below performs for the shaved build. */
function OnShaved(): void {}

/** OnHairGrowth; rideable's Buck is not ported. */
function OnHairGrowth(inst: BeefaloInstance): void {
  if (inst.components.beard.bits.value === 0) {
    inst.hairGrowthPending = true;
  }
}

/** A save from before the components saved themselves: its fields load into the components they belong to. */
function onload(inst: BeefaloInstance, data: EntityPersistData): void {
  const legacy = data.beefalo;
  if (!legacy) {
    return;
  }
  inst.setRotation(legacy.heading);
  if (!data.knownlocations) {
    inst.components.knownlocations.OnLoad(
      legacy.knownlocations ?? {
        locations: [{ name: 'herd', x: legacy.home[0], y: legacy.home[1], z: legacy.home[2] }],
      },
    );
  }
  if (!data.periodicspawner && legacy.poopRemainingSeconds > 0) {
    inst.components.periodicspawner.OnLoad({ time: legacy.poopRemainingSeconds });
  }
  if (!data.beard && legacy.beard) {
    inst.components.beard.OnLoad(legacy.beard);
  }
}

/** The brain's TheWorld: simutil.lua FindEntity / GetClosestInstWithTag over TheSim, and the map's IsAboveGroundAtPoint. */
function CreateBrainWorld(inst: BeefaloInstance, world: BeefaloWorld): BrainWorld {
  // Transform:GetWorldPosition of the searcher, which the brain passes as a BrainEntity.
  const origin = new THREE.Vector3();
  const at = (from: BrainEntity) => {
    const { x, y, z } = from.getPosition();
    return origin.set(x, y, z);
  };
  return {
    get isDay() {
      return world.clock.value.phase === 'day';
    },
    // FindEntity skips the searcher and entities that are not visible, those in limbo among them.
    findEntity: (from, radius, fn, must, cant, oneOf) =>
      inst.TheSim.FindEntities(at(from), radius, must, cant, oneOf).find(
        entity => entity !== from && entity.IsVisible() && !entity.inlimbo && (!fn || fn(entity, from)),
      ),
    getClosestInstWithTag: (tags, from, radius) => {
      const [first, second] = inst.TheSim.FindEntities(at(from), radius, tags);
      return first !== from ? first : second;
    },
    isAboveGroundAtPoint: (x, y, z) => {
      const point = new THREE.Vector3(x, y, z);
      world.constrainPosition(point);
      return point.x === x && point.z === z && world.isWalkable(point);
    },
  };
}

/** beefalo.lua beefalo(), as far as it is ported: a wild adult's beard, health, herd location, manure, locomotion, sleep, brain and stategraph. */
function fn(world: BeefaloWorld): BeefaloInstance {
  const { scheduler } = world,
    random = world.random ?? Math.random;
  const inst = new BeefaloInstance(scheduler);
  inst.BindScheduler(scheduler);
  for (const tag of ['beefalo', 'animal', 'largecreature', 'bearded']) {
    inst.addTag(tag);
  }
  inst.setRotation(0);

  const beard = addComponent(inst, 'beard', Beard, {
    scheduler,
    secondsUntilNextDay: now => world.secondsUntilNextDay(now),
    spawnPrize: (prefab, count, point) => world.spawnPrize(prefab, count, new THREE.Vector3(point.x, point.y, point.z)),
  });
  beard.SetBits(BEEFALO_BEARD_BITS);
  beard.SetDaysGrowth(BEEFALO_HAIR_GROWTH_DAYS + 1);
  beard.onreset = () => OnResetBeard(inst);
  beard.canshavetest = () => CanShaveTest(inst);
  beard.prize = BEEFALO_PRIZE;
  beard.AddCallback(0, OnShaved);
  beard.AddCallback(BEEFALO_HAIR_GROWTH_DAYS, () => OnHairGrowth(inst));
  // AddTag("has_beard") in fn, RemoveTag in OnResetBeard and OnLoadPostPass, and ApplyBuildOverrides' shaved build: both
  // follow whether the beard has bits.
  inst.onRemove(
    createRenderEffect(() => {
      const hairy = beard.hairy.get();
      if (hairy) {
        inst.addTag('has_beard');
      } else {
        inst.removeTag('has_beard');
      }
      inst.sprite.setBuildArchive(hairy ? BEEFALO_BUILD : BEEFALO_SHAVED_BUILD);
    }),
  );

  // The OnDeath and OnHealthDelta listeners are for death, loot and the rider, which are not ported.
  const health = addComponent(inst, 'health', Health, undefined, scheduler);
  health.SetMaxHealth(BEEFALO_HEALTH);
  health.nofadeout = true;
  health.StartRegen(BEEFALO_HEALTH_REGEN, BEEFALO_HEALTH_REGEN_PERIOD);

  addComponent(inst, 'knownlocations', KnownLocations);

  const periodicspawner = addComponent(
    inst,
    'periodicspawner',
    PeriodicSpawner,
    scheduler,
    () => {
      // SetPrefab("poop"): it drops a body length behind the beefalo.
      const heading = THREE.MathUtils.degToRad(inst.transform.rotation);
      const position = inst.position
        .clone()
        .add(new THREE.Vector3(-Math.cos(heading) * WORLD_SCALE, 0, Math.sin(heading) * WORLD_SCALE));
      world.constrainPosition(position);
      world.spawnPoop(position);
      return { spawned: true };
    },
    random,
    () => world.getPoopPositions(),
  );
  periodicspawner.SetRandomTimes(40, 60);
  periodicspawner.SetDensityInRange(BEEFALO_BEHAVIOR.poopDensityRadius, 2);
  periodicspawner.SetMinimumSpacing(BEEFALO_BEHAVIOR.poopSpacing);
  periodicspawner.Start();

  const locomotor = addComponent(inst, 'locomotor', LocoMotor, {
    arriveDistance: 0.15 * WORLD_SCALE,
    pathfinder: world.pathfinder,
  });
  locomotor.walkspeed = BEEFALO_BEHAVIOR.walkSpeed;
  locomotor.runspeed = 7 * WORLD_SCALE;

  const sleeper = addComponent(inst, 'sleeper', Sleeper, world.getWatchWorldContent, random);
  sleeper.SetResistance(3);

  // The drawn sprite follows the logical clip at once.
  let shownAnimation = inst.animstate.animation.value;
  const stopSprite = createRenderEffect(() => {
    const animation = inst.animstate.animation.get();
    if (animation === shownAnimation) {
      return;
    }
    shownAnimation = animation;
    untrack(() => inst.AnimState.PlayAnimation(animation.name, animation.loop));
  });
  inst.stategraph = new BeefaloStateGraph(
    {
      locomotor,
      sleeper,
      hairGrowthPending: () => inst.hairGrowthPending,
      growHair: () => {
        beard.SetBits(BEEFALO_BEARD_BITS);
        inst.hairGrowthPending = false;
      },
      playAnimation: (name, loop) => inst.animstate.PlayAnimation(name, loop),
      pushAnimation: (name, loop) => inst.animstate.PushAnimation(name, loop),
      getCurrentAnimationLength: () => inst.animstate.length,
      isCurrentAnimation: name => inst.animstate.animation.value.name === name,
      random,
    },
    scheduler,
  );
  inst.SetStateGraph(() => inst.stategraph.sg);
  inst.world = CreateBrainWorld(inst, world);
  inst.randomSource = random;
  inst.SetBrain(beefalo => new BeefaloBrain(beefalo, WORLD_SCALE));

  inst.OnLoad = onload;
  inst.onRemove(() => {
    inst.brain?.Stop();
    inst.stategraph.dispose();
    stopSprite();
    inst.animstate.dispose();
  });
  return inst;
}

/** Each frame after the physics step: the beefalo follows its body, then its stategraph, brain and locomotor run. */
function OnUpdate(inst: BeefaloInstance, world: BeefaloWorld, dt: number): void {
  if (inst.status.value !== 'active' || !Number.isFinite(dt) || dt < 0) {
    return;
  }
  const body = inst.physicsBody;
  if (body) {
    const position = new THREE.Vector3(body.position.x, 0, body.position.z);
    world.constrainPosition(position);
    inst.setPosition(position.x, 0, position.z);
    if (body.position.x !== position.x || body.position.z !== position.z) {
      body.position.x = position.x;
      body.position.z = position.z;
      body.aabbNeedsUpdate = true;
    }
  }
  const step = Math.min(dt, 0.1);
  inst.stategraph.update(step);
  inst.brain?.tick(world.scheduler.now);
  inst.components.locomotor.update(step);
}

/** AnimState:SetBuild names; the shaved build replaces the whole hairy build while hair regrows. */
export const BEEFALO_BUILD = 'beefalo_build.zip';
export const BEEFALO_SHAVED_BUILD = 'beefalo_shaved_build.zip';
/**
 * beefalo.lua SetBank("beefalo") over its basic, actions and domestic ANIM archives, with both builds it switches
 * between, and Hide("HEAT"). Its six faces are the clips' facings, mirrored for the left-hand ones.
 */
export const BEEFALO_ART = {
  animationArchive: BEEFALO_BANKS[0],
  extraAnimationArchives: BEEFALO_BANKS.slice(1),
  buildArchives: [BEEFALO_BUILD, BEEFALO_SHAVED_BUILD],
  bank: 'beefalo',
  hiddenLayers: ['HEAT'],
};

/** The Prefab beefalo.lua returns, drawn from its shared archive over its hairy and shaved builds. */
export function beefaloPrefabs(
  world: BeefaloWorld,
): Readonly<Record<typeof BEEFALO_ID, PrefabEntityDefinition<BeefaloInstance>>> {
  return {
    [BEEFALO_ID]: {
      fn: position => {
        const inst = fn(world);
        const placed = new THREE.Vector3(position.x, 0, position.z);
        world.constrainPosition(placed);
        inst.copyPosition(placed);
        return inst;
      },
      assets: BEEFALO_ART,
      // MakeCharacterPhysics(inst, 100, .5)
      physics: { make: (inst, radius) => MakeCharacterPhysics(inst, 100, radius), radius: 0.5 },
      onSpawned: inst => {
        // A saved heading is the record's rotation, which the manager restores without SetRotation's facing.
        inst.setRotation(inst.transform.rotation);
        inst.onRemove(world.componentUpdates.register({ OnUpdate: dt => OnUpdate(inst, world, dt) }));
      },
    },
  };
}

export const beefaloRegistration = {
  create: beefaloPrefabs,
  families: { beefalos: definePrefabIds([BEEFALO_ID], true) },
};

/** c_spawn("beefalo"): the nearest clear, walkable ring point around `position`. */
export function findBeefaloSpawnPoint(
  physics: CANNON.World,
  world: Pick<BeefaloWorld, 'constrainPosition' | 'isWalkable'>,
  position: THREE.Vector3,
): THREE.Vector3 {
  for (let ring = 1; ring <= 4; ring++) {
    for (let index = 0; index < 16; index++) {
      const angle = (index * Math.PI) / 8;
      const target = new THREE.Vector3(
        position.x + Math.cos(angle) * ring * 10,
        0,
        position.z + Math.sin(angle) * ring * 10,
      );
      world.constrainPosition(target);
      const occupied = getRegisteredPhysicsBodies(physics).some(
        body =>
          body.collisionResponse &&
          body.shapes.some(
            shape =>
              shape instanceof CANNON.Sphere &&
              Math.hypot(target.x - body.position.x, target.z - body.position.z) <
                shape.radius + BEEFALO_BEHAVIOR.radius + 1,
          ),
      );
      if (!occupied && world.isWalkable(target)) {
        return target;
      }
    }
  }
  throw new Error('附近没有可生成 beefalo 的空地');
}

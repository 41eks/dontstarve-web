import { addComponent, removeComponent } from './components';
import * as THREE from 'three';
import { SpriteState } from '@dontstarve-web/display';
import type { ReadonlySignal, WorldPhase, WorldContentContext } from '@dontstarve-web/signals';
import { AnimState } from '../../componets/src/animstate';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { ComponentUpdates } from '../../componets/src/componentUpdates';
import { Sleeper } from '../../componets/src/sleeper';
import { Health } from '../../componets/src/health';
import { Inspectable } from '../../componets/src/inspectable';
import { LootDropper, SetSharedLootTable, type LootSpawn } from '../../componets/src/lootdropper';
import { Timer } from '../../componets/src/timer';
import { LocoMotor, type LocoMotorPathfinder } from '../../componets/src/locomotor';
import { KnownLocations } from '../../componets/src/knownlocations';
import { HerdMember } from '../../componets/src/herdmember';
import { SaltLicker } from '../../componets/src/saltlicker';
import { ElectricAttacks } from '../../componets/src/electricattacks';
import { LightningGoatBrain } from '../../brains/src/lightninggoatbrain';
import type { FaceEntityInst } from '../../brains/src/behaviours/faceentity';
import type { BrainEntity, BrainWorld } from '../../brains/src/types';
import { LightningGoatStateGraph, type LightningGoatSound } from '../../stategraphs/src/SGlightninggoat';
import { PrefabInstance, type EntityTask, type PrefabComponents, type PrefabEntityDefinition } from './prefabInstance';
import type { EntityPersistData } from './saveRecord';
import { animationLengths } from './animationTimings';
import { MakeCharacterPhysics, WORLD_SCALE } from './standardcomponents';

export const LIGHTNINGGOAT_ID = 'lightninggoat' as const;

/** tuning.lua LIGHTNING_GOAT_* and SALTLICK_LIGHTNINGGOAT_USES; speeds and distances in this world's units. */
export const LIGHTNING_GOAT_HEALTH = 350 * 2;
const LIGHTNING_GOAT_WALK_SPEED = 4 * WORLD_SCALE;
const LIGHTNING_GOAT_RUN_SPEED = 8 * WORLD_SCALE;
const SALTLICK_LIGHTNINGGOAT_USES = 1;
/** setcharged: inst.chargeleft = 3 days. */
export const LIGHTNING_GOAT_CHARGES = 3;
/** MakeCharacterPhysics(inst, 100, .5). */
const RADIUS = 0.5 * WORLD_SCALE;

/** inst.Light: radius .85 (DST units), falloff .5, intensity .75, colour (255, 255, 236). */
const LIGHT = { radius: 0.85 * WORLD_SCALE, falloff: 0.5, intensity: 0.75, colour: [1, 1, 236 / 255] } as const;

SetSharedLootTable('lightninggoat', [
  ['meat', 1],
  ['meat', 1],
  ['lightninggoathorn', 0.25],
]);
SetSharedLootTable('chargedlightninggoat', [
  ['meat', 1],
  ['meat', 1],
  ['goatmilk', 1],
  ['lightninggoathorn', 0.25],
]);

export interface LightningGoatWorld extends Pick<WorldContentContext, 'getWatchWorldContent'> {
  scheduler: GameTimeScheduler;
  /** StartUpdatingComponent: the stategraph, brain and locomotor run each frame, after the physics step. */
  componentUpdates: ComponentUpdates;
  clock: ReadonlySignal<{ phase: WorldPhase }>;
  /** Seconds from scheduler time `now` to the world's next day boundary: WatchWorldState("cycles"). */
  secondsUntilNextDay(now: number): number;
  /** TheWorld.Pathfinder. */
  pathfinder: LocoMotorPathfinder;
  /** Whether the goat can stand here: on land and clear of colliders. */
  isWalkable(point: THREE.Vector3): boolean;
  constrainPosition(position: THREE.Vector3): void;
  /** lootdropper:SpawnLootPrefab. */
  spawnLoot: LootSpawn;
  /** math.random. */
  random?: () => number;
}

/** lightninggoat.lua OnSave: data.charged and data.chargeleft only exist while the goat is charged. */
export interface LightningGoatSaveState {
  charged: true;
  chargeleft: number;
}

type LightningGoatComponents = PrefabComponents & {
  health: Health;
  sleeper: Sleeper;
  lootdropper: LootDropper;
  inspectable: Inspectable;
  knownlocations: KnownLocations;
  herdmember: HerdMember;
  timer: Timer;
  saltlicker: SaltLicker;
  locomotor: LocoMotor;
  electricattacks?: ElectricAttacks;
};

const LIGHTNING_GOAT_BANKS = ['lightning_goat_basic.zip', 'lightning_goat_actions.zip'] as const;
const CLIP_LENGTHS: ReadonlyMap<string, number> = new Map(
  LIGHTNING_GOAT_BANKS.flatMap(bank => [...animationLengths(bank)]).reverse(),
);
export const LIGHTNING_GOAT_BUILD = 'lightning_goat_build.zip';
export const LIGHTNING_GOAT_SHOCKED_BUILD = 'lightning_goat_shocked_build.zip';
/**
 * lightninggoat.lua SetBank("lightning_goat") over its basic and actions archives, with the build setcharged swaps for the
 * shocked one, and AnimState:Hide("fx") until it is charged.
 */
export const LIGHTNING_GOAT_ART = {
  animationArchive: LIGHTNING_GOAT_BANKS[0],
  extraAnimationArchives: LIGHTNING_GOAT_BANKS.slice(1),
  buildArchives: [LIGHTNING_GOAT_BUILD, LIGHTNING_GOAT_SHOCKED_BUILD],
  bank: 'lightning_goat',
  hiddenLayers: ['fx'],
};

/** lightninggoat.lua: the fields it keeps on inst, and the engine's Physics and AnimState the stategraph and locomotor drive. */
export class LightningGoatInstance extends PrefabInstance implements FaceEntityInst {
  declare readonly components: LightningGoatComponents;
  declare brain: LightningGoatBrain | undefined;
  declare sg: LightningGoatStateGraph['sg'] | undefined;
  /** inst.charged / inst.chargeleft. */
  charged = false;
  chargeleft: number | undefined;
  /** WatchWorldState("cycles", ReduceCharges), as the task at the next day boundary. */
  cyclestask?: EntityTask;
  /** The brain's TheWorld: its day and its entity queries. */
  world!: BrainWorld;
  randomSource: () => number = Math.random;
  /** The engine's AnimState queue: the stategraph's animover/animqueueover come from game time, not from drawing. */
  readonly animstate: AnimState;
  /** SetStateGraph("SGlightninggoat"). */
  stategraph!: LightningGoatStateGraph;

  constructor(scheduler: GameTimeScheduler) {
    super(LIGHTNINGGOAT_ID, new SpriteState({ name: 'idle_loop', billboard: true }));
    this.animstate = new AnimState(scheduler, CLIP_LENGTHS, event => this.PushEvent(event));
  }

  // conventions-allow instance-method: GetTime(), which the brain and its behaviours call on inst.
  getTime(): number {
    return this.GetTime();
  }
  // conventions-allow instance-method: math.random, which the brain's behaviours call on inst.
  random(): number {
    return this.randomSource();
  }

  /** Transform:SetRotation; Transform:SetFourFaced draws the heading with four facings. */
  // conventions-allow instance-method: the engine's Transform:SetRotation, which locomotor and FaceEntity call on inst.
  override setRotation(degrees: number): void {
    super.setRotation(degrees);
    this.sprite.setFacingRotation(degrees, 4);
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

/** The day boundary task WatchWorldState("cycles", ReduceCharges) stands for, re-armed each day while charged. */
function WatchCycles(inst: LightningGoatInstance, world: LightningGoatWorld): void {
  inst.cyclestask?.Cancel();
  inst.cyclestask = inst.DoTaskInTime(world.secondsUntilNextDay(world.scheduler.now), () => {
    inst.cyclestask = undefined;
    ReduceCharges(inst, world);
    if (inst.charged) {
      WatchCycles(inst, world);
    }
  });
}

/** discharge: back to the plain build (at the discharge state's frame 18), no light, no electric attacks. */
function discharge(inst: LightningGoatInstance): void {
  inst.removeTag('charged');
  inst.removeTag('electricdamageimmune');
  inst.components.electricattacks?.RemoveSource(inst);
  inst.components.lootdropper.SetChanceLootTable('lightninggoat');
  inst.stategraph.goToState('discharge');
  // AnimState:ClearBloomEffectHandle: bloom is not rendered.
  inst.charged = false;
  inst.light.set(null);
  inst.chargeleft = undefined;
  inst.cyclestask?.Cancel();
  inst.cyclestask = undefined;
}

function ReduceCharges(inst: LightningGoatInstance, _world: LightningGoatWorld): void {
  if (inst.chargeleft === undefined) {
    return;
  }
  inst.chargeleft -= 1;
  if (inst.chargeleft <= 0) {
    discharge(inst);
  }
}

/** setcharged: the shocked build with its fx layer, the light and three days of charge; `instant` skips the shocked state. */
function setcharged(inst: LightningGoatInstance, world: LightningGoatWorld, instant = false): void {
  if (inst.components.health.IsDead()) {
    return;
  }
  inst.addTag('charged');
  inst.addTag('electricdamageimmune');
  const electricattacks =
    inst.components.electricattacks ??
    addComponent(inst, 'electricattacks', ElectricAttacks, () => removeComponent(inst, 'electricattacks'));
  electricattacks.AddSource(inst);
  inst.components.lootdropper.SetChanceLootTable('chargedlightninggoat');
  inst.sprite.setBuildArchive(LIGHTNING_GOAT_SHOCKED_BUILD);
  inst.sprite.showLayer('fx');
  if (!instant) {
    inst.stategraph.goToState('shocked');
  }
  // AnimState:SetBloomEffectHandle: bloom is not rendered.
  inst.charged = true;
  inst.chargeleft = LIGHTNING_GOAT_CHARGES;
  inst.light.set(LIGHT);
  WatchCycles(inst, world);
}

function OnElectrocute(inst: LightningGoatInstance, world: LightningGoatWorld): void {
  setcharged(inst, world); // don't accidentally pass data as 2nd param to setcharged
}

function OnSave(inst: LightningGoatInstance, data: EntityPersistData): void {
  if (inst.charged) {
    data.lightninggoat = { charged: true, chargeleft: inst.chargeleft! };
  }
}

function OnLoad(inst: LightningGoatInstance, world: LightningGoatWorld, data: EntityPersistData): void {
  const saved = data.lightninggoat;
  if (saved?.charged && saved.chargeleft !== undefined) {
    setcharged(inst, world, true);
    inst.chargeleft = saved.chargeleft;
  }
}

function getstatus(inst: LightningGoatInstance): string | undefined {
  return inst.charged ? 'CHARGED' : undefined;
}

/** The brain's TheWorld: simutil.lua FindEntity / GetClosestInstWithTag over TheSim, and the map's IsAboveGroundAtPoint. */
function CreateBrainWorld(inst: LightningGoatInstance, world: LightningGoatWorld): BrainWorld {
  const origin = new THREE.Vector3();
  const at = (from: BrainEntity) => {
    const { x, y, z } = from.getPosition();
    return origin.set(x, y, z);
  };
  return {
    get isDay() {
      return world.clock.peek().phase === 'day';
    },
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

/**
 * lightninggoat.lua fn(), as far as it is ported. Not ported: combat (RetargetFn, KeepTargetFn, OnAttacked and its
 * electric retaliation and ShareTarget), MakeMediumBurnableCharacter, MakeMediumFreezableCharacter, MakeHauntablePanic,
 * spawnedforhunt, the DynamicShadow and bloom. herdmember and saltlicker are minimal: herds and salt licks are not ported.
 */
function fn(world: LightningGoatWorld): LightningGoatInstance {
  const { scheduler } = world,
    random = world.random ?? Math.random;
  const inst = new LightningGoatInstance(scheduler);
  inst.BindScheduler(scheduler);
  const soundEmitter = inst.AddSoundEmitter();
  inst.setRotation(0);
  // AnimState:Hide("fx") is the art's hiddenLayers; setcharged shows it.
  for (const tag of ['lightninggoat', 'animal', 'lightningrod']) {
    inst.addTag(tag);
  }

  const health = addComponent(inst, 'health', Health, undefined, scheduler);
  health.SetMaxHealth(LIGHTNING_GOAT_HEALTH);

  addComponent(inst, 'sleeper', Sleeper, world.getWatchWorldContent, random).SetResistance(4);

  addComponent(inst, 'lootdropper', LootDropper, world.spawnLoot).SetChanceLootTable('lightninggoat');

  addComponent(inst, 'inspectable', Inspectable).getstatus = () => getstatus(inst);

  addComponent(inst, 'knownlocations', KnownLocations);
  addComponent(inst, 'herdmember', HerdMember).SetHerdPrefab('lightninggoatherd');

  addComponent(inst, 'timer', Timer, scheduler);
  addComponent(inst, 'saltlicker', SaltLicker).SetUp(SALTLICK_LIGHTNINGGOAT_USES);

  inst.ListenForEvent('electrocute', () => OnElectrocute(inst, world));
  inst.ListenForEvent('lightningstrike', () => setcharged(inst, world));

  inst.OnSave = OnSave;
  inst.OnLoad = (inst, data) => OnLoad(inst, world, data);

  const locomotor = addComponent(inst, 'locomotor', LocoMotor, {
    arriveDistance: 0.15 * WORLD_SCALE,
    pathfinder: world.pathfinder,
  });
  locomotor.walkspeed = LIGHTNING_GOAT_WALK_SPEED;
  locomotor.runspeed = LIGHTNING_GOAT_RUN_SPEED;

  const playSound = (sound: LightningGoatSound) =>
    soundEmitter.PlaySound(`dontstarve_DLC001/creatures/lightninggoat/${sound}`);
  const stopSprite = inst.animstate.animation.subscribe(({ name, loop }) => inst.AnimState.PlayAnimation(name, loop));
  inst.stategraph = new LightningGoatStateGraph(
    {
      locomotor,
      sleeper: inst.components.sleeper,
      charged: () => inst.charged,
      playSound,
      doPeriodicTask: (period, task) => {
        const handle = inst.DoPeriodicTask(period, task);
        return () => handle.Cancel();
      },
      clearChargedLook: () => {
        inst.sprite.hideLayer('fx');
        inst.sprite.setBuildArchive(LIGHTNING_GOAT_BUILD);
      },
      performBufferedAction: () => {
        inst.PerformBufferedAction();
      },
      playAnimation: (name, loop) => inst.animstate.PlayAnimation(name, loop),
      pushAnimation: (name, loop) => inst.animstate.PushAnimation(name, loop),
      random,
    },
    scheduler,
  );
  inst.SetStateGraph(() => inst.stategraph.sg);
  inst.world = CreateBrainWorld(inst, world);
  inst.randomSource = random;
  inst.SetBrain(goat => new LightningGoatBrain(goat, WORLD_SCALE));

  inst.onRemove(() => {
    inst.brain?.Stop();
    inst.stategraph.dispose();
    stopSprite();
    inst.animstate.dispose();
    inst.light.set(null);
  });
  return inst;
}

/** Each frame after the physics step: the goat follows its body, then its stategraph, brain and locomotor run. */
function OnUpdate(inst: LightningGoatInstance, world: LightningGoatWorld, dt: number): void {
  if (inst.status.peek() !== 'active' || !Number.isFinite(dt) || dt < 0) {
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

/** The Prefab lightninggoat.lua returns, drawn from its shared archives over its plain and shocked builds. */
export function lightningGoatPrefabs(
  world: LightningGoatWorld,
): Readonly<Record<typeof LIGHTNINGGOAT_ID, PrefabEntityDefinition<LightningGoatInstance>>> {
  return {
    [LIGHTNINGGOAT_ID]: {
      fn: position => {
        const inst = fn(world);
        const placed = new THREE.Vector3(position.x, 0, position.z);
        world.constrainPosition(placed);
        inst.copyPosition(placed);
        return inst;
      },
      assets: LIGHTNING_GOAT_ART,
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

export const LIGHTNING_GOAT_RADIUS = RADIUS;

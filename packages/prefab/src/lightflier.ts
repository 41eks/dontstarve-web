import { PrefabInstance, type EntityTask } from './prefabInstance';
import { addComponent } from './components';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { Vector3 } from 'three';
import { ItemEntity, type InventoryStack } from '@dontstarve-web/inventory';
import { createEffect, createSignal, readonlySignal, watchSignal, WorldContentKey, type GetWatchWorldContent, type TileStateQuery, type ReadonlySignal } from '@dontstarve-web/signals';
import { fourFacingFromRotation } from '@dontstarve-web/animation/facing';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ComponentTimer } from '../../componets/src/timer';
import { FormationFollower } from '../../componets/src/formationfollower';
import { FormationLeader } from '../../componets/src/formationleader';
import { Follower } from '../../componets/src/follower';
import { HomeSeeker } from '../../componets/src/homeseeker';
import { KnownLocations } from '../../componets/src/knownlocations';
import { AnimState } from '../../componets/src/animstate';
import { Health } from '../../componets/src/health';
import { Combat } from '../../componets/src/combat';
import { Eater } from '../../componets/src/eater';
import { Sleeper } from '../../componets/src/sleeper';
import { Freezable } from '../../componets/src/freezable';
import { Burnable } from '../../componets/src/burnable';
import { Propagator } from '../../componets/src/propagator';
import { Hauntable } from '../../componets/src/hauntable';
import { ErodeAway } from '../../componets/src/erodeaway';
import { animationLengths } from './animationTimings';
import { Workable } from '../../componets/src/workable';
import { LocoMotor, type LocoMotorInst } from '../../componets/src/locomotor';
import { LightFlierBrain, SetFormationActive, type LightFlierBrainInst } from '../../brains/src/lightflierbrain';
import { LightFlierStateGraph, type LightFlierStateInst } from '../../stategraphs/src/SGlightflier';
import type { BrainEntity, BrainWorld } from '../../brains/src/types';
import type { ItemPrefabWorld } from './groundPrefab';
import { bindItemWorld, dropStackIndividually, type ItemPrefabDefinition } from './groundItems';
import type { LightFlierFlowerInstance } from './lightflier_flower';
import { WORLD_SCALE, MakeGhostPhysics } from './standardcomponents';

export const LIGHTFLIER_ID = 'lightflier';
export const LIGHTFLIER_PERISH_TIME = 2 * 480;
const LIGHTFLIER_ANIMATION_LENGTHS = animationLengths('lightflier.zip');
export const LIGHTFLIER_TAGS = ['lightflier', 'cavedweller', 'flying', 'ignorewalkableplatformdrowning', 'insect',
  'smallcreature', 'lightbattery', 'lunar_aligned', 'show_spoilage', 'small_livestock', 'formation_lightflier'] as const;
export const LIGHTFLIER_SOUNDS = ['grotto/creatures/light_bug/fly_LP', 'grotto/creatures/light_bug/hit', 'grotto/creatures/light_bug/death'] as const;
export interface LightFlierPlayer {
  readonly position: ReadonlyVector3;
  isValid(): boolean;
  hasLightFlier(): boolean;
  getFacing(): number;
  getWalkSpeed(): number;
  wantsToMove(): boolean;
}
export interface LightFlierServices {
  scheduler: GameTimeScheduler;
  getWatchWorldContent?: GetWatchWorldContent;
  tickingarea?: TileStateQuery;
  cameraHeading?: ReadonlySignal<number>;
  /** Match the host physics substep budget for direct flight integration. */
  maxMovementStep?: number;
  getPlayers(): readonly LightFlierPlayer[];
  spawnItem(state: InventoryStack): ItemEntity;
  dropLoot(prefab: string, count: number, position: Vector3): void;
  /** FindEntity(inst, MAX_WANDER_DIST, nil, { "lightflier_home" }): the live lightflier_flower entities. */
  getHomes(): Iterable<LightFlierFlowerInstance>;
}
type Leader = FormationLeader<LightFlierPlayer, LightFlier>;

/** Shared world services, source assets and nonpersistent formationleader entities. */
export class LightFlierHabitat {
  readonly flies = new Set<LightFlier>();
  /** OnLoadPostPass's newents: homes waiting for a saved child by its entity ID. */
  private readonly waiting = new Map<string, Set<(fly: LightFlier) => void>>();
  readonly formations = new Set<Leader>();
  private readonly leaderTimers = new Map<Leader, ComponentTimer>();
  private readonly distributenext = new Set<Leader>();
  private disposed = false;
  readonly services: LightFlierServices;
  constructor(services: LightFlierServices) { this.services = services; }
  bind(fly: LightFlier): void {
    BindLightFlierWorld(fly, this, LIGHTFLIER_ANIMATION_LENGTHS);
    const found = this.waiting.get(fly.id);
    this.waiting.delete(fly.id);
    for (const fn of found ?? []) fn(fly);
  }
  /** `found` runs once the lightflier with this entity ID joins the world, or now if it has. */
  waitForFly(id: string, found: (fly: LightFlier) => void): () => void {
    const fly = [...this.flies].find(candidate => candidate.id === id);
    if (fly) { found(fly); return () => {}; }
    let set = this.waiting.get(id);
    if (!set) this.waiting.set(id, set = new Set());
    set.add(found);
    return () => { set!.delete(found); if (!set!.size && this.waiting.get(id) === set) this.waiting.delete(id); };
  }
  spawn(position: Vector3): LightFlier {
    if (this.disposed) throw new Error('Lightflier habitat unavailable');
    const fly = this.services.spawnItem({ itemId: LIGHTFLIER_ID, count: 1 });
    if (!(fly instanceof LightFlier)) throw new Error('SpawnPrefab("lightflier") made no lightflier');
    configureLightFlierEntity(fly);
    fly.setPosition(position.x, position.y, position.z); this.bind(fly);
    return fly;
  }
  findFormation(fly: LightFlier): void {
    if (!inWorld(fly) || fly.inFormation || fly.getTime() - fly.lastAttacked < 4) return;
    const p = fly.getPosition();
    const nearby = [...this.formations].filter(leader => p.distanceToSquared(leader.position) <= (8 * WORLD_SCALE) ** 2);
    if (fly.components.formationfollower.SearchForFormation(nearby)) return;
    const target = this.services.getPlayers().find(player => player.isValid() && player.hasLightFlier()
      && ![...this.formations].some(leader => leader.target === player) && p.distanceToSquared(player.position) <= (9 * WORLD_SCALE) ** 2);
    if (target) this.makeFormation(target, fly);
  }
  private makeFormation(target: LightFlierPlayer, fly: LightFlier): void {
    const leader = new FormationLeader<LightFlierPlayer, LightFlier>(target);
    leader.radius = 4.1 * WORLD_SCALE; leader.position.copy(fly.getPosition()); this.formations.add(leader);
    leader.ondisband = () => { this.formations.delete(leader); this.leaderTimers.get(leader)?.stop(); this.leaderTimers.delete(leader); this.distributenext.delete(leader); };
    leader.NewFormationMember(fly);
    const timer = new ComponentTimer(this.services.scheduler, () => { this.validateFormation(leader); if (this.formations.has(leader)) timer.start(1); });
    this.leaderTimers.set(leader, timer); timer.start(1);
  }
  private validateFormation(leader: Leader): void {
    if (!leader.target.isValid() || !leader.target.hasLightFlier()) { leader.DisbandFormation(); return; }
    if (leader.members.size <= 1) return;
    const otherLeaders = [...this.formations].filter(other => other !== leader && leader.position.distanceToSquared(other.position) <= ((8 + 4.1) * WORLD_SCALE) ** 2);
    if (this.distributenext.delete(leader)) {
      const other = otherLeaders.find(candidate => !candidate.IsFormationFull() && leader.members.size - 1 > candidate.members.size);
      if (other) { const fly = [...leader.members][0]; fly.components.formationfollower.LeaveFormation(); other.NewFormationMember(fly); }
    } else {
      this.distributenext.add(leader);
      const player = this.services.getPlayers().find(p => p !== leader.target && p.isValid() && p.hasLightFlier()
        && ![...this.formations].some(other => other.target === p) && leader.position.distanceToSquared(p.position) <= (9 * WORLD_SCALE) ** 2);
      if (player) { const fly = [...leader.members][0]; fly.components.formationfollower.LeaveFormation(); this.makeFormation(player, fly); }
    }
  }
  update(dt: number): void {
    for (const leader of this.formations) {
      const target = leader.target;
      if (!target.isValid() || leader.position.distanceToSquared(target.position) > (16 * WORLD_SCALE) ** 2) { leader.DisbandFormation(); continue; }
      const angle = target.getFacing() * Math.PI / 180;
      const distance = target.wantsToMove() ? target.getWalkSpeed() * .4 : 0;
      const offset = target.position.clone().add(new Vector3(Math.cos(angle) * distance, 0, -Math.sin(angle) * distance));
      leader.position.lerp(offset, .2);
      const rings = [...this.formations].filter(other => other.target === target).sort((a, b) => b.age - a.age);
      const ring = rings.indexOf(leader); leader.radius = (4.1 + ring * 5) * WORLD_SCALE;
      leader.reverse = ring % 2 !== 0; leader.rotation = .9 * .6 ** ring; leader.maxsize = 3 + ring * 6;
      leader.update(dt);
    }
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const leader of this.formations) leader.dispose();
    for (const timer of this.leaderTimers.values()) timer.stop(); this.leaderTimers.clear();
    this.waiting.clear(); this.flies.clear();
  }
}

type LightFlierComponents = ItemEntity['components'] & { health: Health; combat: Combat; homeseeker: HomeSeeker<LightFlierFlowerInstance>;
  knownlocations: KnownLocations; formationfollower: FormationFollower<LightFlierPlayer, LightFlier>; follower: Follower<LightFlierPlayer>;
  locomotor?: LocoMotor; sleeper?: Sleeper; freezable?: Freezable; burnable?: Burnable; propagator?: Propagator; hauntable?: Hauntable };

/**
 * lightflier.lua's inst: an inventory item whose components, stategraph (SGlightflier.lua) and brain
 * (lightflierbrain.lua) are its own. MakeLightFlier adds its creature components; the habitat binds its world.
 */
export class LightFlier extends ItemEntity implements LightFlierBrainInst, LocoMotorInst {
  declare readonly components: LightFlierComponents;
  declare brain: LightFlierBrain | undefined;
  locomotor!: LocoMotor;
  /** SetStateGraph("SGlightflier"). */
  stategraph!: LightFlierStateGraph;
  animstate!: AnimState;
  world!: BrainWorld;
  bornAt = 0;
  lastAttacked = -Infinity;
  habitat?: LightFlierHabitat;
  /** FindTarget's periodic task, from the habitat's attach on. */
  targetsearchtask?: EntityTask;
  targetSearchEnabled = false;
  erosion?: ErodeAway;
  erosionAmount = 0;
  readonly activeState = createSignal(true);
  readonly active = readonlySignal(this.activeState);
  asleephometask?: EntityTask;
  /** Physics:SetMotorVel's speed along the heading. */
  speed = 0;
  readonly cleanups: (() => void)[] = [];

  get home(): LightFlierFlowerInstance | undefined { return this.components.homeseeker.home; }
  get inFormation(): boolean { return this.components.formationfollower.formationleader !== undefined; }
  get facing(): number { return this.rotation; }
  get erosionValue(): number { return this.erosionAmount; }

  // conventions-allow instance-method: GetTime(), which the brain and its behaviours call on inst.
  getTime(): number { return this.habitat?.services.scheduler.now ?? 0; }
  // conventions-allow instance-method: math.random, which the brain's behaviours call on inst.
  random(): number { return Math.random(); }
  /** Transform:SetRotation; the motor velocity follows the heading. */
  // conventions-allow instance-method: the engine's Transform:SetRotation, which locomotor calls on inst.
  override setRotation(degrees: number): void { super.setRotation(degrees); syncMotor(this); }
  // conventions-allow instance-method: the engine's Physics:SetMotorVel, which locomotor calls on inst.
  setMotorSpeed(speed: number): void { this.speed = speed; syncMotor(this); }
  /** homeseeker:SetHome, with the home's position remembered as the wander centre. */
  // conventions-allow instance-method: childspawner:TakeOwnership calls it on the child.
  setHome(home?: LightFlierFlowerInstance): void {
    this.components.homeseeker.SetHome(home);
    if (home) this.components.knownlocations.RememberLocation('home', home.getPosition());
  }
}

/** In the world rather than held: the stategraph, brain and formation run only then. */
function inWorld(inst: LightFlier): boolean { return !inst.isRemoved && !inst.components.inventoryitem.owner; }
function isDead(inst: LightFlier): boolean { return inst.components.health.IsDead(); }

function syncMotor(inst: LightFlier): void {
  const body = inst.physicsBody;
  if (!body) return;
  const angle = inst.rotation * Math.PI / 180;
  body.velocity.x = Math.cos(angle) * inst.speed;
  body.velocity.z = -Math.sin(angle) * inst.speed;
}

/** lightflier.lua fn()'s creature: the sound emitter, ghost physics and the components that survive its world. */
export function MakeLightFlier(inst: LightFlier): void {
  if (inst.components.health) return;
  inst.AddSoundEmitter();
  MakeGhostPhysics(inst, 1, .5);
  addComponent(inst, 'health', Health, 25).OnLoad({ health: inst.lightflier?.health ?? 25 });
  addComponent(inst, 'combat', Combat, () => inst.getTime());
  addComponent(inst, 'homeseeker', HomeSeeker<LightFlierFlowerInstance>);
  addComponent(inst, 'knownlocations', KnownLocations);
  addComponent(inst, 'formationfollower', FormationFollower<LightFlierPlayer, LightFlier>);
  addComponent(inst, 'follower', Follower<LightFlierPlayer>);
  const saved = inst.lightflier;
  if (saved?.knownHome) inst.components.knownlocations.RememberLocation('home', new Vector3(...saved.knownHome));
  const follower = inst.components.formationfollower;
  follower.onenterformation = () => OnEnterFormation(inst);
  follower.onleaveformation = () => OnLeaveFormation(inst);
  // The inventory saves the lightflier's own record with its stack.
  inst.component(LIGHTFLIER_ID, () => ({ OnSave: () => LightFlierSave(inst), dispose: () => {} }));
  inst.ListenForEvent('attacked', OnAttacked);
  inst.ListenForEvent('teleported', () => follower.formationleader?.DisbandFormation());
  inst.ListenForEvent('death', () => follower.LeaveFormation());
  inst.ListenForEvent('gotosleep', GoToSleep);
  inst.ListenForEvent('onwakeup', OnWakeUp);
  inst.ListenForEvent('onputininventory', OnPutInInventory);
  inst.ListenForEvent('ondropped', OnDropped);
}

function OnEnterFormation(inst: LightFlier): void { inst.locomotor?.Stop(); inst.addTag('NOBLOCK'); }

function OnLeaveFormation(inst: LightFlier): void {
  const home = inst.home;
  if (home && inst.getPosition().distanceToSquared(home.getPosition()) > (28 * WORLD_SCALE) ** 2) {
    inst.PushEvent('detachchild'); inst.components.knownlocations.RememberLocation('home', inst.getPosition()); inst.setHome();
  }
  if (inst.locomotor) inst.locomotor.walkspeed = 3.5 * WORLD_SCALE;
  inst.removeTag('NOBLOCK'); inst.components.combat.DropTarget();
}

/** AlertFormation */
function OnAttacked(inst: LightFlier): void {
  WakeUp(inst);
  const follower = inst.components.formationfollower;
  const members = follower.formationleader?.members ?? [inst];
  for (const fly of members) fly.lastAttacked = inst.getTime() + Math.random();
  follower.formationleader?.DisbandFormation();
}

function GoToSleep(inst: LightFlier): void { inst.brain?.Pause(); SetFormationActive(inst, false, WORLD_SCALE); EnableBuzz(inst, false); }
function OnWakeUp(inst: LightFlier): void { if (!inst.components.freezable?.IsFrozen()) inst.brain?.Resume(); EnableBuzz(inst, true); }
function IsSleeping(inst: LightFlier): boolean { return inst.components.sleeper?.IsAsleep() ?? false; }
function WakeUp(inst: LightFlier): void { inst.components.sleeper?.WakeUp(); }

/** EnableBuzz: the fly_LP loop in the emitter's "loop" slot. */
function EnableBuzz(inst: LightFlier, enabled: boolean): void {
  const sound = inst.SoundEmitter!;
  if (!enabled || !inWorld(inst) || !inst.active.peek() || isDead(inst)) sound.KillSound('loop');
  else if (!sound.PlayingSound('loop')) sound.PlaySound(LIGHTFLIER_SOUNDS[0], 'loop');
}

/** Physics belongs to the logical item and survives replacing its display. */
export function BindLightFlierPhysics(inst: LightFlier, world?: import('cannon-es').World): void {
  inst.physics.SetActive(inst.active.peek());
  if (world) inst.bindPhysics(world, () => inst.getPosition());
}

/** SGlightflier's inst: the entity's AnimState, Physics, sleeper, buffered action and lootdropper. */
function stateContext(inst: LightFlier): LightFlierStateInst {
  return {
    get locomotor() { return inst.locomotor; },
    playAnimation: (name, loop) => inst.animstate.PlayAnimation(name, loop),
    pushAnimation: (name, loop) => inst.animstate.PushAnimation(name, loop),
    stopPhysics: () => inst.setMotorSpeed(0),
    performBufferedAction: () => inst.PerformBufferedAction() === true,
    clearBufferedAction: () => inst.ClearBufferedAction(),
    validHomeAction: () => {
      const target = inst.bufferedaction?.target;
      return target instanceof PrefabInstance && target.isValid() && !target.hasTag('fire') && !target.hasTag('burnt');
    },
    isDead: () => isDead(inst),
    isSleeping: () => IsSleeping(inst),
    wakeUp: () => WakeUp(inst),
    enableBuzz: enabled => EnableBuzz(inst, enabled),
    land: landed => { if (landed) inst.removeTag('flying'); else inst.addTag('flying'); },
    get SoundEmitter() { return inst.SoundEmitter!; },
    dropDeathLoot: () => DropDeathLoot(inst),
  };
}

/** The brain's TheWorld: simutil.lua FindEntity / GetClosestInstWithTag over TheSim; caves have no day. */
function CreateBrainWorld(inst: LightFlier): BrainWorld {
  // Transform:GetWorldPosition of the searcher, which the brain passes as a BrainEntity.
  const origin = new Vector3();
  const at = (from: BrainEntity) => { const { x, y, z } = from.getPosition(); return origin.set(x, y, z); };
  return {
    isDay: false, isAboveGroundAtPoint: () => true,
    // FindEntity skips the searcher and entities that are not visible, those in limbo among them.
    findEntity: (from, radius, fn, must, cant, oneOf) => inst.TheSim.FindEntities(at(from), radius, must, cant, oneOf)
      .find(entity => entity !== from && entity.IsVisible() && !entity.inlimbo && (!fn || fn(entity, from))),
    getClosestInstWithTag: (tags, from, radius) => {
      const [first, second] = inst.TheSim.FindEntities(at(from), radius, tags);
      return first !== from ? first : second;
    },
  };
}

/** The rest of fn() in the habitat's world: locomotor, SetStateGraph, SetBrain, the burnable and the day watch. */
function BindLightFlierWorld(inst: LightFlier, habitat: LightFlierHabitat, lengths: ReadonlyMap<string, number>): void {
  if (inst.habitat) return;
  inst.habitat = habitat; habitat.flies.add(inst);
  const services = habitat.services, scheduler = services.scheduler;
  inst.bornAt = scheduler.now - (inst.lightflier?.age ?? 0);
  inst.world = CreateBrainWorld(inst);
  inst.locomotor = addComponent(inst, 'locomotor', LocoMotor, { arriveDistance: .15 * WORLD_SCALE });
  inst.locomotor.walkspeed = inst.locomotor.runspeed = 3.5 * WORLD_SCALE;
  inst.animstate = new AnimState(scheduler, lengths, event => inst.PushEvent(event));
  if (!inst.worldServices?.scheduler) inst.BindScheduler(scheduler);
  inst.stategraph = new LightFlierStateGraph(stateContext(inst), scheduler);
  inst.SetStateGraph(() => inst.stategraph.sg);
  inst.SetBrain(fly => new LightFlierBrain(fly, WORLD_SCALE));
  inst.targetSearchEnabled = true;
  inst.erosion = new ErodeAway(scheduler, amount => { inst.erosionAmount = amount; }, () => inst.remove());
  addComponent(inst, 'freezable', Freezable, scheduler);
  const burnable = addComponent(inst, 'burnable', Burnable, scheduler);
  burnable.canlight = false; burnable.SetBurnTime(6 * 4 / 3);
  addComponent(inst, 'propagator', Propagator, 'small', () => [], WORLD_SCALE, scheduler, services.getWatchWorldContent).acceptsheat = false;
  const hauntable = addComponent(inst, 'hauntable', Hauntable, scheduler);
  hauntable.panicable = true; hauntable.SetOnHauntFn(() => { WakeUp(inst); hauntable.Panic(3); inst.brain?.ForceUpdate(); return true; });
  inst.onRemove(() => {
    habitat.flies.delete(inst);
    inst.animstate.dispose(); inst.erosion?.dispose(); inst.SoundEmitter?.KillSound('loop');
    for (const stop of inst.cleanups.splice(0)) stop();
  });
  if (services.getWatchWorldContent) {
    addComponent(inst, 'sleeper', Sleeper, services.getWatchWorldContent).sleeptestfn = () => false;
    inst.addTag('sleeper');
    const activity = inst.transform.getTileActivity(services.tickingarea, stop => inst.cleanups.push(stop));
    const cycle = services.getWatchWorldContent(WorldContentKey.Cycle, stop => inst.cleanups.push(stop), activity ? { active: activity } : undefined);
    const area = activity ? watchSignal(activity, stop => inst.cleanups.push(stop)) : undefined;
    createEffect(() => {
      const active = area?.get() ?? true, day = cycle.get() === 'day';
      SetActive(inst, active);
      if (!active && day && inWorld(inst)) {
        inst.asleephometask ??= inst.DoTaskInTime(10 + inst.random(), OnSleepGoHome);
      } else { inst.asleephometask?.Cancel(); inst.asleephometask = undefined; }
    });
  }
  if (inWorld(inst)) {
    if (inst.active.peek()) { StartLookingForTarget(inst); EnableBuzz(inst, true); } else inst.brain?.Pause();
  } else OnPutInInventory(inst);
}

function OnSleepGoHome(inst: LightFlier): void {
  inst.asleephometask = undefined;
  if (!inst.active.peek() && inst.home?.isValid()) inst.home.components.childspawner.GoHome(inst);
}

function StartLookingForTarget(inst: LightFlier): void {
  if (!inst.targetSearchEnabled) return;
  StopLookingForTarget(inst);
  inst.targetsearchtask = inst.DoPeriodicTask(1, FindTarget);
}
function StopLookingForTarget(inst: LightFlier): void { inst.targetsearchtask?.Cancel(); inst.targetsearchtask = undefined; }
function FindTarget(inst: LightFlier): void {
  inst.habitat!.findFormation(inst);
  if (!inWorld(inst)) StopLookingForTarget(inst);
}

/** OnEntitySleep / OnEntityWake as the fly's tile activity reports them. */
function SetActive(inst: LightFlier, active: boolean): void {
  if (inst.active.peek() === active) return;
  inst.activeState.set(active);
  inst.physics.SetActive(active);
  const follower = inst.components.formationfollower;
  if (!active) {
    follower.LeaveFormation(); follower.StopUpdating(); StopLookingForTarget(inst); inst.brain?.Pause(); EnableBuzz(inst, false);
  } else if (inWorld(inst)) {
    follower.StartUpdating(); StartLookingForTarget(inst);
    if (!inst.components.freezable?.IsFrozen() && !IsSleeping(inst)) inst.brain?.Resume(); EnableBuzz(inst, true);
  }
}

/** SGlightflier's death: the lightbulb drops and the body erodes away. */
function DropDeathLoot(inst: LightFlier): void {
  inst.persists = false; inst.addTag('dead'); inst.components.workable?.SetWorkable(false);
  inst.addTag('NOCLICK');
  inst.brain?.Stop(); StopLookingForTarget(inst); inst.habitat?.services.dropLoot('lightbulb', 1, inst.getPosition().clone());
  inst.erosion?.start(2);
}

function OnPutInInventory(inst: LightFlier): void {
  inst.physics.SetActive(false);
  inst.home?.components.childspawner.OnChildKilled(inst); inst.setHome();
  StopLookingForTarget(inst); inst.components.formationfollower.LeaveFormation(); inst.components.formationfollower.StopUpdating();
  inst.locomotor?.Stop(); inst.ClearBufferedAction(); inst.animstate?.stop();
  inst.components.sleeper?.StopTesting(); EnableBuzz(inst, false); inst.components.perishable.StartPerishing();
}

function OnDropped(inst: LightFlier): void {
  inst.physics.Teleport(); inst.physics.SetActive(inst.active.peek());
  inst.components.perishable.StopPerishing(); inst.components.workable?.SetWorkLeft(1);
  inst.components.knownlocations.RememberLocation('home', inst.getPosition());
  inst.components.formationfollower.StartUpdating(); inst.stategraph?.goToState('idle');
  if (!inst.active.peek()) inst.brain?.Pause();
  StartLookingForTarget(inst); inst.components.sleeper?.StartTesting(); EnableBuzz(inst, true);
}

/** One frame: the brain, the formation's FollowerOnUpdate, the locomotor, the stategraph and the motor. */
export function UpdateLightFlier(inst: LightFlier, dt: number): void {
  if (!inWorld(inst) || !inst.active.peek()) return;
  const body = inst.physicsBody;
  if (body) inst.setPosition(body.position.x, 0, body.position.z);
  const step = Math.max(0, Math.min(dt, inst.habitat?.services.maxMovementStep ?? .1));
  if (!isDead(inst)) {
    inst.brain?.tick(inst.getTime());
    const follower = inst.components.formationfollower;
    if (follower.updating && follower.targetpos && !inst.stategraph.hasStateTag('busy')) {
      const target = follower.targetpos, p = inst.getPosition();
      inst.locomotor.walkspeed = Math.min(p.distanceTo(target) * 8, 10.5 * WORLD_SCALE);
      inst.setRotation(inst.GetAngleToPoint(target.x, target.y, target.z));
      if (!inst.locomotor.isUpdating) inst.locomotor.WalkForward(true);
    }
    if (inst.locomotor.isUpdating) inst.locomotor.update(step);
  }
  inst.stategraph.update(dt);
  inst.erosion?.update();
  if (!inst.stategraph.hasStateTag('busy') && inst.speed > 0) {
    const angle = inst.rotation * Math.PI / 180;
    if (body) syncMotor(inst);
    else inst.transform.offsetPosition(Math.cos(angle) * inst.speed * step, 0, -Math.sin(angle) * inst.speed * step);
  }
}

function LightFlierSave(inst: LightFlier): NonNullable<InventoryStack['lightflier']> {
  const known = inst.components.knownlocations.GetLocation('home');
  return { health: inst.components.health.currenthealth, age: inst.habitat ? inst.getTime() - inst.bornAt : inst.lightflier?.age ?? 0,
    ...(inst.home ? { homeId: String(inst.home.entityId) } : {}), ...(known ? { knownHome: [known.x, known.y, known.z] } : {}) };
}


/** The inventory item's side of lightflier.lua: tags, the NET workable, the VEGGIE eater and perishing while held. */
export function configureLightFlierEntity(entity: ItemEntity): void {
  for (const tag of LIGHTFLIER_TAGS) entity.addTag(tag);
  entity.components.inventoryitem.canbepickedup = false; entity.components.inventoryitem.canbepickedupalive = true;
  if (!entity.components.workable) {
    const workable = addComponent(entity, 'workable', Workable); workable.SetWorkAction('NET'); workable.SetWorkLeft(1);
    workable.SetOnFinishCallback((_inst, worker) => {
      if (entity instanceof LightFlier) entity.home?.components.childspawner.OnChildKilled(entity);
      worker.components?.inventory?.GiveItem?.(entity, entity.getPosition().clone());
    });
  }
  const eater = addComponent(entity, 'eater', Eater); eater.SetDiet(['VEGGIE']);
  eater.SetOnEatFn(() => entity.components.perishable.SetPercent(1));
  const perishable = entity.components.perishable;
  if (perishable.perishtime.peek() === undefined) perishable.SetPerishTime(LIGHTFLIER_PERISH_TIME);
  perishable.localMultiplier = () => entity.components.inventoryitem.owner ? 1 : 0;
  perishable.perishfn = () => {
    const owner = entity.components.inventoryitem.owner; if (!owner) return;
    owner.PushEvent('murdered', { victim: entity, stackmult: entity.components.stackable.count, negligent: true });
    // Guaranteed one lightbulb per insect, so replacement retains exactly the original stack size.
    entity.components.inventoryitem.slot?.replace('lightbulb');
  };
  if (!entity.components.inventoryitem.owner) perishable.StopPerishing();
}

/**
 * lightflier.lua: the habitat binds the insect's brain, stategraph and formations; its stategraph drives the sprite, and
 * it glows while it flies in the world.
 */
export function lightflierPrefabs(world: ItemPrefabWorld): Record<string, ItemPrefabDefinition> {
  return {
    [LIGHTFLIER_ID]: {
      fn: () => {
        const inst = world.newItem(LIGHTFLIER_ID, (...item) => new LightFlier(...item));
        inst.sprite.resetPresentation({ name: 'walk_loop', billboard: true });
        bindItemWorld(inst, world);
        return inst;
      },
      assets: { animationArchive: 'lightflier.zip', buildArchives: ['lightflier.zip'], bank: 'lightflier' },
      onSpawned: inst => {
        if (!(inst instanceof LightFlier)) return;
        MakeLightFlier(inst);
        world.configureItem(inst);
        configureLightFlierEntity(inst);
        const fly = inst, sprite = inst.sprite;
        const habitat = world.lightflierWorld;
        habitat?.bind(fly);
        if (fly.animstate) {
          const animation = watchSignal(fly.animstate.animation, stop => inst.onRemove(stop));
          createEffect(() => { const { name, loop } = animation.get(); inst.AnimState.PlayAnimation(name, loop); });
        }
        BindLightFlierPhysics(fly, world.physics);
        inst.ListenForEvent('ondropped', () => dropStackIndividually(inst, world));
        sprite.setLightOverride(1);
        const heading = habitat?.services.cameraHeading ? watchSignal(habitat.services.cameraHeading, stop => inst.onRemove(stop)) : undefined;
        // Facing and erosion change the sprite json only when their value does.
        let facing: number | undefined, erosion: number | undefined;
        inst.onRemove(world.componentUpdates.register({
          OnUpdate: dt => {
            if (inst.status.peek() !== 'active' || !fly.active.peek()) return;
            UpdateLightFlier(fly, dt);
            const nextFacing = fourFacingFromRotation(fly.facing, heading?.peek() ?? 0);
            if (nextFacing !== facing) sprite.setFacing(facing = nextFacing);
            const nextErosion = fly.erosionValue;
            if (nextErosion !== erosion) sprite.setErosion(erosion = nextErosion);
            inst.light.set(inWorld(fly) ? { radius: 1.8 * WORLD_SCALE, intensity: .5, falloff: .7, colour: [237 / 255, 237 / 255, 209 / 255] } : null);
          },
        }));
      },
    },
  };
}

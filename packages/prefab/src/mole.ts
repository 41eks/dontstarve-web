import type { EntityEventData } from '../../componets/src/entityEvents';
import { addComponent } from './components';
import { Vector3 } from 'three';
import { createEffect, WorldContentKey, watchSignal, type ReadonlySignal, type WorldContentContext } from '@dontstarve-web/signals';
import { ItemEntity, type InventoryStack } from '@dontstarve-web/inventory';
import { fourFacingFromRotation } from '@dontstarve-web/animation/facing';
import { Eater } from '../../componets/src/eater';
import { Sleeper } from '../../componets/src/sleeper';
import { Health } from '../../componets/src/health';
import { Combat } from '../../componets/src/combat';
import { Inventory } from '../../componets/src/inventory';
import { HomeSeeker } from '../../componets/src/homeseeker';
import { KnownLocations } from '../../componets/src/knownlocations';
import { LocoMotor, type LocoMotorInst, type LocoMotorPathfinder } from '../../componets/src/locomotor';
import { AnimState } from '../../componets/src/animstate';
import type { EntityTask } from './prefabInstance';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { MoleBrain, type MoleBrainInst } from '../../brains/src/molebrain';
import type { BrainEntity, BrainWorld } from '../../brains/src/types';
import { MoleStateGraph, type MoleStateInst } from '../../stategraphs/src/SGmole';
import type { MolehillInstance } from './molehill';
import type { ItemPrefabWorld } from './groundPrefab';
import { bindItemWorld, type ItemPrefabDefinition } from './groundItems';
import { PlaySound, type SoundEventPath } from './sound';
import { WORLD_SCALE, MakeCharacterPhysics, CHARACTER_COLLISION_MASK } from './standardcomponents';
import { animationLengths } from './animationTimings';
import { COLLISION } from '../../componets/src/physicsState';

export const MOLE_ID = 'mole' as const;
export const MOLE_PERISH_TIME = 960;
const MOLE_ANIMATION_LENGTHS = animationLengths('mole_basic.zip');
export type MoleSave = NonNullable<InventoryStack['mole']>;
const SOUND_PREFIX = 'dontstarve_DLC001/creatures/mole/';
export const MOLE_SOUNDS = ['death', 'emerge', 'emerge_voice', 'hurt', 'move', 'retract', 'jump', 'pickup', 'sniff', 'sleep']
  .map(name => `${SOUND_PREFIX}${name}` as SoundEventPath);
export interface MoleWorld extends Pick<WorldContentContext, 'getWatchWorldContent'> {
  itemSpecs?: Readonly<Record<string, Pick<import('@dontstarve-web/inventory').InventoryItemSpec, 'maxStack'>>>;
  cameraHeading: ReadonlySignal<number>;
  getMoles(): readonly Mole[];
  isWalkable(position: Vector3): boolean;
  /** TheWorld.Pathfinder. */
  pathfinder?: LocoMotorPathfinder;
  spawnItem(state: InventoryStack): ItemEntity;
  dropItem(item: ItemEntity, position: Vector3): void;
  dropLoot(prefab: string, position: Vector3): void;
  makeHome(mole: Mole): MolehillInstance;
  registerMole(mole: Mole): () => void;
  spawnMoveFx(position: Vector3): void;
}

type MoleComponents = ItemEntity['components'] & { health: Health; combat: Combat; knownlocations: KnownLocations;
  homeseeker: HomeSeeker<MolehillInstance>; inventory?: Inventory; locomotor?: LocoMotor; sleeper?: Sleeper };

/**
 * mole.lua's inst: an inventory item whose components, stategraph (SGmole.lua) and brain (molebrain.lua) are its own.
 * MakeMole adds its creature components; BindMoleWorld the rest of fn() once the moles' world is known.
 */
export class Mole extends ItemEntity implements MoleBrainInst, LocoMotorInst {
  declare readonly components: MoleComponents;
  declare brain: MoleBrain | undefined;
  world!: BrainWorld;
  locomotor!: LocoMotor;
  /** SetStateGraph("SGmole"). */
  stategraph!: MoleStateGraph;
  animstate!: AnimState;
  isunder = true;
  needs_home_time: number | undefined;
  make_home_delay = 5;
  last_above_time = 0;
  peek_interval = 15;
  flee = false;
  bornAt = 0;
  /** mole.lua: ACTIONS.GOHOME pushes onwenthome, which OnWentHome handles. */
  readonly force_onwenthome_message = true;
  /** In its molehill: spawner:GoHome took it out of the world. */
  occupied = false;
  moleWorld?: MoleWorld;
  moleScheduler?: GameTimeScheduler;
  saved?: MoleSave;
  dropPending = false;
  /** Physics:SetMotorVel's speed along the heading. */
  speed = 0;
  readonly cleanups: (() => void)[] = [];
  stopfleetask?: EntityTask;
  homechecktask?: EntityTask;
  /** SGmole stunned's sg.statemem.playtask / killtask. */
  playtask?: EntityTask;
  killtask?: EntityTask;
  stateTags = new Set<string>();
  randomSource: () => number = Math.random;

  get home(): MolehillInstance | undefined { return this.components.homeseeker.home; }
  get facing(): number { return this.rotation; }

  // conventions-allow instance-method: GetTime(), which the brain and its behaviours call on inst.
  getTime(): number { return this.moleScheduler?.now ?? 0; }
  // conventions-allow instance-method: math.random, which the brain's behaviours call on inst.
  random(): number { return this.randomSource(); }
  /** Transform:SetRotation; the motor velocity follows the heading. */
  // conventions-allow instance-method: the engine's Transform:SetRotation, which locomotor calls on inst.
  override setRotation(degrees: number): void { super.setRotation(degrees); syncMotor(this); }
  // conventions-allow instance-method: the engine's Physics:SetMotorVel, which locomotor calls on inst.
  setMotorSpeed(speed: number): void { this.speed = speed; syncMotor(this); }
  /** homeseeker:SetHome, with the hill's position remembered. */
  // conventions-allow instance-method: spawner:TakeOwnership calls it on the child.
  setHome(home?: MolehillInstance): void {
    this.components.homeseeker.SetHome(home);
    if (home) this.components.knownlocations.RememberLocation('home', home.getPosition());
  }
  /** spawner:GoHome's child:RemoveFromScene, as the mole stops in its hill. */
  // conventions-allow instance-method: spawner:GoHome calls it on the child.
  enterHome(): void {
    this.physics.SetActive(false); this.occupied = true; this.addTag('INLIMBO'); this.brain?.Stop(); this.locomotor.Stop();
    this.animstate.stop(); this.stategraph.pause(); this.components.sleeper?.StopTesting(); StopSounds(this); this.components.homeseeker.SetHome();
  }
  /** spawner:ReleaseChild's child:ReturnToScene beside the hill. */
  // conventions-allow instance-method: spawner:ReleaseChild calls it on the child.
  leaveHome(): void {
    this.occupied = false; this.removeTag('INLIMBO'); const home = this.home!;
    const angle = this.random() * Math.PI * 2;
    const position = home.getPosition();
    this.setPosition(position.x + Math.cos(angle) * WORLD_SCALE, position.y, position.z - Math.sin(angle) * WORLD_SCALE);
    this.physics.Teleport(); this.physics.SetActive(true);
    this.stategraph.resume(); this.stategraph.goToState('idle'); this.brain?.Start(); this.components.sleeper?.StartTesting();
  }
  /** ACTIONS.MAKEMOLEHILL's fn. */
  // conventions-allow instance-method: ACTIONS.MAKEMOLEHILL's fn, which the brain's action runs for inst.
  makeHome(): boolean { this.moleWorld!.makeHome(this); this.needs_home_time = undefined; return true; }
}

/** In the world rather than held or in its hill. */
function inWorld(inst: Mole): boolean { return !inst.isRemoved && !inst.occupied && !inst.components.inventoryitem.owner; }
function isDead(inst: Mole): boolean { return inst.components.health.IsDead(); }

function syncMotor(inst: Mole): void {
  const body = inst.physicsBody;
  if (!body) return;
  const angle = inst.rotation * Math.PI / 180;
  body.velocity.x = Math.cos(angle) * inst.speed;
  body.velocity.z = -Math.sin(angle) * inst.speed;
}

/** mole.lua fn()'s creature: the sound emitter, physics, health, combat, knownlocations and homeseeker. */
export function MakeMole(inst: Mole, random: () => number = Math.random): void {
  if (inst.components.health) return;
  inst.randomSource = random;
  inst.AddSoundEmitter();
  MakeCharacterPhysics(inst, 99999, .5);
  inst.make_home_delay = 5 + Math.floor(inst.random() * 6); inst.peek_interval = 15 + Math.floor(inst.random() * 11);
  addComponent(inst, 'health', Health, 30).OnLoad({ health: inst.mole?.health ?? 30 });
  inst.saved = inst.mole;
  addComponent(inst, 'combat', Combat, () => inst.getTime());
  addComponent(inst, 'knownlocations', KnownLocations);
  addComponent(inst, 'homeseeker', HomeSeeker<MolehillInstance>);
  // The inventory saves the mole's own record with its stack.
  inst.component(MOLE_ID, () => ({ OnSave: () => MoleOnSave(inst), dispose: () => {} }));
  inst.ListenForEvent('ondropped', ondrop);
  inst.ListenForEvent('onputininventory', onpickup);
  inst.ListenForEvent('onwenthome', OnWentHome);
  inst.onRemove(() => {
    inst.animstate?.dispose(); StopSounds(inst); StopStunnedSounds(inst);
    inst.cleanups.splice(0).forEach(stop => stop());
  });
}

/** Physics belongs to the logical item and survives replacing its display. */
export function BindMolePhysics(inst: Mole, world?: import('cannon-es').World): void {
  if (inst.isunder) SetUnderPhysics(inst); else SetAbovePhysics(inst);
  inst.physics.SetActive(inWorld(inst));
  if (world) inst.bindPhysics(world, () => inst.getPosition());
}

export function SetUnderPhysics(inst: Mole): void {
  inst.isunder = true; inst.addTag('notdrawable');
  inst.physics.SetCollisionGroup(COLLISION.CHARACTERS);
  inst.physics.SetCollisionMask(COLLISION.WORLD, COLLISION.OBSTACLES);
}
export function SetAbovePhysics(inst: Mole): void {
  inst.isunder = false; inst.removeTag('notdrawable');
  inst.physics.SetCollisionGroup(COLLISION.CHARACTERS);
  inst.physics.SetCollisionMask(...CHARACTER_COLLISION_MASK);
}

/** SGmole's inst: the entity's AnimState, Physics, SoundEmitter, inventory, lootdropper and buffered action. */
function stateContext(inst: Mole): MoleStateInst {
  return {
    get locomotor() { return inst.locomotor; },
    get isunder() { return inst.isunder; },
    get last_above_time() { return inst.last_above_time; },
    set last_above_time(time) { inst.last_above_time = time; },
    get peek_interval() { return inst.peek_interval; },
    set peek_interval(interval) { inst.peek_interval = interval; },
    getTime: () => inst.getTime(),
    random: () => inst.random(),
    setUnder: () => SetUnderPhysics(inst),
    setAbove: () => SetAbovePhysics(inst),
    stopPhysics: () => inst.setMotorSpeed(0),
    playAnimation: (name, loop) => inst.animstate.PlayAnimation(name, loop),
    pushAnimation: (name, loop) => inst.animstate.PushAnimation(name, loop),
    performBufferedAction: () => inst.PerformBufferedAction() === true,
    clearBufferedAction: () => inst.ClearBufferedAction(),
    get SoundEmitter() { return inst.SoundEmitter!; },
    dropInventory: () => DropInventory(inst),
    dropDeathLoot: () => { inst.persists = false; inst.moleWorld?.dropLoot('smallmeat', inst.getPosition().clone()); },
    setPickup: enabled => { inst.components.inventoryitem.canbepickedup = enabled; },
    startStunnedSounds: skippre => StartStunnedSounds(inst, skippre),
    stopStunnedSounds: () => StopStunnedSounds(inst),
    spawnMoveFx: () => inst.moleWorld?.spawnMoveFx(inst.getPosition()),
    onAttacked: data => OnAttacked(inst, data as EntityEventData['attacked']),
    isDead: () => isDead(inst),
    remove: () => inst.remove(),
  };
}

/** The rest of fn() in the moles' world: inventory, locomotor, SetStateGraph, SetBrain, the home test and the sleeper. */
export function BindMoleWorld(inst: Mole, services: MoleWorld, lengths: ReadonlyMap<string, number> = MOLE_ANIMATION_LENGTHS): void {
  if (inst.moleWorld) return;
  inst.moleWorld = services;
  inst.cleanups.push(services.registerMole(inst));
  const { getWatchWorldContent } = services;
  const cycle = getWatchWorldContent(WorldContentKey.Cycle, stop => inst.cleanups.push(stop));
  const { scheduler } = cycle;
  inst.moleScheduler = scheduler; inst.bornAt = inst.getTime();
  // Transform:GetWorldPosition of the searcher, which the brain passes as a BrainEntity.
  const origin = new Vector3();
  const at = (from: BrainEntity) => { const { x, y, z } = from.getPosition(); return origin.set(x, y, z); };
  inst.world = {
    get isDay() { return cycle.peek() === 'day'; },
    isAboveGroundAtPoint: (x, y, z) => services.isWalkable(new Vector3(x, y, z)),
    // simutil.lua FindEntity over TheSim: it skips the searcher and entities that are not visible, those in limbo among them.
    findEntity: (from, radius, fn, must, cant, oneOf) => inst.TheSim.FindEntities(at(from), radius, must, cant, oneOf)
      .find(entity => entity !== from && entity.IsVisible() && !entity.inlimbo && (!fn || fn(entity, from))),
    getClosestInstWithTag: (tags, from, radius) => {
      const [first, second] = inst.TheSim.FindEntities(at(from), radius, tags);
      return first !== from ? first : second;
    },
  };
  addComponent(inst, 'inventory', Inventory, 3, services.dropItem, services.itemSpecs).OnLoad(inst.saved?.items ?? [], services.spawnItem);
  inst.locomotor = addComponent(inst, 'locomotor', LocoMotor, { arriveDistance: .15 * WORLD_SCALE, pathfinder: services.pathfinder, pathcaps: { ignorecreep: true, ignorebridges: true } });
  inst.locomotor.walkspeed = 2.75 * WORLD_SCALE; inst.locomotor.runspeed = 6 * WORLD_SCALE;
  inst.animstate = new AnimState(scheduler, lengths, event => inst.PushEvent(event));
  if (!inst.worldServices?.scheduler) inst.BindScheduler(scheduler);
  inst.stategraph = new MoleStateGraph(stateContext(inst), scheduler);
  inst.SetStateGraph(() => inst.stategraph.sg);
  inst.stategraph.sg.onNewState(() => SyncStateTags(inst)); SyncStateTags(inst);
  inst.SetBrain(mole => new MoleBrain(mole, WORLD_SCALE));
  if (!inWorld(inst)) inst.brain?.Stop();
  inst.homechecktask = inst.DoTaskInTime(inst.make_home_delay, TestForMakeHome);
  if (inst.saved?.needsHomeElapsed !== undefined) inst.needs_home_time = inst.getTime() - inst.saved.needsHomeElapsed;
  inst.saved = undefined;
  addComponent(inst, 'sleeper', Sleeper, getWatchWorldContent, inst.randomSource, WORLD_SCALE).SetNocturnal(true);
  inst.addTag('sleeper');
  if (inWorld(inst) && inst.dropPending) ondrop(inst);
  createEffect(() => { cycle.get(); inst.brain?.ForceUpdate(); });
}

/** TestForMakeHome */
function TestForMakeHome(inst: Mole): void { if (!inst.home?.isValid()) inst.needs_home_time = inst.getTime(); }

/** The stategraph's tags the source's other code reads as entity tags. */
function SyncStateTags(inst: Mole): void {
  for (const tag of inst.stateTags) inst.removeTag(tag);
  inst.stateTags = new Set(['noattack', 'noelectrocute', 'busy', 'sleeping', 'canwxscan', 'canelectrocute'].filter(tag => inst.stategraph.hasStateTag(tag)));
  for (const tag of inst.stateTags) inst.addTag(tag);
}

/** OnSleep / OnRemove: SoundEmitter:KillAllSounds(). */
function StopSounds(inst: Mole): void { inst.SoundEmitter?.KillAllSounds(); }
function StartStunnedSounds(inst: Mole, skippre: boolean): void {
  const delay = skippre ? 0 : inst.animstate.length;
  const sound = inst.SoundEmitter!;
  // SGmole stunned: DoPeriodicTask(23 * FRAMES, PlayStunnedSound / KillStunnedSound).
  inst.playtask?.Cancel(); inst.killtask?.Cancel();
  inst.playtask = inst.DoPeriodicTask(23 / 30, () => {
    if (!sound.PlayingSound('stunned')) sound.PlaySound(`${SOUND_PREFIX}sleep` as SoundEventPath, 'stunned');
  }, delay);
  inst.killtask = inst.DoPeriodicTask(23 / 30, () => sound.KillSound('stunned'), delay + 11 / 30);
}
function StopStunnedSounds(inst: Mole): void {
  inst.playtask?.Cancel(); inst.playtask = undefined;
  inst.killtask?.Cancel(); inst.killtask = undefined;
  inst.SoundEmitter?.KillSound('stunned');
}
function DropInventory(inst: Mole): void { inst.components.inventory?.DropEverything(); }

function OnAttacked(inst: Mole, data: EntityEventData['attacked']): void {
  inst.flee = true;
  inst.stopfleetask?.Cancel();
  inst.stopfleetask = inst.DoTaskInTime(3 + Math.floor(inst.random() * 4), () => { inst.flee = false; });
  let count = 0;
  for (const mole of inst.moleWorld!.getMoles()) if (mole.getPosition().distanceToSquared(inst.getPosition()) <= (30 * WORLD_SCALE) ** 2) {
    mole.PushEvent('gohome'); if (++count > 5) break;
  }
  const weapon = data.weapon;
  if (weapon?.hasTag('hammer')) { DropInventory(inst); if (!isDead(inst)) inst.stategraph.goToState('stunned'); }
  else if (weapon && !isDead(inst) && !inst.stategraph.hasStateTag('busy')) inst.stategraph.goToState('hit');
}

/** OnWentHome: the stolen items go into the molehill, and the mole stops in idle. */
function OnWentHome(inst: Mole): void {
  const molehill = inst.home;
  if (!molehill) return;
  inst.components.inventory?.TransferInventory(molehill);
  inst.stategraph.goToState('idle');
}

/** OnHomeDugUp */
export function OnHomeDugUp(inst: Mole): void {
  inst.needs_home_time = inst.getTime(); DropInventory(inst); if (!isDead(inst)) inst.stategraph.goToState('stunned');
}

function onpickup(inst: Mole): void {
  inst.physics.SetActive(false);
  inst.PushEvent('ontrapped'); inst.components.homeseeker.SetHome(); inst.components.sleeper?.StopTesting(); inst.brain?.Stop(); inst.locomotor?.Stop(); inst.ClearBufferedAction();
  inst.stategraph?.goToState('idle'); inst.stategraph?.pause(); inst.animstate?.stop(); StopStunnedSounds(inst); StopSounds(inst);
  inst.components.perishable.StartPerishing();
}

function ondrop(inst: Mole): void {
  inst.physics.Teleport(); inst.physics.SetActive(true);
  inst.dropPending = true;
  inst.components.perishable.StopPerishing(); StopSounds(inst);
  if (inst.stategraph) {
    inst.dropPending = false; inst.stategraph.resume(); inst.stategraph.goToState('stunned', true); inst.brain?.Start(); inst.components.sleeper?.StartTesting();
  }
  if (!inst.home?.isValid()) inst.needs_home_time = inst.getTime();
}

/** One frame: the brain, the locomotor, the stategraph and the motor, which stops at the walkable edge. */
export function UpdateMole(inst: Mole, dt: number): void {
  if (!inWorld(inst) || isDead(inst)) return;
  const body = inst.physicsBody;
  if (body) inst.setPosition(body.position.x, 0, body.position.z);
  inst.brain?.tick(inst.getTime()); if (inst.locomotor.isUpdating) inst.locomotor.update(dt); inst.stategraph.update(dt);
  if (inst.speed > 0) {
    const angle = inst.rotation * Math.PI / 180;
    const p = inst.getPosition().clone().add(new Vector3(Math.cos(angle) * inst.speed * dt, 0, -Math.sin(angle) * inst.speed * dt));
    if (inst.moleWorld!.isWalkable(p)) {
      if (body) syncMotor(inst); else inst.setPosition(p.x, p.y, p.z);
    } else inst.locomotor.Stop();
  }
}

/** mole.lua OnSave: needs_home_time as the time elapsed since it was set, with health and the stolen items. */
function MoleOnSave(inst: Mole): MoleSave {
  return { health: inst.components.health.currenthealth,
    ...(inst.needs_home_time === undefined ? inst.saved?.needsHomeElapsed === undefined ? {} : { needsHomeElapsed: inst.saved.needsHomeElapsed }
      : { needsHomeElapsed: inst.getTime() - inst.needs_home_time }),
    items: inst.components.inventory?.OnSave() ?? inst.saved?.items ?? [] };
}


/** The inventory item's side of mole.lua: tags, the ELEMENTAL eater and perishing while held. */
export function configureMoleEntity(entity: ItemEntity): void {
  for (const tag of ['animal', 'prey', 'mole', 'smallcreature', 'canbetrapped', 'baitstealer', 'cattoy', 'catfood', 'whackable', 'stunnedbybomb', 'cookable', 'small_livestock', 'show_spoilage']) entity.addTag(tag);
  if (entity.components.eater) return;
  entity.components.inventoryitem.canbepickedup = false; entity.components.inventoryitem.canbepickedupalive = true;
  const eater = addComponent(entity, 'eater', Eater);
  eater.SetDiet(['ELEMENTAL']); eater.SetOnEatFn(() => entity.components.perishable.SetPercent(1));
  const perishable = entity.components.perishable;
  if (perishable.perishtime.peek() === undefined) perishable.SetPerishTime(MOLE_PERISH_TIME);
  perishable.localMultiplier = () => entity.components.inventoryitem.owner ? 1 : 0;
  perishable.perishfn = () => {
    const owner = entity.components.inventoryitem.owner;
    if (owner) { owner.PushEvent('murdered', { victim: entity, stackmult: 1, negligent: true }); PlaySound(`${SOUND_PREFIX}death`); owner.replace('smallmeat'); }
  };
  if (!entity.components.inventoryitem.owner) perishable.StopPerishing();
}
/** mole.lua: the mole's stategraph drives its sprite, and its brain and locomotion run while it is awake in the world. */
export function molePrefabs(world: ItemPrefabWorld): Record<string, ItemPrefabDefinition> {
  return {
    [MOLE_ID]: {
      fn: () => {
        const inst = world.newItem(MOLE_ID, (...item) => new Mole(...item));
        inst.sprite.resetPresentation({ name: 'idle_under', billboard: true });
        bindItemWorld(inst, world);
        return inst;
      },
      assets: { animationArchive: 'mole_basic.zip', buildArchives: ['mole_build.zip'], bank: 'mole' },
      onSpawned: inst => {
        const moleWorld = world.moleWorld;
        if (!moleWorld) throw new Error('Mole world is unavailable');
        if (!(inst instanceof Mole)) return;
        MakeMole(inst);
        world.configureItem(inst);
        configureMoleEntity(inst);
        const mole = inst, sprite = inst.sprite;
        BindMoleWorld(mole, moleWorld);
        const animation = watchSignal(mole.animstate.animation, stop => inst.onRemove(stop));
        createEffect(() => { const { name, loop } = animation.get(); inst.AnimState.PlayAnimation(name, loop); });
        BindMolePhysics(mole, world.physics);
        const heading = watchSignal(moleWorld.cameraHeading, stop => inst.onRemove(stop));
        // Visibility and facing change the sprite json only when their value does.
        let visible: boolean | undefined, facing: number | undefined;
        inst.onRemove(world.componentUpdates.register({
          OnUpdate: dt => {
            if (inst.status.peek() !== 'active') return;
            UpdateMole(mole, dt);
            const nextVisible = inWorld(mole);
            if (nextVisible !== visible) sprite.setVisible(visible = nextVisible);
            const nextFacing = fourFacingFromRotation(mole.facing, heading.peek());
            if (nextFacing !== facing) sprite.setFacing(facing = nextFacing);
          },
        }));
      },
    },
  };
}

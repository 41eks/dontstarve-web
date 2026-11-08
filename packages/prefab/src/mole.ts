import { addComponent } from './components';
import { Vector3 } from 'three';
import { createEffect, WorldContentKey, watchSignal, type ReadonlySignal, type WorldContentContext } from '@dontstarve-web/signals';
import type { ItemEntity, InventoryStack } from '@dontstarve-web/inventory';
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
import type { BufferedAction } from '../../stategraphs/src/bufferedaction';
import type { MolehillInstance } from './molehill';
import type { ItemPrefabWorld } from './groundPrefab';
import { bindItemWorld, type ItemPrefabDefinition } from './groundItems';
import { PlaySound, type SoundEventPath } from './sound';
import type { SoundEmitter } from './soundEmitter';
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
  getEntities(): readonly BrainEntity[];
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

/** mole.lua: the logical inst survives pickup, dropping and replacement of its visual. */
export class Mole implements MoleBrainInst, MoleStateInst, LocoMotorInst {
  readonly prefab = MOLE_ID;
  /** The mole is the Lua inst its components see; they are stored on, and torn down with, the item entity. */
  get components(): MoleComponents { return this.entity.components as MoleComponents; }
  world!: BrainWorld;
  locomotor!: LocoMotor;
  sg!: MoleStateGraph;
  brain!: MoleBrain;
  animstate!: AnimState;
  isunder = true;
  needs_home_time: number | undefined;
  make_home_delay: number;
  last_above_time = 0;
  peek_interval: number;
  flee = false;
  bornAt = 0;
  bufferedaction?: BufferedAction;
  occupied = false;
  private worldServices?: MoleWorld;
  private scheduler?: GameTimeScheduler;
  private saved?: MoleSave;
  private disposed = false;
  private dropPending = false;
  private speed = 0;
  /** Physics belongs to the logical item and survives replacing its display. */
  bindPhysics(world?: import('cannon-es').World): void {
    MakeCharacterPhysics(this.entity, 99999, .5);
    if (this.isunder) this.setUnder(); else this.setAbove();
    this.entity.physics.SetActive(this.isValid());
    if (world) this.entity.bindPhysics(world, () => this.getPosition());
  }
  private syncMotor(): void {
    const body = this.entity.physicsBody;
    if (!body) return;
    const angle = this.heading * Math.PI / 180;
    body.velocity.x = Math.cos(angle) * this.speed;
    body.velocity.z = -Math.sin(angle) * this.speed;
  }

  private heading = 0;
  private readonly cleanups: (() => void)[] = [];
  private stopfleetask?: EntityTask;
  private homechecktask?: EntityTask;
  /** SGmole stunned's sg.statemem.playtask / killtask. */
  private playtask?: EntityTask;
  private killtask?: EntityTask;
  private stateTags = new Set<string>();
  readonly entity: ItemEntity;
  private readonly randomSource: () => number;
  constructor(entity: ItemEntity, randomSource = Math.random) {
    this.entity = entity; this.randomSource = randomSource;
    entity.AddSoundEmitter();
    this.make_home_delay = 5 + Math.floor(this.random() * 6); this.peek_interval = 15 + Math.floor(this.random() * 11);
    addComponent(this, 'health', Health, 30).OnLoad({ health: entity.mole?.health ?? 30 });
    this.saved = entity.mole;
    addComponent(this, 'combat', Combat, () => this.getTime());
    addComponent(this, 'knownlocations', KnownLocations);
    addComponent(this, 'homeseeker', HomeSeeker<MolehillInstance>);
    this.cleanups.push(entity.ListenForEvent('ondropped', () => this.onDropped()),
      entity.ListenForEvent('onputininventory', () => this.onPickup()));
  }
  get id(): string { return this.entity.id; }
  get home(): MolehillInstance | undefined { return this.components.homeseeker.home; }
  getPosition(): Vector3 { return this.entity.getPosition(); }
  getPhysicsRadius(): number { return .5 * WORLD_SCALE; }
  getTime(): number { return this.scheduler?.now ?? 0; }
  get isRemoved(): boolean { return this.entity.isRemoved || this.disposed; }
  onRemove(remove: () => void): () => void { return this.entity.onRemove(remove); }
  isValid(): boolean { return !this.isRemoved && !this.occupied && !this.entity.components.inventoryitem.owner; }
  hasTag(tag: string): boolean { return this.entity.hasTag(tag); }
  random(): number { return this.randomSource(); }
  ListenForEvent(name: string, fn: (inst: unknown, data: unknown) => void): () => void {
    const stop = this.entity.ListenForEvent(name, fn);
    let set = this.listeners.get(name); if (!set) this.listeners.set(name, set = new Map()); set.set(fn, stop); return stop;
  }
  private readonly listeners = new Map<string, Map<(inst: unknown, data: unknown) => void, () => void>>();
  RemoveEventCallback(name: string, fn: (inst: unknown, data: unknown) => void): void { this.listeners.get(name)?.get(fn)?.(); this.listeners.get(name)?.delete(fn); }
  // inst:PushEvent reaches SGmole itself: entity.sg is its stategraph.
  PushEvent(name: string, data?: unknown): void { this.entity.PushEvent(name, data); }
  isNear(other: { getPosition(): unknown }, distance: number): boolean { return this.getPosition().distanceToSquared(other.getPosition() as Vector3) <= distance ** 2; }
  getAngleToPoint(x: number, _y: number, z: number): number { const p = this.getPosition(); return Math.atan2(-(z - p.z), x - p.x) * 180 / Math.PI; }
  setRotation(degrees: number): void { this.heading = degrees; this.syncMotor(); }
  setMotorSpeed(speed: number): void { this.speed = speed; this.syncMotor(); }
  stopPhysics(): void { this.setMotorSpeed(0); }
  setUnder(): void {
    this.isunder = true; this.entity.addTag('notdrawable');
    this.entity.physics.SetCollisionGroup(COLLISION.CHARACTERS);
    this.entity.physics.SetCollisionMask(COLLISION.WORLD, COLLISION.OBSTACLES);
  }
  setAbove(): void {
    this.isunder = false; this.entity.removeTag('notdrawable');
    this.entity.physics.SetCollisionGroup(COLLISION.CHARACTERS);
    this.entity.physics.SetCollisionMask(...CHARACTER_COLLISION_MASK);
  }
  setPickup(enabled: boolean): void { this.entity.components.inventoryitem.canbepickedup = enabled; }
  isDead(): boolean { return this.components.health.IsDead(); }
  inventoryFull(): boolean { return this.components.inventory?.IsFull() ?? false; }
  bindWorld(services: MoleWorld, lengths: ReadonlyMap<string, number> = MOLE_ANIMATION_LENGTHS): void {
    if (this.worldServices) return;
    this.worldServices = services;
    this.cleanups.push(services.registerMole(this));
    const { getWatchWorldContent } = services;
    const cycle = getWatchWorldContent(WorldContentKey.Cycle, stop => this.cleanups.push(stop));
    const { scheduler } = cycle;
    this.scheduler = scheduler; this.bornAt = this.getTime();
    this.world = {
      get isDay() { return cycle.peek() === 'day'; },
      isAboveGroundAtPoint: (x, y, z) => services.isWalkable(new Vector3(x, y, z)),
      findEntity: (from, radius, predicate, must = [], cant = [], one = []) => {
        const origin = from.getPosition() as Vector3;
        return services.getEntities().filter(e => e !== from && e.isValid() && must.every(t => e.hasTag(t)) && !cant.some(t => e.hasTag(t)) &&
          (!one.length || one.some(t => e.hasTag(t))) && origin.distanceToSquared(e.getPosition() as Vector3) <= radius ** 2)
          .sort((a, b) => origin.distanceToSquared(a.getPosition() as Vector3) - origin.distanceToSquared(b.getPosition() as Vector3))
          .find(e => !predicate || predicate(e, from));
      },
      getClosestInstWithTag: (tags, from, radius) => this.world.findEntity(from, radius, undefined, tags),
    };
    addComponent(this, 'inventory', Inventory, 3, services.dropItem, services.itemSpecs).OnLoad(this.saved?.items ?? [], services.spawnItem);
    this.locomotor = addComponent(this, 'locomotor', LocoMotor, { arriveDistance: .15 * WORLD_SCALE, pathfinder: services.pathfinder, pathcaps: { ignorecreep: true, ignorebridges: true } });
    this.locomotor.walkspeed = 2.75 * WORLD_SCALE; this.locomotor.runspeed = 6 * WORLD_SCALE;
    this.animstate = new AnimState(scheduler, lengths, event => this.sg.pushEvent(event));
    this.sg = new MoleStateGraph(this, scheduler);
    this.entity.sg = this.sg.sg;
    this.sg.sg.onNewState(() => this.syncStateTags()); this.syncStateTags();
    this.brain = new MoleBrain(this, WORLD_SCALE);
    this.entity.brain = this.brain;
    if (!this.entity.worldServices?.scheduler) this.entity.BindScheduler(scheduler);
    // DoTaskInTime(inst.make_home_delay, TestForMakeHome)
    this.homechecktask = this.entity.DoTaskInTime(this.make_home_delay, () => { if (!this.home?.isValid()) this.needs_home_time = this.getTime(); });
    if (this.saved?.needsHomeElapsed !== undefined) this.needs_home_time = this.getTime() - this.saved.needsHomeElapsed;
    this.saved = undefined;
    addComponent(this, 'sleeper', Sleeper, getWatchWorldContent, this.randomSource, WORLD_SCALE).SetNocturnal(true);
    this.entity.addTag('sleeper');
    if (this.isValid()) { this.brain.Start(); if (this.dropPending) this.onDropped(); }
    createEffect(() => { cycle.get(); this.brain.ForceUpdate(); });
  }
  private syncStateTags(): void {
    for (const tag of this.stateTags) this.entity.removeTag(tag);
    this.stateTags = new Set(['noattack', 'noelectrocute', 'busy', 'sleeping', 'canwxscan', 'canelectrocute'].filter(tag => this.sg.hasStateTag(tag)));
    for (const tag of this.stateTags) this.entity.addTag(tag);
  }
  PushBufferedAction(action: BufferedAction): void {
    if (this.bufferedaction === action) return;
    this.clearBufferedAction(); if (!action.isValid()) { action.fail(); return; }
    this.bufferedaction = action;
    if (!this.sg.startAction(action)) this.clearBufferedAction();
  }
  performBufferedAction(): boolean {
    const action = this.bufferedaction; if (!action) return false;
    this.bufferedaction = undefined; const success = action.do();
    if (!success) { this.PushEvent('actionfailed', { action }); action.fail(); } return success;
  }
  clearBufferedAction(): void { this.bufferedaction?.fail(); this.bufferedaction = undefined; }
  playAnimation(name: string, loop = false): void { this.animstate.PlayAnimation(name, loop); }
  pushAnimation(name: string, loop = false): void { this.animstate.PushAnimation(name, loop); }
  /** inst.SoundEmitter (mole.lua AddSoundEmitter). */
  get SoundEmitter(): SoundEmitter { return this.entity.SoundEmitter!; }
  /** OnSleep / OnRemove: SoundEmitter:KillAllSounds(). */
  private stopSounds(): void { this.entity.SoundEmitter?.KillAllSounds(); }
  startStunnedSounds(skippre: boolean): void {
    const delay = skippre ? 0 : this.animstate.length;
    // SGmole stunned: DoPeriodicTask(23 * FRAMES, PlayStunnedSound / KillStunnedSound).
    this.playtask?.Cancel(); this.killtask?.Cancel();
    this.playtask = this.entity.DoPeriodicTask(23 / 30, () => {
      if (!this.SoundEmitter.PlayingSound('stunned')) this.SoundEmitter.PlaySound(`${SOUND_PREFIX}sleep` as SoundEventPath, 'stunned');
    }, delay);
    this.killtask = this.entity.DoPeriodicTask(23 / 30, () => this.SoundEmitter.KillSound('stunned'), delay + 11 / 30);
  }
  stopStunnedSounds(): void {
    this.playtask?.Cancel(); this.playtask = undefined;
    this.killtask?.Cancel(); this.killtask = undefined;
    this.SoundEmitter.KillSound('stunned');
  }
  dropInventory(): void { this.components.inventory?.DropEverything(); }
  dropDeathLoot(): void { this.entity.persists = false; this.worldServices?.dropLoot('smallmeat', this.getPosition().clone()); }
  spawnMoveFx(): void { this.worldServices?.spawnMoveFx(this.getPosition()); }
  setHome(home: unknown): void {
    this.components.homeseeker.SetHome(home as MolehillInstance | undefined);
    if (home) this.components.knownlocations.RememberLocation('home', (home as MolehillInstance).getPosition());
  }
  wentHome(target: BrainEntity): boolean {
    const home = this.home; if (target !== home || !home?.isValid()) return false;
    this.components.inventory?.TransferInventory(home); this.sg.goToState('idle');
    return home.components.spawner.GoHome(this);
  }
  enterHome(): void { this.entity.physics.SetActive(false); this.occupied = true; this.entity.addTag('INLIMBO'); this.brain.Stop(); this.locomotor.Stop(); this.animstate.stop(); this.sg.pause(); this.components.sleeper?.StopTesting(); this.stopSounds(); this.components.homeseeker.SetHome(); }
  leaveHome(): void {
    this.occupied = false; this.entity.removeTag('INLIMBO'); const home = this.home!;
    const angle = this.random() * Math.PI * 2;
    const position = home.getPosition();
    this.entity.setPosition(position.x + Math.cos(angle) * WORLD_SCALE, position.y, position.z - Math.sin(angle) * WORLD_SCALE);
    this.entity.physics.Teleport(); this.entity.physics.SetActive(true);
    this.sg.resume(); this.sg.goToState('idle'); this.brain.Start(); this.components.sleeper?.StartTesting();
  }
  findHomePosition(): Vector3 | undefined {
    const services = this.worldServices!, start = this.random() * Math.PI * 2, radius = (5 + Math.floor(this.random() * 11)) * WORLD_SCALE;
    for (let i = 0; i < 120; i++) {
      const angle = start + i * Math.PI * 2 / 120;
      const p = this.getPosition().clone().add(new Vector3(Math.cos(angle) * radius, 0, -Math.sin(angle) * radius));
      if (services.isWalkable(p)) return p;
    }
    return undefined;
  }
  makeHome(): boolean { this.worldServices!.makeHome(this); this.needs_home_time = undefined; return true; }
  onAttacked(data: unknown): void {
    this.flee = true;
    this.stopfleetask?.Cancel();
    this.stopfleetask = this.entity.DoTaskInTime(3 + Math.floor(this.random() * 4), () => { this.flee = false; });
    let count = 0;
    for (const mole of this.worldServices!.getMoles()) if (mole.getPosition().distanceToSquared(this.getPosition()) <= (30 * WORLD_SCALE) ** 2) {
      mole.PushEvent('gohome'); if (++count > 5) break;
    }
    const weapon = (data as { weapon?: { hasTag(tag: string): boolean } })?.weapon;
    if (weapon?.hasTag('hammer')) { this.dropInventory(); if (!this.isDead()) this.sg.goToState('stunned'); }
    else if (weapon && !this.isDead() && !this.sg.hasStateTag('busy')) this.sg.goToState('hit');
  }
  onHomeDugUp(): void { this.needs_home_time = this.getTime(); this.dropInventory(); if (!this.isDead()) this.sg.goToState('stunned'); }
  private onPickup(): void {
    this.entity.physics.SetActive(false);
    this.entity.PushEvent('ontrapped', undefined); this.components.homeseeker.SetHome(); this.components.sleeper?.StopTesting(); this.brain?.Stop(); this.locomotor?.Stop(); this.clearBufferedAction();
    this.sg?.goToState('idle'); this.sg?.pause(); this.animstate?.stop(); this.stopStunnedSounds(); this.stopSounds();
    this.entity.components.perishable.StartPerishing();
  }
  private onDropped(): void {
    this.entity.physics.Teleport(); this.entity.physics.SetActive(true);
    this.dropPending = true;
    this.entity.components.perishable.StopPerishing(); this.stopSounds();
    if (this.sg) { this.dropPending = false; this.sg.resume(); this.sg.goToState('stunned', true); this.brain.Start(); this.components.sleeper?.StartTesting(); }
    if (!this.home?.isValid()) this.needs_home_time = this.getTime();
  }
  update(dt: number): void {
    if (!this.isValid() || this.isDead()) return;
    const body = this.entity.physicsBody;
    if (body) this.entity.setPosition(body.position.x, 0, body.position.z);
    this.brain.tick(this.getTime()); if (this.locomotor.isUpdating) this.locomotor.update(dt); this.sg.update(dt);
    if (this.speed > 0) {
      const angle = this.heading * Math.PI / 180;
      const p = this.getPosition().clone().add(new Vector3(Math.cos(angle) * this.speed * dt, 0, -Math.sin(angle) * this.speed * dt));
      if (this.worldServices!.isWalkable(p)) {
        if (body) this.syncMotor(); else this.entity.setPosition(p.x, p.y, p.z);
      } else this.locomotor.Stop();
    }
  }
  get facing(): number { return this.heading; }
  OnSave(): MoleSave {
    return { health: this.components.health.currenthealth,
      ...(this.needs_home_time === undefined ? this.saved?.needsHomeElapsed === undefined ? {} : { needsHomeElapsed: this.saved.needsHomeElapsed }
        : { needsHomeElapsed: this.getTime() - this.needs_home_time }),
      items: this.components.inventory?.OnSave() ?? this.saved?.items ?? [] };
  }
  remove(): void { this.entity.remove(); }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    // The components were torn down with the item entity.
    this.brain?.Stop(); this.sg?.dispose(); this.animstate?.dispose(); this.stopSounds();
    this.stopfleetask?.Cancel(); this.homechecktask?.Cancel(); this.stopStunnedSounds();
    this.cleanups.splice(0).forEach(stop => stop());
    for (const listeners of this.listeners.values()) for (const stop of listeners.values()) stop(); this.listeners.clear();
  }
}
export function configureMoleEntity(entity: ItemEntity): void {
  for (const tag of ['animal', 'prey', 'mole', 'smallcreature', 'canbetrapped', 'baitstealer', 'cattoy', 'catfood', 'whackable', 'stunnedbybomb', 'cookable', 'small_livestock', 'show_spoilage']) entity.addTag(tag);
  if (entity.getComponent<Mole>('mole')) return;
  entity.components.inventoryitem.canbepickedup = false; entity.components.inventoryitem.canbepickedupalive = true;
  entity.component('mole', () => new Mole(entity));
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
        const inst = world.newItem(MOLE_ID);
        inst.sprite.resetPresentation({ name: 'idle_under', billboard: true });
        bindItemWorld(inst, world);
        return inst;
      },
      assets: { animationArchive: 'mole_basic.zip', buildArchives: ['mole_build.zip'], bank: 'mole' },
      onSpawned: inst => {
        const moleWorld = world.moleWorld;
        if (!moleWorld) throw new Error('Mole world is unavailable');
        world.configureItem(inst);
        configureMoleEntity(inst);
        const mole = inst.getComponent<Mole>('mole')!, sprite = inst.sprite;
        mole.bindWorld(moleWorld);
        const animation = watchSignal(mole.animstate.animation, stop => inst.onRemove(stop));
        createEffect(() => { const { name, loop } = animation.get(); inst.AnimState.PlayAnimation(name, loop); });
        mole.bindPhysics(world.physics);
        const heading = watchSignal(moleWorld.cameraHeading, stop => inst.onRemove(stop));
        // Visibility and facing change the sprite json only when their value does.
        let visible: boolean | undefined, facing: number | undefined;
        inst.onRemove(world.componentUpdates.register({
          OnUpdate: dt => {
            if (inst.status.peek() !== 'active') return;
            mole.update(dt);
            const nextVisible = mole.isValid();
            if (nextVisible !== visible) sprite.setVisible(visible = nextVisible);
            const nextFacing = fourFacingFromRotation(mole.facing, heading.peek());
            if (nextFacing !== facing) sprite.setFacing(facing = nextFacing);
          },
        }));
      },
    },
  };
}

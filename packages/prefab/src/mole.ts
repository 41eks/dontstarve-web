import { Vector3 } from 'three';
import { createEffect, WorldContentKey, watchSignal, type ReadonlySignal, type WorldContentContext } from '@dontstarve-web/signals';
import type { ItemEntity, InventoryStack } from '@dontstarve-web/inventory';
import { ArchiveSpriteAssets, createArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { fourFacingFromRotation } from '@dontstarve-web/animation/facing';
import { Eater } from '../../componets/src/eater';
import { Sleeper } from '../../componets/src/sleeper';
import { Health } from '../../componets/src/health';
import { Combat } from '../../componets/src/combat';
import { Inventory } from '../../componets/src/inventory';
import { HomeSeeker } from '../../componets/src/homeseeker';
import { KnownLocations } from '../../componets/src/knownlocations';
import { LocoMotor, type LocoMotorInst, type LocoMotorOptions } from '../../componets/src/locomotor';
import { AnimState } from '../../componets/src/animstate';
import { ComponentTimer } from '../../componets/src/timer';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { MoleBrain, type MoleBrainInst } from '../../brains/src/molebrain';
import type { BrainEntity, BrainWorld } from '../../brains/src/types';
import { MoleStateGraph, type MoleStateInst } from '../../stategraphs/src/SGmole';
import type { BufferedAction } from '../../stategraphs/src/bufferedaction';
import type { Molehill } from './molehill';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';
import { PlaySound, PreloadSounds, type SoundEventPath, type SoundHandle } from './sound';
import { WORLD_SCALE } from './standardcomponents';

export const MOLE_ID = 'mole' as const;
export const MOLE_PERISH_TIME = 960;
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
  findPath?: LocoMotorOptions['findPath'];
  spawnItem(state: InventoryStack): ItemEntity;
  dropItem(item: ItemEntity, position: Vector3): void;
  dropLoot(prefab: string, position: Vector3): void;
  makeHome(mole: Mole): Molehill;
  prepare(): Promise<void>;
  registerMole(mole: Mole): () => void;
  spawnMoveFx(position: Vector3): void;
}

/** mole.lua: the logical inst survives pickup, dropping and replacement of its visual. */
export class Mole implements MoleBrainInst, MoleStateInst, LocoMotorInst {
  readonly prefab = MOLE_ID;
  readonly components: {
    health: Health; combat: Combat; knownlocations: KnownLocations; homeseeker: HomeSeeker<Molehill>;
    inventory?: Inventory; locomotor?: LocoMotor; sleeper?: Sleeper;
  };
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
  private heading = 0;
  private readonly sounds = new Map<string, SoundHandle>();
  private readonly oneShots = new Set<SoundHandle>();
  private readonly cleanups: (() => void)[] = [];
  private stopFlee?: ComponentTimer;
  private homeCheck?: ComponentTimer;
  private stunnedPlay?: ComponentTimer;
  private stunnedKill?: ComponentTimer;
  private stateTags = new Set<string>();
  readonly entity: ItemEntity;
  private readonly randomSource: () => number;
  constructor(entity: ItemEntity, randomSource = Math.random) {
    this.entity = entity; this.randomSource = randomSource;
    this.make_home_delay = 5 + Math.floor(this.random() * 6); this.peek_interval = 15 + Math.floor(this.random() * 11);
    const health = new Health(30, this); health.OnLoad({ health: entity.mole?.health ?? 30 });
    this.saved = entity.mole;
    this.components = { health, combat: new Combat(this, () => this.getTime()), knownlocations: new KnownLocations(), homeseeker: new HomeSeeker<Molehill>() };
    entity.components.health = health; entity.components.combat = this.components.combat;
    this.cleanups.push(entity.ListenForEvent('ondropped', () => this.onDropped()),
      entity.ListenForEvent('onputininventory', () => this.onPickup()),
      entity.ListenForEvent('attacked', data => this.sg?.pushEvent('attacked', data)),
      entity.ListenForEvent('stunbomb', () => this.sg?.pushEvent('stunbomb')),
      entity.ListenForEvent('death', () => this.sg?.pushEvent('death')));
  }
  get id(): string { return this.entity.id; }
  get home(): Molehill | undefined { return this.components.homeseeker.home; }
  getPosition(): Vector3 { return this.entity.getPosition(); }
  getPhysicsRadius(): number { return .5 * WORLD_SCALE; }
  getTime(): number { return this.scheduler?.now ?? 0; }
  get isRemoved(): boolean { return this.entity.isRemoved || this.disposed; }
  isValid(): boolean { return !this.isRemoved && !this.occupied && !this.entity.components.inventoryitem.owner; }
  hasTag(tag: string): boolean { return this.entity.hasTag(tag); }
  random(): number { return this.randomSource(); }
  ListenForEvent(name: string, fn: (data?: unknown) => void): () => void {
    const listener = (data: unknown) => fn(data); const stop = this.entity.ListenForEvent(name, listener);
    let set = this.listeners.get(name); if (!set) this.listeners.set(name, set = new Map()); set.set(fn, stop); return stop;
  }
  private readonly listeners = new Map<string, Map<(data?: unknown) => void, () => void>>();
  RemoveEventCallback(name: string, fn: (data?: unknown) => void): void { this.listeners.get(name)?.get(fn)?.(); this.listeners.get(name)?.delete(fn); }
  // Graph receives forwarded inst events exactly once; domain events notify the persistent inst.
  PushEvent(name: string, data?: unknown): void {
    if (name === 'attacked' || name === 'death' || name === 'stunbomb') this.entity.PushEvent(name, data);
    else { this.entity.PushEvent(name, data); this.sg?.pushEvent(name, data); }
  }
  isNear(other: { getPosition(): unknown }, distance: number): boolean { return this.getPosition().distanceToSquared(other.getPosition() as Vector3) <= distance ** 2; }
  getAngleToPoint(x: number, _y: number, z: number): number { const p = this.getPosition(); return Math.atan2(-(z - p.z), x - p.x) * 180 / Math.PI; }
  setRotation(degrees: number): void { this.heading = degrees; }
  setMotorSpeed(speed: number): void { this.speed = speed; }
  stopPhysics(): void { this.speed = 0; }
  setUnder(): void { this.isunder = true; this.entity.addTag('notdrawable'); }
  setAbove(): void { this.isunder = false; this.entity.removeTag('notdrawable'); }
  setPickup(enabled: boolean): void { this.entity.components.inventoryitem.canbepickedup = enabled; }
  isDead(): boolean { return this.components.health.IsDead(); }
  inventoryFull(): boolean { return this.components.inventory?.IsFull() ?? false; }
  bindWorld(services: MoleWorld, lengths: ReadonlyMap<string, number>): void {
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
    this.components.inventory = new Inventory(this, 3, services.dropItem, services.itemSpecs);
    this.components.inventory.OnLoad(this.saved?.items ?? [], services.spawnItem);
    this.locomotor = new LocoMotor(this, { arriveDistance: .15 * WORLD_SCALE, findPath: services.findPath });
    this.locomotor.walkspeed = 2.75 * WORLD_SCALE; this.locomotor.runspeed = 6 * WORLD_SCALE;
    this.components.locomotor = this.locomotor;
    this.animstate = new AnimState(scheduler, lengths, event => this.sg.pushEvent(event));
    this.sg = new MoleStateGraph(this, scheduler);
    this.sg.sg.listenForEvent('newstate', () => this.syncStateTags()); this.syncStateTags();
    this.brain = new MoleBrain(this, WORLD_SCALE);
    this.stopFlee = new ComponentTimer(scheduler, () => { this.flee = false; });
    this.homeCheck = new ComponentTimer(scheduler, () => { if (!this.home?.isValid()) this.needs_home_time = this.getTime(); });
    this.homeCheck.start(this.make_home_delay);
    if (this.saved?.needsHomeElapsed !== undefined) this.needs_home_time = this.getTime() - this.saved.needsHomeElapsed;
    this.saved = undefined;
    this.stunnedPlay = new ComponentTimer(scheduler, () => { this.playSound('sleep', 'stunned'); this.stunnedPlay!.start(23 / 30); });
    this.stunnedKill = new ComponentTimer(scheduler, () => { this.killSound('stunned'); this.stunnedKill!.start(23 / 30); });
    const mole = this;
    this.components.sleeper = new Sleeper({ isValid: () => this.isValid(), PushEvent: (name, data) => this.PushEvent(name, data),
      get sg() { return mole.sg; },
      get components() { return mole.components; }, isNear: (home, distance) => mole.isNear(home, distance * WORLD_SCALE) }, getWatchWorldContent, this.randomSource);
    this.components.sleeper.SetNocturnal(true); this.entity.components.sleeper = this.components.sleeper; this.entity.addTag('sleeper');
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
  playSound(name: string, key?: string): void {
    if (key && this.sounds.get(key)?.isPlaying()) return;
    const handle = PlaySound(`${SOUND_PREFIX}${name}` as SoundEventPath, this.getPosition());
    if (key) this.sounds.set(key, handle); else this.oneShots.add(handle);
  }
  killSound(key: string): void { this.sounds.get(key)?.stop(); this.sounds.delete(key); }
  private stopSounds(): void { for (const sound of [...this.sounds.values(), ...this.oneShots]) sound.stop(); this.sounds.clear(); this.oneShots.clear(); }
  startStunnedSounds(skippre: boolean): void {
    const delay = skippre ? 0 : this.animstate.length;
    this.stunnedPlay!.start(delay); this.stunnedKill!.start(delay + 11 / 30);
  }
  stopStunnedSounds(): void { this.stunnedPlay?.stop(); this.stunnedKill?.stop(); this.killSound('stunned'); }
  dropInventory(): void { this.components.inventory?.DropEverything(); }
  dropDeathLoot(): void { this.entity.persists = false; this.worldServices?.dropLoot('smallmeat', this.getPosition().clone()); }
  spawnMoveFx(): void { this.worldServices?.spawnMoveFx(this.getPosition()); }
  setHome(home: unknown): void {
    this.components.homeseeker.SetHome(home as Molehill | undefined);
    if (home) this.components.knownlocations.RememberLocation('home', (home as Molehill).getPosition());
  }
  wentHome(target: BrainEntity): boolean {
    const home = this.home; if (target !== home || !home?.isValid()) return false;
    this.components.inventory?.TransferInventory(home); this.sg.goToState('idle');
    return home.components.spawner.GoHome(this);
  }
  enterHome(): void { this.occupied = true; this.entity.addTag('INLIMBO'); this.brain.Stop(); this.locomotor.Stop(); this.animstate.stop(); this.sg.pause(); this.components.sleeper?.StopTesting(); this.stopSounds(); this.components.homeseeker.SetHome(); }
  leaveHome(): void {
    this.occupied = false; this.entity.removeTag('INLIMBO'); const home = this.home!;
    const angle = this.random() * Math.PI * 2;
    this.getPosition().copy(home.getPosition()).add(new Vector3(Math.cos(angle) * WORLD_SCALE, 0, -Math.sin(angle) * WORLD_SCALE));
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
    this.flee = true; this.stopFlee!.start(3 + Math.floor(this.random() * 4));
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
    this.entity.PushEvent('ontrapped', undefined); this.components.homeseeker.SetHome(); this.components.sleeper?.StopTesting(); this.brain?.Stop(); this.locomotor?.Stop(); this.clearBufferedAction();
    this.sg?.goToState('idle'); this.sg?.pause(); this.animstate?.stop(); this.stopStunnedSounds(); this.stopSounds();
    this.entity.components.perishable.StartPerishing();
  }
  private onDropped(): void {
    this.dropPending = true;
    this.entity.components.perishable.StopPerishing(); this.stopSounds();
    if (this.sg) { this.dropPending = false; this.sg.resume(); this.sg.goToState('stunned', true); this.brain.Start(); this.components.sleeper?.StartTesting(); }
    if (!this.home?.isValid()) this.needs_home_time = this.getTime();
  }
  update(dt: number): void {
    if (!this.isValid() || this.isDead()) return;
    this.brain.tick(this.getTime()); if (this.locomotor.isUpdating) this.locomotor.update(dt); this.sg.update(dt);
    if (this.speed > 0) {
      const angle = this.heading * Math.PI / 180;
      const p = this.getPosition().clone().add(new Vector3(Math.cos(angle) * this.speed * dt, 0, -Math.sin(angle) * this.speed * dt));
      if (this.worldServices!.isWalkable(p)) this.getPosition().copy(p); else this.locomotor.Stop();
    }
    for (const sound of this.oneShots) if (!sound.isPlaying()) this.oneShots.delete(sound);
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
    this.brain?.Stop(); this.components.sleeper?.dispose(); this.sg?.dispose(); this.animstate?.dispose(); this.stopSounds();
    this.stopFlee?.stop(); this.homeCheck?.stop(); this.stopStunnedSounds();
    this.components.homeseeker.dispose(); this.components.inventory?.dispose(); this.components.health.dispose();
    this.cleanups.splice(0).forEach(stop => stop());
    for (const listeners of this.listeners.values()) for (const stop of listeners.values()) stop(); this.listeners.clear();
  }
}
export function configureMoleEntity(entity: ItemEntity): void {
  for (const tag of ['animal', 'prey', 'mole', 'smallcreature', 'canbetrapped', 'baitstealer', 'cattoy', 'catfood', 'whackable', 'stunnedbybomb', 'cookable', 'small_livestock', 'show_spoilage']) entity.addTag(tag);
  if (entity.getComponent<Mole>('mole')) return;
  entity.components.inventoryitem.canbepickedup = false; entity.components.inventoryitem.canbepickedupalive = true;
  entity.component('mole', () => new Mole(entity));
  entity.components.eater = entity.component('eater', () => new Eater(entity));
  entity.components.eater.SetDiet(['ELEMENTAL']); entity.components.eater.SetOnEatFn(() => entity.components.perishable.SetPercent(1));
  const perishable = entity.components.perishable;
  if (perishable.perishtime.peek() === undefined) perishable.SetPerishTime(MOLE_PERISH_TIME);
  perishable.localMultiplier = () => entity.components.inventoryitem.owner ? 1 : 0;
  perishable.perishfn = () => {
    const owner = entity.components.inventoryitem.owner;
    if (owner) { owner.PushEvent('murdered', { victim: entity, stackmult: 1, negligent: true }); PlaySound(`${SOUND_PREFIX}death`); owner.replace('smallmeat'); }
  };
  if (!entity.components.inventoryitem.owner) perishable.StopPerishing();
}
export function createMoleGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  const assets = new ArchiveSpriteAssets('mole');
  return {
    itemIds: [MOLE_ID], configureEntity: configureMoleEntity,
    create: async () => {
      if (!context.moleWorld) throw new Error('Mole world is unavailable');
      await PreloadSounds(...MOLE_SOUNDS);
      const [sprite, bank] = await Promise.all([
        createArchiveSprite(assets, { animationArchive: 'mole_basic.zip', buildArchives: ['mole_build.zip'], bank: 'mole', animation: 'idle_under', loop: true }),
        assets.loadAnimation('mole_basic.zip'), context.moleWorld.prepare(),
      ]);
      let mole: Mole | undefined;
      const cleanups: (() => void)[] = [];
      const heading = watchSignal(context.moleWorld.cameraHeading, stop => cleanups.push(stop));
      return {
        model: sprite.model,
        bindEntity: entity => {
          configureMoleEntity(entity); mole = entity.getComponent<Mole>('mole')!;
          mole.bindWorld(context.moleWorld!, new Map(bank.animations.map(clip => [clip.name, clip.frames.length / clip.frameRate])));
          const animation = watchSignal(mole.animstate.animation, stop => cleanups.push(stop));
          createEffect(() => { const { name, loop } = animation.get(); if (loop) sprite.start(name); else sprite.playOnce(name); });
          sprite.model.userData.mole = mole; sprite.model.userData.physicsRadius = .5 * WORLD_SCALE;
        },
        update: dt => { mole?.update(dt); sprite.model.visible = mole?.isValid() ?? true; sprite.setFacing(fourFacingFromRotation(mole?.facing ?? 0, heading.peek())); sprite.update(dt); },
        isClickable: () => mole?.isValid() ?? true,
        dispose: () => { cleanups.splice(0).forEach(stop => stop()); sprite.dispose(); },
      };
    }, dispose: () => assets.dispose(),
  };
}

import { Vector3 } from 'three';
import { ItemEntity, type InventoryStack } from '@dontstarve-web/inventory';
import { createEffect, createSignal, readonlySignal, watchSignal, WorldContentKey, type GetWatchWorldContent, type TileStateQuery, type ReadonlySignal } from '@dontstarve-web/signals';
import { ArchiveSpriteAssets, preloadSharedArchiveSprite, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { fourFacingFromRotation } from '@dontstarve-web/animation/facing';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ComponentTimer } from '../../componets/src/timer';
import { TileTracker } from '../../componets/src/tileManager';
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
import { ResidentSprite } from '@dontstarve-web/animation/residentSprite';
import { Workable } from '../../componets/src/workable';
import { LocoMotor, type LocoMotorInst } from '../../componets/src/locomotor';
import { LightFlierBrain, type LightFlierBrainInst } from '../../brains/src/lightflierbrain';
import { LightFlierStateGraph, type LightFlierStateInst } from '../../stategraphs/src/SGlightflier';
import type { BufferedAction } from '../../stategraphs/src/bufferedaction';
import type { BrainEntity, BrainWorld } from '../../brains/src/types';
import type { GroundItemFactory, GroundItemVisual, GroundPrefabContext } from './groundPrefab';
import type { LightFlierFlower } from './lightflier_flower';
import { WORLD_SCALE } from './standardcomponents';
import { setPrefabLocalLight, setPrefabLightOverride } from './localLight';
import { PlaySound, PreloadSounds, type SoundHandle } from './sound';

export const LIGHTFLIER_ID = 'lightflier';
export const LIGHTFLIER_PERISH_TIME = 2 * 480;
export const LIGHTFLIER_TAGS = ['lightflier', 'cavedweller', 'flying', 'ignorewalkableplatformdrowning', 'insect',
  'smallcreature', 'lightbattery', 'lunar_aligned', 'show_spoilage', 'small_livestock', 'formation_lightflier'] as const;
export const LIGHTFLIER_SOUNDS = ['grotto/creatures/light_bug/fly_LP', 'grotto/creatures/light_bug/hit', 'grotto/creatures/light_bug/death'] as const;
export interface LightFlierPlayer {
  readonly position: Vector3;
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
  showItem(entity: ItemEntity, position: Vector3): void;
  dropLoot(prefab: string, count: number, position: Vector3): void;
}
type Leader = FormationLeader<LightFlierPlayer, LightFlier>;

/** Shared world services, source assets and nonpersistent formationleader entities. */
export class LightFlierHabitat {
  readonly flies = new Set<LightFlier>();
  readonly homes = new Map<string, LightFlierFlower>();
  readonly formations = new Set<Leader>();
  private readonly assets: ArchiveSpriteAssets;
  private spriteFactory?: Awaited<ReturnType<typeof preloadSharedArchiveSprite>>;
  private prepared?: Promise<void>;
  private lengths = new Map<string, number>();
  private readonly leaderTimers = new Map<Leader, ComponentTimer>();
  private readonly distributenext = new Set<Leader>();
  private disposed = false;
  readonly services: LightFlierServices;
  constructor(base: string, services: LightFlierServices) { this.assets = new ArchiveSpriteAssets('lightflier', base); this.services = services; }
  prepare(): Promise<void> {
    return this.prepared ??= Promise.all([
      preloadSharedArchiveSprite(this.assets, { animationArchive: 'lightflier.zip', buildArchives: ['lightflier.zip'], bank: 'lightflier' }),
      this.assets.loadAnimation('lightflier.zip'), PreloadSounds(...LIGHTFLIER_SOUNDS),
    ]).then(([factory, bank]) => {
      if (this.disposed) throw new Error('Lightflier habitat disposed');
      this.spriteFactory = factory;
      this.lengths = new Map(bank.animations.map(clip => [clip.name, clip.frames.length / clip.frameRate]));
    });
  }
  createSprite(animation = 'walk_loop', loop = true): ArchiveSprite { if (!this.spriteFactory) throw new Error('Lightflier art was not prepared'); return this.spriteFactory(animation, loop, LIGHTFLIER_ID); }
  bind(fly: LightFlier): void { fly.bindWorld(this, this.lengths); }
  spawn(position: Vector3): LightFlier {
    if (!this.spriteFactory || this.disposed) throw new Error('Lightflier habitat unavailable');
    const entity = this.services.spawnItem({ itemId: LIGHTFLIER_ID, count: 1 }); configureLightFlierEntity(entity);
    const fly = entity.getComponent<LightFlier>(LIGHTFLIER_ID)!; entity.getPosition().copy(position); this.bind(fly);
    this.services.showItem(entity, position.clone()); return fly;
  }
  findFormation(fly: LightFlier): void {
    if (!fly.isValid() || fly.inFormation || fly.getTime() - fly.lastAttacked < 4) return;
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
    this.homes.clear(); this.flies.clear(); this.assets.dispose();
  }
}

/** lightflier.lua inst: inventory identity, components and brain survive replacement of the sprite. */
export class LightFlier implements LightFlierBrainInst, LightFlierStateInst, LocoMotorInst {
  readonly prefab = LIGHTFLIER_ID;
  readonly entity: ItemEntity;
  readonly components: { health: Health; combat: Combat; homeseeker: HomeSeeker<LightFlierFlower>; knownlocations: KnownLocations;
    formationfollower: FormationFollower<LightFlierPlayer, LightFlier>; follower: Follower<LightFlierPlayer>; locomotor?: LocoMotor; sleeper?: Sleeper;
    freezable?: Freezable; burnable?: Burnable; propagator?: Propagator; hauntable?: Hauntable };
  locomotor!: LocoMotor;
  sg!: LightFlierStateGraph;
  brain!: LightFlierBrain;
  animstate!: AnimState;
  world!: BrainWorld;
  bufferedaction?: BufferedAction;
  bornAt = 0;
  lastAttacked = -Infinity;
  private habitat?: LightFlierHabitat;
  private targetSearch?: ComponentTimer;
  private erosion?: ErodeAway;
  private erosionAmount = 0;
  private readonly activeState = createSignal(true);
  readonly active = readonlySignal(this.activeState);
  private tracker?: TileTracker;
  private asleepHome?: ComponentTimer;
  private disposed = false;
  private speed = 0;
  private heading = 0;
  private loop?: SoundHandle;
  private readonly sounds = new Set<SoundHandle>();
  private readonly cleanups: (() => void)[] = [];
  private readonly eventStops = new Map<(data?: unknown) => void, () => void>();
  constructor(entity: ItemEntity) {
    this.entity = entity;
    const health = new Health(25, entity); health.OnLoad({ health: entity.lightflier?.health ?? 25 });
    this.components = { health, combat: new Combat(this, () => this.getTime()), homeseeker: new HomeSeeker(),
      knownlocations: new KnownLocations(), formationfollower: new FormationFollower(this), follower: new Follower(entity) };
    const saved = entity.lightflier;
    if (saved?.knownHome) this.components.knownlocations.RememberLocation('home', new Vector3(...saved.knownHome));
    entity.components.health = health; entity.components.combat = this.components.combat;
    const follower = this.components.formationfollower;
    follower.onenterformation = () => { this.locomotor?.Stop(); entity.addTag('NOBLOCK'); };
    follower.onleaveformation = () => {
      const home = this.home;
      if (home && this.getPosition().distanceToSquared(home.getPosition()) > (28 * WORLD_SCALE) ** 2) {
        entity.PushEvent('detachchild', undefined); this.components.knownlocations.RememberLocation('home', this.getPosition()); this.setHome();
      }
      if (this.locomotor) this.locomotor.walkspeed = 3.5 * WORLD_SCALE;
      entity.removeTag('NOBLOCK'); this.components.combat.DropTarget();
    };
    for (const event of ['locomote', 'startled', 'gotosleep', 'onwakeup', 'freeze', 'onthaw', 'unfreeze', 'electrocute'])
      this.cleanups.push(entity.ListenForEvent(event, data => this.sg?.pushEvent(event, data)));
    this.cleanups.push(entity.ListenForEvent('attacked', data => {
      this.wakeUp();
      const members = follower.formationleader?.members ?? [this];
      for (const fly of members) fly.lastAttacked = this.getTime() + Math.random();
      follower.formationleader?.DisbandFormation(); this.sg?.pushEvent('attacked', data);
    }), entity.ListenForEvent('teleported', () => follower.formationleader?.DisbandFormation()),
    entity.ListenForEvent('death', () => { follower.LeaveFormation(); this.sg?.pushEvent('death'); }),
    entity.ListenForEvent('gotosleep', () => { this.brain?.Pause(); this.formationActive(false); this.enableBuzz(false); }),
    entity.ListenForEvent('onwakeup', () => { if (!this.components.freezable?.IsFrozen()) this.brain?.Resume(); this.enableBuzz(true); }),
    entity.ListenForEvent('onputininventory', () => this.onPutInInventory()), entity.ListenForEvent('ondropped', () => this.onDropped()));
  }
  get id(): string { return this.entity.id; }
  get home(): LightFlierFlower | undefined { return this.components.homeseeker.home; }
  get inFormation(): boolean { return this.components.formationfollower.formationleader !== undefined; }
  get facing(): number { return this.heading; }
  get isRemoved(): boolean { return this.disposed || this.entity.isRemoved; }
  getTime(): number { return this.habitat?.services.scheduler.now ?? 0; }
  getPosition(): Vector3 { return this.entity.getPosition(); }
  getPhysicsRadius(): number { return .5 * WORLD_SCALE; }
  isValid(): boolean { return !this.isRemoved && !this.entity.components.inventoryitem.owner; }
  isDead(): boolean { return this.components.health.IsDead(); }
  hasTag(tag: string): boolean { return this.entity.hasTag(tag); }
  random(): number { return Math.random(); }
  isNear(other: BrainEntity, distance: number): boolean { return this.getPosition().distanceToSquared(other.getPosition() as Vector3) <= distance ** 2; }
  ListenForEvent(name: string, fn: (data?: unknown) => void): () => void {
    const stop = this.entity.ListenForEvent(name, data => fn(data)); this.eventStops.set(fn, stop); return stop;
  }
  RemoveEventCallback(_name: string, fn: (data?: unknown) => void): void { this.eventStops.get(fn)?.(); this.eventStops.delete(fn); }
  PushEvent(name: string, data?: unknown): void { this.entity.PushEvent(name, data); }
  setRotation(degrees: number): void { this.heading = degrees; }
  getAngleToPoint(x: number, _y: number, z: number): number { const p = this.getPosition(); return Math.atan2(-(z - p.z), x - p.x) * 180 / Math.PI; }
  setMotorSpeed(speed: number): void { this.speed = speed; }
  stopPhysics(): void { this.speed = 0; }
  bindWorld(habitat: LightFlierHabitat, lengths: ReadonlyMap<string, number>): void {
    if (this.habitat) return;
    this.habitat = habitat; habitat.flies.add(this);
    const services = habitat.services, scheduler = services.scheduler;
    this.bornAt = scheduler.now - (this.entity.lightflier?.age ?? 0);
    const fly = this;
    this.world = { isDay: false, isAboveGroundAtPoint: () => true,
      findEntity: (from, radius, fn, must = [], cant = [], one = []) => services.getPlayers().map(player => ({
        prefab: 'wilson', components: {}, isValid: () => player.isValid(), hasTag: (tag: string) => tag === 'player' || tag === 'scarytoprey',
        getPosition: () => player.position, getPhysicsRadius: () => .5 * WORLD_SCALE,
      })).filter(e => e.isValid() && must.every(t => e.hasTag(t)) && !cant.some(t => e.hasTag(t)) && (!one.length || one.some(t => e.hasTag(t)))
        && (from.getPosition() as Vector3).distanceToSquared(e.getPosition()) <= radius ** 2).find(e => !fn || fn(e, from)),
      getClosestInstWithTag: (tags, from, radius) => fly.world.findEntity(from, radius, undefined, tags),
    };
    this.locomotor = new LocoMotor(this, { arriveDistance: .15 * WORLD_SCALE });
    this.locomotor.walkspeed = this.locomotor.runspeed = 3.5 * WORLD_SCALE; this.components.locomotor = this.locomotor;
    this.animstate = new AnimState(scheduler, lengths, event => this.sg?.pushEvent(event));
    this.sg = new LightFlierStateGraph(this, scheduler); this.brain = new LightFlierBrain(this, WORLD_SCALE);
    this.targetSearch = new ComponentTimer(scheduler, () => { habitat.findFormation(this); if (this.isValid()) this.targetSearch!.start(1); });
    this.erosion = new ErodeAway(scheduler, amount => { this.erosionAmount = amount; }, () => this.remove());
    this.components.freezable = new Freezable({
      isValid: () => this.isValid(), isDead: () => this.isDead(), addTag: tag => this.entity.addTag(tag), removeTag: tag => this.entity.removeTag(tag),
      PushEvent: name => this.PushEvent(name), ListenForEvent: (name, fn) => this.entity.ListenForEvent(name, fn),
      stopBrain: () => this.brain.Pause(), restartBrain: () => this.brain.Resume(), components: this.components,
    }, scheduler);
    this.entity.components.freezable = this.components.freezable;
    this.components.burnable = new Burnable(this.entity, scheduler); this.entity.components.burnable = this.components.burnable;
    this.components.burnable.canlight = false; this.components.burnable.SetBurnTime(6 * 4 / 3);
    this.components.propagator = new Propagator(this.entity, 'small', () => [], WORLD_SCALE, scheduler, services.getWatchWorldContent);
    this.components.propagator.acceptsheat = false; this.entity.components.propagator = this.components.propagator;
    const hauntable = this.components.hauntable = new Hauntable(this.entity, scheduler); this.entity.components.hauntable = hauntable;
    hauntable.panicable = true; hauntable.SetOnHauntFn(() => { this.wakeUp(); hauntable.Panic(3); this.brain.ForceUpdate(); return true; });
    if (services.getWatchWorldContent) {
      this.components.sleeper = new Sleeper(this, services.getWatchWorldContent); this.components.sleeper.sleeptestfn = () => false;
      this.entity.components.sleeper = this.components.sleeper; this.entity.addTag('sleeper');
      this.tracker = new TileTracker(() => this.getPosition());
      const cycle = services.getWatchWorldContent(WorldContentKey.Cycle, stop => this.cleanups.push(stop), { tile: this.tracker.tile });
      const area = cycle.area ? watchSignal(cycle.area, stop => this.cleanups.push(stop)) : undefined;
      this.asleepHome = new ComponentTimer(scheduler, () => { if (!this.active.peek() && this.home?.isValid()) this.home.components.childspawner.GoHome(this); });
      createEffect(() => {
        const active = area?.get() ?? true, day = cycle.get() === 'day';
        this.setActive(active);
        if (!active && day && this.isValid()) {
          if (this.asleepHome!.snapshot.peek().status !== 'scheduled') this.asleepHome!.start(10 + this.random());
        } else this.asleepHome!.stop();
      });
    }
    if (this.isValid()) {
      this.brain.Start();
      if (this.active.peek()) { this.targetSearch.start(1); this.enableBuzz(true); } else this.brain.Pause();
    } else this.onPutInInventory();
  }
  setHome(home?: LightFlierFlower): void {
    this.components.homeseeker.SetHome(home);
    if (home) this.components.knownlocations.RememberLocation('home', home.getPosition());
  }
  findHome(): void {
    if (this.home?.isValid()) return;
    const home = [...this.habitat!.homes.values()].filter(h => h.isValid() && !h.hasTag('fire') && !h.hasTag('burnt')
      && h.getPosition().distanceToSquared(this.getPosition()) <= (10 * WORLD_SCALE) ** 2)
      .sort((a, b) => a.getPosition().distanceToSquared(this.getPosition()) - b.getPosition().distanceToSquared(this.getPosition()))[0];
    home?.components.childspawner.TakeOwnership(this);
  }
  formationActive(active: boolean): void {
    this.components.formationfollower.active = active;
    if (this.locomotor) { this.locomotor.walkspeed = 3.5 * WORLD_SCALE; this.locomotor.directdrive = active; }
  }
  PushBufferedAction(action: BufferedAction): void {
    if (this.bufferedaction === action) return;
    this.clearBufferedAction(); if (!action.isValid()) { action.fail(); return; }
    this.bufferedaction = action; if (!this.sg.startAction(action)) this.clearBufferedAction();
  }
  clearBufferedAction(): void { this.bufferedaction?.fail(); this.bufferedaction = undefined; }
  performBufferedAction(): boolean { const action = this.bufferedaction; this.bufferedaction = undefined; return action?.do() ?? false; }
  validHomeAction(): boolean { const target = this.bufferedaction?.target as BrainEntity | undefined; return !!target?.isValid() && !target.hasTag('fire') && !target.hasTag('burnt'); }
  wentHome(home: BrainEntity): boolean { return home === this.home && this.home.canGoHome() && this.home.components.childspawner.GoHome(this); }
  playAnimation(name: string, loop = false): void { this.animstate.PlayAnimation(name, loop); }
  pushAnimation(name: string, loop = false): void { this.animstate.PushAnimation(name, loop); }
  playSound(name: 'hit' | 'death'): void { this.sounds.add(PlaySound(`grotto/creatures/light_bug/${name}`, this.getPosition())); }
  enableBuzz(enabled: boolean): void {
    if (!enabled || !this.isValid() || !this.active.peek() || this.isDead()) { this.loop?.stop(); this.loop = undefined; }
    else if (!this.loop?.isPlaying()) this.loop = PlaySound(LIGHTFLIER_SOUNDS[0], this.getPosition());
  }
  land(landed: boolean): void { if (landed) this.entity.removeTag('flying'); else this.entity.addTag('flying'); }
  isSleeping(): boolean { return this.components.sleeper?.IsAsleep() ?? false; }
  wakeUp(): void { this.components.sleeper?.WakeUp(); }
  get erosionValue(): number { return this.erosionAmount; }
  private setActive(active: boolean): void {
    if (this.active.peek() === active) return;
    this.activeState.set(active);
    if (!active) {
      this.components.formationfollower.LeaveFormation(); this.components.formationfollower.StopUpdating(); this.targetSearch?.stop(); this.brain?.Pause(); this.enableBuzz(false);
    } else if (this.isValid()) {
      this.components.formationfollower.StartUpdating(); this.targetSearch?.start(1);
      if (!this.components.freezable?.IsFrozen() && !this.isSleeping()) this.brain?.Resume(); this.enableBuzz(true);
    }
  }
  dropDeathLoot(): void {
    this.entity.persists = false; this.entity.addTag('dead'); this.entity.components.workable?.SetWorkable(false);
    this.entity.addTag('NOCLICK');
    this.brain.Stop(); this.targetSearch?.stop(); this.habitat?.services.dropLoot('lightbulb', 1, this.getPosition().clone());
    this.erosion?.start(2);
  }
  private onPutInInventory(): void {
    this.home?.components.childspawner.OnChildKilled(this); this.setHome();
    this.targetSearch?.stop(); this.components.formationfollower.LeaveFormation(); this.components.formationfollower.StopUpdating();
    this.brain?.Stop(); this.locomotor?.Stop(); this.clearBufferedAction(); this.sg?.sg.pause(); this.animstate?.stop();
    this.components.sleeper?.StopTesting(); this.enableBuzz(false); this.entity.components.perishable.StartPerishing();
  }
  private onDropped(): void {
    this.entity.components.perishable.StopPerishing(); this.entity.components.workable?.SetWorkLeft(1);
    this.components.knownlocations.RememberLocation('home', this.getPosition());
    this.components.formationfollower.StartUpdating(); this.sg?.sg.resume(); this.sg?.goToState('idle'); this.brain?.Start();
    if (this.active.peek()) this.brain?.Resume();
    this.targetSearch?.start(1); this.components.sleeper?.StartTesting(); this.enableBuzz(true);
  }
  update(dt: number): void {
    if (!this.isValid()) return;
    this.tracker?.sync(); if (!this.active.peek()) return;
    const step = Math.max(0, Math.min(dt, this.habitat?.services.maxMovementStep ?? .1));
    if (!this.isDead()) {
      this.brain.tick(this.getTime());
      const follower = this.components.formationfollower;
      if (follower.updating && follower.targetpos && !this.sg.hasStateTag('busy')) {
        const target = follower.targetpos, p = this.getPosition();
        this.locomotor.walkspeed = Math.min(p.distanceTo(target) * 8, 10.5 * WORLD_SCALE);
        this.setRotation(this.getAngleToPoint(target.x, target.y, target.z));
        if (!this.locomotor.isUpdating) this.locomotor.WalkForward(true);
      }
      if (this.locomotor.isUpdating) this.locomotor.update(step);
    }
    this.sg.update(dt);
    this.erosion?.update();
    if (!this.sg.hasStateTag('busy') && this.speed > 0) {
      const angle = this.heading * Math.PI / 180;
      this.getPosition().add(new Vector3(Math.cos(angle) * this.speed * step, 0, -Math.sin(angle) * this.speed * step));
    }
  }
  OnSave(): NonNullable<InventoryStack['lightflier']> {
    const known = this.components.knownlocations.GetLocation('home');
    return { health: this.components.health.currenthealth, age: this.habitat ? this.getTime() - this.bornAt : this.entity.lightflier?.age ?? 0,
      ...(this.home ? { homeId: this.home.id } : {}), ...(known ? { knownHome: [known.x, known.y, known.z] } : {}) };
  }
  remove(): void { this.entity.remove(); }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.habitat?.flies.delete(this);
    this.components.formationfollower.dispose(); this.components.homeseeker.dispose(); this.components.sleeper?.dispose();
    this.components.follower.dispose();
    this.brain?.Stop(); this.sg?.dispose(); this.animstate?.dispose(); this.components.health.dispose();
    this.targetSearch?.stop(); this.erosion?.dispose(); this.loop?.stop(); for (const sound of this.sounds) sound.stop();
    this.asleepHome?.stop();
    this.components.freezable?.dispose(); this.components.burnable?.dispose(); this.components.propagator?.dispose(); this.components.hauntable?.dispose();
    for (const stop of this.cleanups.splice(0)) stop(); for (const stop of this.eventStops.values()) stop(); this.eventStops.clear();
  }
}

export function configureLightFlierEntity(entity: ItemEntity): void {
  if (entity.getComponent<LightFlier>(LIGHTFLIER_ID)) return;
  for (const tag of LIGHTFLIER_TAGS) entity.addTag(tag);
  entity.components.inventoryitem.canbepickedup = false; entity.components.inventoryitem.canbepickedupalive = true;
  entity.component(LIGHTFLIER_ID, () => new LightFlier(entity));
  entity.components.workable = entity.component('workable', () => {
    const workable = new Workable(entity); workable.SetWorkAction('NET'); workable.SetWorkLeft(1);
    workable.SetOnFinishCallback(worker => {
      const fly = entity.getComponent<LightFlier>(LIGHTFLIER_ID)!;
      fly.home?.components.childspawner.OnChildKilled(fly);
      worker.components?.inventory?.GiveItem(entity, entity.getPosition().clone());
    }); return workable;
  });
  entity.components.eater = entity.component('eater', () => new Eater(entity)); entity.components.eater.SetDiet(['VEGGIE']);
  entity.components.eater.SetOnEatFn(() => entity.components.perishable.SetPercent(1));
  const perishable = entity.components.perishable;
  if (perishable.perishtime.peek() === undefined) perishable.SetPerishTime(LIGHTFLIER_PERISH_TIME);
  perishable.localMultiplier = () => entity.components.inventoryitem.owner ? 1 : 0;
  perishable.perishfn = () => {
    const owner = entity.components.inventoryitem.owner; if (!owner) return;
    owner.PushEvent('murdered', { victim: entity, stackmult: entity.components.stackable.count, negligent: true });
    // Guaranteed one lightbulb per insect, so replacement retains exactly the original stack size.
    owner.replace('lightbulb');
  };
  if (!entity.components.inventoryitem.owner) perishable.StopPerishing();
}

export function createLightFlierGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  const own = !context.lightflierWorld;
  const habitat = context.lightflierWorld ?? new LightFlierHabitat(context.animationBaseUrl, {
    scheduler: context.scheduler!, getPlayers: () => [], spawnItem: state => new ItemEntity(state),
    showItem: () => {}, dropLoot: (itemId, count, position) => {
      void context.dropLoot?.([{ itemId, count, name: itemId, icon: `${itemId}.tex` }], position);
    },
  });
  const createPrepared = (): GroundItemVisual => {
      const sprite = new ResidentSprite(clip => habitat.createSprite(clip.name, clip.loop), { name: 'walk_loop', loop: true }, habitat.createSprite(), LIGHTFLIER_ID);
      const active = createSignal(true);
      const cleanups: (() => void)[] = []; let fly: LightFlier | undefined;
      const heading = habitat.services.cameraHeading ? watchSignal(habitat.services.cameraHeading, stop => cleanups.push(stop)) : undefined;
      return { model: sprite.model, active: readonlySignal(active),
        bindEntity: entity => {
          configureLightFlierEntity(entity); fly = entity.getComponent<LightFlier>(LIGHTFLIER_ID)!; habitat.bind(fly);
          const animation = watchSignal(fly.animstate.animation, stop => cleanups.push(stop));
          const awake = watchSignal(fly.active, stop => cleanups.push(stop));
          // OnEntitySleep/OnEntityWake: frames and instance entries exist only while the tile is active.
          createEffect(() => { active.set(awake.get()); sprite.setActive(awake.get()); if (!awake.get()) setPrefabLocalLight(sprite.model, null); });
          createEffect(() => { const { name, loop } = animation.get(); if (loop) sprite.start(name); else sprite.playOnce(name); });
          Object.assign(sprite.model.userData, { lightflier: fly, tags: [...LIGHTFLIER_TAGS], physicsRadius: .5 * WORLD_SCALE });
          setPrefabLightOverride(sprite.model, 1);
        },
        update: dt => {
          fly?.update(dt); sprite.setFacing(fourFacingFromRotation(fly?.facing ?? 0, heading?.peek() ?? 0)); sprite.update(dt);
          sprite.setErosion(fly?.erosionValue ?? 0);
          setPrefabLocalLight(sprite.model, fly?.isValid() ? { radius: 1.8 * WORLD_SCALE, intensity: .5, falloff: .7, colour: [237 / 255, 237 / 255, 209 / 255] } : null);
        },
        isClickable: () => fly?.isValid() ?? true,
        dispose: () => { cleanups.splice(0).forEach(stop => stop()); setPrefabLocalLight(sprite.model, null); sprite.dispose(); },
      };
    };
  return { itemIds: [LIGHTFLIER_ID], capture: 'net', configureEntity: configureLightFlierEntity,
    createPrepared, create: async () => { await habitat.prepare(); return createPrepared(); },
    update: dt => { if (own) habitat.update(dt); }, dispose: () => { if (own) habitat.dispose(); },
  };
}

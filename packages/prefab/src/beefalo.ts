import { syncPlacementEntity } from './placementEntities';
import * as CANNON from 'cannon-es';
import { getRegisteredPhysicsBodies } from '../../componets/src/physicsWorld';
import * as THREE from 'three';
import { createBeefaloSpriteFactory, type FacingSpriteAnimationController } from '@dontstarve-web/animation/beefaloSprite';
import type { AnimatedSpriteFactory } from '@dontstarve-web/animation/sprite';
import { createEffect, createSignal, readonlySignal, type ReadonlySignal, type WorldPhase, type WorldSeason, type WorldContentContext } from '@dontstarve-web/signals';
import { Beard, type BeardSave } from '../../componets/src/beard';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Sleeper } from '../../componets/src/sleeper';
import { actionEntity } from './actionEntity';
import type { LocomotorOptions } from './locomotor';
import { LocoMotor, type LocoMotorInst } from '../../componets/src/locomotor';
import { KnownLocations } from '../../componets/src/knownlocations';
import { PeriodicSpawner } from '../../componets/src/periodicspawner';
import { BeefaloBrain } from '../../brains/src/beefalobrain';
import type { FaceEntityInst } from '../../brains/src/behaviours/faceentity';
import type { BrainEntity, BrainWorld } from '../../brains/src/types';
import { BeefaloStateGraph, type BeefaloStateName } from '../../stategraphs/src/SGBeefalo';
import { newEntityId } from './saveRecord';
import { DampCharacterVelocity, MakeCharacterPhysics, WORLD_SCALE } from './standardcomponents';
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
  phase: WorldPhase;
  season: WorldSeason;
  scheduler: GameTimeScheduler;
  /** Seconds from scheduler time `now` to the world's next day boundary; the world owns the day length. */
  secondsUntilNextDay(now: number): number;
  /** beard.lua SpawnPrefab(prize) launched from the beefalo's position. */
  spawnPrize(prefab: string, count: number, position: THREE.Vector3): void;
  getPlayerPositions(): readonly THREE.Vector3[];
  findPath: NonNullable<LocomotorOptions['findPath']>;
  constrainPosition(position: THREE.Vector3): void;
  /** Logical ground/pending manure positions for periodicspawner's density and spacing rules. */
  getPoopPositions(): Iterable<THREE.Vector3>;
  spawnPoop(position: THREE.Vector3): void;
}

export interface BeefaloManagerWorld extends Omit<BeefaloWorld, 'phase' | 'season' | 'scheduler'> {
  scheduler?: GameTimeScheduler;
  clock: ReadonlySignal<{ phase: BeefaloWorld['phase'] }>;
  season: ReadonlySignal<{ season: BeefaloWorld['season'] }>;
}

export interface BeefaloSaveState {
  /** Legacy home field; named locations are authoritative in new saves. */
  home: [number, number, number];
  knownlocations?: { locations: { name: string; x: number; y: number; z: number }[] };
  heading: number;
  poopRemainingSeconds: number;
  /** beard.lua OnSave; absent in saves written before the beard component existed. */
  beard?: BeardSave;
}

export interface BeefaloRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { beefalo: BeefaloSaveState };
}

export type BeefaloState = BeefaloStateName;

/** beefalo.lua owns components and physics; its brain and stategraph own behavior and states. */
export class BeefaloController {
  private readonly groundPosition = new THREE.Vector3();
  readonly locomotor: LocoMotor;
  readonly knownlocations = new KnownLocations();
  readonly periodicspawner: PeriodicSpawner;
  readonly brain: BeefaloBrain;
  readonly sg: BeefaloStateGraph;
  private readonly home: THREE.Vector3;
  private readonly direction = new THREE.Vector3(1, 0, 0);
  private readonly right = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private disposed = false;
  private readonly hairGrowthPendingState = createSignal(false);
  readonly hairGrowthPending = readonlySignal(this.hairGrowthPendingState);
  private readonly stopAppearance: () => void;
  readonly beard: Beard;
  readonly sleeper: Sleeper;
  readonly model: THREE.Group;
  readonly body: CANNON.Body;
  private readonly animation: FacingSpriteAnimationController;
  private readonly world: BeefaloWorld;
  private readonly random: () => number;

  constructor(model: THREE.Group, body: CANNON.Body, animation: FacingSpriteAnimationController,
    world: BeefaloWorld, saved?: BeefaloSaveState, random = Math.random) {
    this.model = model; this.body = body; this.animation = animation;
    this.world = world; this.random = random;
    this.home = saved ? new THREE.Vector3(...saved.home) : model.position.clone().setY(0);
    if (saved) {
      const heading = THREE.MathUtils.degToRad(saved.heading);
      this.direction.set(Math.cos(heading), 0, -Math.sin(heading));
      this.knownlocations.OnLoad(saved.knownlocations ?? {
        locations: [{ name: 'herd', x: saved.home[0], y: saved.home[1], z: saved.home[2] }],
      });
    }
    const controller = this;
    const motorInst: LocoMotorInst = {
      isValid: () => this.isValid(), getPosition: () => this.getPosition(),
      getPhysicsRadius: () => BEEFALO_BEHAVIOR.radius,
      setRotation: degrees => this.setRotation(degrees),
      getAngleToPoint: (x, _y, z) => this.getAngleToPoint(x, z),
      setMotorSpeed: speed => {
        this.body.velocity.x = this.direction.x * speed;
        this.body.velocity.z = this.direction.z * speed;
      },
      get sg() { return controller.sg; },
      components: {}, PushEvent: (name, data) => this.PushEvent(name, data),
      PushBufferedAction: () => { throw new Error('Passive beefalo has no buffered actions'); },
    };
    this.locomotor = new LocoMotor(motorInst, {
      arriveDistance: .15 * WORLD_SCALE,
      findPath: (start, target) => world.findPath(new THREE.Vector3(start.x, start.y, start.z),
        new THREE.Vector3(target.x, target.y, target.z)),
    });
    this.locomotor.walkspeed = BEEFALO_BEHAVIOR.walkSpeed;
    this.locomotor.runspeed = 7 * WORLD_SCALE;
    Object.assign(model.userData, { prefab: 'beefalo', beefaloController: this,
      tags: ['beefalo', 'animal', 'largecreature'] });
    this.beard = new Beard(this, {
      scheduler: world.scheduler,
      secondsUntilNextDay: now => world.secondsUntilNextDay(now),
      spawnPrize: (prefab, count, point) => world.spawnPrize(prefab, count, new THREE.Vector3(point.x, point.y, point.z)),
    });
    this.beard.SetBits(BEEFALO_BEARD_BITS);
    this.beard.SetDaysGrowth(BEEFALO_HAIR_GROWTH_DAYS + 1);
    this.beard.onreset = () => this.onResetBeard();
    this.beard.canshavetest = () => this.canShaveTest();
    this.beard.prize = BEEFALO_PRIZE;
    // OnShaved only applies build overrides; the hairy memo owns the shaved build.
    this.beard.AddCallback(0, () => undefined);
    this.beard.AddCallback(BEEFALO_HAIR_GROWTH_DAYS, () => {
      if (this.beard.bits.peek() === 0) this.hairGrowthPendingState.set(true);
    });
    this.sleeper = new Sleeper({
      isValid: () => this.isValid(), PushEvent: (name, data) => this.PushEvent(name, data),
      get sg() { return controller.sg; },
      get components() { return controller.components; },
    }, world.getWatchWorldContent, () => this.random());
    this.sleeper.SetResistance(3);
    this.periodicspawner = new PeriodicSpawner(world.scheduler, () => {
      const position = this.model.position.clone().addScaledVector(this.direction, -WORLD_SCALE).setY(0);
      world.constrainPosition(position);
      world.spawnPoop(position);
      return { spawned: true };
    }, () => this.random(), {
      getPosition: () => this.getPosition(), getPrefabPositions: () => world.getPoopPositions(),
    });
    this.periodicspawner.SetRandomTimes(40, 60);
    this.periodicspawner.SetDensityInRange(BEEFALO_BEHAVIOR.poopDensityRadius, 2);
    this.periodicspawner.SetMinimumSpacing(BEEFALO_BEHAVIOR.poopSpacing);
    this.periodicspawner.Start(saved?.poopRemainingSeconds);
    const beard = this.beard;
    model.userData.components = { ...this.components, beard, sleeper: this.sleeper,
      beefalo: { HasTag: (tag: string) => tag === 'has_beard' ? beard.hairy.peek() : undefined } };
    actionEntity(model, 'beefalo');
    this.stopAppearance = createEffect(() => this.animation.setShaved(!beard.hairy.get()));
    if (saved?.beard) this.beard.OnLoad(saved.beard);
    this.sg = new BeefaloStateGraph({
      locomotor: this.locomotor, sleeper: this.sleeper,
      hairGrowthPending: () => this.hairGrowthPendingState.peek(),
      growHair: () => { this.beard.SetBits(BEEFALO_BEARD_BITS); this.hairGrowthPendingState.set(false); },
      playAnimation: (name, loop) => animation.playAnimation(name, loop),
      pushAnimation: (name, loop) => animation.pushAnimation(name, loop),
      getCurrentAnimationLength: () => animation.currentAnimationLength,
      isCurrentAnimation: name => animation.currentAnimation === name,
      random: () => this.random(),
    }, world.scheduler);
    animation.onAnimationEvent = event => this.PushEvent(event);
    this.sg.sg.listenForEvent('newstate', () => { model.userData.beefaloState = this.state; });
    model.userData.beefaloState = this.state;
    this.brain = new BeefaloBrain(this.createBrainInst(), WORLD_SCALE);
    this.brain.Start();
  }

  get state(): BeefaloState { return this.sg.stateName; }

  /** Run before physics; only animation and locomotion need a per-frame update. */
  update(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt < 0) return;
    const step = Math.min(dt, .1);
    this.animation.update(step);
    this.sg.update(step);
    this.brain.tick(this.world.scheduler.now);
    this.locomotor.update(step);
  }

  private setRotation(degrees: number): void {
    const heading = THREE.MathUtils.degToRad(degrees);
    this.direction.set(Math.cos(heading), 0, -Math.sin(heading));
  }

  private getAngleToPoint(x: number, z: number): number {
    return THREE.MathUtils.radToDeg(Math.atan2(this.body.position.z - z, x - this.body.position.x));
  }

  private createBrainInst(): FaceEntityInst {
    const players = new WeakMap<THREE.Vector3, BrainEntity>();
    const playerEntities = () => this.world.getPlayerPositions().map(position => {
      let entity = players.get(position);
      if (!entity) {
        entity = { prefab: 'wilson', components: {}, hasTag: tag => tag === 'player',
          isValid: () => this.world.getPlayerPositions().includes(position),
          getPosition: () => position, getPhysicsRadius: () => 0 };
        players.set(position, entity);
      }
      return entity;
    });
    const nearest = (from: BrainEntity, radius: number, test: (entity: BrainEntity) => boolean) => {
      const position = from.getPosition();
      return playerEntities().filter(entity => test(entity)
        && distanceSquared(position, entity.getPosition()) <= radius ** 2)
        .sort((a, b) => distanceSquared(position, a.getPosition()) - distanceSquared(position, b.getPosition()))[0];
    };
    const controller = this;
    const brainWorld: BrainWorld = {
      get isDay() { return controller.world.phase === 'day'; },
      findEntity: (from, radius, fn, must, cant, oneOf) => nearest(from, radius, entity =>
        (!fn || fn(entity, from)) && (!must || must.every(tag => entity.hasTag(tag)))
        && (!cant || !cant.some(tag => entity.hasTag(tag))) && (!oneOf || oneOf.some(tag => entity.hasTag(tag)))),
      getClosestInstWithTag: (tags, from, radius) => nearest(from, radius, entity => tags.every(tag => entity.hasTag(tag))),
      isAboveGroundAtPoint: (x, y, z) => {
        const point = new THREE.Vector3(x, y, z);
        this.world.constrainPosition(point);
        return point.x === x && point.z === z && this.world.findPath(point, point) !== null;
      },
    };
    return {
      prefab: 'beefalo', world: brainWorld, components: this.components,
      sg: { hasStateTag: tag => this.sg.hasStateTag(tag), hasState: name => this.sg.hasState(name),
        goToState: name => this.sg.goToState(name as BeefaloState) },
      getTime: () => this.world.scheduler.now, random: () => this.random(),
      getPosition: () => this.getPosition(), isValid: () => this.isValid(),
      getPhysicsRadius: () => BEEFALO_BEHAVIOR.radius,
      hasTag: tag => this.model.userData.actionEntity.hasTag(tag),
      getAngleToPoint: (x, _y, z) => this.getAngleToPoint(x, z),
      isNear: (entity, distance) => distanceSquared(this.getPosition(), entity.getPosition()) < distance ** 2,
      facePoint: point => this.setRotation(this.getAngleToPoint(point.x, point.z)),
      ListenForEvent: (name, fn) => this.model.addEventListener(name as never, fn as never),
      RemoveEventCallback: (name, fn) => this.model.removeEventListener(name as never, fn as never),
    };
  }

  /** Run after physics. The source origin is the foot point, regardless of pose. */
  sync(cameraQuaternion: THREE.Quaternion): void {
    this.model.position.set(this.body.position.x, 0, this.body.position.z);
    this.world.constrainPosition(this.model.position);
    if (this.body.position.x !== this.model.position.x || this.body.position.z !== this.model.position.z) {
      this.body.position.x = this.model.position.x;
      this.body.position.z = this.model.position.z;
      this.body.aabbNeedsUpdate = true;
    }
    syncPlacementEntity(this.model);
    this.model.quaternion.copy(cameraQuaternion);
    this.right.set(1, 0, 0).applyQuaternion(cameraQuaternion).setY(0).normalize();
    this.forward.set(0, 0, -1).applyQuaternion(cameraQuaternion).setY(0).normalize();
    const x = this.direction.dot(this.right);
    const z = this.direction.dot(this.forward);
    // SixFaced: side (RIGHT/LEFT), up diagonals, down diagonals. Pure up/down
    // use the corresponding diagonal art; mirrored pairs share the source mask.
    const facing = Math.abs(z) < 0.5 ? (x < 0 ? 4 : 1)
      : z > 0 ? (x < 0 ? 32 : 16) : (x < 0 ? 128 : 64);
    this.animation.setFacing(facing, x < 0);
  }

  exportState(): BeefaloSaveState {
    return { home: this.home.toArray(), knownlocations: this.knownlocations.OnSave() ?? { locations: [] },
      heading: THREE.MathUtils.euclideanModulo(
        THREE.MathUtils.radToDeg(Math.atan2(-this.direction.z, this.direction.x)), 360),
      poopRemainingSeconds: this.periodicspawner.OnSave()?.time ?? 0, beard: this.beard.OnSave() };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.animation.onAnimationEvent = undefined;
    this.brain.Stop();
    this.sg.dispose();
    this.locomotor.Stop();
    this.periodicspawner.dispose();
    this.stopAppearance();
    this.beard.dispose();
    this.sleeper.dispose();
  }

  // Entity surface read by components and actions.
  isValid(): boolean { return !this.disposed; }
  getPosition(): THREE.Vector3 {
    return this.groundPosition.set(this.body.position.x, 0, this.body.position.z);
  }
  PushEvent(name: string, data?: unknown): void {
    if (this.disposed) return;
    if (name === 'gotosleep') this.brain?.Stop();
    else if (name === 'onwakeup') this.brain?.Start();
    this.sg?.pushEvent(name, data);
    this.model.dispatchEvent({ type: name, data } as never);
  }
  get components() { return { locomotor: this.locomotor, knownlocations: this.knownlocations,
    periodicspawner: this.periodicspawner }; }

  private canShaveTest(): { ok: true } | { ok: false; reason?: string } {
    return this.sleeper.IsAsleep() ? { ok: true } : { ok: false, reason: 'AWAKEBEEFALO' };
  }

  /** beefalo.lua OnResetBeard preserves sleep through the sleeping state's onexit. */
  private onResetBeard(): void {
    if (this.sleeper.IsAsleep()) this.sg.sg.statemem.continuesleeping = true;
    this.sg.goToState('shaved');
  }

}

function distanceSquared(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

/** Shared source atlases, independent AI/merged sprite geometry and physics bodies. */
export class BeefaloManager {
  private factoryRequest?: Promise<AnimatedSpriteFactory>;
  private readonly beefalos = new Set<BeefaloController>();
  private readonly pendingSpawns = new Set<THREE.Vector3>();
  private disposed = false;
  private readonly scene: THREE.Scene;
  private readonly physics: CANNON.World;
  private readonly assetBaseUrl: string;
  private readonly world: BeefaloWorld;
  private readonly material = new CANNON.Material({ friction: 0, restitution: 0 });
  private readonly contactMaterials: CANNON.ContactMaterial[];
  private readonly stopClock: () => void;
  private readonly stopSeason: () => void;
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;

  constructor(scene: THREE.Scene, physics: CANNON.World, assetBaseUrl: string, world: BeefaloManagerWorld) {
    this.scene = scene;
    this.physics = physics;
    this.assetBaseUrl = assetBaseUrl;
    this.ownsScheduler = world.scheduler === undefined;
    this.scheduler = world.scheduler ?? new GameTimeScheduler();
    const initialClock = world.clock.peek();
    this.world = {
      ...world, scheduler: this.scheduler, phase: initialClock.phase, season: world.season.peek().season,
    };
    physics.addEventListener('postStep', this.dampBeefalos);
    this.stopClock = world.clock.subscribe(({ phase }) => { this.world.phase = phase; });
    this.stopSeason = world.season.subscribe(({ season }) => { this.world.season = season; });
    // MakeCharacterPhysics sets friction to zero. Cannon otherwise cancels the
    // low walking speed on this heavy, fixed-rotation body's ground contacts.
    const materials = new Set([physics.defaultMaterial, ...getRegisteredPhysicsBodies(physics).map((body) => body.material)
      .filter((material): material is CANNON.Material => material !== null)]);
    this.contactMaterials = Array.from(materials, (material) => {
      const contact = new CANNON.ContactMaterial(this.material, material, { friction: 0, restitution: 0 });
      physics.addContactMaterial(contact);
      return contact;
    });
  }

  private readonly dampBeefalos = (): void => {
    for (const beefalo of this.beefalos) DampCharacterVelocity(beefalo.body, this.physics.dt);
  };

  async spawnNear(position: THREE.Vector3): Promise<THREE.Group> {
    for (let ring = 1; ring <= 4; ring++) {
      for (let index = 0; index < 16; index++) {
        const angle = index * Math.PI / 8;
        const target = new THREE.Vector3(position.x + Math.cos(angle) * ring * 10, 0,
          position.z + Math.sin(angle) * ring * 10);
        this.world.constrainPosition(target);
        const occupied = getRegisteredPhysicsBodies(this.physics).some((body) => body.collisionResponse && body.shapes.some((shape) =>
          shape instanceof CANNON.Sphere && Math.hypot(target.x - body.position.x, target.z - body.position.z)
            < shape.radius + BEEFALO_BEHAVIOR.radius + 1));
        if (!occupied && !Array.from(this.pendingSpawns).some((point) =>
          point.distanceToSquared(target) < (BEEFALO_BEHAVIOR.radius * 2 + 1) ** 2)
          && this.world.findPath(target, target)) {
          this.pendingSpawns.add(target);
          try { return await this.spawn(target); }
          finally { this.pendingSpawns.delete(target); }
        }
      }
    }
    throw new Error('附近没有可生成 beefalo 的空地');
  }

  async spawn(position: THREE.Vector3, saved?: BeefaloRecord): Promise<THREE.Group> {
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid beefalo position');
    if (this.disposed) throw new Error('Beefalo manager has been disposed');
    if (!this.factoryRequest) {
      this.factoryRequest = createBeefaloSpriteFactory(this.assetBaseUrl);
      void this.factoryRequest.catch(() => { this.factoryRequest = undefined; });
    }
    const factory = await this.factoryRequest;
    if (this.disposed) throw new Error('Beefalo manager has been disposed');
    const model = factory.create({ initialAnimation: 'idle_loop', name: 'beefalo' });
    model.position.copy(position).setY(0);
    this.world.constrainPosition(model.position);
    model.userData.entityId = saved?.id ?? newEntityId();
    const body = new CANNON.Body({ ...MakeCharacterPhysics(100, 0.5), material: this.material,
      position: new CANNON.Vec3(model.position.x, BEEFALO_BEHAVIOR.radius, model.position.z),
      linearDamping: 0 });
    const controller = new BeefaloController(model, body, model.userData.animationController, this.world, saved?.components.beefalo);
    this.beefalos.add(controller);
    this.physics.addBody(body);
    this.scene.add(model);
    return model;
  }

  update(dt: number): void {
    if (this.ownsScheduler && Number.isFinite(dt) && dt > 0) this.scheduler.advance(Math.min(dt, 0.1));
    for (const beefalo of this.beefalos) beefalo.update(dt);
  }
  sync(cameraQuaternion: THREE.Quaternion): void { for (const beefalo of this.beefalos) beefalo.sync(cameraQuaternion); }

  /** TheSim:FindEntities around a point on the ground plane: the beefalo's engine inst, with its tags and components. */
  entitiesNear(position: { readonly x: number; readonly z: number }, range: number): readonly ReturnType<typeof actionEntity>[] {
    return Array.from(this.beefalos).filter(({ model }) =>
      Math.hypot(model.position.x - position.x, model.position.z - position.z) <= range)
      .map(({ model }) => model.userData.actionEntity as ReturnType<typeof actionEntity>);
  }

  get renderEntities() {
    return Array.from(this.beefalos, ({ model }) => ({ object: model, footPosition: model.position, cameraDepth: 0 }));
  }

  exportRecords(): BeefaloRecord[] {
    return Array.from(this.beefalos, (beefalo) => ({
      id: String(beefalo.model.userData.entityId),
      transform: { position: beefalo.model.position.toArray(), rotationY: 0 },
      components: { beefalo: beefalo.exportState() },
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.physics.removeEventListener('postStep', this.dampBeefalos);
    this.stopClock();
    this.stopSeason();
    if (this.ownsScheduler) this.scheduler.dispose();
    for (const beefalo of this.beefalos) {
      beefalo.dispose();
      this.physics.removeBody(beefalo.body);
      beefalo.model.removeFromParent();
    }
    this.beefalos.clear();
    for (const contact of this.contactMaterials) this.physics.removeContactMaterial(contact);
    void this.factoryRequest?.then((factory) => factory.dispose(), () => undefined);
  }
}

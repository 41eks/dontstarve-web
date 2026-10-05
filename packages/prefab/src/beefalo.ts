import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { createBeefaloSpriteFactory, type FacingSpriteAnimationController } from '@dontstarve-web/animation/beefaloSprite';
import type { AnimatedSpriteFactory } from '@dontstarve-web/animation/sprite';
import { Locomotor, type LocomotorOptions } from './locomotor';
import { newEntityId } from './saveRecord';
import { TILE_SIZE } from './tile';

const WORLD_SCALE = TILE_SIZE / 4;
/** beefalo.lua, beefalobrain.lua and SGBeefalo.lua; distances use this world's scale. */
export const BEEFALO_BEHAVIOR = {
  radius: 0.5 * WORLD_SCALE,
  walkSpeed: 1 * WORLD_SCALE,
  wanderDay: 20 * WORLD_SCALE,
  wanderNight: 5 * WORLD_SCALE,
  faceDistance: 4 * WORLD_SCALE,
  keepFaceDistance: 6 * WORLD_SCALE,
  poopMinSeconds: 40,
  poopMaxSeconds: 60,
  poopSpacing: 8 * WORLD_SCALE,
  poopDensityRadius: 20 * WORLD_SCALE,
} as const;

export interface BeefaloWorld {
  isDay(): boolean;
  isNight(): boolean;
  getPlayerPositions(): readonly THREE.Vector3[];
  findPath: NonNullable<LocomotorOptions['findPath']>;
  constrainPosition(position: THREE.Vector3): void;
  /** Host applies periodicspawner's density and spacing rules. */
  spawnPoop(position: THREE.Vector3): void;
}

export interface BeefaloSaveState {
  home: [number, number, number];
  heading: number;
  poopRemainingSeconds: number;
}

export interface BeefaloRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { beefalo: BeefaloSaveState };
}

export type BeefaloState = 'idle' | 'walk_pre' | 'walk' | 'walk_pst' | 'graze_pre' | 'graze' | 'graze_pst'
  | 'shake' | 'bellow' | 'sleep_pre' | 'sleep' | 'sleep_pst';

/** A passive wild adult: locomotion, idle actions, FaceEntity, sleep and manure. */
export class BeefaloController {
  private currentState: BeefaloState = 'idle';
  private readonly locomotor: Locomotor;
  private readonly home: THREE.Vector3;
  private readonly direction = new THREE.Vector3(1, 0, 0);
  private readonly right = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private faceTarget?: THREE.Vector3;
  private idleRemaining = 0;
  private wanderRemaining = 0;
  private walkRemaining = 0;
  private grazeRemaining = 0;
  private poopRemaining: number;
  private disposed = false;
  readonly model: THREE.Group;
  readonly body: CANNON.Body;
  private readonly animation: FacingSpriteAnimationController;
  private readonly world: BeefaloWorld;
  private readonly random: () => number;

  constructor(model: THREE.Group, body: CANNON.Body, animation: FacingSpriteAnimationController,
    world: BeefaloWorld, saved?: BeefaloSaveState, random = Math.random) {
    this.model = model;
    this.body = body;
    this.animation = animation;
    this.world = world;
    this.random = random;
    this.home = saved ? new THREE.Vector3(...saved.home) : model.position.clone().setY(0);
    if (saved) {
      const heading = THREE.MathUtils.degToRad(saved.heading);
      this.direction.set(Math.cos(heading), 0, -Math.sin(heading));
    }
    this.poopRemaining = saved?.poopRemainingSeconds ?? this.nextPoopTime();
    this.locomotor = new Locomotor(body, { findPath: world.findPath, arriveDistance: 0.3 });
    Object.assign(model.userData, { prefab: 'beefalo', beefaloController: this,
      tags: ['beefalo', 'animal', 'largecreature', 'bearded'] });
    this.idle();
    this.wanderRemaining = 1 + random() * 3;
  }

  get state(): BeefaloState { return this.currentState; }

  /** Run before physics, so the body's velocity participates in world collisions. */
  update(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt < 0) return;
    const step = Math.min(dt, 0.1);
    this.animation.update(step);
    this.poopRemaining -= step;
    if (this.poopRemaining <= 0) {
      this.poopRemaining = this.nextPoopTime();
      const position = this.model.position.clone().addScaledVector(this.direction, -WORLD_SCALE).setY(0);
      this.world.constrainPosition(position);
      this.world.spawnPoop(position);
    }

    if (this.world.isNight()) {
      if (this.currentState !== 'sleep_pre' && this.currentState !== 'sleep') {
        this.locomotor.stop();
        this.faceTarget = undefined;
        this.setState('sleep_pre');
        this.once('sleep_pre', () => { this.setState('sleep'); this.animation.start('sleep_loop'); });
      }
      return;
    }
    if (this.currentState === 'sleep' || this.currentState === 'sleep_pre') {
      this.setState('sleep_pst');
      this.once('sleep_pst', () => this.idle());
      return;
    }
    if (this.currentState === 'sleep_pst') return;

    // Wild beefalo look at players rather than fleeing or attacking on proximity.
    const players = this.world.getPlayerPositions();
    if (this.faceTarget && (!players.includes(this.faceTarget)
      || distanceSquared(this.model.position, this.faceTarget) > BEEFALO_BEHAVIOR.keepFaceDistance ** 2)) {
      this.faceTarget = undefined;
      this.wanderRemaining = 1 + this.random() * 3;
    }
    if (!this.faceTarget) {
      this.faceTarget = players.reduce<THREE.Vector3 | undefined>((nearest, position) =>
        distanceSquared(this.model.position, position) <= BEEFALO_BEHAVIOR.faceDistance ** 2
          && (!nearest || distanceSquared(this.model.position, position) < distanceSquared(this.model.position, nearest))
          ? position : nearest, undefined);
    }
    if (this.faceTarget) {
      const toward = this.faceTarget.clone().sub(this.model.position).setY(0);
      if (toward.lengthSq() > 1e-6) this.direction.copy(toward.normalize());
      if (this.currentState === 'walk' || this.currentState === 'walk_pre') this.stopWalking();
    }

    if (this.currentState === 'walk') {
      this.walkRemaining -= step;
      this.locomotor.update(BEEFALO_BEHAVIOR.walkSpeed, step);
      const speed = Math.hypot(this.body.velocity.x, this.body.velocity.z);
      if (speed > 0.01) this.direction.set(this.body.velocity.x / speed, 0, this.body.velocity.z / speed);
      if (this.walkRemaining <= 0 || !this.locomotor.destination) this.stopWalking();
      return;
    }
    if (this.currentState === 'walk_pre' || this.currentState === 'walk_pst') return;

    if (!this.faceTarget) {
      this.wanderRemaining -= step;
      if (this.wanderRemaining <= 0 && this.startWalking()) return;
    }
    if (this.currentState === 'graze') {
      this.grazeRemaining -= step;
      if (this.grazeRemaining <= 0) {
        this.setState('graze_pst');
        this.once('graze2_pst', () => this.idle());
      }
    } else if (this.currentState === 'idle') {
      this.idleRemaining -= step;
      if (this.idleRemaining <= 0) {
        const choice = this.random();
        if (choice < 0.5) {
          this.setState('graze_pre');
          this.grazeRemaining = 1 + this.random() * 5;
          this.once('graze2_pre', () => { this.setState('graze'); this.animation.start('graze2_loop'); });
        } else {
          const action = choice < 0.75 ? 'shake' : 'bellow';
          this.setState(action);
          this.once(action, () => this.idle());
        }
      }
    }
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
    return { home: this.home.toArray(), heading: THREE.MathUtils.euclideanModulo(
      THREE.MathUtils.radToDeg(Math.atan2(-this.direction.z, this.direction.x)), 360),
    poopRemainingSeconds: this.poopRemaining };
  }

  dispose(): void { this.disposed = true; this.locomotor.stop(); }

  private startWalking(): boolean {
    const radius = this.world.isDay() ? BEEFALO_BEHAVIOR.wanderDay : BEEFALO_BEHAVIOR.wanderNight;
    for (let attempt = 0; attempt < 4; attempt++) {
      const angle = this.random() * Math.PI * 2;
      const distance = radius * (0.2 + this.random() * 0.8);
      const target = this.home.clone().add(new THREE.Vector3(Math.cos(angle) * distance, 0, Math.sin(angle) * distance));
      this.world.constrainPosition(target);
      if (distanceSquared(this.model.position, target) < 1 || !this.locomotor.goToPoint(target)) continue;
      this.direction.copy(target).sub(this.model.position).setY(0).normalize();
      this.walkRemaining = 2 + this.random() * 3;
      this.setState('walk_pre');
      this.once('walk_pre', () => { this.setState('walk'); this.animation.start('walk_loop'); });
      return true;
    }
    this.wanderRemaining = 1 + this.random() * 3;
    return false;
  }

  private stopWalking(): void {
    this.locomotor.stop();
    this.wanderRemaining = 1 + this.random() * 3;
    this.setState('walk_pst');
    this.once('walk_pst', () => this.idle());
  }

  private idle(): void {
    this.setState('idle');
    this.idleRemaining = 1 + this.random();
    this.animation.start('idle_loop');
  }

  private setState(state: BeefaloState): void {
    this.currentState = state;
    this.model.userData.beefaloState = state;
  }

  private once(clip: string, callback: () => void): void {
    const state = this.currentState;
    this.animation.playOnce(clip, () => { if (!this.disposed && this.currentState === state) callback(); });
  }

  private nextPoopTime(): number { return BEEFALO_BEHAVIOR.poopMinSeconds + this.random() * 20; }
}

function distanceSquared(a: THREE.Vector3, b: THREE.Vector3): number {
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

  constructor(scene: THREE.Scene, physics: CANNON.World, assetBaseUrl: string, world: BeefaloWorld) {
    this.scene = scene;
    this.physics = physics;
    this.assetBaseUrl = assetBaseUrl;
    this.world = world;
    // MakeCharacterPhysics sets friction to zero. Cannon otherwise cancels the
    // low walking speed on this heavy, fixed-rotation body's ground contacts.
    const materials = new Set([physics.defaultMaterial, ...physics.bodies.map((body) => body.material)
      .filter((material): material is CANNON.Material => material !== null)]);
    this.contactMaterials = Array.from(materials, (material) => {
      const contact = new CANNON.ContactMaterial(this.material, material, { friction: 0, restitution: 0 });
      physics.addContactMaterial(contact);
      return contact;
    });
  }

  async spawnNear(position: THREE.Vector3): Promise<THREE.Group> {
    for (let ring = 1; ring <= 4; ring++) {
      for (let index = 0; index < 16; index++) {
        const angle = index * Math.PI / 8;
        const target = new THREE.Vector3(position.x + Math.cos(angle) * ring * 10, 0,
          position.z + Math.sin(angle) * ring * 10);
        this.world.constrainPosition(target);
        const occupied = this.physics.bodies.some((body) => body.collisionResponse && body.shapes.some((shape) =>
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
    const body = new CANNON.Body({ mass: 100, fixedRotation: true, material: this.material,
      shape: new CANNON.Sphere(BEEFALO_BEHAVIOR.radius),
      position: new CANNON.Vec3(model.position.x, BEEFALO_BEHAVIOR.radius, model.position.z),
      linearDamping: 0.2 });
    const controller = new BeefaloController(model, body, model.userData.animationController, this.world, saved?.components.beefalo);
    this.beefalos.add(controller);
    this.physics.addBody(body);
    this.scene.add(model);
    return model;
  }

  update(dt: number): void { for (const beefalo of this.beefalos) beefalo.update(dt); }
  sync(cameraQuaternion: THREE.Quaternion): void { for (const beefalo of this.beefalos) beefalo.sync(cameraQuaternion); }

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

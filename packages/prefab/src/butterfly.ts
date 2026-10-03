import * as THREE from 'three';
import {
  createAnimatedSpriteFactory,
  type AnimatedSpriteFactory,
  type SpriteAnimationController,
} from '@three-roaming/animation/sprite';

export interface ButterflyFlower {
  readonly id: string;
  readonly position: THREE.Vector3;
}

export interface ButterflyWorld {
  isDay(): boolean;
  /** Player and other entities carrying DST's scarytoprey tag. */
  getThreatPositions(): readonly THREE.Vector3[];
  getFlowers(): readonly ButterflyFlower[];
  isFlowerOccupied?(flowerId: string): boolean;
  /** Flying creatures ignore obstacles, but cannot leave the world. */
  constrainPosition?(position: THREE.Vector3): void;
}

export const BUTTERFLY_BEHAVIOR = {
  fleeDistance: 5,
  stopFleeDistance: 10,
  seeFlowerDistance: 30,
  wanderDistance: 12,
  maxFlowerWanderDistance: 20,
  walkSpeed: 4, // Default locomotor speed; SGbutterfly's local WALK_SPEED is unused.
  collectCount: 5,
} as const;

export type ButterflyState = 'idle' | 'moving' | 'land' | 'pollinate' | 'takeoff' | 'removed';

/** The live drop path of butterfly.lua, butterflybrain.lua and SGbutterfly.lua. */
export class ButterflyController {
  private currentState: ButterflyState = 'idle';
  private readonly visitedFlowers = new Set<string>();
  private flower?: ButterflyFlower;
  private goingHome = false;
  private fleeing = false;
  private waitRemaining: number;
  private walkRemaining = 0;
  private readonly destination = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private readonly model: THREE.Group;
  private readonly animation: SpriteAnimationController;
  private readonly world: ButterflyWorld;
  private readonly random: () => number;

  constructor(model: THREE.Group, animation: SpriteAnimationController, world: ButterflyWorld, random = Math.random) {
    this.model = model;
    this.animation = animation;
    this.world = world;
    this.random = random;
    this.waitRemaining = 1 + random() * 3;
    Object.assign(model.userData, {
      itemId: 'butterfly', prefab: 'butterfly', butterflyController: this,
      tags: ['butterfly', 'flying', 'insect', 'smallcreature', 'pollinator'],
    });
    // OnDropped explicitly enters idle rather than the graph's initial takeoff.
    this.setState('idle');
  }

  get state(): ButterflyState { return this.currentState; }
  get removed(): boolean { return this.currentState === 'removed'; }
  get targetFlowerId(): string | undefined { return this.flower?.id; }

  update(dt: number): void {
    if (this.removed) return;
    const step = Math.max(0, Math.min(dt, 0.1));
    this.animation.update(step);
    if (this.removed || this.currentState === 'land' || this.currentState === 'takeoff') return;
    if (this.currentState === 'pollinate') {
      this.waitRemaining -= step;
      if (this.waitRemaining <= 0) {
        this.flower = undefined;
        this.setState('takeoff');
        this.animation.playOnce('take_off', () => {
          this.waitRemaining = 1 + this.random() * 3;
          this.setState('idle');
        });
      }
      return;
    }

    const position = this.model.position;
    const nearestThreat = this.world.getThreatPositions().reduce<THREE.Vector3 | undefined>((nearest, threat) =>
      !nearest || groundDistanceSquared(position, threat) < groundDistanceSquared(position, nearest) ? threat : nearest,
    undefined);
    const fleeDistance = this.fleeing ? BUTTERFLY_BEHAVIOR.stopFleeDistance : BUTTERFLY_BEHAVIOR.fleeDistance;
    if (nearestThreat && groundDistanceSquared(position, nearestThreat) < fleeDistance ** 2) {
      this.fleeing = true;
      this.flower = undefined;
      this.direction.subVectors(position, nearestThreat).setY(0);
      if (this.direction.lengthSq() === 0) {
        const angle = this.random() * Math.PI * 2;
        this.direction.set(Math.cos(angle), 0, Math.sin(angle));
      }
      this.move(this.direction, step);
      return;
    }
    if (this.fleeing) {
      this.fleeing = false;
      this.walkRemaining = 0;
      this.waitRemaining = 1 + this.random() * 3;
      this.setState('idle');
    }

    const flowers = this.world.getFlowers();
    if (this.flower && (!flowers.some(({ id }) => id === this.flower!.id)
      || (!this.goingHome && this.world.isFlowerOccupied?.(this.flower.id)))) this.flower = undefined;
    const nearestFlower = flowers.reduce<ButterflyFlower | undefined>((nearest, flower) => {
      const distance = groundDistanceSquared(position, flower.position);
      return distance <= BUTTERFLY_BEHAVIOR.seeFlowerDistance ** 2
        && (!nearest || distance < groundDistanceSquared(position, nearest.position)) ? flower : nearest;
    }, undefined);
    this.goingHome = !this.world.isDay() || this.visitedFlowers.size > BUTTERFLY_BEHAVIOR.collectCount;
    if (this.goingHome) this.flower = nearestFlower;
    else if (!this.flower && nearestFlower && !this.visitedFlowers.has(nearestFlower.id)
      && !this.world.isFlowerOccupied?.(nearestFlower.id)) this.flower = nearestFlower;

    if (this.flower) {
      this.direction.subVectors(this.flower.position, position).setY(0);
      if (this.direction.length() <= Math.max(0.1, BUTTERFLY_BEHAVIOR.walkSpeed * step)) {
        position.set(this.flower.position.x, 0, this.flower.position.z);
        this.land();
      } else this.move(this.direction, step);
      return;
    }

    // Wander waits 1–4 seconds, walks for 2–5 seconds, and leashes to a nearby
    // flower. Without a flower the source deliberately has no home leash.
    if (this.walkRemaining > 0) {
      this.walkRemaining -= step;
      this.direction.subVectors(this.destination, position).setY(0);
      if (this.walkRemaining <= 0 || this.direction.length() <= BUTTERFLY_BEHAVIOR.walkSpeed * step) {
        this.walkRemaining = 0;
        this.waitRemaining = 1 + this.random() * 3;
        this.setState('idle');
      } else this.move(this.direction, step);
    } else {
      this.waitRemaining -= step;
      if (this.waitRemaining <= 0 || (nearestFlower
        && groundDistanceSquared(position, nearestFlower.position) > BUTTERFLY_BEHAVIOR.maxFlowerWanderDistance ** 2)) {
        if (nearestFlower && groundDistanceSquared(position, nearestFlower.position) > BUTTERFLY_BEHAVIOR.maxFlowerWanderDistance ** 2) {
          this.destination.copy(nearestFlower.position);
        } else {
          const angle = this.random() * Math.PI * 2;
          this.destination.copy(position).add(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
            .multiplyScalar(BUTTERFLY_BEHAVIOR.wanderDistance));
        }
        this.world.constrainPosition?.(this.destination);
        this.walkRemaining = 2 + this.random() * 3;
      }
    }
  }

  private move(direction: THREE.Vector3, dt: number): void {
    direction.normalize();
    this.model.position.addScaledVector(direction, BUTTERFLY_BEHAVIOR.walkSpeed * dt);
    this.world.constrainPosition?.(this.model.position);
    // SetTwoFaced: mirror the art in camera space, keep the world rotation 0.
    this.cameraRight.set(1, 0, 0).applyQuaternion(this.model.quaternion).setY(0);
    const screenDirection = direction.dot(this.cameraRight);
    const visual = this.model.children[0];
    if (visual && Math.abs(screenDirection) > 1e-6) visual.scale.x = Math.abs(visual.scale.x) * Math.sign(screenDirection);
    this.setState('moving');
  }

  private land(): void {
    this.setState('land');
    const flower = this.flower!;
    const goingHome = this.goingHome;
    this.animation.playOnce('land', () => {
      if (goingHome) {
        this.flower = undefined;
        this.setState('removed');
      } else {
        this.visitedFlowers.add(flower.id);
        this.waitRemaining = 2 + this.random() * 2;
        this.setState('pollinate');
      }
    });
  }

  private setState(state: ButterflyState): void {
    this.currentState = state;
    this.model.userData.butterflyState = state;
    const grounded = state === 'land' || state === 'pollinate' || state === 'removed';
    this.model.userData.tags = ['butterfly', 'insect', 'smallcreature', 'pollinator', ...(grounded ? [] : ['flying'])];
    if (state === 'idle') this.animation.start('idle_flight_loop');
    else if (state === 'moving') this.animation.start('flight_cycle');
    else if (state === 'pollinate') this.animation.start('idle');
  }
}

function groundDistanceSquared(a: THREE.Vector3, b: THREE.Vector3): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

/** Share original DST build textures across separately animated butterflies. */
export class ButterflyAssets {
  private factory?: Promise<AnimatedSpriteFactory>;
  private readonly assetBaseUrl: string;

  constructor(assetBaseUrl: string) { this.assetBaseUrl = assetBaseUrl; }

  async create(world: ButterflyWorld) {
    if (!this.factory) {
      this.factory = createAnimatedSpriteFactory(this.assetBaseUrl, 'butterfly_basic.zip');
      void this.factory.catch(() => { this.factory = undefined; });
    }
    const factory = await this.factory;
    const model = factory.create({ initialAnimation: 'idle_flight_loop', name: 'GroundItem:butterfly' });
    const controller = new ButterflyController(model, model.userData.animationController, world);
    return {
      model, controller,
      update: (dt: number) => controller.update(dt),
      dispose: () => factory.disposeSprite(model),
    };
  }
}

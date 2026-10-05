import * as THREE from 'three';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory, type SpriteAnimationController } from '@dontstarve-web/animation/sprite';
import { setPrefabLightOverride, setPrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';

export const FIREFLIES_ID = 'fireflies';
export const FIREFLIES_LIGHT = {
  radius: TILE_SIZE / 4,
  intensity: 0.5,
  falloff: 1,
  colour: [180 / 255, 195 / 255, 150 / 255] as const,
};

export interface FirefliesWorld {
  isNight(): boolean;
  getPlayerPositions(): readonly THREE.Vector3[];
}

/** fireflies.lua: stationary swarm, playerprox hysteresis and fixed-rate light fades. */
export class FirefliesController {
  private fadeValue = 0;
  private fadeRate = 0;
  private direction = 0;
  private playerClose = false;
  private night = false;
  private checks: number[] = [];
  private disableWorkRemaining?: number;
  private canWork = false;
  private canClick = false;
  private disposed = false;
  readonly model: THREE.Group;
  private readonly animation: SpriteAnimationController;
  private readonly world: FirefliesWorld;
  private readonly random: () => number;

  constructor(
    model: THREE.Group,
    animation: SpriteAnimationController,
    world: FirefliesWorld,
    random = Math.random,
  ) {
    this.model = model;
    this.animation = animation;
    this.world = world;
    this.random = random;
    Object.assign(model.userData, { itemId: FIREFLIES_ID, prefab: FIREFLIES_ID,
      firefliesController: this, rayTestOnBB: true });
    // Source uses the bloom shader; its luminous swarm art stays visible at night.
    setPrefabLightOverride(model, 1);
    model.children[0].visible = false;
    this.refresh();
  }

  get intensity(): number { return this.fadeValue; }
  get workable(): boolean { return !this.disposed && this.canWork; }
  get clickable(): boolean { return !this.disposed && this.canClick; }

  /** Called after assigning the source ground origin, for both drops and restores. */
  place(dropped: boolean): void {
    this.night = this.world.isNight();
    this.updateProximity();
    if (dropped) {
      this.fadeIn();
      this.checks.push(2 + this.random());
    } else this.updateLight();
  }

  update(dt: number): void {
    if (this.disposed) return;
    const step = Math.max(0, Math.min(dt, 0.1));
    this.animation.update(step);
    if (this.disableWorkRemaining !== undefined) {
      this.disableWorkRemaining -= step;
      if (this.disableWorkRemaining <= 0) {
        this.disableWorkRemaining = undefined;
        this.canWork = false;
      }
    }
    if (this.night !== this.world.isNight()) {
      this.night = this.world.isNight();
      this.checks.push(2 + this.random());
    }
    if (this.updateProximity()) this.updateLight();
    let due = false;
    this.checks = this.checks.map(time => time - step).filter(time => {
      if (time > 0) return true;
      due = true;
      return false;
    });
    if (due) this.updateLight();
    if (this.fadeRate !== 0) {
      this.fadeValue = THREE.MathUtils.clamp(this.fadeValue + this.fadeRate * step, 0, FIREFLIES_LIGHT.intensity);
      if ((this.fadeRate > 0 && this.fadeValue >= FIREFLIES_LIGHT.intensity)
        || (this.fadeRate < 0 && this.fadeValue <= 0)) {
        this.fadeRate = 0;
        if (this.fadeValue === 0) this.finishFadeOut();
      }
    }
    this.refresh();
  }

  dispose(): void {
    this.disposed = true;
    this.canClick = this.canWork = false;
    this.checks = [];
    this.fadeValue = this.fadeRate = 0;
    setPrefabLocalLight(this.model, null);
    setPrefabLightOverride(this.model, null);
  }

  private updateProximity(): boolean {
    const distanceSquared = this.world.getPlayerPositions().reduce((nearest, player) => Math.min(nearest,
      (player.x - this.model.position.x) ** 2 + (player.z - this.model.position.z) ** 2), Infinity);
    const close = this.playerClose ? distanceSquared < 5 ** 2 : distanceSquared <= 3 ** 2;
    if (close === this.playerClose) return false;
    this.playerClose = close;
    return true;
  }

  private updateLight(): void {
    if (this.world.isNight() && !this.playerClose) this.fadeIn();
    else this.fadeOut();
  }

  private fadeIn(): void {
    if (this.direction > 0) return;
    this.direction = 1;
    this.canWork = this.canClick = true;
    this.disableWorkRemaining = undefined;
    this.model.children[0].visible = true;
    this.animation.playOnce('swarm_pre', () => {
      if (!this.disposed && this.direction > 0) this.animation.start('swarm_loop');
    });
    const byte = 1 + Math.min(30, Math.floor(this.random() * 31));
    this.fadeRate = (FIREFLIES_LIGHT.intensity - this.fadeValue) / (3 + (byte - 1) / 15);
    this.refresh();
  }

  private fadeOut(): void {
    if (this.direction <= 0) return;
    this.direction = -1;
    this.animation.playOnce('swarm_pst', () => {
      if (!this.disposed && this.direction < 0) this.model.children[0].visible = false;
    });
    const byte = 32 + Math.min(31, Math.floor(this.random() * 32));
    this.fadeRate = -this.fadeValue / (0.75 + (byte - 32) / 31);
    if (this.fadeValue === 0) this.finishFadeOut();
  }

  private finishFadeOut(): void {
    this.canClick = false;
    this.disableWorkRemaining = 1.5 + this.random();
    this.model.children[0].visible = false;
  }

  private refresh(): void {
    setPrefabLocalLight(this.model, this.fadeValue > 0 ? { ...FIREFLIES_LIGHT, intensity: this.fadeValue } : null);
    this.model.userData.tags = ['firefly', 'cattoyairborne', 'flying', 'NOBLOCK', ...(this.canClick ? [] : ['NOCLICK'])];
    this.model.userData.firefliesIntensity = this.fadeValue;
  }
}

/** Independent swarm animations share the unmodified source build/atlas. */
export class FirefliesAssets {
  private factory?: Promise<AnimatedSpriteFactory>;
  private disposed = false;
  private readonly assetBaseUrl: string;
  constructor(assetBaseUrl: string) { this.assetBaseUrl = assetBaseUrl; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.factory) void this.factory.then((factory) => factory.dispose(), () => undefined);
  }

  async create(world: FirefliesWorld) {
    if (this.disposed) throw new Error('Insect assets have been disposed');
    if (!this.factory) {
      this.factory = createAnimatedSpriteFactory(this.assetBaseUrl, 'fireflies.zip');
      void this.factory.catch(() => { this.factory = undefined; });
    }
    const factory = await this.factory;
    if (this.disposed) throw new Error('Insect assets have been disposed');
    const model = factory.create({ initialAnimation: 'swarm_loop', name: 'GroundItem:fireflies' });
    const controller = new FirefliesController(model, model.userData.animationController, world);
    return { model, controller, onPlaced: (dropped: boolean) => controller.place(dropped),
      update: (dt: number) => controller.update(dt),
      isClickable: () => controller.clickable, isWorkable: () => controller.workable,
      dispose() { controller.dispose(); factory.disposeSprite(model); } };
  }
}

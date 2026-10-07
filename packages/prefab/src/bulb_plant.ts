import * as THREE from 'three';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory, type SpriteAnimationController } from '@dontstarve-web/animation/sprite';
import { setPrefabLocalLight, type PrefabLocalLight } from './localLight';
import { newEntityId } from './saveRecord';
import { TILE_SIZE } from './tile';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import type { WorldContext } from './worldContext';
import type { CursorLabel } from './buildCursor';

export const BULB_PLANT_ID = 'flower_cave';
export const BULB_PLANT_PREFABS = ['flower_cave', 'flower_cave_double', 'flower_cave_triple'] as const;
export type BulbPlantPrefabId = typeof BULB_PLANT_PREFABS[number];
export function isBulbPlantPrefab(value: string): value is BulbPlantPrefabId {
  return (BULB_PLANT_PREFABS as readonly string[]).includes(value);
}
export const BULB_PLANT_VARIANTS = ['single', 'springy', 'double', 'triple'] as const;
export const BULB_PLANT_LIGHT_STATES = ['ON', 'CHARGED', 'RECHARGING'] as const;
export type BulbPlantVariant = typeof BULB_PLANT_VARIANTS[number];
export type BulbPlantLightState = typeof BULB_PLANT_LIGHT_STATES[number];
export interface BulbPlantSaveState {
  variant: BulbPlantVariant;
  lightState: BulbPlantLightState;
  remainingSeconds?: number;
  picked?: boolean;
  regrowSeconds?: number;
}
export interface BulbPlantRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { bulbPlant: BulbPlantSaveState };
}
export const BULB_PLANT_LIGHT: PrefabLocalLight = {
  radius: 3 * (TILE_SIZE / 4), intensity: 0.8, falloff: 0.5,
  colour: [237 / 255, 237 / 255, 209 / 255],
};
export const BULB_PLANT_MAX_ON_TIME = 108; // 90 + random integer 4–8 + random 0–10.
export const BULB_PLANT_MAX_RECHARGE_TIME = 118; // 110 + random integer 4–8.
export function bulbPlantRegrowTime(variant: BulbPlantVariant): number {
  return 3 * 480 * (variant === 'double' ? 1.5 : variant === 'triple' ? 2 : 1);
}

/** Shared OnUpdateLight curve from flower_cave.lua and lightflier_flower.lua. */
export function bulbPlantLight(on: boolean, progress: number, variant: BulbPlantVariant = 'single'): PrefabLocalLight | null {
  const k = THREE.MathUtils.clamp(progress, 0, 1);
  const base = { ...BULB_PLANT_LIGHT, radius: (variant === 'double' || variant === 'triple' ? 4.5 : 3) * (TILE_SIZE / 4) };
  if (!on && k >= 1 || on && k <= 0) return null;
  if (!on) return { ...base,
    radius: base.radius * (1 - k), intensity: base.intensity * (1 - k),
    falloff: k + base.falloff * (1 - k) };
  if (k < 0.33) {
    const t = k / 0.33;
    return { ...base, radius: base.radius * 1.33 * t,
      intensity: base.intensity * t, falloff: base.falloff * 0.8 * t + 1 - t };
  }
  const t = (k - 0.33) / 0.67;
  return { ...base, radius: base.radius * (t + 1.33 * (1 - t)),
    falloff: base.falloff * (t + 0.8 * (1 - t)) };
}

export interface BulbPlantWorld {
  /** LightWatcher level at the plant; the host samples ambient and other lights. */
  getLightLevel(model: THREE.Group): number;
}

/** flower_cave's lighting and pickable state; the host owns inventory transfers. */
export class BulbPlantController {
  private state: BulbPlantLightState;
  private timer?: number;
  private tweenDuration = 4;
  private tweenElapsed = 4;
  private lightOn: boolean;
  private wakeRemaining = 1;
  private awake = false;
  private inLight = false;
  private animationVersion = 0;
  private disposed = false;
  private picked = false;
  private regrowRemaining?: number;
  private readonly model: THREE.Group;
  private readonly animation: SpriteAnimationController;
  private readonly world: BulbPlantWorld;
  private readonly random: () => number;
  private readonly variant: BulbPlantVariant;

  constructor(model: THREE.Group, animation: SpriteAnimationController, world: BulbPlantWorld, variant: BulbPlantVariant,
    saved?: BulbPlantSaveState, random = Math.random) {
    this.model = model;
    this.animation = animation;
    this.world = world;
    this.random = random;
    this.variant = variant;
    this.state = saved?.lightState ?? 'CHARGED';
    this.timer = saved?.remainingSeconds;
    this.picked = saved?.picked ?? false;
    this.regrowRemaining = saved?.regrowSeconds;
    this.lightOn = this.state === 'ON';
    Object.assign(model.userData, { tags: ['plant'], bulbPlantController: this });
    this.refreshLight();
  }

  get lightState(): BulbPlantLightState { return this.state; }
  get canPick(): boolean { return !this.disposed && !this.picked; }
  get productCount(): number { return this.variant === 'double' ? 2 : this.variant === 'triple' ? 3 : 1; }

  tryPick(giveFruit: (count: number) => boolean): boolean {
    if (!this.canPick || !giveFruit(this.productCount)) return false;
    if (this.state === 'ON') this.state = 'RECHARGING';
    this.timer = undefined;
    this.lightOn = false;
    this.tweenElapsed = this.tweenDuration;
    this.picked = true;
    this.regrowRemaining = bulbPlantRegrowTime(this.variant);
    this.playSequence('picking', 'picked');
    this.refreshLight();
    return true;
  }

  update(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt < 0) return;
    this.animation.update(dt);
    const level = this.world.getLightLevel(this.model);
    const wasInLight = this.inLight;
    this.inLight = this.inLight ? level > 0.05 : level >= 0.075;
    if (this.awake && !wasInLight && this.inLight) this.turnOn();
    let remaining = dt;
    // Advance through timer boundaries so frame stalls preserve source durations.
    while (remaining > 0) {
      const step = Math.min(remaining, this.awake ? Infinity : this.wakeRemaining,
        this.timer ?? Infinity, this.regrowRemaining ?? Infinity);
      this.tweenElapsed = Math.min(this.tweenDuration, this.tweenElapsed + step);
      if (!this.awake) this.wakeRemaining -= step;
      if (this.timer !== undefined) this.timer -= step;
      if (this.regrowRemaining !== undefined) this.regrowRemaining -= step;
      remaining -= step;
      if (!this.awake && this.wakeRemaining <= 0) {
        this.awake = true;
        if (this.inLight) this.turnOn();
      }
      if (this.timer !== undefined && this.timer <= 0) {
        this.timer = undefined;
        if (this.state === 'ON') this.turnOff();
        else if (this.state === 'RECHARGING') {
          this.setState('CHARGED');
          if (this.inLight) this.turnOn();
        }
      }
      if (this.regrowRemaining !== undefined && this.regrowRemaining <= 0) {
        this.regrowRemaining = undefined;
        this.picked = false;
        this.beginRecharge();
        this.playSequence('grow', 'idle', true);
      }
    }
    this.refreshLight();
  }

  turnOn(): void {
    if (this.disposed || this.picked || this.state !== 'CHARGED') return;
    this.setState('ON');
    this.lightOn = true;
    this.tweenElapsed = 0;
    this.tweenDuration = this.randomTween();
    this.timer = 90 + this.tweenDuration + this.random() * 10;
    this.refreshLight();
  }

  turnOff(): void {
    if (this.disposed || this.state !== 'ON') return;
    this.beginRecharge();
  }

  private beginRecharge(): void {
    this.setState('RECHARGING');
    this.lightOn = false;
    this.tweenElapsed = 0;
    this.tweenDuration = this.randomTween();
    this.timer = 110 + this.tweenDuration;
    this.refreshLight();
  }

  exportState(variant: BulbPlantVariant): BulbPlantSaveState {
    return { variant, lightState: this.state, ...(this.timer === undefined ? {} : { remainingSeconds: this.timer }),
      ...(this.picked ? { picked: true, regrowSeconds: this.regrowRemaining } : {}) };
  }

  dispose(): void {
    this.disposed = true;
    this.animationVersion++;
    setPrefabLocalLight(this.model, null);
  }

  private randomTween(): number { return 4 + Math.min(4, Math.floor(this.random() * 5)); }

  private setState(state: BulbPlantLightState): void {
    this.state = state;
    const clips = state === 'ON' ? ['recharge', 'idle'] : state === 'CHARGED' ? ['revive', 'off'] : ['drain', 'withered'];
    this.playSequence(clips[0], clips[1], state === 'ON');
  }

  private playSequence(first: string, last: string, loop = false): void {
    const version = ++this.animationVersion;
    this.animation.playOnce(first, () => {
      if (this.disposed || version !== this.animationVersion) return;
      if (loop) this.animation.start(last);
      else this.animation.playOnce(last);
    });
  }

  private refreshLight(): void {
    setPrefabLocalLight(this.model, bulbPlantLight(this.lightOn, this.tweenElapsed / this.tweenDuration, this.variant));
    this.model.userData.bulbPlantLightState = this.state;
    this.model.userData.bulbPlantPicked = this.picked;
  }
}

interface Plant {
  prefabId: BulbPlantPrefabId;
  model: THREE.Group;
  controller: BulbPlantController;
  variant: BulbPlantVariant;
  factory: AnimatedSpriteFactory;
}

/** Shared original single/springy assets, independent world lights and timers. */
export class BulbPlantManager {
  private readonly factories = new Map<BulbPlantVariant, Promise<AnimatedSpriteFactory>>();
  private readonly plants = new Set<Plant>();
  private readonly scene: THREE.Scene;
  private readonly assetBaseUrl: string;
  private readonly world: BulbPlantWorld;
  private readonly random: () => number;
  private disposed = false;
  private pointer?: PointerRaycaster;
  private cursor?: CursorLabel;
  private canvas?: HTMLCanvasElement;
  private giveFruit?: (count: number, sourcePosition: THREE.Vector3) => boolean;
  private hoveredId?: string;

  constructor(scene: THREE.Scene, assetBaseUrl: string, world: BulbPlantWorld, random = Math.random) {
    this.scene = scene;
    this.assetBaseUrl = assetBaseUrl;
    this.world = world;
    this.random = random;
  }

  async spawn(prefabId: BulbPlantPrefabId, position: THREE.Vector3, saved?: BulbPlantRecord): Promise<THREE.Group> {
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid bulb plant position');
    const state = saved?.components.bulbPlant;
    const variant = state?.variant ?? (prefabId === 'flower_cave_double' ? 'double'
      : prefabId === 'flower_cave_triple' ? 'triple' : BULB_PLANT_VARIANTS[Math.min(1, Math.floor(this.random() * 2))]);
    let request = this.factories.get(variant);
    if (!request) {
      request = createAnimatedSpriteFactory(this.assetBaseUrl, `bulb_plant_${variant}.zip`);
      this.factories.set(variant, request);
      void request.catch(() => this.factories.delete(variant));
    }
    const factory = await request;
    if (this.disposed) throw new Error('Bulb plant manager has been disposed');
    const initialAnimation = state?.picked ? 'picked' : state?.lightState === 'ON' ? 'idle' : state?.lightState === 'RECHARGING' ? 'withered' : 'off';
    const model = factory.create({ initialAnimation, initialFrame: initialAnimation === 'idle' ? 'first' : 'last', name: prefabId });
    model.position.set(position.x, 0, position.z);
    model.userData.entityId = saved?.id ?? newEntityId();
    model.userData.bulbPlantVariant = variant;
    model.userData.prefab = prefabId;
    const controller = new BulbPlantController(model, model.userData.animationController, this.world, variant, state, this.random);
    this.plants.add({ prefabId, model, controller, variant, factory });
    this.scene.add(model);
    return model;
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    for (const plant of this.plants) {
      plant.model.quaternion.copy(cameraQuaternion);
      plant.controller.update(dt);
    }
    this.updateHover();
  }

  setupInteraction(world: WorldContext, giveFruit: (count: number, sourcePosition: THREE.Vector3) => boolean): void {
    this.pointer = new PointerRaycaster(world);
    this.cursor = world.createCursorLabel?.(this.pointer);
    this.giveFruit = giveFruit;
    this.canvas = world.renderer.domElement;
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
  }

  private pickableModels(): THREE.Group[] {
    return [...this.plants].filter(plant => plant.controller.canPick).map(plant => plant.model);
  }

  private hitPlant() {
    const hit = this.pointer?.raycastPointer(this.pickableModels());
    let root: THREE.Object3D | null = hit?.object ?? null;
    while (root && ![...this.plants].some(plant => plant.model === root)) root = root.parent;
    return [...this.plants].find(plant => plant.model === root);
  }

  private updateHover(): void {
    if (!this.pointer) return;
    const plant = this.hitPlant();
    const id = plant?.model.userData.entityId;
    if (id !== this.hoveredId) {
      this.hoveredId = id;
      if (plant) this.cursor?.show(': 采摘荧光果', 'left');
      else this.cursor?.hide();
    }
    this.cursor?.update();
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.defaultPrevented || !this.pointer) return;
    this.pointer.trackPointer(event);
    const plant = this.hitPlant();
    if (!plant) return;
    event.preventDefault();
    plant.controller.tryPick((count) => this.giveFruit?.(count, plant.model.position.clone()) ?? false);
    this.updateHover();
  };

  get renderEntities() {
    return [...this.plants].map(({ model }) => ({ object: model, footPosition: model.position, cameraDepth: 0 }));
  }

  exportRecords(): { prefabId: BulbPlantPrefabId; record: BulbPlantRecord }[] {
    return [...this.plants].map(({ prefabId, model, variant, controller }) => ({ prefabId, record: {
      id: String(model.userData.entityId), transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
      components: { bulbPlant: controller.exportState(variant) },
    } }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas?.removeEventListener('pointerdown', this.handlePointerDown);
    this.pointer?.dispose();
    this.cursor?.hide();
    for (const { model, controller, factory } of this.plants) {
      controller.dispose();
      factory.disposeSprite(model);
    }
    this.plants.clear();
    for (const factory of this.factories.values()) void factory.then(value => value.dispose(), () => undefined);
  }
}

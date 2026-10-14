import * as THREE from 'three';
import { createEffect, createMemo, createSignal, readonlySignal, getBoundWatchWorldContent, type Memo, type ReadonlySignal, type Signal } from '@dontstarve-web/signals';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory, type SpriteAnimationController } from '@dontstarve-web/animation/sprite';
import { setPrefabLocalLight, type PrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';
import { OPALSTAFF_COLOUR, YELLOWSTAFF_COLOUR } from './yellowstaff';
import { newEntityId } from './saveRecord';
import { PlaySound, PreloadSounds, type SoundHandle } from './sound';
import { actionEntity, FindEntities } from './actionEntity';
import { Propagator } from '../../componets/src/propagator';
import type { BurnableInst } from '../../componets/src/burnable';

export const DWARF_STAR_ID = 'stafflight';
// Gameplay duration requested for this project: 24 minutes.
export const DWARF_STAR_DURATION = 24 * 60;
export const POLAR_LIGHT_ID = 'staffcoldlight';
// tuning.lua: OPALSTAFF_STAR_DURATION = total_day_time * 2 (480 seconds per day).
export const POLAR_LIGHT_DURATION = 16 * 60;
/** Match the forest's ten-tile visual loading range, measured on the ground. */
export const STAFF_LIGHT_ACTIVE_RADIUS = TILE_SIZE * 10;
export type StaffLightId = typeof DWARF_STAR_ID | typeof POLAR_LIGHT_ID;
export type StaffLightPhase = 'active' | 'disappearing' | 'removed';
export interface StaffLightState {
  readonly remaining: ReadonlySignal<number>;
  readonly removed: ReadonlySignal<boolean>;
  readonly phase: ReadonlySignal<StaffLightPhase>;
}

/** Read-only component state survives visual unloading and final removal. */
export function getStaffLightState(model: THREE.Object3D): StaffLightState | undefined {
  return model.userData.staffLightState;
}

/** stafflight.lua: abs(sin(pi * timeAlive * .05)), using the scene's world scale. */
export function dwarfStarLight(ageSeconds: number): PrefabLocalLight {
  const pulse = Math.abs(Math.sin(Math.PI * ageSeconds * 0.05));
  return {
    radius: (11 + pulse) * (TILE_SIZE / 4),
    intensity: 0.8 - 0.1 * pulse,
    falloff: 0.8 - 0.1 * pulse,
    colour: YELLOWSTAFF_COLOUR,
  };
}

export function polarLight(ageSeconds: number): PrefabLocalLight {
  return { ...dwarfStarLight(ageSeconds), colour: OPALSTAFF_COLOUR };
}

export interface DwarfStarRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { timer: { remainingSeconds: number } };
}

interface Star {
  /** Stable entity handle; no mesh or animation resources while unloaded. */
  model: THREE.Group;
  sprite?: THREE.Group;
  animation?: SpriteAnimationController;
  remaining: Signal<number>;
  removed: Signal<boolean>;
  phase: Memo<StaffLightPhase>;
  ageSeconds: number;
  lastSettlementSeconds: number;
  pendingFrames: number;
  removalAtSeconds: number | null;
  creationSound?: SoundHandle;
  loopSound?: SoundHandle;
  releaseAppearance?: () => void;
  propagator?: Propagator;
}

/** Independent summon lifetimes; shared DST textures, separate merged frame meshes. */
export class DwarfStarManager {
  private factoryRequest?: Promise<AnimatedSpriteFactory>;
  private spriteFactory?: AnimatedSpriteFactory;
  private readonly stars = new Set<Star>();
  private disposed = false;
  private readonly scene: THREE.Scene;
  private readonly animationBaseUrl: string;
  private readonly duration: number;
  private readonly getPlayerPosition?: () => Pick<THREE.Vector3, 'x' | 'z'>;
  private elapsedSeconds = 0;
  readonly prefabId: StaffLightId;

  constructor(scene: THREE.Scene, animationBaseUrl: string, prefabId: StaffLightId = DWARF_STAR_ID,
    getPlayerPosition?: () => Pick<THREE.Vector3, 'x' | 'z'>) {
    this.scene = scene;
    this.animationBaseUrl = animationBaseUrl;
    this.prefabId = prefabId;
    this.getPlayerPosition = getPlayerPosition;
    this.duration = prefabId === POLAR_LIGHT_ID ? POLAR_LIGHT_DURATION : DWARF_STAR_DURATION;
  }

  async prepare(): Promise<void> {
    const [factory] = await Promise.all([this.factory(), PreloadSounds('dontstarve/common/staff_star_create', this.loopEvent)]);
    if (this.disposed) throw new Error('Dwarf star manager has been disposed');
    this.spriteFactory = factory;
  }

  async spawn(position: THREE.Vector3, saved?: { id: string; remainingSeconds: number }): Promise<THREE.Group> {
    await this.prepare();
    return this.spawnPrepared(position, saved);
  }

  /** Preloaded CASTSPELL commits synchronously at its source stategraph frame. */
  spawnPrepared(position: THREE.Vector3, saved?: { id: string; remainingSeconds: number }): THREE.Group {
    const remainingSeconds = saved?.remainingSeconds ?? this.duration;
    if (![position.x, position.y, position.z].every(Number.isFinite)
      || !Number.isFinite(remainingSeconds) || remainingSeconds <= 0 || remainingSeconds > this.duration)
      throw new RangeError(`Invalid ${this.prefabId} position or lifetime`);
    if (this.disposed) throw new Error('Dwarf star manager has been disposed');
    if (!this.spriteFactory) throw new Error('Dwarf star assets must be prepared before spawning');
    const model = new THREE.Group();
    model.name = this.prefabId;
    model.position.set(position.x, 0, position.z);
    model.userData.entityId = saved?.id ?? newEntityId();
    const remaining = createSignal(remainingSeconds);
    const removed = createSignal(false);
    const phase = createMemo<StaffLightPhase>(() => removed.get() ? 'removed'
      : remaining.get() > 0 ? 'active' : 'disappearing');
    model.userData.staffLightState = Object.freeze({
      remaining: readonlySignal(remaining), removed: readonlySignal(removed), phase: readonlySignal(phase),
    } satisfies StaffLightState);
    model.userData.persists = true;
    const star: Star = { model, remaining, removed, phase,
      ageSeconds: this.duration - remainingSeconds, lastSettlementSeconds: this.elapsedSeconds,
      pendingFrames: 0, removalAtSeconds: null };
    if (this.prefabId === DWARF_STAR_ID) {
      const inst = actionEntity(model, this.prefabId);
      inst.components.propagator = star.propagator = new Propagator(inst, 'default', radius =>
        FindEntities(this.scene, model.position, radius, [], ['INLIMBO']) as BurnableInst[], TILE_SIZE / 4, undefined, getBoundWatchWorldContent());
      // stafflight.lua: bare propagator, heatoutput 15, spreading from creation until removal.
      star.propagator.heatoutput = 15;
      star.propagator.spreading.set(true);
    }
    this.stars.add(star);
    if (this.isNearby(model.position, this.getPlayerPosition?.())) this.load(star, !saved);
    return model;
  }

  get renderEntities() {
    return Array.from(this.stars).filter((star) => star.sprite)
      .map(({ model, sprite }) => ({ object: sprite!, footPosition: model.position, cameraDepth: 0 }));
  }

  update(dt: number, cameraWorldQuaternion: THREE.Quaternion): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    // One game clock advances even when every star is asleep. No wall-clock time
    // or per-sleeping-star countdown is needed, so paused games consume no life.
    this.elapsedSeconds += dt;
    const playerPosition = this.getPlayerPosition?.();
    for (const star of this.stars) {
      const awake = this.isNearby(star.model.position, playerPosition);
      const changed = awake !== Boolean(star.sprite);
      if (changed) {
        // Flush the partial batch on departure; catch up all sleeping time on
        // return, before enabling art, light or sound for an expired entity.
        if (!this.settle(star, false)) continue;
        if (awake) this.load(star, false);
        else this.unload(star);
      }
      if (!changed && star.phase.peek() === 'active' && ++star.pendingFrames === 60
        && star.sprite
        && !this.settle(star, true)) continue;
      if (star.removalAtSeconds !== null && this.elapsedSeconds >= star.removalAtSeconds) {
        this.removeStar(star);
        continue;
      }
      // Visual unloading retains the component. Never spread beyond the logical removal deadline,
      // even when a sleeping star's lifetime has not yet been settled for presentation/save.
      const removalAt = star.removalAtSeconds ?? star.lastSettlementSeconds + star.remaining.peek() + 1;
      star.propagator?.Update(Math.max(0, Math.min(dt, removalAt - (this.elapsedSeconds - dt))));
      if (!star.sprite) continue;
      star.model.quaternion.copy(cameraWorldQuaternion);
      star.animation!.update(dt);
      const age = star.ageSeconds + this.elapsedSeconds - star.lastSettlementSeconds;
      setPrefabLocalLight(star.model, this.light(age));
    }
  }

  exportRecords(): DwarfStarRecord[] {
    for (const star of this.stars) this.settle(star, Boolean(star.sprite));
    return Array.from(this.stars).filter((star) => star.phase.peek() === 'active').map((star) => ({
      id: String(star.model.userData.entityId),
      transform: { position: [star.model.position.x, 0, star.model.position.z], rotationY: 0 },
      components: { timer: { remainingSeconds: star.remaining.peek() } },
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const star of this.stars) {
      this.settle(star, false);
      this.removeStar(star);
    }
    this.spriteFactory = undefined;
    void this.factoryRequest?.then((factory) => factory.dispose(), () => undefined);
  }

  /** Explicit entity removal, independent of the queued presentation effect. */
  remove(model: THREE.Object3D): boolean {
    const star = Array.from(this.stars).find(star => star.model === model);
    if (!star) return false;
    this.settle(star, false);
    this.removeStar(star);
    return true;
  }

  /** stafflight.lua onhaunt stops extinguish and enters the same kill_light path. */
  haunt(model: THREE.Object3D): boolean {
    const star = Array.from(this.stars).find(star => star.model === model);
    if (!star) return false;
    if (!this.settle(star, Boolean(star.sprite))) return true;
    if (star.phase.peek() === 'active') this.beginDisappearance(star, this.elapsedSeconds, Boolean(star.sprite));
    return true;
  }

  private factory(): Promise<AnimatedSpriteFactory> {
    if (this.disposed) return Promise.reject(new Error('Dwarf star manager has been disposed'));
    if (!this.factoryRequest) {
      this.factoryRequest = createAnimatedSpriteFactory(this.animationBaseUrl,
        this.prefabId === POLAR_LIGHT_ID ? 'star_cold.zip' : 'star_hot.zip');
      void this.factoryRequest.catch(() => { this.factoryRequest = undefined; });
    }
    return this.factoryRequest;
  }

  private get loopEvent() {
    return this.prefabId === POLAR_LIGHT_ID ? 'dontstarve/common/staff_coldlight_LP' : 'dontstarve/common/staff_star_LP';
  }

  private light(ageSeconds: number): PrefabLocalLight {
    return this.prefabId === POLAR_LIGHT_ID ? polarLight(ageSeconds) : dwarfStarLight(ageSeconds);
  }

  private startIdle(star: Star, animation: SpriteAnimationController): void {
    if (this.disposed || star.animation !== animation || star.phase.peek() !== 'active' || !this.stars.has(star)) return;
    if (this.prefabId === POLAR_LIGHT_ID) {
      const clips = ['idle_loop', 'idle_loop2', 'idle_loop3'];
      animation.playOnce(clips[Math.floor(Math.random() * clips.length)], () => this.startIdle(star, animation));
    } else animation.start('idle_loop');
  }

  private load(star: Star, appear: boolean): void {
    if (this.disposed || !this.stars.has(star) || star.phase.peek() !== 'active' || star.sprite) return;
    const sprite = this.spriteFactory!.create({
      initialAnimation: appear ? 'appear' : 'idle_loop', name: this.prefabId,
    });
    sprite.userData.entityId = star.model.userData.entityId;
    star.sprite = sprite;
    star.animation = sprite.userData.animationController as SpriteAnimationController;
    const animation = star.animation;
    star.model.userData.animationController = star.animation;
    star.model.add(sprite);
    if (appear) {
      star.creationSound = PlaySound('dontstarve/common/staff_star_create', star.model.position);
      animation.playOnce('appear', () => this.startIdle(star, animation));
    } else this.startIdle(star, animation);
    star.loopSound = PlaySound(this.loopEvent, star.model.position);
    setPrefabLocalLight(star.model, this.light(star.ageSeconds));
    this.scene.add(star.model);
    let presentedPhase: StaffLightPhase | undefined;
    const stop = createEffect(() => {
      const phase = star.phase.get();
      if (phase === presentedPhase || star.animation !== animation || !this.stars.has(star)) return;
      presentedPhase = phase;
      if (phase === 'disappearing') {
        const loopSound = star.loopSound;
        animation.playOnce('disappear', () => {
          if (star.animation === animation && this.stars.has(star)) loopSound?.stop();
        });
      } else if (phase === 'removed') this.releaseVisual(star);
    });
    star.releaseAppearance = () => {
      stop();
      if (star.animation === animation) this.releaseVisual(star);
    };
  }

  private unload(star: Star): void {
    const release = star.releaseAppearance;
    star.releaseAppearance = undefined;
    if (release) release();
    else this.releaseVisual(star);
  }

  private releaseVisual(star: Star): void {
    star.creationSound?.stop();
    star.loopSound?.stop();
    star.creationSound = undefined;
    star.loopSound = undefined;
    setPrefabLocalLight(star.model, null);
    if (star.sprite) this.spriteFactory!.disposeSprite(star.sprite);
    star.sprite = undefined;
    star.animation = undefined;
    delete star.model.userData.animationController;
    star.model.removeFromParent();
  }

  private removeStar(star: Star): void {
    if (!this.stars.delete(star)) return;
    star.model.userData.persists = false;
    star.model.userData.removed = true;
    star.propagator?.dispose();
    star.removed.set(true);
    this.unload(star);
    star.phase.dispose();
  }

  private isNearby(position: THREE.Vector3, player: Pick<THREE.Vector3, 'x' | 'z'> | undefined): boolean {
    if (!player) return true;
    const dx = position.x - player.x, dz = position.z - player.z;
    return dx * dx + dz * dz <= STAFF_LIGHT_ACTIVE_RADIUS ** 2;
  }

  /** Settle actual game seconds, including a partial batch or a sleeping interval. */
  private settle(star: Star, animateExpiry: boolean): boolean {
    if (!this.stars.has(star)) return false;
    if (star.phase.peek() === 'disappearing') {
      if (!animateExpiry || this.elapsedSeconds >= star.removalAtSeconds!) this.removeStar(star);
      return this.stars.has(star);
    }
    const elapsed = this.elapsedSeconds - star.lastSettlementSeconds;
    star.lastSettlementSeconds = this.elapsedSeconds;
    star.pendingFrames = 0;
    star.ageSeconds += elapsed;
    const remaining = star.remaining.peek() - elapsed;
    if (remaining > 0) {
      star.remaining.set(remaining);
      return true;
    }
    return this.beginDisappearance(star, this.elapsedSeconds + remaining, animateExpiry);
  }

  private beginDisappearance(star: Star, expirySeconds: number, animateExpiry: boolean): boolean {
    // Commit domain work synchronously; presentation may run later or be cancelled.
    star.removalAtSeconds = expirySeconds + 1;
    star.model.userData.persists = false;
    star.remaining.set(0);
    if (!animateExpiry || this.elapsedSeconds >= star.removalAtSeconds) {
      this.removeStar(star);
      return false;
    }
    return true;
  }
}

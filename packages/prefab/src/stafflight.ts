import * as THREE from 'three';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory, type SpriteAnimationController } from '@dontstarve-web/animation/sprite';
import { setPrefabLocalLight, type PrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';
import { OPALSTAFF_COLOUR, YELLOWSTAFF_COLOUR } from './yellowstaff';
import { newEntityId } from './saveRecord';
import { PlaySound, PreloadSounds, type SoundHandle } from './sound';

export const DWARF_STAR_ID = 'stafflight';
// Gameplay duration requested for this project: 24 minutes.
export const DWARF_STAR_DURATION = 24 * 60;
export const POLAR_LIGHT_ID = 'staffcoldlight';
// tuning.lua: OPALSTAFF_STAR_DURATION = total_day_time * 2 (480 seconds per day).
export const POLAR_LIGHT_DURATION = 16 * 60;
/** Match the forest's ten-tile visual loading range, measured on the ground. */
export const STAFF_LIGHT_ACTIVE_RADIUS = TILE_SIZE * 10;
export type StaffLightId = typeof DWARF_STAR_ID | typeof POLAR_LIGHT_ID;

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
  remainingSeconds: number;
  ageSeconds: number;
  lastSettlementSeconds: number;
  pendingFrames: number;
  removalAtSeconds: number | null;
  creationSound?: SoundHandle;
  loopSound?: SoundHandle;
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
    const star: Star = { model, remainingSeconds,
      ageSeconds: this.duration - remainingSeconds, lastSettlementSeconds: this.elapsedSeconds,
      pendingFrames: 0, removalAtSeconds: null };
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
      if (!star.sprite) continue;
      if (!changed && star.removalAtSeconds === null && ++star.pendingFrames === 60
        && !this.settle(star, true)) continue;
      if (star.removalAtSeconds !== null && this.elapsedSeconds >= star.removalAtSeconds) {
        this.remove(star);
        continue;
      }
      star.model.quaternion.copy(cameraWorldQuaternion);
      star.animation!.update(dt);
      const age = star.ageSeconds + this.elapsedSeconds - star.lastSettlementSeconds;
      setPrefabLocalLight(star.model, this.light(age));
    }
  }

  exportRecords(): DwarfStarRecord[] {
    for (const star of this.stars) this.settle(star, Boolean(star.sprite));
    return Array.from(this.stars).filter((star) => star.removalAtSeconds === null).map((star) => ({
      id: String(star.model.userData.entityId),
      transform: { position: [star.model.position.x, 0, star.model.position.z], rotationY: 0 },
      components: { timer: { remainingSeconds: star.remainingSeconds } },
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const star of this.stars) this.remove(star);
    this.spriteFactory = undefined;
    void this.factoryRequest?.then((factory) => factory.dispose(), () => undefined);
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

  private startIdle(star: Star): void {
    if (this.disposed || !star.animation || star.removalAtSeconds !== null || !this.stars.has(star)) return;
    if (this.prefabId === POLAR_LIGHT_ID) {
      const clips = ['idle_loop', 'idle_loop2', 'idle_loop3'];
      star.animation.playOnce(clips[Math.floor(Math.random() * clips.length)], () => this.startIdle(star));
    } else star.animation.start('idle_loop');
  }

  private load(star: Star, appear: boolean): void {
    const sprite = this.spriteFactory!.create({
      initialAnimation: appear ? 'appear' : 'idle_loop', name: this.prefabId,
    });
    sprite.userData.entityId = star.model.userData.entityId;
    star.sprite = sprite;
    star.animation = sprite.userData.animationController as SpriteAnimationController;
    star.model.userData.animationController = star.animation;
    star.model.add(sprite);
    if (appear) {
      star.creationSound = PlaySound('dontstarve/common/staff_star_create', star.model.position);
      star.animation.playOnce('appear', () => this.startIdle(star));
    } else this.startIdle(star);
    star.loopSound = PlaySound(this.loopEvent, star.model.position);
    setPrefabLocalLight(star.model, this.light(star.ageSeconds));
    this.scene.add(star.model);
  }

  private unload(star: Star): void {
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

  private remove(star: Star): void {
    this.unload(star);
    this.stars.delete(star);
  }

  private isNearby(position: THREE.Vector3, player: Pick<THREE.Vector3, 'x' | 'z'> | undefined): boolean {
    if (!player) return true;
    const dx = position.x - player.x, dz = position.z - player.z;
    return dx * dx + dz * dz <= STAFF_LIGHT_ACTIVE_RADIUS ** 2;
  }

  /** Settle actual game seconds, including a partial batch or a sleeping interval. */
  private settle(star: Star, animateExpiry: boolean): boolean {
    if (star.removalAtSeconds !== null) {
      if (!animateExpiry || this.elapsedSeconds >= star.removalAtSeconds) this.remove(star);
      return this.stars.has(star);
    }
    const elapsed = this.elapsedSeconds - star.lastSettlementSeconds;
    star.lastSettlementSeconds = this.elapsedSeconds;
    star.pendingFrames = 0;
    star.ageSeconds += elapsed;
    star.remainingSeconds -= elapsed;
    if (star.remainingSeconds > 0) return true;
    star.removalAtSeconds = this.elapsedSeconds + star.remainingSeconds + 1;
    if (!animateExpiry || this.elapsedSeconds >= star.removalAtSeconds) {
      this.remove(star);
      return false;
    }
    // stafflight.lua kills staff_star_loop on disappearance's animover and
    // removes the entity one second after expiry. Overshoot uses the same clock.
    star.animation!.playOnce('disappear', () => star.loopSound?.stop());
    return true;
  }
}

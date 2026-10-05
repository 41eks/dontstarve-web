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
  model: THREE.Group;
  animation: SpriteAnimationController;
  remainingSeconds: number;
  ageSeconds: number;
  removalSeconds: number | null;
  creationSound?: SoundHandle;
  loopSound: SoundHandle;
}

/** Independent summon lifetimes; shared DST textures, separate merged frame meshes. */
export class DwarfStarManager {
  private factoryRequest?: Promise<AnimatedSpriteFactory>;
  private readonly stars = new Set<Star>();
  private disposed = false;
  private readonly scene: THREE.Scene;
  private readonly animationBaseUrl: string;
  private readonly duration: number;
  readonly prefabId: StaffLightId;

  constructor(scene: THREE.Scene, animationBaseUrl: string, prefabId: StaffLightId = DWARF_STAR_ID) {
    this.scene = scene;
    this.animationBaseUrl = animationBaseUrl;
    this.prefabId = prefabId;
    this.duration = prefabId === POLAR_LIGHT_ID ? POLAR_LIGHT_DURATION : DWARF_STAR_DURATION;
  }

  async prepare(): Promise<void> {
    await Promise.all([this.factory(), PreloadSounds('dontstarve/common/staff_star_create', this.loopEvent)]);
  }

  async spawn(position: THREE.Vector3, saved?: { id: string; remainingSeconds: number }): Promise<THREE.Group> {
    const remainingSeconds = saved?.remainingSeconds ?? this.duration;
    if (![position.x, position.y, position.z].every(Number.isFinite)
      || !Number.isFinite(remainingSeconds) || remainingSeconds <= 0 || remainingSeconds > this.duration)
      throw new RangeError(`Invalid ${this.prefabId} position or lifetime`);
    await this.prepare();
    const factory = await this.factory();
    if (this.disposed) throw new Error('Dwarf star manager has been disposed');
    const model = factory.create({ initialAnimation: saved ? 'idle_loop' : 'appear', name: this.prefabId });
    model.position.set(position.x, 0, position.z);
    model.userData.entityId = saved?.id ?? newEntityId();
    const animation = model.userData.animationController as SpriteAnimationController;
    const star: Star = { model, animation, remainingSeconds,
      ageSeconds: this.duration - remainingSeconds, removalSeconds: null,
      creationSound: saved ? undefined : PlaySound('dontstarve/common/staff_star_create', model.position),
      loopSound: PlaySound(this.loopEvent, model.position) };
    this.stars.add(star);
    if (!saved) animation.playOnce('appear', () => this.startIdle(star));
    else this.startIdle(star);
    setPrefabLocalLight(model, this.light(star.ageSeconds));
    this.scene.add(model);
    return model;
  }

  get renderEntities() {
    return Array.from(this.stars, ({ model }) => ({ object: model, footPosition: model.position, cameraDepth: 0 }));
  }

  update(dt: number, cameraWorldQuaternion: THREE.Quaternion): void {
    if (!Number.isFinite(dt) || dt < 0) return;
    for (const star of this.stars) {
      star.model.quaternion.copy(cameraWorldQuaternion);
      star.animation.update(dt);
      star.ageSeconds += dt;
      setPrefabLocalLight(star.model, this.light(star.ageSeconds));
      if (star.removalSeconds !== null) {
        star.removalSeconds -= dt;
      } else {
        star.remainingSeconds -= dt;
        if (star.remainingSeconds <= 0) {
          // stafflight.lua kills staff_star_loop on the disappearance's animover.
          star.animation.playOnce('disappear', () => star.loopSound.stop());
          star.removalSeconds = 1 + star.remainingSeconds;
        }
      }
      if (star.removalSeconds !== null && star.removalSeconds <= 0) this.remove(star);
    }
  }

  exportRecords(): DwarfStarRecord[] {
    return Array.from(this.stars).filter((star) => star.removalSeconds === null).map((star) => ({
      id: String(star.model.userData.entityId),
      transform: { position: [star.model.position.x, 0, star.model.position.z], rotationY: 0 },
      components: { timer: { remainingSeconds: star.remainingSeconds } },
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const star of this.stars) this.remove(star);
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
    if (this.disposed || star.removalSeconds !== null || !this.stars.has(star)) return;
    if (this.prefabId === POLAR_LIGHT_ID) {
      const clips = ['idle_loop', 'idle_loop2', 'idle_loop3'];
      star.animation.playOnce(clips[Math.floor(Math.random() * clips.length)], () => this.startIdle(star));
    } else star.animation.start('idle_loop');
  }

  private remove(star: Star): void {
    star.creationSound?.stop();
    star.loopSound.stop();
    setPrefabLocalLight(star.model, null);
    this.stars.delete(star);
    void this.factoryRequest?.then((factory) => factory.disposeSprite(star.model));
    star.model.removeFromParent();
  }
}

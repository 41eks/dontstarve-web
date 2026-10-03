import * as THREE from 'three';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory, type SpriteAnimationController } from '@three-roaming/animation/sprite';
import { setPrefabLocalLight, type PrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';
import { YELLOWSTAFF_COLOUR } from './yellowstaff';
import { newEntityId } from './saveRecord';

export const DWARF_STAR_ID = 'stafflight';
// Gameplay duration requested for this project: 24 minutes.
export const DWARF_STAR_DURATION = 24 * 60;

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
}

/** Independent summon lifetimes; shared DST textures, separate merged frame meshes. */
export class DwarfStarManager {
  private factoryRequest?: Promise<AnimatedSpriteFactory>;
  private readonly stars = new Set<Star>();
  private disposed = false;
  private readonly scene: THREE.Scene;
  private readonly animationBaseUrl: string;

  constructor(scene: THREE.Scene, animationBaseUrl: string) {
    this.scene = scene;
    this.animationBaseUrl = animationBaseUrl;
  }

  async prepare(): Promise<void> { await this.factory(); }

  async spawn(position: THREE.Vector3, saved?: { id: string; remainingSeconds: number }): Promise<THREE.Group> {
    const remainingSeconds = saved?.remainingSeconds ?? DWARF_STAR_DURATION;
    if (![position.x, position.y, position.z].every(Number.isFinite)
      || !Number.isFinite(remainingSeconds) || remainingSeconds <= 0 || remainingSeconds > DWARF_STAR_DURATION)
      throw new RangeError('Invalid dwarf star position or lifetime');
    const factory = await this.factory();
    if (this.disposed) throw new Error('Dwarf star manager has been disposed');
    const model = factory.create({ initialAnimation: saved ? 'idle_loop' : 'appear', name: DWARF_STAR_ID });
    model.position.set(position.x, 0, position.z);
    model.userData.entityId = saved?.id ?? newEntityId();
    const animation = model.userData.animationController as SpriteAnimationController;
    if (!saved) animation.playOnce('appear', () => animation.start('idle_loop'));
    const star: Star = { model, animation, remainingSeconds,
      ageSeconds: DWARF_STAR_DURATION - remainingSeconds, removalSeconds: null };
    this.stars.add(star);
    setPrefabLocalLight(model, dwarfStarLight(star.ageSeconds));
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
      setPrefabLocalLight(star.model, dwarfStarLight(star.ageSeconds));
      if (star.removalSeconds !== null) {
        star.removalSeconds -= dt;
      } else {
        star.remainingSeconds -= dt;
        if (star.remainingSeconds <= 0) {
          star.animation.playOnce('disappear');
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
      this.factoryRequest = createAnimatedSpriteFactory(this.animationBaseUrl, 'star_hot.zip');
      void this.factoryRequest.catch(() => { this.factoryRequest = undefined; });
    }
    return this.factoryRequest;
  }

  private remove(star: Star): void {
    setPrefabLocalLight(star.model, null);
    this.stars.delete(star);
    void this.factoryRequest?.then((factory) => factory.disposeSprite(star.model));
    star.model.removeFromParent();
  }
}

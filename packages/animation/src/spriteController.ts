import type * as THREE from 'three';
import type { SpriteController } from './sprite';
import type { StaticSpriteController } from './wallSprite';
import type { FacingSpriteController } from './beefaloSprite';

/**
 * The playback controller a factory-built sprite carries: an animated sprite's (six-faced art also switches builds),
 * or a static (wall) sprite's.
 */
export type FactorySpriteController = SpriteController | (SpriteController & FacingSpriteController) | StaticSpriteController;

const controllers = new WeakMap<THREE.Object3D, FactorySpriteController>();

/** The factory that builds a sprite registers its controller under the sprite's root. */
export function setSpriteController(sprite: THREE.Object3D, controller: FactorySpriteController): void {
  controllers.set(sprite, controller);
}

/** The controller registered for a factory sprite, if it is one. */
export function spriteController(sprite: THREE.Object3D | undefined): FactorySpriteController | undefined {
  return sprite ? controllers.get(sprite) : undefined;
}

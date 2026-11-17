import type * as THREE from 'three';
import type { StaticSpriteController } from './wallSprite';

/** The playback controller a static (wall) sprite carries: its poses and image frames. */
export type FactorySpriteController = StaticSpriteController;

const controllers = new WeakMap<THREE.Object3D, FactorySpriteController>();

/** The factory that builds a static sprite registers its controller under the sprite's root. */
export function setSpriteController(sprite: THREE.Object3D, controller: FactorySpriteController): void {
  controllers.set(sprite, controller);
}

/** The controller registered for a static sprite, if it is one. */
export function spriteController(sprite: THREE.Object3D | undefined): FactorySpriteController | undefined {
  return sprite ? controllers.get(sprite) : undefined;
}

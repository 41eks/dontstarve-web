import type * as THREE from 'three';

const spriteRenderGroups = new WeakMap<THREE.Object3D, THREE.Group>();

export function registerSpriteRenderGroup(
  sprite: THREE.Object3D,
  renderGroup: THREE.Group,
): void {
  spriteRenderGroups.set(sprite, renderGroup);
}

export function setSpriteEntityRenderOrder(
  sprite: THREE.Object3D,
  renderOrder: number,
): void {
  const renderGroup = spriteRenderGroups.get(sprite);
  if (!renderGroup) {
    throw new Error(`${sprite.name || 'Object3D'} is not a registered animated sprite`);
  }
  renderGroup.renderOrder = renderOrder;
}

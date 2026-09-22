import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  registerSpriteRenderGroup,
  setSpriteEntityRenderOrder,
} from '../src/renderOrder';

describe('sprite entity render order', () => {
  it('sets the registered visual group order without changing its mesh', () => {
    const sprite = new THREE.Group();
    const visual = new THREE.Group();
    const mesh = new THREE.Mesh();
    visual.add(mesh);
    sprite.add(visual);
    registerSpriteRenderGroup(sprite, visual);

    setSpriteEntityRenderOrder(sprite, 2);

    expect(visual.renderOrder).toBe(2);
    expect(visual.children).toEqual([mesh]);
  });

  it('rejects objects that are not animated sprites', () => {
    const object = new THREE.Group();
    object.name = 'Unregistered';

    expect(() => setSpriteEntityRenderOrder(object, 1)).toThrow(
      'Unregistered is not a registered animated sprite',
    );
  });
});

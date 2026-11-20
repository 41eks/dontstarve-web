import * as THREE from 'three';
import { prefabDisplay } from '../../display/src';
import { itemAt, ItemWorldFixture } from './itemWorldFixture';
import { createPickupInventory } from './pickupFixture';

/** Exercise the item prefab's ground art as the application spawns it: an item inst lying in the world, drawn by its display. */
export async function createGroundItemVisual(itemId: string, skinId?: string) {
  const inventory = createPickupInventory();
  const world = new ItemWorldFixture(
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    undefined,
    '/dst/data/databundles/images.zip',
    inventory,
    '/dst/data/anim',
    new THREE.Group(),
  );
  const model = world.spawnFromSave(itemId, { itemId, count: 1, skinId, name: itemId, icon: '' }, new THREE.Vector3());
  const display = prefabDisplay(model)!,
    instance = itemAt(model);
  // The item exists at once; its display loads the art before the test inspects the drawn sprite.
  await display.artLoaded();
  return {
    model,
    display,
    instance,
    get currentAnimation() {
      return instance.sprite.currentAnimation;
    },
    update: (dt: number) => instance.sprite.update(dt),
    dispose: () => {
      world.dispose();
      inventory.dispose();
    },
  };
}

import { createResidentGroundItem, type GroundItemAssets } from '../../prefab/src/groundItems';

/** Exercise the display-owned ground art, including the lifecycle used in the application. */
export async function createGroundItemVisual(assets: GroundItemAssets, itemId: string, skinId?: string) {
  const { visual, instance, display } = createResidentGroundItem({ assets }, { itemId, skinId });
  // The item exists at once; its display loads the art before the test inspects the drawn sprite.
  await display.artLoaded();
  return { ...visual, get currentAnimation() { return instance.sprite.currentAnimation; },
    update: (dt: number) => instance.sprite.update(dt) };
}

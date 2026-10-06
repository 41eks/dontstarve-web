import * as THREE from 'three';
import {
  findImage, smallHash, SpriteFrameRenderer, type Animation, type ResolvedSprite,
} from '@dontstarve-web/animation/animationAssets';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from './groundItems';
import { listenInventoryEvents } from './inventoryEvents';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';

export const BERNIE_ITEM_ID = 'bernie_inactive';
export const BERNIE_BIG_SANITY_PERCENT = 30 / 200;
export type BernieGroundForm = 'bernie_active' | 'bernie_big';
type BernieAnimationForm = BernieGroundForm | typeof BERNIE_ITEM_ID;

export interface BernieWorld {
  getSanityPercent(): number;
}

/** The application deliberately allows Wilson to activate Bernie too. */
export function bernieGroundForm(sanityPercent: number): BernieGroundForm {
  return sanityPercent < BERNIE_BIG_SANITY_PERCENT ? 'bernie_big' : 'bernie_active';
}

/** Preload both banks so a sanity change never removes or asynchronously swaps an entity. */
export async function createBernieGroundSprite(assets: GroundItemAssets, world: BernieWorld, skinId?: string) {
  const definition = GROUND_ITEM_DEFINITIONS[BERNIE_ITEM_ID];
  const skinArchive = skinId === undefined ? undefined : definition.skinArchives[skinId];
  if (skinId !== undefined && !skinArchive) throw new Error(`Unknown Bernie skin: ${skinId}`);
  const [small, big, base, skin] = await Promise.all([
    assets.loadAnimation('bernie.zip'), assets.loadAnimation('bernie_big.zip'),
    assets.loadBuild('bernie_build.zip'), skinArchive ? assets.loadBuild(skinArchive) : undefined,
  ]);
  const findClip = (parsed: typeof small, bank: string, name = 'idle_loop'): Animation => {
    const clip = parsed.animations.find(({ name: clipName, bankHash }) => clipName === name && bankHash === smallHash(bank));
    if (!clip?.frames.length) throw new Error(`Missing Bernie animation ${bank}:${name}`);
    return clip;
  };
  const animations: Record<BernieAnimationForm, Animation> = {
    bernie_active: findClip(small, 'bernie'), bernie_big: findClip(big, 'bernie_big'),
    bernie_inactive: findClip(small, 'bernie', 'inactive'),
  };
  const model = new THREE.Group();
  const visual = new THREE.Group();
  visual.scale.set(0.02, -0.02, 0.02);
  model.add(visual);
  registerSpriteRenderGroup(model, visual);
  Object.assign(model.userData, { billboard: true, itemId: BERNIE_ITEM_ID, skinId });
  const renderer = new SpriteFrameRenderer(visual);
  let form: BernieAnimationForm | undefined;
  let inInventory = false;
  let elapsed = 0;
  let previousFrame = -1;
  const showForm = (next: BernieAnimationForm, dt: number) => {
    if (next !== form) {
      form = next;
      elapsed = 0;
      previousFrame = -1;
      // bernie_big.lua applies a 0.7 Transform scale; small Bernie uses 1.
      const scale = 0.02 * (form === 'bernie_big' ? 0.7 : 1);
      visual.scale.set(scale, -scale, scale);
      model.name = `GroundItem:${form}`;
      Object.assign(model.userData, { prefab: form, animation: form === BERNIE_ITEM_ID ? 'inactive' : 'idle_loop' });
    }
    elapsed += Math.max(0, Math.min(dt, 0.1));
    const clip = animations[form];
    const frame = Math.floor(elapsed * clip.frameRate) % clip.frames.length;
    if (frame === previousFrame) return;
    const sprites = [...clip.frames[frame].elements]
      .filter((element) => element.imageHash !== smallHash('bounding'))
      .sort((a, b) => b.z - a.z).map((element) => {
        for (const source of skin ? [skin, base] : [base]) {
          const image = findImage(source.build, element.imageHash, element.imageIndex);
          if (image) return { element, image, materials: source.materials };
        }
        // The shared bank also contains allegiance FX placeholders (blob_body,
        // etc.). DST leaves these undrawn when the selected build has no art.
        return undefined;
      }).filter((sprite): sprite is ResolvedSprite => sprite !== undefined);
    renderer.show(sprites);
    previousFrame = frame;
  };
  const update = (dt: number) => {
    if (!inInventory) showForm(bernieGroundForm(world.getSanityPercent()), dt);
  };
  try { update(0); } catch (error) {
    visual.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    throw error;
  }
  const onGround = () => { inInventory = false; update(0); };
  const removeInventoryEvents = listenInventoryEvents(model, {
    ondropped: onGround,
    onload: onGround,
    onputininventory: () => { inInventory = true; showForm(BERNIE_ITEM_ID, 0); },
  });
  return {
    model, update,
    dispose() {
      removeInventoryEvents();
      inInventory = true;
      model.removeFromParent();
      visual.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    },
  };
}

export function createBernieGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  return {
    itemIds: [BERNIE_ITEM_ID],
    create: (item) => createBernieGroundSprite(context.assets, context.bernieWorld, item.skinId),
  };
}

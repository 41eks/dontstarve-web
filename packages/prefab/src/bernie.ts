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
  const animations = new Map<string, Animation>();
  for (const [form, parsed, bank] of [
    ['bernie_active', small, 'bernie'], ['bernie_big', big, 'bernie_big'],
  ] as const) {
    for (const name of ['idle_loop', 'idle_loop_nodir', 'activate']) {
      animations.set(`${form}:${name}`, findClip(parsed, bank, name));
    }
  }
  for (const name of ['deactivate', 'deactivate_pst']) {
    animations.set(`bernie_big:${name}`, findClip(big, 'bernie_big', name));
  }
  animations.set(`${BERNIE_ITEM_ID}:inactive`, findClip(small, 'bernie', 'inactive'));
  const model = new THREE.Group();
  const visual = new THREE.Group();
  visual.scale.set(0.02, -0.02, 0.02);
  model.add(visual);
  registerSpriteRenderGroup(model, visual);
  Object.assign(model.userData, { billboard: true, itemId: BERNIE_ITEM_ID, skinId });
  const renderer = new SpriteFrameRenderer(visual);
  let form: BernieAnimationForm;
  let clip: Animation;
  let inInventory = false;
  let elapsed = 0;
  let previousFrame = -1;
  const play = (next: BernieAnimationForm, name: string, time = 0) => {
    const animation = animations.get(`${next}:${name}`);
    if (!animation) throw new Error(`Missing Bernie animation ${next}:${name}`);
    form = next;
    clip = animation;
    elapsed = time;
    previousFrame = -1;
    // bernie_big.lua keeps scale 0.7 throughout activate/deactivate, including
    // the small pose in deactivate_pst. The growth is baked into the source art.
    const scale = 0.02 * (form === 'bernie_big' ? 0.7 : 1);
    visual.scale.set(scale, -scale, scale);
    model.name = `GroundItem:${form}`;
    Object.assign(model.userData, { prefab: form, animation: name });
  };
  const draw = () => {
    const rawFrame = Math.floor(elapsed * clip.frameRate);
    const frame = clip.name === 'idle_loop' ? rawFrame % clip.frames.length
      : Math.min(rawFrame, clip.frames.length - 1);
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
    if (inInventory) return;
    const desired = bernieGroundForm(world.getSanityPercent());
    // Finish busy states before responding to another sanity change, as the
    // Lua brains do. Re-read sanity on each update rather than queuing stale forms.
    if (clip.name === 'idle_loop' && desired !== form) {
      if (desired === 'bernie_big') play('bernie_big', 'activate');
      else play('bernie_big', 'deactivate');
    }
    elapsed += Math.max(0, Math.min(dt, 0.1));
    while (clip.name !== 'idle_loop') {
      const duration = clip.name === 'idle_loop_nodir' ? 0.5 : clip.frames.length / clip.frameRate;
      if (elapsed + 1e-8 < duration) break;
      const remaining = Math.max(0, elapsed - duration);
      switch (clip.name) {
        case 'deactivate': play('bernie_big', 'deactivate_pst', remaining); break;
        // SGberniebig goes inactive after the whole queue; the small prefab
        // reanimates through SGbernie's activate before returning to idle.
        case 'deactivate_pst': play('bernie_active', 'activate', remaining); break;
        case 'activate': play(form, 'idle_loop_nodir', remaining); break;
        // Both stategraphs switch facing at 0.5s and preserve animation time.
        case 'idle_loop_nodir': play(form, 'idle_loop', elapsed); break;
        default: throw new Error(`Unexpected Bernie animation ${clip.name}`);
      }
    }
    draw();
  };
  try { play(bernieGroundForm(world.getSanityPercent()), 'idle_loop'); draw(); } catch (error) {
    visual.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    throw error;
  }
  const onGround = () => {
    inInventory = false;
    play(bernieGroundForm(world.getSanityPercent()), 'idle_loop');
    draw();
  };
  const removeInventoryEvents = listenInventoryEvents(model, {
    ondropped: onGround,
    onload: onGround,
    onputininventory: () => { inInventory = true; play(BERNIE_ITEM_ID, 'inactive'); draw(); },
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

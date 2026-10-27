import { smallHash, type Animation } from '@dontstarve-web/animation/animationAssets';
import { SpriteController } from '@dontstarve-web/animation/sprite';
import { SpriteResources } from '@dontstarve-web/display';
import { animationTiming } from './animationTimings';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import { createPrefabEntity } from './prefabInstance';
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

/** bernie.zip and bernie_big.zip clips named `form:clip`; bernie_big.lua keeps scale 0.7, its growth is baked into the art. */
class BernieSpriteController extends SpriteController {
  protected override findAnimation(key: string): Animation {
    const separator = key.indexOf(':');
    const form = key.slice(0, separator), name = key.slice(separator + 1);
    const bank = smallHash(form === 'bernie_big' ? 'bernie_big' : 'bernie');
    const animation = this.animations.animations.find(clip => clip.name === name && clip.bankHash === bank);
    if (!animation?.frames.length) throw new Error(`Missing Bernie animation ${key}`);
    const scale = 0.02 * (form === 'bernie_big' ? 0.7 : 1);
    this.visual.scale.set(scale, -scale, scale);
    return animation;
  }
}

/** The display shares both banks and each skin; gameplay uses imported clip timings. */
export class BernieAssets {
  private readonly resources: SpriteResources;
  constructor(assetBaseUrl: string) { this.resources = new SpriteResources(assetBaseUrl); }
  source(skinId?: string) {
    const skinArchive = skinId === undefined ? undefined : GROUND_ITEM_DEFINITIONS[BERNIE_ITEM_ID].skinArchives[skinId];
    if (skinId !== undefined && !skinArchive) throw new Error(`Unknown Bernie skin: ${skinId}`);
    return this.resources.factory({ buildArchive: 'bernie_build.zip', animationArchive: 'bernie.zip',
      extraAnimationArchives: ['bernie_big.zip'], skinArchive }, BernieSpriteController);
  }
  dispose(): void { this.resources.dispose(); }
}

export function createBernieGroundSprite(assets: BernieAssets, world: BernieWorld, skinId?: string) {
  const clipOf = (form: BernieAnimationForm, name: string) => animationTiming(form === 'bernie_big' ? 'bernie_big.zip' : 'bernie.zip', name);
  const required = [...(['bernie_active', 'bernie_big'] as const).flatMap(form => ['idle_loop', 'idle_loop_nodir', 'activate'].map(name => [form, name] as const)),
    ['bernie_big', 'deactivate'], ['bernie_big', 'deactivate_pst'], [BERNIE_ITEM_ID, 'inactive']] as const;
  for (const [form, name] of required) clipOf(form, name);
  let form: BernieAnimationForm = bernieGroundForm(world.getSanityPercent());
  const spriteName = `GroundItem:${BERNIE_ITEM_ID}`;
  const { instance, display } = createPrefabEntity(BERNIE_ITEM_ID, assets.source(skinId), { name: `${form}:idle_loop` }, spriteName);
  const model = display.model, sprite = instance.sprite;
  model.userData.itemId = BERNIE_ITEM_ID; instance.skinId = skinId;
  let clip = clipOf(form, 'idle_loop');
  let inInventory = false;
  let elapsed = 0;
  const play = (next: BernieAnimationForm, name: string, time = 0) => {
    form = next;
    clip = clipOf(next, name);
    elapsed = time;
    const key = `${next}:${name}`;
    if (name === 'idle_loop') sprite.start(key); else sprite.playOnce(key);
    model.name = `GroundItem:${form}`;
    model.userData.animation = name;
  };
  const update = (dt: number) => {
    if (inInventory) return;
    sprite.update(dt);
    const desired = bernieGroundForm(world.getSanityPercent());
    const previous = clip;
    // Finish busy states before responding to another sanity change, as the
    // Lua brains do. Re-read sanity on each update rather than queuing stale forms.
    if (clip.name === 'idle_loop' && desired !== form) {
      if (desired === 'bernie_big') play('bernie_big', 'activate');
      else play('bernie_big', 'deactivate');
    }
    elapsed += Math.max(0, Math.min(dt, 0.1));
    while (clip.name !== 'idle_loop') {
      const duration = clip.name === 'idle_loop_nodir' ? 0.5 : clip.frames / clip.frameRate;
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
    // A clip started during this update is shown at the time the stategraph has reached in it.
    if (clip !== previous) {
      const frame = Math.floor(elapsed * clip.frameRate);
      if (frame > 0) sprite.setFrame(clip.name === 'idle_loop' ? frame % clip.frames : Math.min(frame, clip.frames - 1));
      sprite.update(0);
    }
  };
  const onGround = () => {
    inInventory = false;
    play(bernieGroundForm(world.getSanityPercent()), 'idle_loop');
    sprite.update(0);
  };
  const removeInventoryEvents = listenInventoryEvents(model, {
    ondropped: onGround,
    onload: onGround,
    onputininventory: () => { inInventory = true; play(BERNIE_ITEM_ID, 'inactive'); sprite.update(0); },
  });
  model.userData.animation = 'idle_loop';
  model.name = `GroundItem:${form}`;
  return {
    model, instance, update,
    dispose() {
      removeInventoryEvents();
      inInventory = true;
      instance.remove();
      display.dispose();
    },
  };
}

export function createBernieGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  const assets = new BernieAssets(context.animationBaseUrl);
  return {
    itemIds: [BERNIE_ITEM_ID],
    create: (item) => createBernieGroundSprite(assets, context.bernieWorld, item.skinId),
    dispose: () => assets.dispose(),
  };
}

import * as THREE from 'three';
import {
  findImage, smallHash, SpriteFrameRenderer, type AnimElement, type Matrix2D, type ResolvedSprite,
} from '@dontstarve-web/animation/animationAssets';
import {
  bloomPadding, compose, HatArtAssets, isHatPlayerElementVisible, resolveHatElement, resolveHatSprites,
  type HatArtDefinition, type HatEquipment as ArtHatEquipment, type HatEquipMode,
} from '@dontstarve-web/animation/hatAssets';
import type { InventoryItemSpec, InventoryRecipeDefinition, InventorySkinSpec } from '@dontstarve-web/inventory';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import { attachPrefabLight, type PrefabLocalLight } from './localLight';
import { createMemo, createSignal, readonlySignal, type Memo, type ReadonlySignal } from '@dontstarve-web/signals';
import { TILE_SIZE } from './tile';
import catalog from './hats.json' with { type: 'json' };
import { listenInventoryEvents } from './inventoryEvents';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';

export type { HatEquipMode };
export type HatEquipment = ArtHatEquipment<HatDefinition>;
export { resolveHatSprites };

export interface HatDefinition extends HatArtDefinition {
  readonly name: string;
  readonly icon: string;
  readonly atlas: string;
  readonly archive: string;
  readonly equip: {
    readonly mode: HatEquipMode;
    readonly symbol: string;
    readonly activated?: {
      readonly archive: string;
      readonly symbol: string;
      readonly sanityThreshold: number;
      readonly light: PrefabLocalLight;
    };
    readonly follow?: {
      readonly animation: string;
      readonly symbols?: readonly string[];
      readonly extraBuilds?: readonly string[];
    };
  };
  readonly skinArchives: Readonly<Record<string, string>>;
  readonly skinEquipModes: Readonly<Record<string, HatEquipMode>>;
}

export const HAT_DEFINITIONS: Readonly<Record<string, HatDefinition>> = catalog.hats as unknown as
  Readonly<Record<string, HatDefinition>>;
export const HAT_IDS: readonly string[] = Object.keys(HAT_DEFINITIONS);
export function isHatId(itemId: string): boolean {
  return Object.hasOwn(HAT_DEFINITIONS, itemId);
}

export const HAT_ITEM_SPECS: Readonly<Record<string, InventoryItemSpec>> = Object.fromEntries(
  Object.entries(HAT_DEFINITIONS).map(([id, hat]) => [id, {
    name: hat.name, icon: hat.icon, atlas: hat.atlas, maxStack: 1, equippable: 'head',
  }]),
);

export const HAT_SKIN_SPECS: Readonly<Record<string, InventorySkinSpec>> = catalog.skinSpecs;

/** Original requirements, including technology and character/skill restrictions. */
export const HAT_CRAFTING_DEFINITIONS = catalog.recipes;

export const HAT_RECIPES: Readonly<Record<string, InventoryRecipeDefinition>> = Object.fromEntries(
  HAT_CRAFTING_DEFINITIONS.flatMap((source) => {
    const ingredients: Record<string, number> = {};
    const requiredItems: string[] = [];
    for (const ingredient of source.ingredients) {
      // Character resources (balloonhat's sanity) have no inventory-slot equivalent.
      if (typeof ingredient.type !== 'string' || typeof ingredient.amount !== 'number'
        || !Number.isSafeInteger(ingredient.amount) || ingredient.amount < 0) return [];
      if (ingredient.amount === 0) requiredItems.push(ingredient.type);
      else ingredients[ingredient.type] = (ingredients[ingredient.type] ?? 0) + ingredient.amount;
    }
    const config = source.config as { product?: string; numtogive?: number };
    return [[source.name, {
      recipeId: source.name, productId: config.product ?? source.name,
      productCount: config.numtogive ?? 1, ingredients, buffered: false,
      ...(requiredItems.length ? { requiredItems } : {}),
    }]];
  }),
);

/** One cache per player; loads only hats actually equipped and shares atlas materials. */
export class HatEquipmentAssets extends HatArtAssets<HatDefinition> {
  constructor(assetBaseUrl: string) { super(assetBaseUrl, HAT_DEFINITIONS); }
}

/** The element hashes are immutable animation data; only the hat mode changes, so only it is a signal. */
export function createHatPlayerVisibility(mode: ReadonlySignal<HatEquipMode | null>): Memo<(element: AnimElement) => boolean> {
  return createMemo(() => {
    const current = mode.get();
    return (element: AnimElement) => isHatPlayerElementVisible(element, current);
  });
}

/** hats.lua activation and alterguardian_hat_equipped.lua's two NoFaced layers. */
export class HatActivationController {
  private readonly owner: THREE.Object3D;
  private removeLight: (() => void) | null = null;
  private readonly hat = createSignal<HatEquipment | null>(null);
  /** Derived from the equipped hat's threshold and the owner's sanity ratio (hats.lua's 85% boundary). */
  readonly activated: ReadonlySignal<boolean>;
  private readonly activatedMemo: Memo<boolean>;
  private readonly stopActivated: () => void;
  private active = false;
  private deactivating = false;
  private elapsed = 0;

  constructor(owner: THREE.Object3D, sanityPercent?: ReadonlySignal<number>) {
    this.owner = owner;
    this.activatedMemo = createMemo(() => {
      const hat = this.hat.get();
      const config = hat?.definition.equip.activated;
      return !!hat?.activated && !!config && (sanityPercent?.get() ?? 1) > config.sanityThreshold;
    });
    this.activated = readonlySignal(this.activatedMemo);
    this.stopActivated = this.activatedMemo.subscribe(active => this.apply(active));
  }

  get isAnimating(): boolean { return this.active || this.deactivating; }
  get hidesSwapHat(): boolean {
    return this.active || (this.deactivating && this.elapsed < 8 / 30);
  }

  setHat(hat: HatEquipment | null): void {
    this.hat.set(hat);
    this.active = false;
    this.deactivating = false;
    this.elapsed = 0;
    this.apply(this.activatedMemo.peek());
  }

  dispose(): void {
    this.stopActivated();
    this.activatedMemo.dispose();
    this.removeLight?.(); this.removeLight = null;
  }

  update(dt: number): void {
    if (!this.isAnimating) return;
    this.elapsed += dt;
    if (this.deactivating) {
      const clip = this.hat.peek()!.activated!.animations.animations.find(({ name }) => name === 'activate_pst')!;
      if (this.elapsed >= clip.frames.length / clip.frameRate) this.deactivating = false;
    }
  }

  resolve(anchor: AnimElement, mirrored: boolean): { back: ResolvedSprite[]; front: ResolvedSprite[] } {
    const back: ResolvedSprite[] = [];
    const front: ResolvedSprite[] = [];
    const fx = this.hat.peek()?.activated;
    if (!fx || !this.isAnimating) return { back, front };
    const clips = fx.animations.animations;
    const pre = clips.find(({ name }) => name === 'activate_pre')!;
    const preDuration = pre.frames.length / pre.frameRate;
    const clip = clips.find(({ name }) => name === (this.active
      ? this.elapsed < preDuration ? 'activate_pre' : 'activate_loop'
      : 'activate_pst'))!;
    const time = this.active && this.elapsed >= preDuration ? this.elapsed - preDuration : this.elapsed;
    const index = Math.floor((time + 1e-8) * clip.frameRate);
    const frame = clip.frames[clip.name === 'activate_loop'
      ? index % clip.frames.length : Math.min(index, clip.frames.length - 1)];
    // FollowSymbol supplies the hair position, but SetNoFaced keeps the orbit
    // independent of head rotation, facing and the player's mirrored scale.
    const anchorMatrix: Matrix2D = [mirrored ? -1 : 1, 0, 0, 1, anchor.matrix[4], anchor.matrix[5]];
    for (const element of [...frame.elements].sort((a, b) => b.z - a.z)) {
      const hash = element.imageHash;
      const skinnable = hash === smallHash('p4_piece') || hash === smallHash('fx_glow');
      const source = skinnable ? fx.builds.find(({ build }) => build.symbols.has(hash)) : fx.builds.at(-1);
      if (!source) continue;
      // No seed contents: flame_swap/outline have no source build images.
      const image = findImage(source.build, hash, element.imageIndex);
      if (!image) continue;
      const sprites = element.layerHash === smallHash('back') ? back : front;
      const transformed = { ...element, matrix: compose(anchorMatrix, element.matrix) };
      if (hash === smallHash('p4_piece')) {
        sprites.push({ element: transformed, image: { ...image,
          width: image.width + bloomPadding * 2, height: image.height + bloomPadding * 2,
          bbx: image.bbx! - bloomPadding, bby: image.bby! - bloomPadding,
        }, materials: fx.bloomMaterials.get(source)! });
      }
      sprites.push({ element: transformed, image,
        materials: hash === smallHash('fx_glow') ? fx.glowMaterials.get(source)! : source.materials });
    }
    return { back, front };
  }

  private apply(active: boolean): void {
    const config = this.hat.peek()?.definition.equip.activated;
    if (active !== this.active) {
      this.deactivating = this.active && !active;
      this.active = active;
      this.elapsed = 0;
    }
    // hats.lua spawns alterguardianhatlight under the owner on activation and removes it on deactivation.
    this.removeLight?.(); this.removeLight = null;
    if (active && config) {
      this.removeLight = attachPrefabLight(this.owner, 'HatActivationLight', {
        ...config.light, radius: config.light.radius * (TILE_SIZE / 4),
      });
    }
  }
}

export interface HatGroundSprite {
  readonly model: THREE.Group;
  update(dt: number): void;
  /** Shared atlas materials belong to HatEquipmentAssets. */
  dispose(): void;
}

/** hats.lua's simple(): the world bank plays anim, independently of swap_hat. */
export async function createHatGroundSprite(
  assets: HatEquipmentAssets,
  itemId: string,
  skinId?: string,
): Promise<HatGroundSprite> {
  const hat = await assets.load(itemId, skinId);
  // Each hat archive supplies its own anim, so select that archive's ground clip.
  const animation = hat.animations.animations.find(({ name }) => name === 'anim');
  if (!animation) throw new Error(`Hat ${itemId} has no ground animation`);
  const model = new THREE.Group();
  model.name = `GroundHat:${itemId}`;
  model.userData.billboard = true;
  const visual = new THREE.Group();
  visual.scale.set(0.02, -0.02, 0.02);
  model.add(visual);
  registerSpriteRenderGroup(model, visual);
  const renderer = new SpriteFrameRenderer(visual);
  let elapsed = 0;
  let frameIndex = -1;
  let inInventory = false;
  const update = (dt: number) => {
    if (inInventory) return;
    elapsed += Math.min(dt, 0.1);
    const frame = Math.floor(elapsed * animation.frameRate);
    // Rabbit's animqueueover restarts its ground idle in hats.lua.
    const next = itemId === 'rabbithat' ? frame % animation.frames.length
      : Math.min(frame, animation.frames.length - 1);
    if (next === frameIndex) return;
    frameIndex = next;
    const sprites = [...animation.frames[next].elements].sort((a, b) => b.z - a.z)
      .flatMap((element) => {
        const sprite = resolveHatElement(hat, element);
        return sprite ? [sprite] : [];
      });
    renderer.show(sprites);
  };
  update(0);
  const onGround = () => { inInventory = false; update(0); };
  const removeInventoryEvents = listenInventoryEvents(model, {
    ondropped: onGround,
    onload: onGround,
    onputininventory: () => { inInventory = true; },
  });
  return {
    model, update,
    dispose() {
      removeInventoryEvents();
      inInventory = true;
      model.removeFromParent();
      visual.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    },
  };
}

export function createHatGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  const assets = new HatEquipmentAssets(context.animationBaseUrl);
  return {
    itemIds: Object.keys(HAT_DEFINITIONS),
    create: (item) => createHatGroundSprite(assets, item.itemId, item.skinId),
    dispose: () => assets.dispose(),
  };
}

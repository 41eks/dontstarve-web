import * as THREE from 'three';
import {
  createMaterials, findImage, loadAnimationArchive, loadBuild, smallHash,
  type AnimElement, type BuildPackage, type Matrix2D, type ParsedAnim, type ParsedBuild,
  SpriteFrameRenderer, type ResolvedSprite,
} from '@three-roaming/animation/animationAssets';
import type { InventoryItemSpec, InventoryRecipeDefinition, InventorySkinSpec } from '@three-roaming/inventory';
import { registerSpriteRenderGroup } from '@three-roaming/animation/renderOrder';
import catalog from './hats.json' with { type: 'json' };

export type HatEquipMode = 'normal' | 'opentop' | 'fullhelm';

export interface HatDefinition {
  readonly name: string;
  readonly icon: string;
  readonly atlas: string;
  readonly archive: string;
  readonly equip: {
    readonly mode: HatEquipMode;
    readonly symbol: string;
    readonly follow?: {
      readonly animation: string;
      readonly symbols?: readonly string[];
      readonly extraBuilds?: readonly string[];
    };
  };
  readonly skinArchives: Readonly<Record<string, string>>;
  readonly skinEquipModes: Readonly<Record<string, HatEquipMode>>;
}

export const HAT_DEFINITIONS: Readonly<Record<string, HatDefinition>> = catalog.hats as
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

interface HatBuild {
  readonly build: ParsedBuild;
  readonly materials: THREE.MeshBasicMaterial[];
}
export interface HatEquipment {
  readonly definition: HatDefinition;
  readonly builds: readonly HatBuild[];
  readonly animations: ParsedAnim;
}

/** One cache per player; loads only hats actually equipped and shares atlas materials. */
export class HatEquipmentAssets {
  private readonly builds = new Map<string, Promise<HatBuild>>();
  private readonly hats = new Map<string, Promise<HatEquipment>>();
  private readonly assetBaseUrl: string;

  constructor(assetBaseUrl: string) {
    this.assetBaseUrl = assetBaseUrl;
  }

  load(itemId: string, skinId?: string): Promise<HatEquipment> {
    const definition = HAT_DEFINITIONS[itemId];
    if (!definition) return Promise.reject(new Error(`Unknown hat: ${itemId}`));
    const key = `${itemId}\n${skinId ?? ''}`;
    let request = this.hats.get(key);
    if (!request) {
      request = this.loadHat(definition, skinId);
      this.hats.set(key, request);
      void request.catch(() => this.hats.delete(key));
    }
    return request;
  }

  private async loadHat(definition: HatDefinition, skinId?: string): Promise<HatEquipment> {
    const { buildPackage, animations } = await loadAnimationArchive(definition.archive, this.assetBaseUrl);
    const base = this.builds.get(definition.archive) ?? Promise.resolve(this.materialize(buildPackage));
    this.builds.set(definition.archive, base);
    const skinArchive = skinId ? definition.skinArchives[skinId] : undefined;
    if (skinId && !skinArchive) throw new Error(`Unknown skin ${skinId} for ${definition.archive}`);
    const archives = [...(skinArchive ? [skinArchive] : []), definition.archive,
      ...(definition.equip.follow?.extraBuilds ?? [])];
    const builds = await Promise.all(archives.map((archive) => this.loadBuild(archive)));
    const skinMode = skinId ? definition.skinEquipModes[skinId] : undefined;
    return {
      definition: skinMode ? { ...definition, equip: { ...definition.equip, mode: skinMode } } : definition,
      builds, animations,
    };
  }

  private loadBuild(archive: string): Promise<HatBuild> {
    let request = this.builds.get(archive);
    if (!request) {
      request = loadBuild(archive, this.assetBaseUrl).then((build) => this.materialize(build));
      this.builds.set(archive, request);
      void request.catch(() => this.builds.delete(archive));
    }
    return request;
  }

  private materialize(build: BuildPackage): HatBuild {
    const materials = createMaterials(build);
    for (const material of materials) material.name = `hat:${build.build.name}`;
    return { build: build.build, materials };
  }
}

const hashSet = (names: readonly string[]) => new Set(names.map(smallHash));
const hairHashes = hashSet(['hair', 'hairfront', 'hairpigtails']);
const faceHashes = hashSet(['face', 'swap_face', 'beard', 'cheeks']);
const hatHairHash = smallHash('HAIR_HAT');
const headHash = smallHash('headbase');
const hatHeadHash = smallHash('headbase_hat');
const swapHatHash = smallHash('swap_hat');

/** DST visibility groups also contain layers named head/hairfront in the ANIM data. */
export function isHatPlayerElementVisible(element: AnimElement, mode: HatEquipMode | null): boolean {
  if (element.imageHash === swapHatHash) return mode !== null && mode !== 'fullhelm';
  if (element.imageHash === hatHeadHash) return mode === 'normal' || mode === 'fullhelm';
  if (element.imageHash === hatHairHash || element.layerHash === hatHairHash) return mode === 'normal';
  if (element.imageHash === headHash) return mode === null || mode === 'opentop';
  if (hairHashes.has(element.imageHash)) return mode === null || mode === 'opentop';
  if (faceHashes.has(element.imageHash)) return mode !== 'fullhelm';
  if (element.layerHash === smallHash('HEAD_HAT_HELM')) return mode === 'fullhelm';
  if (element.layerHash === smallHash('HEAD_HAT_NOHELM')) return mode === 'normal';
  return true;
}

function compose(parent: Matrix2D, child: Matrix2D): Matrix2D {
  const [a, b, c, d, tx, ty] = parent;
  const [e, f, g, h, ux, uy] = child;
  return [a * e + c * f, b * e + d * f, a * g + c * h, b * g + d * h,
    a * ux + c * uy + tx, b * ux + d * uy + ty];
}

function resolve(hat: HatEquipment, element: AnimElement, hash = element.imageHash): ResolvedSprite | undefined {
  const source = hat.builds.find(({ build }) => build.symbols.has(hash));
  if (!source) return undefined;
  const image = findImage(source.build, hash, element.imageIndex);
  return image ? { element, image, materials: source.materials } : undefined;
}

/** Inserts physical FollowSymbol art at its player's layer, in the same merged geometry. */
export function resolveHatSprites(hat: HatEquipment, anchor: AnimElement, elapsed: number): ResolvedSprite[] {
  const follow = hat.definition.equip.follow;
  if (!follow) {
    const sprite = resolve(hat, anchor, smallHash(hat.definition.equip.symbol));
    return sprite ? [sprite] : [];
  }
  const animation = hat.animations.animations.find(({ name }) =>
    name === `${follow.animation}${anchor.imageIndex + 1}`);
  if (!animation) return [];
  const frame = animation.frames[Math.floor(elapsed * animation.frameRate) % animation.frames.length];
  const symbols = follow.symbols ? hashSet(follow.symbols) : undefined;
  return [...frame.elements].filter((element) => !symbols || symbols.has(element.imageHash))
    .sort((a, b) => b.z - a.z)
    .flatMap((element) => {
      const sprite = resolve(hat, { ...element, matrix: compose(anchor.matrix, element.matrix) });
      return sprite ? [sprite] : [];
    });
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
  const update = (dt: number) => {
    elapsed += Math.min(dt, 0.1);
    const frame = Math.floor(elapsed * animation.frameRate);
    // Rabbit's animqueueover restarts its ground idle in hats.lua.
    const next = itemId === 'rabbithat' ? frame % animation.frames.length
      : Math.min(frame, animation.frames.length - 1);
    if (next === frameIndex) return;
    frameIndex = next;
    const sprites = [...animation.frames[next].elements].sort((a, b) => b.z - a.z)
      .flatMap((element) => {
        const sprite = resolve(hat, element);
        return sprite ? [sprite] : [];
      });
    renderer.show(sprites);
  };
  update(0);
  return {
    model, update,
    dispose() {
      model.removeFromParent();
      visual.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    },
  };
}

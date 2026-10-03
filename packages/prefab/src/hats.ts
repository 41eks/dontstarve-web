import * as THREE from 'three';
import {
  createMaterials, findImage, loadAnim, loadAnimationArchive, loadBuild, smallHash,
  type AnimElement, type BuildPackage, type Matrix2D, type ParsedAnim, type ParsedBuild,
  SpriteFrameRenderer, type ResolvedSprite,
} from '@three-roaming/animation/animationAssets';
import type { InventoryItemSpec, InventoryRecipeDefinition, InventorySkinSpec } from '@three-roaming/inventory';
import { registerSpriteRenderGroup } from '@three-roaming/animation/renderOrder';
import { setPrefabLightOverride, setPrefabLocalLight, type PrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';
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

interface HatBuild {
  readonly build: ParsedBuild;
  readonly materials: THREE.MeshBasicMaterial[];
}
export interface HatEquipment {
  readonly definition: HatDefinition;
  readonly builds: readonly HatBuild[];
  readonly animations: ParsedAnim;
  readonly activated?: {
    readonly animations: ParsedAnim;
    readonly builds: readonly HatBuild[];
    readonly glowMaterials: ReadonlyMap<HatBuild, THREE.MeshBasicMaterial[]>;
    readonly bloomMaterials: ReadonlyMap<HatBuild, THREE.MeshBasicMaterial[]>;
  };
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
    const activation = definition.equip.activated;
    let activated: HatEquipment['activated'];
    if (activation) {
      const [fxAnimations, fxBuild] = await Promise.all([
        loadAnim(activation.archive, this.assetBaseUrl), this.loadBuild(activation.archive),
      ]);
      // Only p4_piece/fx_glow use the skin; other symbols retain their FX build.
      const sources = [...(skinArchive ? [await this.loadBuild(skinArchive)] : []),
        fxBuild];
      const fxBuilds = sources.map(({ build, materials }) => ({ build,
        // hats.lua's empty spore container applies a 0.7 multiplier.
        materials: materials.map((source) => {
          const material = source.clone();
          material.color.setRGB(0.7, 0.7, 0.7, THREE.SRGBColorSpace);
          return material;
        }),
      }));
      activated = { animations: fxAnimations, builds: fxBuilds,
        glowMaterials: new Map(fxBuilds.map((source) => [source, source.materials.map((base) => {
          const glow = base.clone();
          glow.name += ':glow';
          // Preserve the source glow texture in darkness within the merged mesh.
          setPrefabLightOverride(glow, 1);
          return glow;
        })])),
        bloomMaterials: new Map(fxBuilds.map((source) => [source, createHatBloomMaterials(source)])),
      };
    }
    const skinMode = skinId ? definition.skinEquipModes[skinId] : undefined;
    return {
      definition: skinMode ? { ...definition, equip: { ...definition.equip, mode: skinMode } } : definition,
      builds, animations, ...(activated ? { activated } : {}),
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

const bloomPadding = 12;

/** Local approximation of the crown's SetBloomEffectHandle, using its own atlas
 * art. Bounds prevent the blur from sampling neighbouring atlas symbols. */
function createHatBloomMaterials(source: HatBuild): THREE.MeshBasicMaterial[] {
  const image = findImage(source.build, smallHash('p4_piece'), 0);
  if (!image) return [];
  return source.materials.map((base) => {
    const material = base.clone();
    material.name += ':bloom';
    material.blending = THREE.AdditiveBlending;
    material.opacity = 0.6;
    material.alphaTest = 0.001;
    setPrefabLightOverride(material, 1);
    material.onBeforeCompile = (shader) => {
      shader.uniforms.hatBloomBounds = { value: new THREE.Vector4(
        image.bbx! / image.canvasWidth!, image.bby! / image.canvasHeight!,
        (image.bbx! + image.width) / image.canvasWidth!, (image.bby! + image.height) / image.canvasHeight!,
      ) };
      shader.uniforms.hatBloomStep = { value: new THREE.Vector2(
        bloomPadding / 2 / image.canvasWidth!, bloomPadding / 2 / image.canvasHeight!,
      ) };
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
        #include <common>
        uniform vec4 hatBloomBounds;
        uniform vec2 hatBloomStep;
      `).replace('#include <map_fragment>', `
        vec4 halo = vec4(0.0);
        float weights = 0.0;
        for (int x = -2; x <= 2; x++) {
          for (int y = -2; y <= 2; y++) {
            vec2 delta = vec2(float(x), float(y));
            vec2 uv = vMapUv + delta * hatBloomStep;
            float weight = exp(-dot(delta, delta) * 0.5);
            weights += weight;
            if (all(greaterThanEqual(uv, hatBloomBounds.xy))
              && all(lessThanEqual(uv, hatBloomBounds.zw))) {
              vec4 texel = texture2D(map, uv);
              halo += vec4(texel.rgb * texel.a, texel.a) * weight;
            }
          }
        }
        diffuseColor *= vec4(halo.rgb / max(halo.a, 0.0001), halo.a / weights);
      `);
    };
    material.customProgramCacheKey = () => 'dst-hat-bloom-v1';
    return material;
  });
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

/** hats.lua activation and alterguardian_hat_equipped.lua's two NoFaced layers. */
export class HatActivationController {
  readonly model = new THREE.Group();
  private hat: HatEquipment | null = null;
  private sanityPercent = 1;
  private active = false;
  private deactivating = false;
  private elapsed = 0;

  constructor(owner: THREE.Object3D) {
    this.model.name = 'HatActivationLight';
    owner.add(this.model);
  }

  get isAnimating(): boolean { return this.active || this.deactivating; }
  get hidesSwapHat(): boolean {
    return this.active || (this.deactivating && this.elapsed < 8 / 30);
  }

  setHat(hat: HatEquipment | null): void {
    this.hat = hat;
    this.active = false;
    this.deactivating = false;
    this.elapsed = 0;
    this.refresh();
  }

  setSanityPercent(percent: number): void {
    if (!Number.isFinite(percent)) throw new RangeError('Sanity percent must be finite');
    this.sanityPercent = THREE.MathUtils.clamp(percent, 0, 1);
    this.refresh();
  }

  update(dt: number): void {
    if (!this.isAnimating) return;
    this.elapsed += dt;
    if (this.deactivating) {
      const clip = this.hat!.activated!.animations.animations.find(({ name }) => name === 'activate_pst')!;
      if (this.elapsed >= clip.frames.length / clip.frameRate) this.deactivating = false;
    }
  }

  resolve(anchor: AnimElement, mirrored: boolean): { back: ResolvedSprite[]; front: ResolvedSprite[] } {
    const back: ResolvedSprite[] = [];
    const front: ResolvedSprite[] = [];
    const fx = this.hat?.activated;
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

  private refresh(): void {
    const config = this.hat?.definition.equip.activated;
    const active = !!this.hat?.activated && !!config && this.sanityPercent > config.sanityThreshold;
    if (active !== this.active) {
      this.deactivating = this.active && !active;
      this.active = active;
      this.elapsed = 0;
    }
    setPrefabLocalLight(this.model, active && config ? {
      ...config.light, radius: config.light.radius * (TILE_SIZE / 4),
    } : null);
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

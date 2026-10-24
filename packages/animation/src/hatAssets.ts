import * as THREE from 'three';
import {
  createMaterials, findImage, loadAnim, loadAnimationArchive, loadBuild, smallHash,
  type AnimElement, type BuildPackage, type Matrix2D, type ParsedAnim, type ParsedBuild,
  type ResolvedSprite,
} from './animationAssets';
import { setLightOverride } from './lightOverride';

export type HatEquipMode = 'normal' | 'opentop' | 'fullhelm';

/** The archive/symbol fields art resolution needs; gameplay metadata stays in the prefab package. */
export interface HatArtDefinition {
  readonly archive: string;
  readonly equip: {
    readonly mode: HatEquipMode;
    readonly symbol: string;
    readonly activated?: { readonly archive: string };
    readonly follow?: {
      readonly animation: string;
      readonly symbols?: readonly string[];
      readonly extraBuilds?: readonly string[];
    };
  };
  readonly skinArchives: Readonly<Record<string, string>>;
  readonly skinEquipModes: Readonly<Record<string, HatEquipMode>>;
}

export interface HatBuild {
  readonly build: ParsedBuild;
  readonly materials: THREE.MeshBasicMaterial[];
}
export interface HatEquipment<D extends HatArtDefinition = HatArtDefinition> {
  readonly definition: D;
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
export class HatArtAssets<D extends HatArtDefinition = HatArtDefinition> {
  private readonly builds = new Map<string, Promise<HatBuild>>();
  private readonly hats = new Map<string, Promise<HatEquipment<D>>>();
  private readonly assetBaseUrl: string;
  private readonly definitions: Readonly<Record<string, D>>;
  private disposed = false;

  constructor(assetBaseUrl: string, definitions: Readonly<Record<string, D>>) {
    this.assetBaseUrl = assetBaseUrl;
    this.definitions = definitions;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const build of this.builds.values()) void build.then(({ materials }) => {
      for (const material of materials) { material.map?.dispose(); material.dispose(); }
    }, () => undefined);
    for (const hat of this.hats.values()) void hat.then(({ activated }) => {
      if (!activated) return;
      for (const material of [
        ...activated.builds.flatMap(({ materials }) => materials),
        ...Array.from(activated.glowMaterials.values()).flat(),
        ...Array.from(activated.bloomMaterials.values()).flat(),
      ]) material.dispose();
    }, () => undefined);
    this.builds.clear();
    this.hats.clear();
  }

  load(itemId: string, skinId?: string): Promise<HatEquipment<D>> {
    if (this.disposed) return Promise.reject(new Error('Hat assets have been disposed'));
    const definition = Object.hasOwn(this.definitions, itemId) ? this.definitions[itemId] : undefined;
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

  private async loadHat(definition: D, skinId?: string): Promise<HatEquipment<D>> {
    const { buildPackage, animations } = await loadAnimationArchive(definition.archive, this.assetBaseUrl);
    if (this.disposed) throw new Error('Hat assets have been disposed');
    const base = this.builds.get(definition.archive) ?? Promise.resolve(this.materialize(buildPackage));
    this.builds.set(definition.archive, base);
    const skinArchive = skinId ? definition.skinArchives[skinId] : undefined;
    if (skinId && !skinArchive) throw new Error(`Unknown skin ${skinId} for ${definition.archive}`);
    const archives = [...(skinArchive ? [skinArchive] : []), definition.archive,
      ...(definition.equip.follow?.extraBuilds ?? [])];
    const builds = await Promise.all(archives.map((archive) => this.loadBuild(archive)));
    const activation = definition.equip.activated;
    let activated: HatEquipment<D>['activated'];
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
          setLightOverride(glow, 1);
          return glow;
        })])),
        bloomMaterials: new Map(fxBuilds.map((source) => [source, createHatBloomMaterials(source)])),
      };
    }
    const skinMode = skinId ? definition.skinEquipModes[skinId] : undefined;
    return {
      definition: skinMode ? { ...definition, equip: { ...definition.equip, mode: skinMode } } as D : definition,
      builds, animations, ...(activated ? { activated } : {}),
    };
  }

  private loadBuild(archive: string): Promise<HatBuild> {
    if (this.disposed) return Promise.reject(new Error('Hat assets have been disposed'));
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

export const bloomPadding = 12;

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
    setLightOverride(material, 1);
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

export function compose(parent: Matrix2D, child: Matrix2D): Matrix2D {
  const [a, b, c, d, tx, ty] = parent;
  const [e, f, g, h, ux, uy] = child;
  return [a * e + c * f, b * e + d * f, a * g + c * h, b * g + d * h,
    a * ux + c * uy + tx, b * ux + d * uy + ty];
}

export function resolveHatElement(hat: HatEquipment, element: AnimElement, hash = element.imageHash): ResolvedSprite | undefined {
  const source = hat.builds.find(({ build }) => build.symbols.has(hash));
  if (!source) return undefined;
  const image = findImage(source.build, hash, element.imageIndex);
  return image ? { element, image, materials: source.materials } : undefined;
}

/** Inserts physical FollowSymbol art at its player's layer, in the same merged geometry. */
export function resolveHatSprites(hat: HatEquipment, anchor: AnimElement, elapsed: number): ResolvedSprite[] {
  const follow = hat.definition.equip.follow;
  if (!follow) {
    const sprite = resolveHatElement(hat, anchor, smallHash(hat.definition.equip.symbol));
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
      const sprite = resolveHatElement(hat, { ...element, matrix: compose(anchor.matrix, element.matrix) });
      return sprite ? [sprite] : [];
    });
}


import * as THREE from 'three';
import { findImage, type AnimElement, type Animation, type BuildImage, type Matrix2D, type ParsedBuild, type ResolvedSprite } from './animationAssets';
import { animStateVisible, resolveAnimStateSymbol, type ResolvedAnimState } from './animState';
import type { ReadonlyVector3 } from './transformRoot';

/**
 * Per-entity appearance drawn over an animation frame: AnimState declarations, OverrideSymbol / AddOverrideBuild,
 * follower composites, tint and bloom. Factory controllers and shared archive sprites resolve their frames through it,
 * so both accept the same AnimState calls.
 */

/** AnimState:OverrideSymbol with a loaded build; the caller owns its materials. */
export interface SymbolOverride {
  build: ParsedBuild;
  materials: THREE.MeshBasicMaterial[];
  symbolHash: number;
}

/** A whole build drawn by AnimState:AddOverrideBuild; the caller owns its materials. */
export interface BuildOverride {
  readonly build: ParsedBuild;
  readonly materials: THREE.MeshBasicMaterial[];
}

/** A child frame merged in the owner's layer order, or retained at a detached world point. */
export interface CompositeSpriteFrame {
  readonly sprites: readonly ResolvedSprite[];
  readonly symbol?: number;
  readonly detached?: { readonly position: ReadonlyVector3; readonly mirrored: boolean };
  /** AnimState:SetFinalOffset of a follower: negative draws it behind the whole owner, positive in front, 0 at the symbol's layer. */
  readonly finalOffset?: number;
  /** Transform:SetNoFaced: the follower keeps its own orientation, unmirrored by the owner's facing. */
  readonly noFaced?: boolean;
  /** Follower:FollowSymbol's x/y offset, in the followed symbol's space. */
  readonly offset?: readonly [number, number];
}

export interface SpriteTint { readonly colour: readonly number[]; readonly amount: number }

export function sameComposites(a: readonly CompositeSpriteFrame[], b: readonly CompositeSpriteFrame[]): boolean {
  return a.length === b.length && a.every((frame, i) => frame.sprites === b[i].sprites
    && frame.symbol === b[i].symbol && frame.detached === b[i].detached
    && frame.finalOffset === b[i].finalOffset && frame.noFaced === b[i].noFaced
    && frame.offset?.[0] === b[i].offset?.[0] && frame.offset?.[1] === b[i].offset?.[1]);
}

/** OverrideSymbol first, then the override builds from the last added; undefined leaves the symbol to the sprite's builds. */
export function resolveOverrideArt(element: AnimElement, overrides: ReadonlyMap<number, SymbolOverride>,
  buildOverrides: ReadonlyMap<string, BuildOverride>): ResolvedSprite | null | undefined {
  const override = overrides.get(element.imageHash);
  if (override) {
    const image = findImage(override.build, override.symbolHash, element.imageIndex);
    return image ? { element, image, materials: override.materials } : null;
  }
  for (const build of [...buildOverrides.values()].reverse()) {
    const image = findImage(build.build, element.imageHash, element.imageIndex);
    if (image) return { element, image, materials: build.materials };
  }
  return undefined;
}

/**
 * Private material copies of one sprite for AnimState:SetMultColour, alpha and SetAddColour-like tint, and the bloom
 * halos of its dressed materials. Source materials are returned unchanged while nothing is applied.
 */
export class SpriteMaterialDresser {
  private readonly colour = new THREE.Color(1, 1, 1);
  private opacity = 1;
  private readonly tintAmount = { value: 0 };
  private readonly tintColour = { value: new THREE.Color() };
  private readonly privateMaterials = new Map<THREE.MeshBasicMaterial, THREE.MeshBasicMaterial>();
  private readonly bloomMaterials = new Map<THREE.MeshBasicMaterial, Map<BuildImage, THREE.MeshBasicMaterial>>();

  /** Nothing dresses the source materials, so frames may be shared. */
  get plain(): boolean { return this.privateMaterials.size === 0 && this.undressed; }
  private get undressed(): boolean {
    return this.opacity === 1 && this.tintAmount.value === 0 && this.colour.r === 1 && this.colour.g === 1 && this.colour.b === 1;
  }

  setColour(colour: readonly number[]): void { this.colour.setRGB(colour[0], colour[1], colour[2]); this.refresh(); }
  setOpacity(opacity: number): void { this.opacity = opacity; this.refresh(); }
  setTint(tint: SpriteTint): void {
    this.tintAmount.value = tint.amount;
    this.tintColour.value.setRGB(tint.colour[0], tint.colour[1], tint.colour[2]);
  }

  private refresh(): void {
    for (const [source, material] of this.privateMaterials) {
      material.color.copy(source.color).multiply(this.colour);
      material.opacity = source.opacity * this.opacity;
    }
    for (const [base, halos] of this.bloomMaterials) for (const halo of halos.values()) halo.color.copy(base.color);
  }

  dress(source: THREE.MeshBasicMaterial, halo?: BuildImage): THREE.MeshBasicMaterial {
    let material = this.privateMaterials.get(source);
    if (!material && this.undressed) material = source;
    if (!material) {
      material = source.clone();
      material.color.copy(source.color).multiply(this.colour);
      material.opacity = source.opacity * this.opacity;
      // clone() keeps the authored material properties, but deliberately omits renderer-installed compile hooks.
      // Copying the source's lighting hook would install world lighting twice when this private material is drawn.
      const previousCompile = material.onBeforeCompile.bind(material), previousKey = material.customProgramCacheKey();
      material.onBeforeCompile = (shader, renderer) => {
        previousCompile(shader, renderer);
        shader.uniforms.spriteTintAmount = this.tintAmount;
        shader.uniforms.spriteTintColour = this.tintColour;
        shader.fragmentShader = 'uniform float spriteTintAmount;\nuniform vec3 spriteTintColour;\n' + shader.fragmentShader.replace(
          '#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = diffuseColor.rgb * (1.0 - spriteTintAmount) + spriteTintColour * spriteTintAmount;');
      };
      material.customProgramCacheKey = () => previousKey + ':spriteTint';
      this.privateMaterials.set(source, material);
    }
    return halo ? this.bloom(material, halo) : material;
  }

  private bloom(base: THREE.MeshBasicMaterial, image: BuildImage): THREE.MeshBasicMaterial {
    let halos = this.bloomMaterials.get(base);
    if (!halos) this.bloomMaterials.set(base, halos = new Map());
    let material = halos.get(image);
    if (!material) halos.set(image, material = createBloomMaterial(base, image));
    return material;
  }

  dispose(): void {
    for (const material of this.privateMaterials.values()) material.dispose();
    this.privateMaterials.clear();
    for (const halos of this.bloomMaterials.values()) for (const material of halos.values()) material.dispose();
    this.bloomMaterials.clear();
  }
}

/** What one sprite draws over its frame elements. */
export interface FrameDressing {
  readonly animState?: ResolvedAnimState;
  /** Seconds the AnimState's symbol animations have played. */
  readonly animStateElapsed: number;
  readonly composites: readonly CompositeSpriteFrame[];
  /** The drawn frame is mirrored by the sprite's facing. */
  readonly mirrored: boolean;
  readonly materials: SpriteMaterialDresser;
  /** The sprite's own hidden layers and symbols, besides the AnimState's. */
  visible(element: AnimElement): boolean;
  /** The sprite's own art for a symbol that no follower or AnimState declaration replaces. */
  resolveArt(element: AnimElement): ResolvedSprite | undefined;
  /** A detached follower's world point in the sprite visual's frame. */
  toVisual(position: ReadonlyVector3, target: THREE.Vector3): THREE.Vector3;
}

const compositePoint = new THREE.Vector3();

/** One drawn frame of `frames` (the clip's and any skin layers'), in DST layer order, with the sprite's dressing applied. */
export function resolveDressedFrame(frames: readonly Animation['frames'][number][], dressing: FrameDressing): ResolvedSprite[] {
  const { animState, composites } = dressing;
  const followers = new Map<number, CompositeSpriteFrame[]>();
  // Each halo part, with the unpadded image its blur is bounded to.
  const halos = new Map<ResolvedSprite, BuildImage>();
  for (const fx of composites) if (fx.symbol !== undefined && !fx.finalOffset) {
    const entries = followers.get(fx.symbol) ?? [];
    entries.push(fx); followers.set(fx.symbol, entries);
  }
  const sprites = frames.flatMap((frame) => [...frame.elements]
    .filter((element) => (!animState || animStateVisible(animState, element)) && dressing.visible(element))
    .sort((a, b) => b.z - a.z)
    .flatMap((element) => {
      // Follower anchors can have no image in the owner's build. Resolve them before looking up body art.
      const followed = followers.get(element.imageHash);
      // Followers are their own entities; the owner's symbol light override and bloom are for its own art.
      if (followed) return followed.flatMap(fx => fx.sprites.map(sprite => ({ ...sprite,
        element: { ...sprite.element, matrix: composeSpriteMatrix(followMatrix(element.matrix, fx.offset), sprite.element.matrix) } })));
      const declared = animState && resolveAnimStateSymbol(animState, element, dressing.animStateElapsed);
      const own = declared ?? dressing.resolveArt(element);
      const parts = own === undefined ? [] : Array.isArray(own) ? own : [own];
      const light = animState?.symbolLightOverrides.get(element.imageHash);
      const lit = light === undefined ? parts : parts.map(part => ({ ...part, lightOverride: light }));
      return animState?.blooms.has(element.imageHash) ? lit.flatMap(part => [bloomHalo(part, halos), part]) : lit;
    }));
  const elements = frames[0].elements;
  const back: ResolvedSprite[] = [], front: ResolvedSprite[] = [];
  for (const fx of composites) {
    if (fx.symbol !== undefined && !fx.finalOffset) continue;
    let matrix: Matrix2D = [1, 0, 0, 1, 0, 0];
    if (fx.symbol !== undefined) {
      // Follower:FollowSymbol takes the symbol's position only; SetFinalOffset draws it before or after the owner.
      const anchor = elements.find(element => element.imageHash === fx.symbol);
      if (!anchor) continue;
      const [a, b, c, d, tx, ty] = anchor.matrix, [x, y] = fx.offset ?? [0, 0];
      matrix = fx.noFaced ? [dressing.mirrored ? -1 : 1, 0, 0, 1, a * x + c * y + tx, b * x + d * y + ty] : followMatrix(anchor.matrix, fx.offset);
    } else if (fx.detached) {
      const point = dressing.toVisual(fx.detached.position, compositePoint);
      matrix = [fx.detached.mirrored === dressing.mirrored ? 1 : -1, 0, 0, 1, point.x, point.y];
    }
    (fx.finalOffset! < 0 ? back : front).push(...fx.sprites.map(sprite => ({ ...sprite, element: { ...sprite.element, matrix: composeSpriteMatrix(matrix, sprite.element.matrix) } })));
  }
  return [...back, ...sprites, ...front].map(sprite => ({ ...sprite,
    materials: sprite.materials.map(material => dressing.materials.dress(material, halos.get(sprite))) }));
}

const BLOOM_PADDING = 12;

/** The halo of a bloomed part: its image padded so the blur has room, drawn just behind it. */
function bloomHalo(part: ResolvedSprite, halos: Map<ResolvedSprite, BuildImage>): ResolvedSprite {
  const { image } = part;
  const halo = { ...part, image: { ...image, width: image.width + BLOOM_PADDING * 2, height: image.height + BLOOM_PADDING * 2,
    bbx: image.bbx! - BLOOM_PADDING, bby: image.bby! - BLOOM_PADDING } };
  halos.set(halo, image);
  return halo;
}

/** Local approximation of SetBloomEffectHandle: an additive blur of the part's own atlas art, bounded to its image. */
function createBloomMaterial(base: THREE.MeshBasicMaterial, image: BuildImage): THREE.MeshBasicMaterial {
  const material = base.clone();
  material.name += ':bloom';
  material.blending = THREE.AdditiveBlending;
  material.opacity = 0.6;
  material.alphaTest = 0.001;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.hatBloomBounds = { value: new THREE.Vector4(
      image.bbx! / image.canvasWidth!, image.bby! / image.canvasHeight!,
      (image.bbx! + image.width) / image.canvasWidth!, (image.bby! + image.height) / image.canvasHeight!,
    ) };
    shader.uniforms.hatBloomStep = { value: new THREE.Vector2(BLOOM_PADDING / 2 / image.canvasWidth!, BLOOM_PADDING / 2 / image.canvasHeight!) };
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
}

/** A followed symbol's transform moved by the follower's offset in that symbol's space. */
function followMatrix(matrix: Matrix2D, offset: readonly [number, number] | undefined): Matrix2D {
  return offset ? composeSpriteMatrix(matrix, [1, 0, 0, 1, offset[0], offset[1]]) : matrix;
}

export function composeSpriteMatrix(parent: Matrix2D, child: Matrix2D): Matrix2D {
  const [a, b, c, d, tx, ty] = parent, [e, f, g, h, ux, uy] = child;
  return [a * e + c * f, b * e + d * f, a * g + c * h, b * g + d * h, a * ux + c * uy + tx, b * ux + d * uy + ty];
}

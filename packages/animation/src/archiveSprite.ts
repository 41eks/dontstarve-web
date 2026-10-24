import * as THREE from 'three';
import {
  createMaterials, findImage, loadAnim, loadBuild, smallHash, SpriteFrameRenderer, FrameGeometryCache,
  type ParsedAnim, type ParsedBuild, type ResolvedSprite, type SharedFrame, type SpriteMaterialOptions,
} from './animationAssets';
import { registerSpriteRenderGroup } from './renderOrder';
import { selectsFacing } from './facing';
import { InstancedArchiveSprites } from './instancedArchiveSprites';

/** Animation/build sources supplied by callers; no prefab or inventory metadata. */
export interface ArchiveSpriteDefinition extends SpriteMaterialOptions {
  readonly animationArchive: string;
  /** Further archives of the same bank when a prefab's clips are split across files (evergreen short/normal and tall/old). */
  readonly extraAnimationArchives?: readonly string[];
  readonly buildArchives: readonly string[];
  readonly bank: string;
  readonly animation: string;
  readonly loop: boolean;
  readonly symbolOverrides?: Readonly<Record<string, { archive: string; symbol: string }>>;
  /** Source animation placeholders supplied by runtime systems such as snow. */
  readonly hiddenSymbols?: readonly string[];
}

export interface ArchiveSpriteOptions {
  /** Listed looping clips, or all clips (including one-shots), drawn as precomposed instances. */
  instancedAnimations?: readonly string[] | 'all';
  /** Ground-contact origin when this sprite is nested below a logical entity or a lifted visual. */
  foot?: THREE.Object3D;
  /** Reuse immutable frame geometry for selected clips or all clips; playback/material copies stay independent. */
  sharedAnimations?: readonly string[] | 'all';
  skinArchive?: string;
  /** Give this sprite private material copies at this opacity, adjustable later with `setOpacity()`. */
  opacity?: number;
  /** Per-instance AnimState:SetMultColour RGB, multiplied onto private material copies. */
  colour?: readonly [number, number, number];
  name?: string;
  scale?: number;
}

export interface ArchiveSpriteBuild {
  readonly build: ParsedBuild;
  readonly materials: THREE.MeshBasicMaterial[];
}

/** Separate caches support animation-only banks and build-only swap archives. */
export class ArchiveSpriteAssets {
  private readonly animations = new Map<string, Promise<ParsedAnim>>();
  private readonly builds = new Map<string, Promise<ArchiveSpriteBuild>>();
  private disposed = false;
  readonly frameCache = new FrameGeometryCache();
  readonly instancedSprites = new InstancedArchiveSprites();

  private readonly materialNamePrefix: string;
  private readonly assetBaseUrl: string;

  constructor(materialNamePrefix = 'sprite', assetBaseUrl = `${import.meta.env.BASE_URL}dst/data/anim`) {
    this.materialNamePrefix = materialNamePrefix;
    this.assetBaseUrl = assetBaseUrl;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.instancedSprites.dispose();
    this.frameCache.dispose();
    for (const build of this.builds.values()) void build.then(({ materials }) => {
      for (const material of materials) { material.map?.dispose(); material.dispose(); }
    }, () => undefined);
    this.builds.clear();
    this.animations.clear();
  }

  loadAnimation(archive: string): Promise<ParsedAnim> {
    if (this.disposed) return Promise.reject(new Error('Sprite assets have been disposed'));
    let request = this.animations.get(archive);
    if (!request) {
      request = loadAnim(archive, this.assetBaseUrl);
      this.animations.set(archive, request);
      void request.catch(() => this.animations.delete(archive));
    }
    return request;
  }

  loadBuild(archive: string, options: SpriteMaterialOptions = {}): Promise<ArchiveSpriteBuild> {
    if (this.disposed) return Promise.reject(new Error('Sprite assets have been disposed'));
    // Sampling and colour belong to this source appearance. Sharing only by
    // archive would let an opaque caller overwrite a translucent prefab's art.
    const key = JSON.stringify([archive, options.multColour ?? [1, 1, 1, 1], options.pointFiltering ?? false]);
    let request = this.builds.get(key);
    if (!request) {
      request = loadBuild(archive, this.assetBaseUrl).then((asset) => {
        const materials = createMaterials(asset, options);
        for (const material of materials) material.name = `${this.materialNamePrefix}:${asset.build.name}`;
        return { build: asset.build, materials };
      });
      this.builds.set(key, request);
      void request.catch(() => this.builds.delete(key));
    }
    return request;
  }
}

export interface ArchiveSprite {
  readonly model: THREE.Group;
  readonly currentAnimation: string;
  /** AnimState:GetCurrentAnimationNumFrames. */
  readonly frameCount: number;
  update(dt: number): void;
  /** AnimState:SetFrame within the current clip. */
  setFrame(frame: number): void;
  start(name: string): void;
  playOnce(name: string, onComplete?: () => void): void;
  setAnimation(name: string): void;
  setPaused(paused: boolean): void;
  /** Only for sprites created with `options.opacity`, whose materials are private. */
  setOpacity(opacity: number): void;
  /**
   * Eight-faced insts select, among clips of the same name, the one whose `facing` mask contains this FACING bit,
   * mirrored horizontally when the clip lists both a facing and its left-hand mirror.
   */
  setFacing(facing: number): void;
  /** AnimState:SetBuild among the definition's `buildArchives`; the clip and frame are kept. */
  setBuildArchive(archive: string): void;
  /** AnimState:Hide / Show for a named symbol layer, such as MakeSnowCovered's `snow`. */
  setSymbolHidden(symbol: string, hidden: boolean): void;
  /** Private geometry/material copies belong to the entity; shared frames and source materials to its assets. */
  dispose(): void;
}

interface LoadedArchiveSprite {
  readonly parsed: ParsedAnim;
  readonly sharedBuilds: ArchiveSpriteBuild[];
  readonly sharedSkin?: ArchiveSpriteBuild;
}

async function loadArchiveSprite(
  assets: ArchiveSpriteAssets,
  definition: ArchiveSpriteDefinition,
  options: ArchiveSpriteOptions,
): Promise<LoadedArchiveSprite> {
  const archives = [definition.animationArchive, ...definition.extraAnimationArchives ?? []];
  const [parts, sharedBuilds, sharedSkin] = await Promise.all([
    Promise.all(archives.map(archive => assets.loadAnimation(archive))),
    Promise.all(definition.buildArchives.map((archive) => assets.loadBuild(archive, definition))),
    options.skinArchive ? assets.loadBuild(options.skinArchive, definition) : undefined,
  ]);
  const parsed = parts.length === 1 ? parts[0] : { animations: parts.flatMap(part => part.animations) };
  return { parsed, sharedBuilds, sharedSkin };
}

/** Load split archives and compose each DST frame in its original layer order. */
export async function createArchiveSprite(
  assets: ArchiveSpriteAssets,
  definition: ArchiveSpriteDefinition,
  options: ArchiveSpriteOptions = {},
): Promise<ArchiveSprite> {
  return constructArchiveSprite(assets, definition, options, await loadArchiveSprite(assets, definition, options));
}

function constructArchiveSprite(
  assets: ArchiveSpriteAssets,
  definition: ArchiveSpriteDefinition,
  options: ArchiveSpriteOptions,
  { parsed, sharedBuilds, sharedSkin }: LoadedArchiveSprite,
): ArchiveSprite {
  // Translucent previews cannot share the asset cache's materials with opaque insts.
  const ownedMaterials: THREE.MeshBasicMaterial[] = [];
  const sources = new Map<ArchiveSpriteBuild, ArchiveSpriteBuild>();
  const materialCopies = new Map<THREE.MeshBasicMaterial, THREE.MeshBasicMaterial>();
  const own = <T extends ArchiveSpriteBuild | undefined>(source: T): T => {
    if (!source || (options.opacity === undefined && !options.colour)) return source;
    const materials = source.materials.map(material => {
      const copy = material.clone(); ownedMaterials.push(copy); materialCopies.set(material, copy);
      if (options.colour) copy.color.multiply(new THREE.Color().setRGB(...options.colour));
      return copy;
    });
    const result = { build: source.build, materials };
    sources.set(result, source);
    return result as T;
  };
  const builds = sharedBuilds.map(own);
  let activeBuilds = builds;
  const skin = own(sharedSkin);
  const applyOpacity = (opacity: number) => {
    for (const material of ownedMaterials) {
      material.transparent = opacity < 1; material.opacity = opacity; material.needsUpdate = true;
    }
  };
  if (options.opacity !== undefined) applyOpacity(options.opacity);
  const bankHash = smallHash(definition.bank);
  let facing: number | undefined;
  let flipped = false;
  const findClip = (name: string) => {
    const candidates = parsed.animations.filter(clip => clip.name === name && clip.bankHash === bankHash);
    const selected = facing === undefined ? undefined
      : candidates.map(clip => ({ clip, ...selectsFacing(clip.facing, facing!) })).find(({ matches }) => matches);
    flipped = selected?.flipped ?? false;
    return selected?.clip ?? candidates[0];
  };
  const initialAnimation = findClip(definition.animation);
  if (!initialAnimation?.frames.length) throw new Error(`Missing sprite animation ${definition.bank}:${definition.animation}`);
  let animation = initialAnimation;
  const overrides = new Map(Object.entries(definition.symbolOverrides ?? {}).map(([symbol, override]) =>
    [smallHash(symbol), { hash: smallHash(override.symbol), source: builds[definition.buildArchives.indexOf(override.archive)] }]));
  const hidden = new Set((definition.hiddenSymbols ?? []).map(smallHash));
  const sharedAnimations = options.sharedAnimations === 'all' ? 'all' : new Set(options.sharedAnimations);
  const cache = assets.frameCache;
  const source = (build: ArchiveSpriteBuild) => sources.get(build) ?? build;
  const appearanceKey = () => JSON.stringify([
    activeBuilds.map(build => cache.idOf(source(build))), skin ? cache.idOf(source(skin)) : 0,
    [...overrides].sort(([a], [b]) => a - b).map(([hash, override]) =>
      [hash, override.hash, cache.idOf(source(override.source))]),
    [...hidden].sort((a, b) => a - b),
  ]);
  let sharedAppearance = '';
  const tintedFrames = new WeakMap<SharedFrame, SharedFrame>();
  const model = new THREE.Group();
  model.name = options.name ?? `${definition.bank}:${definition.animation}`;
  model.userData.billboard = true;
  const visual = new THREE.Group();
  const scale = options.scale ?? 0.02;
  visual.scale.set(scale, -scale, scale);
  model.add(visual);
  registerSpriteRenderGroup(model, visual);
  const renderer = new SpriteFrameRenderer(visual);
  const instances = options.instancedAnimations?.length
    ? assets.instancedSprites.retain(model, visual, options.colour, options.opacity ?? definition.multColour?.[3] ?? 1, options.foot) : undefined;
  let elapsed = 0;
  let previousFrame = -1;
  let paused = false;
  let disposed = false;
  let loop = definition.loop;
  let onComplete: (() => void) | undefined;
  const resolveSprites = (index: number, shared: boolean): ResolvedSprite[] => [...animation.frames[index].elements]
    // These banks include a bounding-only symbol with no build art.
    .filter((element) => element.imageHash !== smallHash('bounding') && !hidden.has(element.imageHash))
    .sort((a, b) => b.z - a.z).map((element) => {
      const override = overrides.get(element.imageHash);
      const hash = override?.hash ?? element.imageHash;
      const candidates = [...(skin ? [skin] : []), ...(override ? [override.source] : activeBuilds)];
      for (const build of candidates) {
        const image = findImage(build.build, hash, element.imageIndex);
        if (image) return { element, image, materials: (shared ? source(build) : build).materials };
      }
      throw new Error(`Missing sprite part ${model.name}:${hash}:${element.imageIndex}`);
    });
  const update = (dt: number) => {
    if (paused || disposed) return;
    elapsed += Math.max(0, Math.min(dt, 0.1));
    const rawFrame = Math.floor(elapsed * animation.frameRate);
    if (!loop && elapsed * animation.frameRate + 1e-8 >= animation.frames.length && onComplete) {
      const complete = onComplete;
      onComplete = undefined;
      complete();
      if (disposed || paused) return;
      update(0);
      return;
    }
    const index = loop ? rawFrame % animation.frames.length
      : Math.min(rawFrame, animation.frames.length - 1);
    if (index === previousFrame) return;
    // Preserve genuinely empty source frames rather than inventing replacement art.
    if (sharedAnimations === 'all' || sharedAnimations.has(animation.name)) {
      sharedAppearance ||= appearanceKey();
      const frame = cache.get(`${cache.idOf(animation)}:${sharedAppearance}:${index}`, () => resolveSprites(index, true));
      let tinted = tintedFrames.get(frame);
      if (!tinted) {
        tinted = ownedMaterials.length ? { ...frame, materials: frame.materials.map(material => materialCopies.get(material) ?? material) } : frame;
        tintedFrames.set(frame, tinted);
      }
      renderer.showShared(tinted);
    } else renderer.show(resolveSprites(index, false));
    visual.scale.x = flipped ? -scale : scale;
    const instanced = !!instances && (options.instancedAnimations === 'all'
      || loop && options.instancedAnimations!.includes(animation.name));
    if (instances) renderer.setInstanced(instanced);
    if (instanced) {
      sharedAppearance ||= appearanceKey();
      instances.show(`${cache.idOf(animation)}:${sharedAppearance}`, animation,
        () => animation.frames.map((_, index) => resolveSprites(index, true)), index);
    } else instances?.hide();
    previousFrame = index;
  };
  const selectAnimation = (name: string, shouldLoop: boolean, complete?: () => void) => {
    if (disposed) return;
    const next = findClip(name);
    if (!next?.frames.length) throw new Error(`Missing sprite animation ${definition.bank}:${name}`);
    animation = next;
    loop = shouldLoop;
    onComplete = complete;
    elapsed = 0;
    previousFrame = -1;
    update(0);
  };
  try { update(0); } catch (error) {
    instances?.dispose();
    renderer.dispose();
    ownedMaterials.forEach(material => material.dispose());
    visual.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    throw error;
  }
  return {
    model, update,
    get currentAnimation() { return animation.name; },
    get frameCount() { return animation.frames.length; },
    setFrame(frame: number) {
      if (disposed) return;
      elapsed = Math.max(0, Math.floor(frame)) / animation.frameRate;
      previousFrame = -1;
      update(0);
    },
    start(name: string) {
      if (animation.name !== name || !loop) selectAnimation(name, true);
    },
    playOnce(name: string, complete?: () => void) { selectAnimation(name, false, complete); },
    setPaused(value: boolean) {
      if (disposed) return;
      paused = value;
      if (!paused) update(0);
    },
    setAnimation(name: string) {
      if (animation.name !== name) selectAnimation(name, definition.loop);
    },
    setOpacity(opacity: number) {
      if (options.opacity === undefined) throw new Error(`Sprite ${model.name} does not own its materials`);
      applyOpacity(opacity);
      instances?.setOpacity(opacity);
    },
    setBuildArchive(archive: string) {
      const index = definition.buildArchives.indexOf(archive);
      if (index < 0) throw new Error(`Sprite ${model.name} has no build archive ${archive}`);
      if (disposed || activeBuilds[0] === builds[index]) return;
      activeBuilds = [builds[index]];
      sharedAppearance = '';
      previousFrame = -1;
      update(0);
    },
    setSymbolHidden(symbol: string, isHidden: boolean) {
      const hash = smallHash(symbol);
      if (disposed || hidden.has(hash) === isHidden) return;
      if (isHidden) hidden.add(hash); else hidden.delete(hash);
      sharedAppearance = '';
      previousFrame = -1;
      update(0);
    },
    setFacing(value: number) {
      if (disposed || facing === value) return;
      facing = value;
      const next = findClip(animation.name);
      if (!next?.frames.length) return;
      animation = next;
      previousFrame = -1;
      update(0);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      instances?.dispose();
      renderer.dispose();
      ownedMaterials.forEach(material => material.dispose());
      model.removeFromParent();
      visual.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    },
  };
}

/**
 * Prefab entry point for immutable shared frame geometry, including clips selected later.
 * Reuse the same assets owner across entities; dispose each sprite before disposing that owner.
 * Models, playback, callbacks and material copies stay local to each sprite.
 */
export function createSharedArchiveSprite(
  assets: ArchiveSpriteAssets,
  definition: ArchiveSpriteDefinition,
  options: Omit<ArchiveSpriteOptions, 'sharedAnimations'> = {},
): Promise<ArchiveSprite> {
  return createArchiveSprite(assets, definition, { ...options, sharedAnimations: 'all' });
}

/**
 * `createSharedArchiveSprite()` for proximity-loaded entities: await the archives once, then create each entity
 * synchronously with its own initial clip. Sprites share the same assets owner, frame cache and instance batches.
 */
export async function preloadSharedArchiveSprite(
  assets: ArchiveSpriteAssets,
  definition: Omit<ArchiveSpriteDefinition, 'animation' | 'loop'>,
  options: Omit<ArchiveSpriteOptions, 'sharedAnimations'> = {},
): Promise<(animation: string, loop: boolean, name?: string, appearance?: Pick<ArchiveSpriteOptions, 'colour'>) => ArchiveSprite> {
  const shared = { ...options, sharedAnimations: 'all' } as const;
  const loaded = await loadArchiveSprite(assets, definition as ArchiveSpriteDefinition, shared);
  return (animation, loop, name, appearance) =>
    constructArchiveSprite(assets, { ...definition, animation, loop }, { ...shared, ...appearance, ...(name ? { name } : {}) }, loaded);
}

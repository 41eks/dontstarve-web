import * as THREE from 'three';
import { spritePerf, spritePerfAsync } from './spritePerf';
import {
  createMaterials, findImage, loadAnim, loadBuild, smallHash, SpriteFrameRenderer, FrameGeometryCache,
  type AnimElement, type ParsedAnim, type ParsedBuild, type ResolvedSprite, type SharedFrame, type SpriteMaterialOptions,
} from './animationAssets';
import { registerSpriteRenderGroup } from './renderOrder';
import { selectsFacing } from './facing';
import { InstancedArchiveSprites, type InstancedSprite } from './instancedArchiveSprites';
import { installMatrixGate } from './matrixGate';
import type { ResolvedAnimState } from './animState';
import type { SpriteArtSource } from './sprite';
import {
  resolveDressedFrame, resolveOverrideArt, sameComposites, SpriteMaterialDresser,
  type BuildOverride, type CompositeSpriteFrame, type FrameDressing, type SpriteTint, type SymbolOverride,
} from './spriteDressing';

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
  /** AnimState:Hide / Show selects animation layers independently of symbol names. */
  readonly hiddenLayers?: readonly string[];
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
  /** Stationary billboard: its owner uses faceCamera()/refreshTransform() for
   * transform changes, avoiding per-frame local-transform comparisons.
   * Reparenting is still detected automatically.
   */
  staticBillboard?: boolean;
  /** Ancestors are assumed static; set when the parent moves while this sprite stays attached to it. */
  dynamicParent?: boolean;
}

export interface ArchiveSpriteBuild {
  readonly build: ParsedBuild;
  readonly materials: THREE.MeshBasicMaterial[];
}

/** A skin build, as the display resolves the entity's skin; a factory sprite's `SpriteSkin` is one. */
export interface ArchiveSpriteSkin extends ArchiveSpriteBuild {
  /** OverrideItemSkinSymbol: only these symbols come from the skin. */
  readonly symbols?: ReadonlySet<number>;
  /** Symbols kept from the base build even when skinned. */
  readonly baseSymbols?: ReadonlySet<number>;
  /** Skin animation banks drawn over the clip's frame, from `animations`. */
  readonly animations?: ParsedAnim;
  readonly animationBanks?: ReadonlySet<number>;
}

interface SpriteAppearance {
  animation: ParsedAnim['animations'][number];
  builds: readonly ArchiveSpriteBuild[];
  skin?: ArchiveSpriteSkin;
  overrides: ReadonlyMap<number, { hash: number; source: ArchiveSpriteBuild }>;
  hidden: ReadonlySet<number>;
  hiddenLayers: ReadonlySet<number>;
}

const boundingHash = smallHash('bounding');

function animStateDeclaresNothing(state: ResolvedAnimState): boolean {
  return state.overrides.size === 0 && !state.overrideBuilds?.length && state.hiddenLayers.size === 0 && state.hiddenSymbols.size === 0
    && state.symbolLightOverrides.size === 0 && state.symbolAnimations.size === 0 && state.blooms.size === 0 && state.attachments.length === 0;
}

// These banks include bounding-only symbols with no build art.
function appearanceVisible({ hidden, hiddenLayers }: Pick<SpriteAppearance, 'hidden' | 'hiddenLayers'>, element: AnimElement): boolean {
  return element.imageHash !== boundingHash && !hidden.has(element.imageHash) && !hiddenLayers.has(element.layerHash);
}

function resolveAppearanceElement({ builds, skin, overrides }: SpriteAppearance, element: AnimElement): ResolvedSprite | undefined {
  const override = overrides.get(element.imageHash), hash = override?.hash ?? element.imageHash;
  const skinned = skin && !skin.baseSymbols?.has(element.imageHash) && (!skin.symbols || skin.symbols.has(element.imageHash));
  for (const build of [...(skinned ? [skin] : []), ...(override ? [override.source] : builds)]) {
    const image = findImage(build.build, hash, element.imageIndex);
    if (image) return { element, image, materials: build.materials };
  }
  // Missing source intervals draw nothing (e.g. leaf FX supplied by a separate prefab).
  return undefined;
}

function resolveAppearanceFrame(appearance: SpriteAppearance, index: number): ResolvedSprite[] {
  return [...appearance.animation.frames[index].elements]
    .filter(element => appearanceVisible(appearance, element))
    .sort((a, b) => b.z - a.z).flatMap(element => resolveAppearanceElement(appearance, element) ?? []);
}

/** This closure retains immutable source appearance data, never the sprite that first requested it. */
function appearanceResolver(appearance: SpriteAppearance): (index: number) => ResolvedSprite[] {
  return index => resolveAppearanceFrame(appearance, index);
}

const buildKey = (archive: string, options: SpriteMaterialOptions) =>
  JSON.stringify([archive, options.multColour ?? [1, 1, 1, 1], options.pointFiltering ?? false]);

/** Separate caches support animation-only banks and build-only swap archives. */
export class ArchiveSpriteAssets {
  private readonly animations = new Map<string, Promise<ParsedAnim>>();
  private readonly builds = new Map<string, Promise<ArchiveSpriteBuild>>();
  // What has finished loading, for callers that draw synchronously and load the rest.
  private readonly loadedAnimations = new Map<string, ParsedAnim>();
  private readonly loadedBuilds = new Map<string, ArchiveSpriteBuild>();
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
    this.loadedBuilds.clear();
    this.loadedAnimations.clear();
  }

  peekAnimation(archive: string): ParsedAnim | undefined { return this.loadedAnimations.get(archive); }
  peekBuild(archive: string, options: SpriteMaterialOptions = {}): ArchiveSpriteBuild | undefined {
    return this.loadedBuilds.get(buildKey(archive, options));
  }

  loadAnimation(archive: string): Promise<ParsedAnim> {
    if (this.disposed) return Promise.reject(new Error('Sprite assets have been disposed'));
    let request = this.animations.get(archive);
    if (!request) {
      request = loadAnim(archive, this.assetBaseUrl);
      void request.then(animations => { if (!this.disposed) this.loadedAnimations.set(archive, animations); }, () => undefined);
      this.animations.set(archive, request);
      void request.catch(() => this.animations.delete(archive));
    }
    return request;
  }

  loadBuild(archive: string, options: SpriteMaterialOptions = {}): Promise<ArchiveSpriteBuild> {
    if (this.disposed) return Promise.reject(new Error('Sprite assets have been disposed'));
    // Sampling and colour belong to this source appearance. Sharing only by
    // archive would let an opaque caller overwrite a translucent prefab's art.
    const key = buildKey(archive, options);
    let request = this.builds.get(key);
    if (!request) {
      request = loadBuild(archive, this.assetBaseUrl).then((asset) => {
        const materials = createMaterials(asset, options);
        for (const material of materials) material.name = `${this.materialNamePrefix}:${asset.build.name}`;
        const build = { build: asset.build, materials };
        if (!this.disposed) this.loadedBuilds.set(key, build);
        return build;
      });
      this.builds.set(key, request);
      void request.catch(() => this.builds.delete(key));
    }
    return request;
  }
}

export interface ArchiveSprite {
  readonly model: THREE.Group;
  /** The shared-batch instance of a sprite created with `instancedAnimations`; its display lists it for the pass. */
  readonly instanced?: InstancedSprite;
  readonly currentAnimation: string;
  /** AnimState:GetCurrentAnimationNumFrames. */
  readonly frameCount: number;
  /** AnimState:GetCurrentAnimationLength, in seconds. */
  readonly currentAnimationLength: number;
  /** The frame of the current clip being drawn. */
  readonly frame: number;
  update(dt: number): void;
  /** AnimState:SetFrame within the current clip. */
  setFrame(frame: number): void;
  start(name: string): void;
  playOnce(name: string, onComplete?: () => void): void;
  setAnimation(name: string): void;
  setPaused(paused: boolean): void;
  /** AnimState:SetDeltaTimeMultiplier, without changing source frame rates. */
  setPlaybackRate(rate: number): void;
  /** The display supplies a loaded shared skin build; undefined restores the original build. */
  setSkin(skin: ArchiveSpriteSkin | undefined): void;
  /** Only for sprites created with `options.opacity`, whose materials are private. */
  setOpacity(opacity: number): void;
  /** Per-entity tint, for sprites created with options.colour; shared atlas pixels stay unchanged. */
  setColour(colour: readonly [number, number, number]): void;
  /** AnimState:SetErosionParams's amount on the shared-batch instance. */
  setErosion(amount: number): void;
  /** Draw a few depth steps towards the camera, so an effect on its owner's plane is not hidden by the owner's depth. */
  setDepthOffset(enabled: boolean): void;
  /**
   * Eight-faced insts select, among clips of the same name, the one whose `facing` mask contains this FACING bit,
   * mirrored horizontally when the clip lists both a facing and its left-hand mirror.
   */
  setFacing(facing: number): void;
  /** AnimState:SetBuild among the definition's `buildArchives`; the clip and frame are kept. */
  setBuildArchive(archive: string): void;
  /** Follower:FollowSymbol: where `symbol` plus an offset in animation pixels is on the current frame; false when the frame has no such symbol. */
  getSymbolPosition(symbol: string, x: number, y: number, target: THREE.Vector3): boolean;
  /** AnimState:OverrideSymbol / ClearOverrideSymbol among the preloaded build archives. */
  setSymbolOverride(symbol: string, archive?: string, sourceSymbol?: string): void;
  /** AnimState:Hide / Show for a named symbol layer, such as MakeSnowCovered's `snow`. */
  setSymbolHidden(symbol: string, hidden: boolean): void;
  setLayerHidden(layer: string, hidden: boolean): void;
  /** AnimState:OverrideSymbol / ClearOverrideSymbol with a build the caller loaded and owns. */
  overrideSymbol(symbol: string, override: SymbolOverride | undefined): void;
  /** Replaces every OverrideSymbol made with `overrideSymbol`, and the layers hidden alongside them. */
  setSymbolOverrides(overrides: ReadonlyMap<number, SymbolOverride>, hiddenLayers?: readonly string[]): void;
  /** AnimState:AddOverrideBuild / ClearOverrideBuild with a build the caller loaded and owns. */
  addOverrideBuild(name: string, override: BuildOverride): void;
  clearOverrideBuild(name: string): void;
  /** The entity's merged AnimState declarations (symbol overrides, hidden symbols, light overrides, bloom, symbol animations). */
  setAnimState(state: ResolvedAnimState): void;
  /** Bank and builds loaded by the display in place of the definition's; the clip is kept when the bank has it. */
  setArtSource(source: SpriteArtSource): void;
  setTint(tint: SpriteTint): void;
  /** Follower frames merged into this sprite's layer order. */
  setComposites(frames: readonly CompositeSpriteFrame[]): void;
  /** The parts of the frame being drawn, for an owner that merges this sprite as a follower. */
  getResolvedFrame(): readonly ResolvedSprite[];
  /** Turn towards the camera; unchanged transforms reuse their matrices. */
  faceCamera(rotation: THREE.Quaternion): void;
  /** Explicitly invalidate transforms. Required after moving a staticBillboard;
   * other sprites also detect direct model/visual movement automatically. */
  refreshTransform(): void;
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
    for (const [owned, shared] of sources) if (shared === source) return owned as T;
    const materials = source.materials.map(material => {
      const copy = material.clone(); ownedMaterials.push(copy); materialCopies.set(material, copy);
      if (options.colour) copy.color.multiply(new THREE.Color().setRGB(...options.colour));
      return copy;
    });
    const result = { ...source, materials };
    sources.set(result, source);
    return result as T;
  };
  const builds = sharedBuilds.map(own);
  let activeBuilds = builds;
  let skin: ArchiveSpriteSkin | undefined = own(sharedSkin);
  const applyOpacity = (opacity: number) => {
    for (const material of ownedMaterials) {
      material.transparent = opacity < 1; material.opacity = opacity; material.needsUpdate = true;
    }
  };
  if (options.opacity !== undefined) applyOpacity(options.opacity);
  const bankHash = smallHash(definition.bank);
  let facing: number | undefined;
  let flipped = false;
  let artSource: SpriteArtSource | undefined;
  const findClip = (name: string) => {
    const clips = artSource?.animations.animations ?? parsed.animations, bank = artSource?.bank ?? bankHash;
    const candidates = clips.filter(clip => clip.name === name && clip.bankHash === bank);
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
  const hiddenLayers = new Set((definition.hiddenLayers ?? []).map(smallHash));
  const sharedAnimations = options.sharedAnimations === 'all' ? 'all' : new Set(options.sharedAnimations);
  const cache = assets.frameCache;
  const source = (build: ArchiveSpriteBuild) => sources.get(build) ?? build;
  const appearanceKey = () => JSON.stringify([
    activeBuilds.map(build => cache.idOf(source(build))), skin ? cache.idOf(source(skin)) : 0,
    [...overrides].sort(([a], [b]) => a - b).map(([hash, override]) =>
      [hash, override.hash, cache.idOf(source(override.source))]),
    [...hidden].sort((a, b) => a - b),
    [...hiddenLayers].sort((a, b) => a - b),
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
  const matrixGate = installMatrixGate(model, visual, options.staticBillboard, undefined, options.dynamicParent);
  const renderer = new SpriteFrameRenderer(visual);
  const instances = options.instancedAnimations?.length
    ? assets.instancedSprites.retain(model, visual, options.colour, options.opacity ?? definition.multColour?.[3] ?? 1, options.foot) : undefined;
  let elapsed = 0;
  let previousFrame = -1;
  let paused = false;
  let disposed = false;
  let loop = definition.loop;
  let onComplete: (() => void) | undefined;
  let playbackRate = 1;
  // Per-entity dressing. While any of it applies, frames are resolved for this sprite alone, outside shared frames and instances.
  let animState: ResolvedAnimState | undefined;
  let animStateElapsed = 0;
  let composites: readonly CompositeSpriteFrame[] = [];
  let runtimeOverrides: ReadonlyMap<number, SymbolOverride> = new Map();
  let runtimeHiddenLayers: ReadonlySet<number> = new Set();
  const buildOverrides = new Map<string, BuildOverride>();
  const dresser = new SpriteMaterialDresser();
  // AnimState:SetSkin with animation banks of its own, drawn over the clip's frame.
  const skinLayers = () => skin?.animations && skin.animationBanks?.size
    ? skin.animations.animations.filter(clip => clip.name === animation.name && skin!.animationBanks!.has(clip.bankHash)) : [];
  const dressed = () => skinLayers().length > 0 || animState !== undefined || composites.length > 0 || runtimeOverrides.size > 0 || runtimeHiddenLayers.size > 0
    || buildOverrides.size > 0 || !dresser.plain;
  let resolvedFrame: readonly ResolvedSprite[] | undefined;
  const ownAppearance = (): SpriteAppearance => ({ animation, builds: activeBuilds, skin, overrides, hidden, hiddenLayers });
  const dressing: FrameDressing = {
    get animState() { return animState; },
    get animStateElapsed() { return animStateElapsed; },
    get composites() { return composites; },
    get mirrored() { return flipped; },
    materials: dresser,
    visible: element => appearanceVisible({ hidden, hiddenLayers }, element) && !runtimeHiddenLayers.has(element.layerHash),
    resolveArt: element => {
      const override = resolveOverrideArt(element, runtimeOverrides, buildOverrides);
      return override === undefined ? resolveAppearanceElement(ownAppearance(), element) : override ?? undefined;
    },
    toVisual: (position, target) => {
      visual.updateWorldMatrix(true, false);
      return visual.worldToLocal(target.copy(position));
    },
  };
  // Keep only source data in the deferred resolver, without retaining this entity's controller or private materials.
  const snapshotAppearance = (): SpriteAppearance => ({ animation, builds: activeBuilds.map(source), skin: skin && source(skin),
    overrides: new Map([...overrides].map(([hash, override]) => [hash, { hash: override.hash, source: source(override.source) }])),
    hidden: new Set(hidden), hiddenLayers: new Set(hiddenLayers) });
  const resolveSprites = (index: number, shared: boolean): ResolvedSprite[] => shared ? resolveAppearanceFrame(snapshotAppearance(), index)
    : dressed() ? resolveDressedFrame([animation.frames[index], ...skinLayers().map(layer => {
      const frame = Math.floor(elapsed * layer.frameRate);
      return layer.frames[loop ? frame % layer.frames.length : Math.min(frame, layer.frames.length - 1)];
    })], dressing) : resolveAppearanceFrame(ownAppearance(), index);
  const update = (dt: number, refresh = false) => {
    if (disposed) return;
    const attachments = animState?.attachments ?? [];
    const following = (animState?.symbolAnimations.size ?? 0) > 0;
    for (const attachment of attachments) attachment.update(dt);
    if (following) animStateElapsed += dt;
    // Animated symbols and attachments redraw the frame even while the clip itself holds still.
    if (following || attachments.some(attachment => attachment.isAnimating)) { previousFrame = -1; refresh = true; }
    if (paused && !refresh) return;
    if (!paused) elapsed += Math.max(0, Math.min(dt, 0.1)) * playbackRate;
    const rawFrame = Math.floor(elapsed * animation.frameRate);
    if (!paused && !loop && elapsed * animation.frameRate + 1e-8 >= animation.frames.length && onComplete) {
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
    resolvedFrame = undefined;
    const ownFrame = dressed();
    // Preserve genuinely empty source frames rather than inventing replacement art.
    if (ownFrame) renderer.show(resolvedFrame = resolveSprites(index, false));
    else if (sharedAnimations === 'all' || sharedAnimations.has(animation.name)) {
      sharedAppearance ||= appearanceKey();
      const frame = cache.get(`${cache.idOf(animation)}:${sharedAppearance}:${index}`, () => resolveSprites(index, true));
      let tinted = tintedFrames.get(frame);
      if (!tinted) {
        tinted = ownedMaterials.length ? { ...frame, materials: frame.materials.map(material => materialCopies.get(material) ?? material) } : frame;
        tintedFrames.set(frame, tinted);
      }
      renderer.showShared(tinted);
    } else renderer.show(resolveSprites(index, false));
    // Frames replace baked vertex geometry, not Object3D transforms. Only a facing flip
    // invalidates the transform; animation and spatial-envelope changes have their own owners.
    const scaleX = flipped ? -scale : scale;
    if (visual.scale.x !== scaleX) {
      visual.scale.x = scaleX;
      matrixGate?.markDirty();
    }
    const instanced = !!instances && !ownFrame && (options.instancedAnimations === 'all'
      || loop && options.instancedAnimations!.includes(animation.name));
    if (instances) renderer.setInstanced(instanced);
    if (instanced) {
      sharedAppearance ||= appearanceKey();
      instances.show(`${cache.idOf(animation)}:${sharedAppearance}`, animation,
        () => appearanceResolver(snapshotAppearance()), index);
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
  /** The appearance changed: draw the current frame again, paused or not. */
  const redraw = () => {
    if (disposed) return;
    sharedAppearance = '';
    previousFrame = -1;
    update(0, true);
  };
  try { update(0); } catch (error) {
    matrixGate?.dispose();
    instances?.dispose();
    renderer.dispose();
    ownedMaterials.forEach(material => material.dispose());
    visual.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    throw error;
  }
  return {
    model, update, instanced: instances,
    get currentAnimation() { return animation.name; },
    get frameCount() { return animation.frames.length; },
    get currentAnimationLength() { return animation.frames.length / animation.frameRate; },
    get frame() { return Math.max(0, previousFrame); },
    setFrame(frame: number) {
      if (disposed) return;
      elapsed = Math.max(0, Math.floor(frame)) / animation.frameRate;
      previousFrame = -1;
      // A paused clip shows the frame it is set to.
      update(0, true);
    },
    setPlaybackRate(rate: number) {
      if (!Number.isFinite(rate) || rate < 0) throw new RangeError('Invalid animation playback rate');
      playbackRate = rate;
    },
    overrideSymbol(symbol, override) {
      const next = new Map(runtimeOverrides), hash = smallHash(symbol);
      if (override) next.set(hash, override); else if (!next.delete(hash)) return;
      runtimeOverrides = next;
      redraw();
    },
    setSymbolOverrides(next, hiddenLayers = []) {
      runtimeOverrides = new Map(next);
      runtimeHiddenLayers = new Set(hiddenLayers.map(smallHash));
      redraw();
    },
    addOverrideBuild(name, override) {
      buildOverrides.delete(name);
      buildOverrides.set(name, override);
      redraw();
    },
    clearOverrideBuild(name) { if (buildOverrides.delete(name)) redraw(); },
    setAnimState(state) {
      // Declarations that were all taken away leave the sprite to its shared frames again.
      const next = animStateDeclaresNothing(state) ? undefined : state;
      if (next === animState) return;
      animState = next;
      redraw();
    },
    setArtSource(next) {
      if (disposed || next === artSource) return;
      artSource = next;
      activeBuilds = [next.build, ...next.fallbackBuilds ?? []].map(own);
      const clip = findClip(animation.name);
      if (clip?.frames.length) animation = clip;
      redraw();
    },
    setTint(tint) { dresser.setTint(tint); redraw(); },
    setComposites(frames) {
      if (sameComposites(frames, composites)) return;
      composites = frames;
      redraw();
    },
    getResolvedFrame() { return resolvedFrame ??= resolveSprites(Math.max(0, previousFrame), false); },
    start(name: string) {
      if (animation.name !== name || !loop) selectAnimation(name, true);
    },
    playOnce(name: string, complete?: () => void) { selectAnimation(name, false, complete); },
    faceCamera(rotation: THREE.Quaternion) {
      if (model.quaternion.equals(rotation)) return;
      model.quaternion.copy(rotation);
      matrixGate?.markDirty();
    },
    refreshTransform() { matrixGate?.markDirty(); },
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
      renderer.syncDepthOffset();
      instances?.setOpacity(opacity);
    },
    setColour(colour) {
      if (!options.colour) throw new Error(`Sprite ${model.name} does not own its colour`);
      if (disposed) return;
      const tint = new THREE.Color().setRGB(...colour);
      for (const [material, copy] of materialCopies) copy.color.copy(material.color).multiply(tint);
      renderer.syncDepthOffset();
      instances?.setColour(colour);
    },
    setErosion(amount: number) { if (!disposed) instances?.setErosion(amount); },
    setDepthOffset(enabled) { if (!disposed) renderer.setDepthOffset(enabled); },
    setSkin(next) {
      if (disposed) return;
      const replacement = own(next);
      if (replacement === skin) return;
      skin = replacement;
      sharedAppearance = ''; previousFrame = -1;
      update(0, true);
    },
    setSymbolOverride(symbol, archive, sourceSymbol = symbol) {
      if (disposed) return;
      const hash = smallHash(symbol), previous = overrides.get(hash);
      if (archive === undefined) {
        if (!previous) return;
        overrides.delete(hash);
      } else {
        const index = definition.buildArchives.indexOf(archive);
        if (index < 0) throw new Error(`Sprite ${model.name} has no build archive ${archive}`);
        const replacement = { hash: smallHash(sourceSymbol), source: builds[index] };
        if (previous?.hash === replacement.hash && previous.source === replacement.source) return;
        overrides.set(hash, replacement);
      }
      redraw();
    },
    setBuildArchive(archive: string) {
      const index = definition.buildArchives.indexOf(archive);
      if (index < 0) throw new Error(`Sprite ${model.name} has no build archive ${archive}`);
      if (disposed || activeBuilds.length === 1 && activeBuilds[0] === builds[index]) return;
      activeBuilds = [builds[index]];
      redraw();
    },
    setSymbolHidden(symbol: string, isHidden: boolean) {
      const hash = smallHash(symbol);
      if (disposed || hidden.has(hash) === isHidden) return;
      if (isHidden) hidden.add(hash); else hidden.delete(hash);
      redraw();
    },
    setLayerHidden(layer: string, isHidden: boolean) {
      const hash = smallHash(layer);
      if (disposed || hiddenLayers.has(hash) === isHidden) return;
      if (isHidden) hiddenLayers.add(hash); else hiddenLayers.delete(hash);
      redraw();
    },
    getSymbolPosition(symbol, x, y, target) {
      const element = animation.frames[Math.max(0, previousFrame)]?.elements.find(element => element.imageHash === smallHash(symbol));
      if (!element) return false;
      const [a, b, c, d, tx, ty] = element.matrix;
      visual.updateMatrix();
      target.set(a * x + c * y + tx, b * x + d * y + ty, 0).applyMatrix4(visual.matrix);
      return true;
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
      matrixGate?.dispose();
      renderer.dispose();
      dresser.dispose();
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
  const loaded = await spritePerfAsync('preload', `${definition.bank ?? ''} ${definition.animationArchive ?? ''}`, () => loadArchiveSprite(assets, definition as ArchiveSpriteDefinition, shared));
  return (animation, loop, name, appearance) => spritePerf('construct', animation, () =>
    constructArchiveSprite(assets, { ...definition, animation, loop }, { ...shared, ...appearance, ...(name ? { name } : {}) }, loaded));
}

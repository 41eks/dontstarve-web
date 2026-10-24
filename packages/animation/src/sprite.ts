import * as THREE from 'three';
import { createEffect, WorldContentKey, type GetWatchWorldContent, type WorldContentSignal } from '@dontstarve-web/signals';
import {
  createMaterials,
  FrameGeometryCache,
  findImage,
  loadAnim,
  loadAnimationArchive,
  loadBuild,
  loadSpriteSkinArchive,
  smallHash,
  SpriteFrameRenderer,
  type Animation,
  type BuildPackage,
  type ParsedAnim,
  type ParsedBuild,
  type ResolvedSprite,
} from './animationAssets';
import { registerSpriteRenderGroup } from './renderOrder';
import { publishSpriteSpatialBounds, spriteSpatialRadius } from './spatialBounds';
import { installMatrixGate } from './matrixGate';

/** Envelope radius of every frame of an animation drawn from the plain build (no skin layers or overrides). */
const animationEnvelopes = new WeakMap<Animation, number>();
const envelopeSphere = new THREE.Sphere();

export interface SpriteAnimationController {
  start(name: string): void;
  playOnce(name: string, onComplete?: () => void): void;
  update(dt: number): void;
}

export interface TransientSpriteAnimationController extends SpriteAnimationController {
  readonly currentAnimation: string;
  /** Brief feedback, then restore the interrupted clip, pose and callback. */
  playTransient(name: string): void;
}

/** AnimState:Hide / Show: toggle a named layer of the current build. */
export interface LayerAnimationController {
  hideLayer(layer: string): void;
  showLayer(layer: string): void;
}

/** AnimState:SetPercent: show a clip at a fixed fraction of its length without advancing it. */
export interface PercentAnimationController {
  setPercent(name: string, percent: number): void;
}

/** AnimState:GetCurrentAnimationNumFrames / SetFrame on the current clip. */
export interface FrameSeekableAnimationController {
  readonly numFrames: number;
  setFrame(frame: number): void;
}

export interface AnimatedSpriteOptions {
  initialAnimation: string;
  /** Build zip separate from the bank zip passed as `file`, e.g. moondial.zip + moondial_build.zip. */
  buildArchive?: string;
  /** Restore a stable one-shot end pose without replaying its animation. */
  initialFrame?: 'first' | 'last';
  name?: string;
  scale?: number;
  /** Skin build archive; missing symbols fall back to the base build. */
  skinArchive?: string;
  /** Restrict replacement to these symbols, e.g. researchlab4's machine_hat. */
  skinSymbols?: readonly string[];
  /** Symbols DST explicitly keeps from the base build even when wearing a skin. */
  baseSymbols?: readonly string[];
  /** Additional skin animation banks drawn over the main frame in the same mesh. */
  skinAnimationBanks?: readonly string[];
  symbolOverrides?: Readonly<Record<string, { archive: string; symbol: string }>>;
  hiddenLayers?: readonly string[];
  getWatchWorldContent?: GetWatchWorldContent;
  /** MakeSnowCoveredPristine: the prefab opts in and owns the shared snow build. */
  snowCovered?: LoadedBuildOverride;
}

interface SymbolOverride {
  build: ParsedBuild;
  materials: THREE.MeshBasicMaterial[];
  symbolHash: number;
}

interface SpriteSkin {
  build: ParsedBuild;
  materials: THREE.MeshBasicMaterial[];
  animations?: ParsedAnim;
  symbols?: ReadonlySet<number>;
  baseSymbols: ReadonlySet<number>;
  animationBanks: ReadonlySet<number>;
}

/** One archive and set of atlas materials shared by independent animated entities. */
export interface AnimatedSpriteFactory {
  create(options: AnimatedSpriteOptions): THREE.Group;
  disposeSprite(sprite: THREE.Group): void;
  dispose(): void;
}

export class SpriteController implements TransientSpriteAnimationController, FrameSeekableAnimationController, PercentAnimationController, LayerAnimationController {
  protected readonly visual: THREE.Group;
  private readonly renderer: SpriteFrameRenderer;
  private readonly matrixGate?: ReturnType<typeof installMatrixGate>;
  private build: ParsedBuild;
  protected readonly animations: ParsedAnim;
  private materials: THREE.MeshBasicMaterial[];
  protected animation!: Animation;
  protected animationName = '';
  protected elapsed = 0;
  protected frameKey = '';
  private layers: Animation[] = [];
  protected loop = true;
  private paused = false;
  private onComplete?: () => void;
  private animationQueue: { name: string; loop: boolean }[] = [];
  private queueAfter = 0;
  private transientRestore?: () => void;
  private readonly skin?: SpriteSkin;
  private overrides = new Map<number, SymbolOverride>();
  private buildOverrides = new Map<string, LoadedBuildOverride>();
  private hiddenLayers = new Set<number>();
  /** AnimState:Hide layers; independent of the skin's hiddenLayers, which setSymbolOverrides replaces. */
  private animStateHiddenLayers = new Set<number>();
  private frameCache?: FrameGeometryCache;
  private sharedBuild?: ParsedBuild;
  private sharedMaterials?: THREE.MeshBasicMaterial[];
  private readonly snow?: LoadedBuildOverride;
  private snowLevel?: WorldContentSignal<number>;
  private stopSnow?: () => void;

  constructor(
    visual: THREE.Group,
    build: ParsedBuild,
    animations: ParsedAnim,
    materials: THREE.MeshBasicMaterial[],
    initialAnimation: string,
    skin?: SpriteSkin,
    getWatchWorldContent?: GetWatchWorldContent,
    snowCovered?: LoadedBuildOverride,
  ) {
    this.visual = visual;
    this.renderer = new SpriteFrameRenderer(visual);
    if (visual.parent) this.matrixGate = installMatrixGate(visual.parent, visual, false, false, true);
    this.build = build;
    this.animations = animations;
    this.materials = materials;
    this.skin = skin;
    this.snow = snowCovered;
    this.selectAnimation(initialAnimation, true);
    if (this.snow) {
      this.overrideSymbol('snow', { build: this.snow.build, materials: this.snow.materials, symbolHash: smallHash('snow') });
      this.setWorldContent(getWatchWorldContent);
    }
  }

  /** Each controller owns its world bridge, including when the host replaces its world binding. */
  setWorldContent(getWatchWorldContent?: GetWatchWorldContent): void {
    this.stopSnow?.();
    this.stopSnow = undefined;
    this.snowLevel = undefined;
    if (!this.snow) return;
    this.snowLevel = getWatchWorldContent?.(WorldContentKey.SnowLevel, stop => { this.stopSnow = stop; });
    const snowLevel = this.snowLevel;
    if (snowLevel) createEffect(() => this.updateSnowLayer(snowLevel.get()));
    else this.hideLayer('snow');
  }

  private updateSnowLayer(level: number): void {
    // weather.lua SNOW_COVERED_THRESHOLD.
    if (level >= .015) this.showLayer('snow'); else this.hideLayer('snow');
  }

  dispose(): void {
    this.matrixGate?.dispose();
    this.stopSnow?.();
    this.stopSnow = undefined;
    this.snowLevel = undefined;
    this.renderer.dispose();
  }

  /** Draw frames from the factory's shared cache while this sprite has no per-instance appearance. */
  useFrameCache(cache: FrameGeometryCache): void {
    this.frameCache = cache;
    this.sharedBuild = this.build;
    this.sharedMaterials = this.materials;
    this.reshowFrame();
  }

  private canShareFrame(): boolean {
    return this.frameCache !== undefined && !this.skin && this.overrides.size === 0 && this.buildOverrides.size === 0
      && this.hiddenLayers.size === 0 && this.animStateHiddenLayers.size === 0
      && this.build === this.sharedBuild && this.materials === this.sharedMaterials
      && this.isLayerVisible === SpriteController.prototype.isLayerVisible;
  }

  start(name: string) {
    this.animationQueue = [];
    if (name === this.animationName && this.loop) return;
    this.selectAnimation(name, true);
  }

  get currentAnimation(): string { return this.animationName; }
  get numFrames(): number { return this.animation.frames.length; }
  /** AnimState:GetCurrentAnimationLength, in seconds. */
  get currentAnimationLength(): number { return this.animation.frames.length / this.animation.frameRate; }

  setFrame(frame: number): void {
    if (!Number.isInteger(frame) || frame < 0 || frame >= this.animation.frames.length) throw new RangeError('Invalid animation frame');
    this.elapsed = frame / this.animation.frameRate;
    this.showFrame(frame);
  }

  setPercent(name: string, percent: number): void {
    if (!Number.isFinite(percent) || percent < 0 || percent > 1) throw new RangeError('Invalid animation percent');
    this.selectAnimation(name, false);
    this.setFrame(Math.min(Math.floor(percent * this.animation.frames.length), this.animation.frames.length - 1));
    this.paused = true;
  }

  setSymbolOverrides(overrides: Map<number, SymbolOverride>, hiddenLayers: readonly string[] = []): void {
    this.overrides = overrides;
    if (this.snow) this.overrides.set(smallHash('snow'), {
      build: this.snow.build, materials: this.snow.materials, symbolHash: smallHash('snow'),
    });
    this.hiddenLayers = new Set(hiddenLayers.map(smallHash));
    this.reshowFrame();
  }

  hideLayer(layer: string): void {
    const hash = smallHash(layer);
    if (!this.animStateHiddenLayers.has(hash)) { this.animStateHiddenLayers.add(hash); this.reshowFrame(); }
  }

  showLayer(layer: string): void {
    if (this.animStateHiddenLayers.delete(smallHash(layer))) this.reshowFrame();
  }

  /** AnimState:SetBuild: the base build whose symbols are drawn when no override or skin applies. */
  setBuild(build: ParsedBuild, materials: THREE.MeshBasicMaterial[]): void {
    if (build === this.build && materials === this.materials) return;
    this.build = build;
    this.materials = materials;
    this.reshowFrame();
  }

  /** AnimState:OverrideSymbol / ClearOverrideSymbol; the caller owns the loaded override's materials. */
  overrideSymbol(symbol: string, override: SymbolOverride | undefined): void {
    const hash = smallHash(symbol);
    if (override) this.overrides.set(hash, override);
    else this.overrides.delete(hash);
    this.reshowFrame();
  }

  /** AnimState:AddOverrideBuild: every symbol of the build replaces the base and skin symbol of that name. */
  addOverrideBuild(name: string, override: LoadedBuildOverride): void {
    this.buildOverrides.delete(name);
    this.buildOverrides.set(name, override);
    this.reshowFrame();
  }

  /** AnimState:ClearOverrideBuild; the caller keeps ownership of the loaded build's materials. */
  clearOverrideBuild(name: string): void {
    if (this.buildOverrides.delete(name)) this.reshowFrame();
  }

  private reshowFrame(): void {
    this.frameKey = '';
    const frame = Math.floor(this.elapsed * this.animation.frameRate);
    this.showFrame(this.loop ? frame % this.animation.frames.length : Math.min(frame, this.animation.frames.length - 1));
  }

  /** Keep a live entity's clip, progress and completion callback across reskinning. */
  copyPlaybackFrom(source: SpriteController): void {
    this.animStateHiddenLayers = new Set(source.animStateHiddenLayers);
    if (this.snow) this.updateSnowLayer(this.snowLevel?.peek() ?? 0);
    this.selectAnimation(source.animationName, source.loop, source.onComplete);
    this.animationQueue = source.animationQueue.map(entry => ({ ...entry }));
    this.queueAfter = source.queueAfter;
    this.elapsed = source.elapsed;
    this.update(0);
    this.paused = source.paused;
  }

  playOnce(name: string, onComplete?: () => void) {
    this.selectAnimation(name, false, onComplete);
  }

  /** AnimState:PushAnimation: finish this pass before advancing to the queued clip. */
  pushAnimation(name: string, loop = false): void {
    this.findAnimation(name);
    if (this.animationQueue.length === 0) {
      const duration = this.currentAnimationLength;
      this.queueAfter = this.loop ? (Math.floor(this.elapsed / duration) + 1) * duration : duration;
    }
    this.animationQueue.push({ name, loop });
  }

  playTransient(name: string) {
    const { animationName, elapsed, loop, onComplete } = this;
    const queue = this.animationQueue.map(entry => ({ ...entry }));
    const queueAfter = this.queueAfter;
    const restore = this.transientRestore ?? (() => {
      this.selectAnimation(animationName, loop, onComplete);
      this.elapsed = elapsed;
      this.animationQueue = queue;
      this.queueAfter = queueAfter;
      const frame = Math.floor(elapsed * this.animation.frameRate);
      this.showFrame(loop ? frame % this.animation.frames.length : Math.min(frame, this.animation.frames.length - 1));
    });
    this.selectAnimation(name, false, restore);
    this.transientRestore = restore;
  }

  holdLastFrame(name: string) {
    this.selectAnimation(name, false);
    this.elapsed = this.animation.frames.length / this.animation.frameRate;
    this.showFrame(this.animation.frames.length - 1);
  }

  protected findAnimation(name: string): Animation {
    const base = this.animations.animations.find((candidate) => candidate.name === name);
    if (!base) throw new Error(`Sprite animation ${name} is unavailable`);
    return this.skin?.animations?.animations.find((candidate) =>
      candidate.name === name && candidate.bankHash === base.bankHash,
    ) ?? base;
  }

  protected isLayerVisible(_layerHash: number): boolean { return true; }

  update(dt: number) {
    if (this.paused) return;
    this.elapsed += Math.min(dt, 0.1);
    if (this.animationQueue.length > 0 && this.elapsed >= this.queueAfter) {
      const [next, ...remaining] = this.animationQueue;
      const remainder = this.elapsed - this.queueAfter;
      const completion = this.onComplete;
      this.onComplete = undefined;
      completion?.();
      this.selectAnimation(next.name, next.loop);
      this.animationQueue = remaining;
      this.queueAfter = this.currentAnimationLength;
      this.elapsed = remainder;
    }
    const elapsedFrame = Math.floor(this.elapsed * this.animation.frameRate);
    if (!this.loop && elapsedFrame >= this.animation.frames.length) {
      const completion = this.onComplete;
      this.onComplete = undefined;
      completion?.();
      return;
    }

    const nextFrame = this.loop
      ? elapsedFrame % this.animation.frames.length
      : elapsedFrame;
    this.showFrame(nextFrame);
  }

  private selectAnimation(name: string, loop: boolean, onComplete?: () => void) {
    const animation = this.findAnimation(name);
    if (!animation.frames.length) throw new Error(`Sprite animation ${name} has no frames`);
    this.animation = animation;
    this.animationName = name;
    this.loop = loop;
    this.onComplete = onComplete;
    this.animationQueue = [];
    this.transientRestore = undefined;
    this.paused = false;
    this.elapsed = 0;
    this.frameKey = '';
    this.layers = this.skin?.animations?.animations.filter((candidate) =>
      candidate.name === name && this.skin!.animationBanks.has(candidate.bankHash),
    ) ?? [];
    this.publishAnimationEnvelope();
    this.showFrame(0);
  }

  /** Publish the largest bounds over all frames up front, so spatial queries never wait for a larger frame to be shown. */
  private publishAnimationEnvelope(): void {
    const cacheable = this.layers.length === 0 && this.overrides.size === 0 && this.buildOverrides.size === 0 && !this.skin;
    let radius = cacheable ? animationEnvelopes.get(this.animation) : undefined;
    if (radius === undefined) {
      const visual = new THREE.Group(), scratch = new SpriteFrameRenderer(visual);
      const count = Math.max(this.animation.frames.length, ...this.layers.map(layer => layer.frames.length));
      for (let i = 0; i < count; i++) {
        scratch.show(this.resolveSprites(i % this.animation.frames.length, this.layers.map(layer => i % layer.frames.length)));
      }
      radius = spriteSpatialRadius(visual) ?? 0;
      scratch.dispose();
      if (cacheable) animationEnvelopes.set(this.animation, radius);
    }
    if (radius > 0) publishSpriteSpatialBounds(this.visual, envelopeSphere.set(envelopeSphere.center.set(0, 0, 0), radius));
  }

  protected showFrame(index: number) {
    const layerIndices = this.layers.map((layer) => {
      const frame = Math.floor(this.elapsed * layer.frameRate);
      return this.loop ? frame % layer.frames.length : Math.min(frame, layer.frames.length - 1);
    });
    const key = `${index}:${layerIndices.join(',')}`;
    if (key === this.frameKey) return;
    this.frameKey = key;
    if (this.canShareFrame()) {
      const cache = this.frameCache!;
      this.renderer.showShared(cache.get(`${cache.idOf(this.animation)}:${key}`, () => this.resolveSprites(index, layerIndices)));
      return;
    }
    this.renderer.show(this.resolveSprites(index, layerIndices));
  }

  private resolveSprites(index: number, layerIndices: readonly number[]): ResolvedSprite[] {
    const frames = [this.animation.frames[index], ...this.layers.map((layer, i) => layer.frames[layerIndices[i]])];
    const sprites = frames.flatMap((frame) => [...frame.elements]
      .filter((element) => !this.hiddenLayers.has(element.layerHash) && !this.animStateHiddenLayers.has(element.layerHash) && this.isLayerVisible(element.layerHash))
      .sort((a, b) => b.z - a.z)
      .map((element) => {
        const override = this.overrides.get(element.imageHash);
        if (override) {
          const image = findImage(override.build, override.symbolHash, element.imageIndex);
          return image ? { element, image, materials: override.materials } : undefined;
        }
        for (const override of [...this.buildOverrides.values()].reverse()) {
          const image = findImage(override.build, element.imageHash, element.imageIndex);
          if (image) return { element, image, materials: override.materials };
        }
        const skin = this.skin;
        if (skin && !skin.baseSymbols.has(element.imageHash)
          && (skin.symbols === undefined || skin.symbols.has(element.imageHash))) {
          const image = findImage(skin.build, element.imageHash, element.imageIndex);
          if (image) return { element, image, materials: skin.materials };
        }
        const image = findImage(this.build, element.imageHash, element.imageIndex);
        return image ? { element, image, materials: this.materials } : undefined;
      })
      .filter((sprite): sprite is ResolvedSprite => Boolean(sprite)));
    return sprites;
  }
}

/** A build symbol that can replace another symbol at runtime, with its own atlas materials. */
export interface LoadedSymbolOverride extends SymbolOverride { dispose(): void }

export async function loadSymbolOverride(assetBaseUrl: string, archive: string, symbol: string): Promise<LoadedSymbolOverride> {
  const loaded = await loadSpriteSkinArchive(archive, assetBaseUrl);
  const materials = createMaterials(loaded.buildPackage);
  return {
    build: loaded.buildPackage.build, materials, symbolHash: smallHash(symbol),
    dispose() { for (const material of materials) { material.map?.dispose(); material.dispose(); } },
  };
}

/** A whole build used as an override build; its atlases belong to the caller. */
export interface LoadedBuildOverride {
  readonly build: ParsedBuild;
  readonly materials: THREE.MeshBasicMaterial[];
  dispose(): void;
}

export async function loadBuildOverride(assetBaseUrl: string, archive: string): Promise<LoadedBuildOverride> {
  const loaded = await loadSpriteSkinArchive(archive, assetBaseUrl);
  const materials = createMaterials(loaded.buildPackage);
  return {
    build: loaded.buildPackage.build, materials,
    dispose() { for (const material of materials) { material.map?.dispose(); material.dispose(); } },
  };
}

export async function createAnimatedSprite(
  assetBaseUrl: string,
  file: string,
  options: AnimatedSpriteOptions,
): Promise<THREE.Group> {
  const { buildPackage, animations } = options.buildArchive
    ? { buildPackage: await loadBuild(options.buildArchive, assetBaseUrl), animations: await loadAnim(file, assetBaseUrl) }
    : await loadAnimationArchive(file, assetBaseUrl);
  const skinArchive = options.skinArchive
    ? await loadSpriteSkinArchive(options.skinArchive, assetBaseUrl) : undefined;
  const skin: SpriteSkin | undefined = skinArchive ? {
    build: skinArchive.buildPackage.build,
    materials: createMaterials(skinArchive.buildPackage),
    animations: skinArchive.animations,
    symbols: options.skinSymbols ? new Set(options.skinSymbols.map(smallHash)) : undefined,
    baseSymbols: new Set(options.baseSymbols?.map(smallHash)),
    animationBanks: new Set(options.skinAnimationBanks?.map(smallHash)),
  } : undefined;
  const overrides = new Map<number, SymbolOverride>();
  const overrideMaterials = new Map<string, THREE.MeshBasicMaterial[]>();
  for (const [symbol, source] of Object.entries(options.symbolOverrides ?? {})) {
    const archive = await loadSpriteSkinArchive(source.archive, assetBaseUrl);
    let materials = overrideMaterials.get(source.archive);
    if (!materials) {
      materials = createMaterials(archive.buildPackage);
      overrideMaterials.set(source.archive, materials);
    }
    overrides.set(smallHash(symbol), { build: archive.buildPackage.build, materials, symbolHash: smallHash(source.symbol) });
  }
  const materials = createMaterials(buildPackage);
  const sprite = createSprite(buildPackage.build, animations, materials, options, skin);
  sprite.userData.ownedSpriteMaterials = [...materials, ...(skin?.materials ?? []), ...[...overrideMaterials.values()].flat()];
  (sprite.userData.animationController as SpriteController).setSymbolOverrides(overrides, options.hiddenLayers);
  return sprite;
}

export interface AnimatedSpriteSourceOptions {
  /** Build zip separate from the bank zip passed as `file`. */
  buildArchive?: string;
  /** Skin build archive shared by every sprite of this source. */
  skinArchive?: string;
  symbolOverrides?: Readonly<Record<string, { archive: string; symbol: string }>>;
}

/**
 * The shared half of `createAnimatedSprite`: archives, atlas materials and frame geometry are loaded once and
 * reused by every sprite created from the source; each `create` only builds an entity's controller and meshes.
 * `create` takes the per-entity skin/symbol options of `createAnimatedSprite`. Disposing the source releases the
 * atlases, so the owner disposes sprites first (`disposeSprite`) and then the source.
 */
export async function createAnimatedSpriteSource(
  assetBaseUrl: string,
  file: string,
  source: AnimatedSpriteSourceOptions = {},
): Promise<AnimatedSpriteFactory> {
  const { buildPackage, animations } = source.buildArchive
    ? { buildPackage: await loadBuild(source.buildArchive, assetBaseUrl), animations: await loadAnim(file, assetBaseUrl) }
    : await loadAnimationArchive(file, assetBaseUrl);
  const skinArchive = source.skinArchive ? await loadSpriteSkinArchive(source.skinArchive, assetBaseUrl) : undefined;
  const overrides = new Map<number, SymbolOverride>();
  const overrideMaterials = new Map<string, THREE.MeshBasicMaterial[]>();
  for (const [symbol, from] of Object.entries(source.symbolOverrides ?? {})) {
    const archive = await loadSpriteSkinArchive(from.archive, assetBaseUrl);
    let materials = overrideMaterials.get(from.archive);
    if (!materials) {
      materials = createMaterials(archive.buildPackage);
      overrideMaterials.set(from.archive, materials);
    }
    overrides.set(smallHash(symbol), { build: archive.buildPackage.build, materials, symbolHash: smallHash(from.symbol) });
  }
  const factory = createSpriteFactory(buildPackage, animations, SpriteController, skinArchive);
  return {
    create(options) {
      const sprite = factory.create(options);
      (sprite.userData.animationController as SpriteController).setSymbolOverrides(new Map(overrides), options.hiddenLayers);
      return sprite;
    },
    disposeSprite: factory.disposeSprite,
    dispose() {
      factory.dispose();
      for (const materials of overrideMaterials.values()) for (const material of materials) { material.map?.dispose(); material.dispose(); }
    },
  };
}

export async function createAnimatedSpriteFactory(
  assetBaseUrl: string,
  file: string,
): Promise<AnimatedSpriteFactory> {
  const { buildPackage, animations } = await loadAnimationArchive(file, assetBaseUrl);
  return createSpriteFactory(buildPackage, animations);
}

/** Share loaded atlases while allowing specialized sprite controllers. */
export function createSpriteFactory(
  buildPackage: BuildPackage,
  animations: ParsedAnim,
  controllerClass: typeof SpriteController = SpriteController,
  skinArchive?: Awaited<ReturnType<typeof loadSpriteSkinArchive>>,
): AnimatedSpriteFactory {
  const materials = createMaterials(buildPackage);
  const skinMaterials = skinArchive ? createMaterials(skinArchive.buildPackage) : [];
  const sprites = new Set<THREE.Group>();
  const frameCache = new FrameGeometryCache();
  let disposed = false;
  const disposeSprite = (sprite: THREE.Group) => {
    if (!sprites.delete(sprite)) return;
    (sprite.userData.animationController as SpriteController | undefined)?.dispose();
    sprite.removeFromParent();
    sprite.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
  };
  return {
    create(options) {
      if (disposed) throw new Error('Animated sprite factory has been disposed');
      const skin: SpriteSkin | undefined = skinArchive ? {
        build: skinArchive.buildPackage.build, materials: skinMaterials, animations: skinArchive.animations,
        symbols: options.skinSymbols ? new Set(options.skinSymbols.map(smallHash)) : undefined,
        baseSymbols: new Set(options.baseSymbols?.map(smallHash)),
        animationBanks: new Set(options.skinAnimationBanks?.map(smallHash)),
      } : undefined;
      const sprite = createSprite(buildPackage.build, animations, materials, options, skin, controllerClass, frameCache);
      sprites.add(sprite);
      return sprite;
    },
    disposeSprite,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const sprite of sprites) disposeSprite(sprite);
      frameCache.dispose();
      for (const material of [...materials, ...skinMaterials]) {
        material.map?.dispose();
        material.dispose();
      }
    },
  };
}

function createSprite(
  build: ParsedBuild,
  animations: ParsedAnim,
  materials: THREE.MeshBasicMaterial[],
  options: AnimatedSpriteOptions,
  skin?: SpriteSkin,
  controllerClass: typeof SpriteController = SpriteController,
  frameCache?: FrameGeometryCache,
): THREE.Group {
  const sprite = new THREE.Group();
  sprite.name = options.name ?? build.name;
  sprite.userData.billboard = true;

  const visual = new THREE.Group();
  const scale = options.scale ?? 0.02;
  visual.scale.set(scale, -scale, scale);
  sprite.add(visual);
  registerSpriteRenderGroup(sprite, visual);

  const controller = new controllerClass(
    visual,
    build,
    animations,
    materials,
    options.initialAnimation,
    skin,
    options.getWatchWorldContent,
    options.snowCovered,
  );
  if (frameCache) controller.useFrameCache(frameCache);
  if (options.initialFrame === 'last') controller.holdLastFrame(options.initialAnimation);
  sprite.userData.animationController = controller;
  return sprite;
}

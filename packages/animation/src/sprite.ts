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
  type AnimElement,
  type BuildPackage,
  type ParsedAnim,
  type ParsedBuild,
  type ResolvedSprite,
  type Matrix2D,
  type BuildImage,
} from './animationAssets';
import { animStateVisible, resolveAnimStateSymbol, type ResolvedAnimState, type SymbolBuild } from './animState';
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

/** Prepared animation bank and builds. The resource owner retains the shared atlases. */
export interface SpriteArtSource {
  readonly animations: ParsedAnim;
  readonly bank: number;
  readonly build: SymbolBuild;
  readonly fallbackBuilds?: readonly SymbolBuild[];
}

/** A child frame merged in the owner's layer order, or retained at a detached world point. */
export interface CompositeSpriteFrame {
  readonly sprites: readonly ResolvedSprite[];
  readonly symbol?: number;
  readonly detached?: { readonly position: THREE.Vector3; readonly mirrored: boolean };
  /** AnimState:SetFinalOffset of a follower: negative draws it behind the whole owner, positive in front, 0 at the symbol's layer. */
  readonly finalOffset?: number;
  /** Transform:SetNoFaced: the follower keeps its own orientation, unmirrored by the owner's facing. */
  readonly noFaced?: boolean;
  /** Follower:FollowSymbol's x/y offset, in the followed symbol's space. */
  readonly offset?: readonly [number, number];
}

export interface SpriteTint { readonly colour: readonly number[]; readonly amount: number }

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
  private artSource?: SpriteArtSource;
  private animState?: ResolvedAnimState;
  /** Seconds the AnimState's symbol animations have played. */
  private animStateElapsed = 0;
  /** Bloom halos of dressed materials, per halo image. */
  private readonly bloomMaterials = new Map<THREE.MeshBasicMaterial, Map<BuildImage, THREE.MeshBasicMaterial>>();
  private artFacing?: number;
  private mirrored = false;
  private composites: readonly CompositeSpriteFrame[] = [];
  private resolvedFrame: readonly ResolvedSprite[] = [];
  private readonly colour = new THREE.Color(1, 1, 1);
  private opacity = 1;
  private readonly tintAmount = { value: 0 };
  private readonly tintColour = { value: new THREE.Color() };
  private readonly privateMaterials = new Map<THREE.MeshBasicMaterial, THREE.MeshBasicMaterial>();
  private readonly compositePoint = new THREE.Vector3();

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
    for (const material of this.privateMaterials.values()) material.dispose();
    this.privateMaterials.clear();
    for (const halos of this.bloomMaterials.values()) for (const material of halos.values()) material.dispose();
    this.bloomMaterials.clear();
  }

  /** Draw frames from the factory's shared cache while this sprite has no per-instance appearance. */
  useFrameCache(cache: FrameGeometryCache): void {
    this.frameCache = cache;
    this.sharedBuild = this.build;
    this.sharedMaterials = this.materials;
    this.reshowFrame();
  }

  private canShareFrame(): boolean {
    return this.frameCache !== undefined && !this.artSource && !this.animState && this.composites.length === 0
      && this.privateMaterials.size === 0 && this.colour.r === 1 && this.colour.g === 1 && this.colour.b === 1 && this.opacity === 1
      && !this.skin && this.overrides.size === 0 && this.buildOverrides.size === 0
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

  /** Draw a few depth steps towards the camera, so an effect on its owner's plane is not hidden by the owner's depth. */
  setDepthOffset(enabled: boolean): void { this.renderer.setDepthOffset(enabled); }

  setPaused(paused: boolean): void { this.paused = paused; }
  setArtSource(source: SpriteArtSource): void {
    if (source === this.artSource) return;
    this.artSource = source;
    if (source.animations.animations.some(animation => animation.name === this.animationName && animation.bankHash === source.bank)) {
      this.animation = this.findAnimation(this.animationName);
      this.reshowFrame();
    }
  }
  setAnimState(state: ResolvedAnimState): void { this.animState = state; this.reshowFrame(); }
  setFacing(facing: number, mirrored = false): void {
    if (facing === this.artFacing && mirrored === this.mirrored) return;
    this.artFacing = facing; this.mirrored = mirrored;
    this.visual.scale.x = Math.abs(this.visual.scale.x) * (mirrored ? -1 : 1);
    this.animation = this.findAnimation(this.animationName);
    this.reshowFrame();
  }
  setColour(colour: readonly number[]): void { this.colour.setRGB(colour[0], colour[1], colour[2]); this.refreshMaterials(); }
  setOpacity(opacity: number): void { this.opacity = opacity; this.refreshMaterials(); }
  setTint(tint: SpriteTint): void {
    this.tintAmount.value = tint.amount;
    this.tintColour.value.setRGB(tint.colour[0], tint.colour[1], tint.colour[2]);
    this.reshowFrame();
  }
  setComposites(frames: readonly CompositeSpriteFrame[]): void {
    if (frames.length === this.composites.length && frames.every((frame, i) => frame.sprites === this.composites[i].sprites
      && frame.symbol === this.composites[i].symbol && frame.detached === this.composites[i].detached
      && frame.finalOffset === this.composites[i].finalOffset && frame.noFaced === this.composites[i].noFaced
      && frame.offset?.[0] === this.composites[i].offset?.[0] && frame.offset?.[1] === this.composites[i].offset?.[1])) return;
    this.composites = frames; this.reshowFrame();
  }
  getResolvedFrame(): readonly ResolvedSprite[] { return this.resolvedFrame; }
  getSymbolPosition(symbol: string, x: number, y: number, target: THREE.Vector3): boolean {
    const frame = Math.min(this.animation.frames.length - 1, Math.max(0, Math.floor(this.elapsed * this.animation.frameRate)));
    const element = this.animation.frames[frame].elements.find(element => element.imageHash === smallHash(symbol));
    if (!element) return false;
    const [a, b, c, d, tx, ty] = element.matrix;
    this.visual.updateMatrix();
    target.set(a * x + c * y + tx, b * x + d * y + ty, 0).applyMatrix4(this.visual.matrix);
    return true;
  }

  private refreshMaterials(): void {
    for (const [source, material] of this.privateMaterials) {
      material.color.copy(source.color).multiply(this.colour);
      material.opacity = source.opacity * this.opacity;
    }
    for (const [base, halos] of this.bloomMaterials) for (const halo of halos.values()) halo.color.copy(base.color);
    this.reshowFrame();
  }
  private dressedMaterial(source: THREE.MeshBasicMaterial): THREE.MeshBasicMaterial {
    let material = this.privateMaterials.get(source);
    if (!material && this.opacity === 1 && this.tintAmount.value === 0 && this.colour.r === 1 && this.colour.g === 1 && this.colour.b === 1) return source;
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
    return material;
  }

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
    const source = this.artSource;
    const candidates = (source?.animations ?? this.animations).animations.filter(candidate => candidate.name === name
      && (source === undefined || candidate.bankHash === source.bank));
    const base = candidates.find(candidate => candidate.facing === this.artFacing)
      ?? candidates.find(candidate => this.artFacing !== undefined && (candidate.facing & this.artFacing) !== 0) ?? candidates[0];
    if (!base) throw new Error(`Sprite animation ${name} is unavailable`);
    // A skin swaps the build only (AnimState:SetSkin); the bank's clip stays the base archive's. The stub anim.bin in
    // dynamic/hat_dreadstone_horn.zip points dreadstonehat/anim at swap_hat frame 1 instead of the ground pose 3.
    return base;
  }

  protected isLayerVisible(_layerHash: number): boolean { return true; }

  update(dt: number) {
    const attachments = this.animState?.attachments ?? [];
    const following = (this.animState?.symbolAnimations.size ?? 0) > 0;
    const animating = following || attachments.some(attachment => attachment.isAnimating);
    for (const attachment of attachments) attachment.update(dt);
    if (following) this.animStateElapsed += dt;
    if (animating) this.frameKey = '';
    if (this.paused) { if (animating) this.reshowFrame(); return; }
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
    const resolved = this.resolveSprites(index, layerIndices);
    this.resolvedFrame = resolved;
    this.renderer.show(resolved);
  }

  private resolveSprites(index: number, layerIndices: readonly number[]): ResolvedSprite[] {
    const frames = [this.animation.frames[index], ...this.layers.map((layer, i) => layer.frames[layerIndices[i]])];
    const followers = new Map<number, CompositeSpriteFrame[]>();
    // Each halo part, with the unpadded image its blur is bounded to.
    const halos = new Map<ResolvedSprite, BuildImage>();
    for (const fx of this.composites) if (fx.symbol !== undefined && !fx.finalOffset) {
      const entries = followers.get(fx.symbol) ?? [];
      entries.push(fx); followers.set(fx.symbol, entries);
    }
    const sprites = frames.flatMap((frame) => [...frame.elements]
      .filter((element) => (!this.animState || animStateVisible(this.animState, element))
        && !this.hiddenLayers.has(element.layerHash) && !this.animStateHiddenLayers.has(element.layerHash) && this.isLayerVisible(element.layerHash))
      .sort((a, b) => b.z - a.z)
      .flatMap((element) => {
        const sprite = this.resolveElement(element, followers);
        const parts = sprite === undefined ? [] : Array.isArray(sprite) ? sprite : [sprite];
        // Followers are their own entities; the owner's symbol light override and bloom are for its own art.
        if (followers.has(element.imageHash)) return parts;
        const light = this.animState?.symbolLightOverrides.get(element.imageHash);
        const lit = light === undefined ? parts : parts.map(part => ({ ...part, lightOverride: light }));
        return this.animState?.blooms.has(element.imageHash) ? lit.flatMap(part => [bloomHalo(part, halos), part]) : lit;
      }));
    const elements = frames[0].elements;
    const back: ResolvedSprite[] = [], front: ResolvedSprite[] = [];
    for (const fx of this.composites) {
      if (fx.symbol !== undefined && !fx.finalOffset) continue;
      let matrix: Matrix2D = [1, 0, 0, 1, 0, 0];
      if (fx.symbol !== undefined) {
        // Follower:FollowSymbol takes the symbol's position only; SetFinalOffset draws it before or after the owner.
        const anchor = elements.find(element => element.imageHash === fx.symbol);
        if (!anchor) continue;
        const [a, b, c, d, tx, ty] = anchor.matrix, [x, y] = fx.offset ?? [0, 0];
        matrix = fx.noFaced ? [this.mirrored ? -1 : 1, 0, 0, 1, a * x + c * y + tx, b * x + d * y + ty] : followMatrix(anchor.matrix, fx.offset);
      } else if (fx.detached) {
        this.visual.updateWorldMatrix(true, false);
        this.visual.worldToLocal(this.compositePoint.copy(fx.detached.position));
        matrix = [fx.detached.mirrored === this.mirrored ? 1 : -1, 0, 0, 1, this.compositePoint.x, this.compositePoint.y];
      }
      (fx.finalOffset! < 0 ? back : front).push(...fx.sprites.map(sprite => ({ ...sprite, element: { ...sprite.element, matrix: composeSpriteMatrix(matrix, sprite.element.matrix) } })));
    }
    return [...back, ...sprites, ...front].map(sprite => ({ ...sprite, materials: sprite.materials.map(material => {
      const dressed = this.dressedMaterial(material);
      const halo = halos.get(sprite);
      return halo ? this.bloomMaterial(dressed, halo) : dressed;
    }) }));
  }

  private bloomMaterial(base: THREE.MeshBasicMaterial, image: BuildImage): THREE.MeshBasicMaterial {
    let halos = this.bloomMaterials.get(base);
    if (!halos) this.bloomMaterials.set(base, halos = new Map());
    let material = halos.get(image);
    if (!material) halos.set(image, material = createBloomMaterial(base, image));
    return material;
  }

  private resolveElement(element: AnimElement, followers: ReadonlyMap<number, readonly CompositeSpriteFrame[]>): ResolvedSprite | ResolvedSprite[] | undefined {
    // Follower anchors can have no image in the owner's build. Resolve them before looking up body art.
    const followed = followers.get(element.imageHash);
    if (followed) return followed.flatMap(fx => fx.sprites.map(sprite => ({ ...sprite,
      element: { ...sprite.element, matrix: composeSpriteMatrix(followMatrix(element.matrix, fx.offset), sprite.element.matrix) } })));
    const declared = this.animState && resolveAnimStateSymbol(this.animState, element, this.animStateElapsed);
    if (declared) return declared;
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
    for (const source of this.artSource ? [this.artSource.build, ...this.artSource.fallbackBuilds ?? []] : [{ build: this.build, materials: this.materials }]) {
      const image = findImage(source.build, element.imageHash, element.imageIndex);
      if (image) return { element, image, materials: source.materials };
    }
    return undefined;
  }
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
  /** AnimState:AddOverrideBuild made by every entity of this source at construction: build name → archive. */
  overrideBuilds?: Readonly<Record<string, string>>;
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
  const buildOverrides = await Promise.all(Object.entries(source.overrideBuilds ?? {})
    .map(async ([name, archive]) => [name, await loadBuildOverride(assetBaseUrl, archive)] as const));
  const factory = createSpriteFactory(buildPackage, animations, SpriteController, skinArchive);
  return {
    create(options) {
      const sprite = factory.create(options);
      const controller = sprite.userData.animationController as SpriteController;
      controller.setSymbolOverrides(new Map(overrides), options.hiddenLayers);
      for (const [name, override] of buildOverrides) controller.addOverrideBuild(name, override);
      return sprite;
    },
    disposeSprite: factory.disposeSprite,
    dispose() {
      factory.dispose();
      for (const [, override] of buildOverrides) override.dispose();
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
): AnimatedSpriteFactory & { readonly build: SymbolBuild } {
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
    build: { build: buildPackage.build, materials },
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

function composeSpriteMatrix(parent: Matrix2D, child: Matrix2D): Matrix2D {
  const [a, b, c, d, tx, ty] = parent, [e, f, g, h, ux, uy] = child;
  return [a * e + c * f, b * e + d * f, a * g + c * h, b * g + d * h, a * ux + c * uy + tx, b * ux + d * uy + ty];
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

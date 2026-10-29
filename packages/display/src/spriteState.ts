import { createSignal, readonlySignal, type ReadonlySignal, type Signal } from '@dontstarve-web/signals';
import type * as THREE from 'three';
import type { AnimStateArt, AnimStateJson, SymbolBuild } from '@dontstarve-web/animation/animState';
import type { SpriteMaterialOptions } from '@dontstarve-web/animation/animationAssets';
import type { FxJson } from './fxAttachments';
import type { FollowerFx } from './followerFx';
import type { LayerAnimationController, LoadedBuildOverride, PercentAnimationController, SpriteController, TransientSpriteAnimationController, SpriteArtSource, SpriteTint } from '@dontstarve-web/animation/sprite';

type SymbolOverrideValue = Parameters<SpriteController['overrideSymbol']>[1];
type SymbolOverrideMap = Parameters<SpriteController['setSymbolOverrides']>[0];

interface SkinArt extends AnimStateArt {
  peekBuild(archive: string, options?: SpriteMaterialOptions): SymbolBuild | undefined;
  loadBuild(archive: string, options?: SpriteMaterialOptions): Promise<SymbolBuild>;
}

/** Source skin names and their resource owner; declaring this performs no IO. */
export interface SkinJson {
  readonly archives: Readonly<Record<string, string>>;
  readonly art: SkinArt;
  readonly materialOptions?: SpriteMaterialOptions;
  readonly symbols?: readonly string[];
  readonly baseSymbols?: readonly string[];
  readonly animationBanks?: Readonly<Record<string, readonly string[]>>;
}

/** Named bank and builds. The display resolves them from the owner's shared cache. */
export interface NamedSpriteArt {
  readonly animationArchive: string;
  readonly bank: string;
  readonly buildArchive: string;
  readonly fallbackBuilds?: readonly string[];
  readonly art: AnimStateArt;
}
export type SpriteSourceJson = SpriteArtSource | NamedSpriteArt;

/** The clip an entity is logically in. `finished` is written when its playback ends or settles, without a signal write. */
export interface ClipJson {
  readonly name: string;
  readonly loop: boolean;
  readonly complete?: () => void;
  finished: boolean;
  /** AnimState:SetPercent pose, shown as a held frame. */
  readonly percent?: number;
  /** Static build-image rest pose; an undefined name selects the source image. */
  readonly pose?: { readonly name: string | undefined };
  /** AnimState with no animation playing (bank and build only): nothing is drawn until a clip is played. */
  readonly none?: true;
}

/** Appearance that belongs to the entity and is dressed again on every drawn sprite. */
export type AppearanceJson =
  | { readonly kind: 'skin'; readonly skin: SkinJson }
  /** The display loads the archives `state` names from `art`, the entity's resource owner. */
  | { readonly kind: 'anim-state'; readonly state: AnimStateJson; readonly art?: AnimStateArt }
  | { readonly kind: 'layer'; readonly layer: string; readonly hidden: boolean }
  | { readonly kind: 'symbols'; readonly overrides: SymbolOverrideMap; readonly hiddenLayers: readonly string[] }
  | { readonly kind: 'symbol'; readonly symbol: string; readonly override: SymbolOverrideValue }
  | { readonly kind: 'archive-symbol'; readonly symbol: string; readonly archive?: string; readonly sourceSymbol?: string }
  | { readonly kind: 'archive-hidden'; readonly symbol: string; readonly hidden: boolean }
  | { readonly kind: 'archive-build'; readonly archive: string }
  | { readonly kind: 'build'; readonly name: string; readonly override: LoadedBuildOverride | undefined };

/** What an entity looks like, as plain data. The prefab writes it; the display draws it. */
export interface SpriteJson {
  readonly skinId?: string;
  readonly clip: ClipJson;
  readonly source?: SpriteSourceJson;
  readonly tint?: SpriteTint;
  /** `fx` is drawn at the follower's node by the display, which loads its art. */
  readonly followers?: ReadonlyMap<THREE.Object3D, { readonly symbol: string; readonly x: number; readonly y: number; readonly fx?: FollowerFx }>;
  /** Turned to the camera by the display: the source's default orientation, unlike OnGround art. Declared at creation. */
  readonly billboard?: boolean;
  readonly queue: readonly { readonly name: string; readonly loop: boolean }[];
  /** A frame of the clip, or `at`, a fraction of its length that the display resolves once the clip's art has loaded. */
  readonly frame?: number | { readonly at: number };
  /** A fresh object is one more request for a brief feedback clip. */
  readonly transient?: { readonly name: string };
  readonly image?: number;
  readonly facing?: number;
  /** Left-hand facings drawn as their mirrored right-hand art. */
  readonly mirrored?: boolean;
  readonly colour?: readonly number[];
  readonly opacity?: number;
  /** AnimState:SetLightOverride: minimum material light, without emitting light. */
  readonly lightOverride?: number;
  /** Held out of the world, such as an item in a pack. */
  readonly paused?: boolean;
  readonly visible?: boolean;
  readonly erosion?: number;
  /** Background art keeps its source orientation and draw order across visual reloads. */
  readonly ground?: { readonly renderOrder: number; readonly flat: boolean };
  /** LAYER_BACKGROUND art that draws by mesh order among the ground layers, keeping its group order. */
  readonly meshOrder?: number;
  /** An effect drawn on its owner's plane, a few depth steps towards the camera. */
  readonly depthOffset?: boolean;
  readonly appearance: ReadonlyMap<string, AppearanceJson>;
}

/** What the drawn sprite answers; set by the display while it has one. */
export interface SpriteProbe {
  readonly currentAnimation: string;
  readonly numFrames: number;
  readonly currentAnimationLength: number;
  readonly pose: string | undefined;
  readonly loaded: boolean;
  update(dt: number): void;
  createFollower?(): THREE.Object3D;
}

/**
 * What a shared archive sprite can be told: clips, frames, pausing, tint, facing and declared effects. An entity drawn
 * from an archive is typed with this, so a call it cannot draw (a static pose or a queue) does not compile.
 */
export interface ArchiveSpriteCommands {
  readonly sprite: ReadonlySignal<SpriteJson>;
  setSkinId(skinId: string | undefined): void;
  setSkinSource(skin: SkinJson): void;
  readonly fx: ReadonlySignal<ReadonlyMap<string, FxJson>>;
  readonly animationSource: ReadonlySignal<ReadonlySignal<string | number> | undefined>;
  readonly art: ReadonlySignal<number>;
  readonly loaded: boolean;
  readonly currentAnimation: string;
  readonly numFrames: number;
  update(dt: number): void;
  setAwake(awake: boolean): void;
  start(name: string): void;
  playOnce(name: string, complete?: () => void): void;
  pushAnimation(name: string, loop?: boolean): void;
  holdLastFrame(name: string): void;
  /** AnimState with no animation playing: nothing is drawn until a clip is played again. */
  clearAnimation(): void;
  setFrame(frame: number): void;
  /** AnimState:SetFrame at `fraction` of the clip's frames, for a frame chosen before the art has loaded. */
  setFrameAt(fraction: number): void;
  setFacing(facing: number): void;
  setColour(colour: readonly number[]): void;
  setOpacity(opacity: number): void;
  /** null clears it: the model keeps no minimum light. */
  setLightOverride(value: number | null): void;
  setPaused(paused: boolean): void;
  setVisible(visible: boolean): void;
  setErosion(amount: number): void;
  setSymbolOverride(symbol: string, archive?: string, sourceSymbol?: string): void;
  setSymbolHidden(symbol: string, hidden: boolean): void;
  hideLayer(layer: string): void;
  showLayer(layer: string): void;
  setBuildArchive(archive: string): void;
  setGround(renderOrder: number, flat?: boolean): void;
  setMeshOrder(order: number): void;
  setDepthOffset(enabled: boolean): void;
  attachFx(key: string, fx: FxJson): void;
  detachFx(key: string): void;
  followAnimation(source: ReadonlySignal<string | number> | undefined): void;
}

/**
 * The prefab-side sprite of an entity: animation commands become a `SpriteJson` snapshot, and nothing here touches a
 * model. It offers the controller surface prefabs already call, so a prefab changes the json and the display reacts.
 */
export class SpriteState implements ArchiveSpriteCommands, TransientSpriteAnimationController, PercentAnimationController, LayerAnimationController {
  private readonly json: ReturnType<typeof createSignal<SpriteJson>>;
  /** Snapshots of the entity's sprite; the display subscribes to this. */
  readonly sprite: ReadonlySignal<SpriteJson>;
  /** A projection of json.skinId for existing skin consumers; it stores no second value. */
  readonly skinId: Signal<string | undefined>;
  private readonly fxDeclared = createSignal<ReadonlyMap<string, FxJson>>(new Map());
  /** Effects shown on the entity while their `active` signal is true; apart from `sprite`, so a clip change does not reach them. */
  readonly fx = readonlySignal(this.fxDeclared);
  private readonly followed = createSignal<ReadonlySignal<string | number> | undefined>(undefined);
  /** The clip follows this signal's value for as long as it is declared. */
  readonly animationSource = readonlySignal(this.followed);
  private readonly artVersion = createSignal(0);
  /** Changes whenever the drawn sprite is attached or released; owners dress what they keep outside the json after it. */
  readonly art = readonlySignal(this.artVersion);
  private readonly initialAnimation: string;
  private probe: SpriteProbe | undefined;
  private awake = true;

  /**
   * `held` marks an initial clip shown on its last frame; `none` starts with no animation playing, as an AnimState that
   * was given only a bank and build; `billboard` entities face the camera.
   */
  constructor(clip: { name: string; held?: boolean; none?: boolean; billboard?: boolean }) {
    this.initialAnimation = clip.name;
    this.json = createSignal<SpriteJson>({
      clip: clip.none ? { name: clip.name, loop: false, finished: true, none: true }
        : { name: clip.name, loop: !clip.held, finished: clip.held === true }, queue: [], appearance: new Map(),
      ...clip.billboard ? { billboard: true } : {},
    });
    this.sprite = readonlySignal(this.json);
    this.skinId = {
      get: () => this.json.get().skinId, peek: () => this.state.skinId, set: value => this.setSkinId(value),
      subscribe: listener => this.json.subscribe((value, previous) => {
        if (value.skinId !== previous.skinId) listener(value.skinId, previous.skinId);
      }),
    };
  }

  private get state(): SpriteJson { return this.json.peek(); }
  private write(patch: Partial<SpriteJson>): void { this.json.set({ ...this.state, ...patch }); }
  setSkinId(skinId: string | undefined): void { if (skinId !== this.state.skinId) this.write({ skinId }); }
  setSkinSource(skin: SkinJson): void { this.withAppearance('skin', { kind: 'skin', skin }); }
  private withAppearance(key: string, value: AppearanceJson): void {
    const appearance = new Map(this.state.appearance);
    // A later command for the same target replaces the earlier one and is dressed last.
    appearance.delete(key);
    appearance.set(key, value);
    this.write({ appearance });
  }

  /** The display reports which drawn sprite answers questions about the entity, and when the drawn sprite changes. */
  bind(probe: SpriteProbe | undefined): void { this.probe = probe; }
  artChanged(): void { this.artVersion.set(this.artVersion.peek() + 1); }

  get loaded(): boolean { return this.probe?.loaded ?? false; }
  get currentAnimation(): string { return this.probe?.currentAnimation ?? this.state.clip.name; }
  get numFrames(): number { return this.probe?.numFrames ?? 0; }
  get currentAnimationLength(): number { return this.probe?.currentAnimationLength ?? 0; }
  get pose(): string | undefined { return this.probe ? this.probe.pose : this.state.clip.pose?.name; }
  update(dt: number): void { this.probe?.update(dt); }

  /** Nothing is drawn while the entity sleeps; a transition that was playing is not replayed but ends in its completion state. */
  setAwake(awake: boolean): void {
    if (!awake) this.settle();
    this.awake = awake;
  }
  // Playing no animation, the sprite is built for the next clip, which is drawn rather than settled.
  private get drawn(): boolean { return this.awake && (this.state.clip.none === true || (this.probe?.loaded ?? true)); }
  /** The completion state: the clip completes, and what was queued behind it is the clip now. */
  private settle(): void {
    const { clip, queue } = this.state;
    this.finish(clip);
    const last = queue[queue.length - 1];
    if (last) this.write({ clip: { name: last.name, loop: last.loop, finished: !last.loop }, queue: [], frame: undefined });
  }

  /** A clip's playback ended, or was settled because nothing is drawn: it completes once. */
  finish(clip: ClipJson): void {
    if (this.state.clip !== clip || clip.finished) return;
    clip.finished = true;
    clip.complete?.();
  }

  start(name: string): void {
    this.write({ clip: { name, loop: true, finished: false }, queue: [], frame: undefined });
  }
  playOnce(name: string, complete?: () => void): void {
    const clip: ClipJson = { name, loop: false, finished: false, complete }, drawn = this.drawn;
    this.write({ clip, queue: [], frame: undefined });
    // Nothing is drawn, so the transition completes at once.
    if (!drawn) this.finish(clip);
  }
  /** AnimState with no animation playing: the drawn sprite is released until a clip is played again. */
  clearAnimation(): void {
    this.write({ clip: { name: this.initialAnimation, loop: false, finished: true, none: true }, queue: [], frame: undefined });
  }
  pushAnimation(name: string, loop = false): void {
    this.write({ queue: [...this.state.queue, { name, loop }] });
    if (!this.drawn) this.settle();
  }
  playTransient(name: string): void { this.write({ transient: { name } }); }
  holdLastFrame(name: string): void {
    this.write({ clip: { name, loop: false, finished: true }, queue: [], frame: undefined });
  }
  setPercent(name: string, percent: number): void {
    this.write({ clip: { name, loop: false, finished: true, percent }, queue: [], frame: undefined });
  }
  setPose(name: string | undefined): void {
    this.write({ clip: { name: name ?? this.initialAnimation, loop: false, finished: true, pose: { name } }, queue: [], frame: undefined });
  }
  setFrame(frame: number): void { if (frame !== this.state.frame) this.write({ frame }); }
  setFrameAt(fraction: number): void {
    if (!(fraction >= 0 && fraction <= 1)) throw new RangeError('Frame fraction must be within [0, 1]');
    this.write({ frame: { at: fraction } });
  }
  setArtSource(source: SpriteSourceJson): void { if (source !== this.state.source) this.write({ source }); }
  setAnimState(state: AnimStateJson, art?: AnimStateArt): void { this.withAppearance('anim-state', { kind: 'anim-state', state, art }); }
  setTint(tint: SpriteTint): void { this.write({ tint }); }
  followSymbol(symbol: string, x: number, y: number, fx?: FollowerFx): { readonly node: THREE.Object3D; remove(): void } {
    const node = this.probe?.createFollower?.();
    if (!node) throw new Error('The sprite has no display for a symbol follower');
    this.write({ followers: new Map(this.state.followers).set(node, { symbol, x, y, ...fx ? { fx } : {} }) });
    return { node, remove: () => {
      const followers = new Map(this.state.followers);
      followers.delete(node);
      this.write({ followers });
    } };
  }
  showImage(image: number): void { this.write({ image }); }
  setFacing(facing: number, mirrored?: boolean): void {
    if (facing !== this.state.facing || mirrored !== this.state.mirrored) this.write({ facing, mirrored });
  }
  setColour(colour: readonly number[]): void { this.write({ colour }); }
  setOpacity(opacity: number): void { this.write({ opacity }); }
  setLightOverride(lightOverride: number | null): void { this.write({ lightOverride: lightOverride ?? undefined }); }
  setPaused(paused: boolean): void { this.write({ paused }); }
  setVisible(visible: boolean): void { this.write({ visible }); }
  setErosion(erosion: number): void { this.write({ erosion }); }
  setGround(renderOrder: number, flat = true): void { this.write({ ground: { renderOrder, flat } }); }
  setMeshOrder(meshOrder: number): void { this.write({ meshOrder }); }
  setDepthOffset(depthOffset: boolean): void { this.write({ depthOffset }); }
  setSymbolOverride(symbol: string, archive?: string, sourceSymbol?: string): void {
    this.withAppearance(`archive-symbol:${symbol}`, { kind: 'archive-symbol', symbol, archive, sourceSymbol });
  }
  setSymbolHidden(symbol: string, hidden: boolean): void {
    this.withAppearance(`archive-hidden:${symbol}`, { kind: 'archive-hidden', symbol, hidden });
  }
  setBuildArchive(archive: string): void { this.withAppearance('archive-build', { kind: 'archive-build', archive }); }
  /** Declares an effect under `key`; declaring the key again replaces it. */
  attachFx(key: string, fx: FxJson): void { this.fxDeclared.set(new Map(this.fxDeclared.peek()).set(key, fx)); }
  detachFx(key: string): void {
    const fx = new Map(this.fxDeclared.peek());
    fx.delete(key);
    this.fxDeclared.set(fx);
  }
  /** Declares that the animation is this signal's value; the display keeps it so. Undefined ends it. */
  followAnimation(source: ReadonlySignal<string | number> | undefined): void { this.followed.set(source); }

  hideLayer(layer: string): void { this.withAppearance(`layer:${layer}`, { kind: 'layer', layer, hidden: true }); }
  showLayer(layer: string): void { this.withAppearance(`layer:${layer}`, { kind: 'layer', layer, hidden: false }); }
  setSymbolOverrides(overrides: SymbolOverrideMap, hiddenLayers: readonly string[] = []): void {
    this.withAppearance('symbols', { kind: 'symbols', overrides, hiddenLayers });
  }
  overrideSymbol(symbol: string, override: SymbolOverrideValue): void {
    this.withAppearance(`symbol:${symbol}`, { kind: 'symbol', symbol, override });
  }
  addOverrideBuild(name: string, override: LoadedBuildOverride): void {
    this.withAppearance(`build:${name}`, { kind: 'build', name, override });
  }
  clearOverrideBuild(name: string): void {
    this.withAppearance(`build:${name}`, { kind: 'build', name, override: undefined });
  }
}

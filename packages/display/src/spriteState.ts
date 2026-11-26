import {
  createMemo,
  createSignal,
  LazySignal,
  readonlySignal,
  type ReadonlySignal,
  type Signal,
} from '@dontstarve-web/signals';
import * as THREE from 'three';
import {
  hasOceanShading,
  NO_OCEAN_SHADING,
  sameOceanShading,
  type SpriteOceanShading,
} from '@dontstarve-web/animation/oceanShading';
import type { AnimStateArt, AnimStateJson, SymbolBuild } from '@dontstarve-web/animation/animState';
import type { SpriteMaterialOptions } from '@dontstarve-web/animation/animationAssets';
import type { FxJson } from './fxAttachments';
import type { FollowerFx } from './followerFx';
import type {
  LayerAnimationController,
  LoadedBuildOverride,
  PercentAnimationController,
  TransientSpriteAnimationController,
  SpriteArtSource,
  SpriteTint,
} from '@dontstarve-web/animation/sprite';
import type { ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { ArchiveSpriteSource } from './displayEngine';

type SymbolOverrideValue = Parameters<ArchiveSprite['overrideSymbol']>[1];
type SymbolOverrideMap = Parameters<ArchiveSprite['setSymbolOverrides']>[0];

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
  /** The ANIM assets the entity declares: AnimState:PlayAnimation finds a clip of `bank` in any of them. */
  readonly animationArchives: readonly string[];
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
  /** AnimState with no animation playing (bank and build only): nothing is drawn until a clip is played. */
  readonly none?: true;
}

const ANIM_STATE_SLOT = 'anim-state:';
type AnimStateAppearance = Extract<AppearanceJson, { kind: 'anim-state' }>;

/** The entity's own AnimState first, then the slots other entities declared on it, in the order they were declared. */
export function animStateDeclarations(
  appearance: SpriteJson['appearance'],
): readonly (readonly [string, AnimStateAppearance])[] {
  const own = appearance.get('anim-state');
  const declared: (readonly [string, AnimStateAppearance])[] = own?.kind === 'anim-state' ? [['anim-state', own]] : [];
  for (const [key, op] of appearance) {
    if (op.kind === 'anim-state' && key.startsWith(ANIM_STATE_SLOT)) {
      declared.push([key, op]);
    }
  }
  return declared;
}

/** Appearance that belongs to the entity and is dressed again on every drawn sprite. */
export type AppearanceJson =
  | { readonly kind: 'skin'; readonly skin: SkinJson }
  /**
   * The declaring AnimState's own json signal, which the display follows; it loads the archives the state names from `art`,
   * the declaring entity's resource owner.
   */
  | { readonly kind: 'anim-state'; readonly state: ReadonlySignal<AnimStateJson>; readonly art?: AnimStateArt }
  | { readonly kind: 'layer'; readonly layer: string; readonly hidden: boolean }
  | { readonly kind: 'symbols'; readonly overrides: SymbolOverrideMap; readonly hiddenLayers: readonly string[] }
  | { readonly kind: 'symbol'; readonly symbol: string; readonly override: SymbolOverrideValue }
  | {
      readonly kind: 'archive-symbol';
      readonly symbol: string;
      readonly archive?: string;
      readonly sourceSymbol?: string;
    }
  | { readonly kind: 'archive-hidden'; readonly symbol: string; readonly hidden: boolean }
  | { readonly kind: 'archive-build'; readonly archive: string }
  | { readonly kind: 'build'; readonly name: string; readonly override: LoadedBuildOverride | undefined };

/**
 * The snow symbol's sources for standardcomponents.lua UpdateLunarHailBuildup, named by the prefab's schema, and the
 * lunarhailbuildup component's read-only IsBuildupWorkable.
 */
export interface LunarHailBuildupJson {
  /** The archive OverrideSymbol(symbol, build, source) reads the sources from. */
  readonly archive: string;
  readonly symbol: string;
  /** The source while there is no workable buildup. */
  readonly snow: string;
  /** The source while only buildup is workable. */
  readonly buildup: string;
  /** The source while there is workable buildup and the world is snow covered. */
  readonly snowyBuildup: string;
  readonly workable: ReadonlySignal<boolean>;
}

/** mushtree.lua's networked acid look: `_smoke_number` (0 none, 1-3 that glob, 4 all) and `_bloomed`. */
export interface AcidGlobsJson {
  readonly smokeNumber: ReadonlySignal<number>;
  readonly bloomed: ReadonlySignal<boolean>;
}

/** The glob symbols an AcidGlobsJson shows, by symbol: true when shown. */
export type AcidGlobLook = ReadonlyMap<string, boolean>;

/**
 * mushtree.lua try_acid_art_update's ShowSymbol / HideSymbol, from the values it networks: glob i shows when every
 * glob does (4) or the smoke number is i, as swap_acidglob_bloom<i> while bloomed and swap_acidglob<i> otherwise.
 */
export function acidGlobLook(smokeNumber: number, bloomed: boolean): AcidGlobLook {
  const look = new Map<string, boolean>();
  for (let i = 1; i <= 3; i++) {
    const shown = smokeNumber === 4 || smokeNumber === i;
    look.set(`swap_acidglob${i}`, shown && !bloomed);
    look.set(`swap_acidglob_bloom${i}`, shown && bloomed);
  }
  return look;
}

/** What the display draws on a SnowCovered entity's `snow` layer: whether it is shown, and its symbol override. */
export interface SnowLook {
  readonly shown: boolean;
  readonly override?: { readonly archive: string; readonly symbol: string; readonly source: string };
}

/**
 * standardcomponents.lua UpdateLunarHailBuildup: snow alone keeps `snow`, buildup alone uses `lunarhail_buildup`, both
 * use `lunarhail_snow_buildup`, and neither hides the layer. Without a buildup declaration, MakeSnowCovered's look.
 */
export function snowLook(snowCovered: boolean, hail?: LunarHailBuildupJson, workable = false): SnowLook {
  if (!hail) {
    return { shown: snowCovered };
  }
  const source = workable ? (snowCovered ? hail.snowyBuildup : hail.buildup) : hail.snow;
  return { shown: snowCovered || workable, override: { archive: hail.archive, symbol: hail.symbol, source } };
}

/** active: drawn and in the scene; asleep: nothing drawn and out of the scene; removed: everything released. */
export type PrefabStatus = 'active' | 'asleep' | 'removed';

/** What an entity looks like, as plain data. The prefab writes it through its `SpriteState`. */
export interface SpriteDeclaration {
  readonly skinId?: string;
  readonly clip: ClipJson;
  readonly source?: SpriteSourceJson;
  readonly tint?: SpriteTint;
  /** `fx` is drawn at the follower's node by the display, which loads its art. */
  readonly followers?: ReadonlyMap<
    THREE.Object3D,
    { readonly symbol: string; readonly x: number; readonly y: number; readonly fx?: FollowerFx }
  >;
  /** Turned to the camera by the display: the source's default orientation, unlike OnGround art. Declared at creation. */
  readonly billboard?: boolean;
  /**
   * The entity only plays clips of this archive, from their start: no queue, frame, skin, appearance, tint, facing,
   * followers or effects of its own, which SpriteState refuses. The display chooses how to draw it from that promise.
   * Declared at creation.
   */
  readonly plainClips?: ArchiveSpriteSource;
  /**
   * MakeSnowCoveredPristine: the entity carries the SnowCovered tag, and the display shows or hides its `snow` layer by
   * the world's issnowcovered as TheSim:HandleAllSnowSymbols does. Declared at creation.
   */
  readonly snowCovered?: true;
  /**
   * MakeLunarHailBuildup on a SnowCovered entity: standardcomponents.lua UpdateLunarHailBuildup's look, which the
   * display derives from this and the world's issnowcovered. Declared at creation.
   */
  readonly lunarHailBuildup?: LunarHailBuildupJson;
  /**
   * mushtree.lua's acid globs: the display shows swap_acidglob<i> / swap_acidglob_bloom<i> from the entity's
   * `_smoke_number` and `_bloomed`, as its client does on acidphasedirty / bloomeddirty. Declared at creation.
   */
  readonly acidGlobs?: AcidGlobsJson;
  readonly queue: readonly { readonly name: string; readonly loop: boolean }[];
  /** A frame of the clip, or `at`, a fraction of its length that the display resolves once the clip's art has loaded. */
  readonly frame?: number | { readonly at: number };
  /** A fresh object is one more request for a brief feedback clip. */
  readonly transient?: { readonly name: string };
  readonly facing?: number;
  /** Transform:SetEightFaced with this logical rotation; the display selects the view from its camera input. */
  readonly facingRotation?: number;
  readonly facingMode?: 4 | 6 | 8;
  /** AnimState playback speed; animation owns elapsed time. */
  readonly playbackRate?: number;
  /** An externally driven pose, such as physical jump progress; only the named clip is held. */
  readonly frameSource?: { readonly name: string; readonly progress: ReadonlySignal<number | undefined> };
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
  /** AnimState:SetLayer(LAYER_BACKGROUND) on billboard art: drawn by meshOrder with the ground layers, not depth-sorted. */
  readonly background?: boolean;
  /** A positive AnimState:SetFinalOffset: drawn after what shares its foot point (foot sort layer 2). */
  readonly depthOffset?: boolean;
  /** AnimState:SetFinalOffset(-1) on a standalone entity: it sorts before what shares its foot point, such as a sitter. */
  readonly behindFoot?: boolean;
  /** Height of the drawn sprite above the entity's foot point, such as thrown loot in the air. The transform stays on the ground. */
  readonly visualHeight?: number;
  /**
   * AnimState:SetFloatParams(offset, enabled, bob) and SetOceanBlendParams(amount), as anim.ksh's FLOAT_PARAMS and
   * OCEAN_BLEND_PARAMS.x. Absent while neither is set.
   */
  readonly oceanShading?: SpriteOceanShading;
  readonly appearance: ReadonlyMap<string, AppearanceJson>;
}

/** What the display draws: the entity's declaration in the entity's lifecycle, derived from both. */
export interface SpriteJson extends SpriteDeclaration {
  readonly status: PrefabStatus;
}

/** The effects of a sprite that has attached none; attachFx and detachFx write new maps. */
const NO_FX: ReadonlyMap<string, FxJson> = new Map();

/** The lifecycle of a sprite that no entity has bound its own to. */
const ALWAYS_ACTIVE: ReadonlySignal<PrefabStatus> = readonlySignal(createSignal<PrefabStatus>('active'));

/** What the drawn sprite answers; set by the display while it has one. */
export interface SpriteProbe {
  readonly currentAnimation: string;
  readonly numFrames: number;
  readonly currentAnimationLength: number;
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
  /** The entity falls asleep: what was playing ends in its completion state. */
  settleAsleep(): void;
  /** The entity binds its lifecycle, which the json it is drawn from carries. */
  bindStatus(status: ReadonlySignal<PrefabStatus>): void;
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
  facePoint(from: THREE.Vector3, to: THREE.Vector3): void;
  setColour(colour: readonly number[]): void;
  /** AnimState:SetAddColour's rgb. */
  setAddColour(add: readonly number[]): void;
  setOpacity(opacity: number): void;
  /** null clears it: the model keeps no minimum light. */
  setLightOverride(value: number | null): void;
  setPaused(paused: boolean): void;
  setVisible(visible: boolean): void;
  setErosion(amount: number): void;
  /** AnimState:SetFloatParams(offset, enabled, bob): bob at the waterline and cut what lies below it. */
  setFloatParams(offset: number, enabled: number, bob: number): void;
  /** AnimState:SetOceanBlendParams(amount): multiply the colour by the ocean's under it by `amount`. */
  setOceanBlendParams(amount: number): void;
  setSymbolOverride(symbol: string, archive?: string, sourceSymbol?: string): void;
  setSymbolHidden(symbol: string, hidden: boolean): void;
  hideLayer(layer: string): void;
  showLayer(layer: string): void;
  /** MakeSnowCoveredPristine's SnowCovered tag, as the engine reads it: the `snow` layer follows issnowcovered. */
  setSnowCovered(): void;
  /** MakeLunarHailBuildup on a SnowCovered entity: the `snow` layer also follows the component's workable buildup. */
  setLunarHailBuildup(hail: LunarHailBuildupJson): void;
  /** mushtree.lua's acid globs, which the display shows from the declared smoke number and bloom. */
  setAcidGlobs(globs: AcidGlobsJson): void;
  setBuildArchive(archive: string): void;
  setGround(renderOrder: number, flat?: boolean): void;
  setMeshOrder(order: number): void;
  /** AnimState:SetLayer: LAYER_BACKGROUND leaves the depth-sorted world layer, keeping the art's orientation. */
  setLayer(layer: 'world' | 'background'): void;
  setDepthOffset(enabled: boolean): void;
  setBehindFoot(enabled: boolean): void;
  attachFx(key: string, fx: FxJson): void;
  detachFx(key: string): void;
  followAnimation(source: ReadonlySignal<string | number> | undefined): void;
}

/**
 * The prefab-side sprite of an entity: animation commands become a `SpriteJson` snapshot, and nothing here touches a
 * model. It offers the controller surface prefabs already call, so a prefab changes the json and the display reacts.
 */
/** The first clip of a presentation, declared by the entity's constructor or by a new presentation of it. */
export interface SpriteClipDeclaration {
  readonly name: string;
  readonly held?: boolean;
  readonly none?: boolean;
  readonly billboard?: boolean;
  /** The entity promises to only play clips of this archive: see SpriteDeclaration.plainClips. */
  readonly plainClips?: ArchiveSpriteSource;
}

/** What a plain-clip entity may write, and the value each must keep but `clip`. */
const PLAIN_CLIP_WRITES: ReadonlySet<string> = new Set(['clip', 'queue', 'frame']);

function assertPlainClipWrite(patch: Partial<SpriteDeclaration>): void {
  for (const key of Object.keys(patch)) {
    if (!PLAIN_CLIP_WRITES.has(key)) {
      throw new Error(`A plain-clip sprite does not declare \`${key}\``);
    }
  }
  if ((patch.queue !== undefined && patch.queue.length > 0) || patch.frame !== undefined) {
    throw new Error('A plain-clip sprite plays its clips from their start, with nothing queued');
  }
}

function initialJson(clip: SpriteClipDeclaration): SpriteDeclaration {
  return {
    clip: clip.none
      ? { name: clip.name, loop: false, finished: true, none: true }
      : { name: clip.name, loop: !clip.held, finished: clip.held === true },
    queue: [],
    appearance: new Map(),
    ...(clip.billboard ? { billboard: true } : {}),
    ...(clip.plainClips ? { plainClips: clip.plainClips } : {}),
  };
}

export class SpriteState
  implements
    ArchiveSpriteCommands,
    TransientSpriteAnimationController,
    PercentAnimationController,
    LayerAnimationController
{
  private readonly declared: Signal<SpriteDeclaration>;
  /** The lifecycle of the entity this sprite belongs to; the entity binds its own. */
  private readonly lifecycle = createSignal(ALWAYS_ACTIVE);
  /** Snapshots of the entity's sprite in its lifecycle, derived from both; the display subscribes to this alone. */
  readonly sprite: ReadonlySignal<SpriteJson>;
  /** A projection of json.skinId for existing skin consumers; it stores no second value. */
  readonly skinId: Signal<string | undefined>;
  /** No signal until the first attachFx: most entities never attach an effect. */
  private readonly fxDeclared = new LazySignal<ReadonlyMap<string, FxJson>>(NO_FX);
  /** Effects shown on the entity while their `active` signal is true; apart from `sprite`, so a clip change does not reach them. */
  get fx(): ReadonlySignal<ReadonlyMap<string, FxJson>> {
    return this.fxDeclared;
  }
  /** The declared effects, read without declaring them. */
  peekFx(): ReadonlyMap<string, FxJson> {
    return this.fxDeclared.peek();
  }
  /** Runs `listener` once the entity first attaches an effect; the display follows `fx` from then on. */
  whenFxDeclared(listener: () => void): () => void {
    return this.fxDeclared.whenDeclared(listener);
  }
  /** No signal until the first followAnimation. */
  private readonly followed = new LazySignal<ReadonlySignal<string | number> | undefined>(undefined);
  /** The clip follows this signal's value for as long as it is declared. */
  get animationSource(): ReadonlySignal<ReadonlySignal<string | number> | undefined> {
    return this.followed;
  }
  /** Runs `listener` once the entity first follows an animation source. */
  whenAnimationFollowed(listener: () => void): () => void {
    return this.followed.whenDeclared(listener);
  }
  private artVersion: number | LazySignal<number> = 0;
  /** Changes whenever the drawn sprite is attached or released; owners dress what they keep outside the json after it. */
  get art(): ReadonlySignal<number> {
    return (this.artVersion = typeof this.artVersion === 'number' ? new LazySignal(this.artVersion) : this.artVersion);
  }
  protected initialAnimation: string;
  private probe: SpriteProbe | undefined;

  /**
   * `held` marks an initial clip shown on its last frame; `none` starts with no animation playing, as an AnimState that
   * was given only a bank and build; `billboard` entities face the camera.
   */
  constructor(clip: SpriteClipDeclaration) {
    this.initialAnimation = clip.name;
    this.declared = createSignal(initialJson(clip));
    this.sprite = readonlySignal(
      createMemo<SpriteJson>(() => ({ ...this.declared.get(), status: this.lifecycle.get().get() })),
    );
    this.skinId = {
      get: () => this.declared.get().skinId,
      peek: () => this.state.skinId,
      set: value => this.setSkinId(value),
    };
  }

  /**
   * A new presentation of the same entity, as an item dropped on the ground again: its new visual declares the clip and
   * appearance afresh, and the skin, which belongs to the entity, stays. The previous presentation's pending clip
   * callbacks, effects and followed animation are dropped with it.
   */
  resetPresentation(clip: SpriteClipDeclaration): void {
    const { skinId } = this.state;
    this.initialAnimation = clip.name;
    this.declared.set({ ...initialJson(clip), ...(skinId === undefined ? {} : { skinId }) });
    // An entity that never attached an effect keeps no signal for it.
    if (this.fxDeclared.declared) {
      this.fxDeclared.set(NO_FX);
    }
    this.followed.set(undefined);
  }

  /** The entity's lifecycle, owned by the entity: its sprite is drawn in it. */
  bindStatus(status: ReadonlySignal<PrefabStatus>): void {
    this.lifecycle.set(status);
  }
  private get state(): SpriteDeclaration {
    return this.declared.peek();
  }
  protected write(patch: Partial<SpriteDeclaration>): void {
    if (this.state.plainClips) {
      assertPlainClipWrite(patch);
    }
    this.declared.set({ ...this.state, ...patch });
  }
  setSkinId(skinId: string | undefined): void {
    if (skinId !== this.state.skinId) {
      this.write({ skinId });
    }
  }
  setSkinSource(skin: SkinJson): void {
    this.withAppearance('skin', { kind: 'skin', skin });
  }
  /** The skins the declared skin source can draw, in its order: PREFAB_SKINS for this entity. */
  get skinNames(): readonly string[] {
    const declared = this.state.appearance.get('skin');
    return declared?.kind === 'skin' ? Object.keys(declared.skin.archives) : [];
  }
  private withAppearance(key: string, value: AppearanceJson): void {
    const appearance = new Map(this.state.appearance);
    // A later command for the same target replaces the earlier one and is dressed last.
    appearance.delete(key);
    appearance.set(key, value);
    this.write({ appearance });
  }

  /** The display reports which drawn sprite answers questions about the entity, and when the drawn sprite changes. */
  bind(probe: SpriteProbe | undefined): void {
    this.probe = probe;
    this.displayPending = false;
  }
  /**
   * The display has built its first sprite, or is still loading its art. What was played or pushed while it was pending
   * (the entity's OnLoad and onSpawned) settles now if nothing is drawn, as it would have on a display whose art was
   * loading, and plays on otherwise; fn's own clips were played before any display, so they play.
   */
  displayStarted(): void {
    if (!this.playedWhilePending) {
      return;
    }
    this.playedWhilePending = false;
    const { clip, queue } = this.state;
    if (this.probe && !this.drawn && (queue.length > 0 || (!clip.loop && !clip.finished && !clip.none))) {
      this.settle();
    }
  }
  /**
   * A display starts once the entity's fn, OnLoad and onSpawned have run: until it binds, followers get their nodes and
   * what they play waits for it, which settles or draws it as its art is loaded or not.
   */
  bindPendingDisplay(): void {
    const state = this;
    this.displayPending = true;
    this.playedWhilePending = false;
    this.probe = {
      get currentAnimation() {
        return state.state.clip.name;
      },
      numFrames: 0,
      currentAnimationLength: 0,
      loaded: false,
      update() {},
      createFollower: () => new THREE.Object3D(),
    };
  }
  private displayPending = false;
  private playedWhilePending = false;
  artChanged(): void {
    const version = this.artVersion;
    if (typeof version === 'number') {
      this.artVersion = version + 1;
    } else {
      version.set(version.peek() + 1);
    }
  }

  get loaded(): boolean {
    return this.probe?.loaded ?? false;
  }
  get currentAnimation(): string {
    return this.probe?.currentAnimation ?? this.state.clip.name;
  }
  get numFrames(): number {
    return this.probe?.numFrames ?? 0;
  }
  get currentAnimationLength(): number {
    return this.probe?.currentAnimationLength ?? 0;
  }
  update(dt: number): void {
    this.probe?.update(dt);
  }

  /** Nothing is drawn while the entity sleeps; a transition that was playing is not replayed but ends in its completion state. */
  settleAsleep(): void {
    this.settle();
  }
  // Drawn only while the entity is active. Playing no animation, the sprite is built for the next clip, which is drawn rather than settled.
  private get drawn(): boolean {
    return (
      this.lifecycle.peek().peek() === 'active' &&
      (this.state.clip.none === true || this.displayPending || (this.probe?.loaded ?? true))
    );
  }
  /** The completion state: the clip completes, and what was queued behind it is the clip now. */
  private settle(): void {
    const { clip, queue } = this.state;
    this.finish(clip);
    const last = queue[queue.length - 1];
    if (last) {
      this.write({ clip: { name: last.name, loop: last.loop, finished: !last.loop }, queue: [], frame: undefined });
    }
  }

  /** A clip's playback ended, or was settled because nothing is drawn: it completes once. */
  finish(clip: ClipJson): void {
    if (this.state.clip !== clip || clip.finished) {
      return;
    }
    clip.finished = true;
    clip.complete?.();
  }

  start(name: string): void {
    this.write({ clip: { name, loop: true, finished: false }, queue: [], frame: undefined });
  }
  playOnce(name: string, complete?: () => void): void {
    const clip: ClipJson = { name, loop: false, finished: false, complete },
      drawn = this.drawn;
    if (this.displayPending) {
      this.playedWhilePending = true;
    }
    this.write({ clip, queue: [], frame: undefined });
    // Nothing is drawn, so the transition completes at once.
    if (!drawn) {
      this.finish(clip);
    }
  }
  /** AnimState with no animation playing: the drawn sprite is released until a clip is played again. */
  clearAnimation(): void {
    this.write({
      clip: { name: this.initialAnimation, loop: false, finished: true, none: true },
      queue: [],
      frame: undefined,
    });
  }
  pushAnimation(name: string, loop = false): void {
    this.write({ queue: [...this.state.queue, { name, loop }] });
    if (this.displayPending) {
      this.playedWhilePending = true;
    }
    if (!this.drawn) {
      this.settle();
    }
  }
  playTransient(name: string): void {
    this.write({ transient: { name } });
  }
  holdLastFrame(name: string): void {
    this.write({ clip: { name, loop: false, finished: true }, queue: [], frame: undefined });
  }
  setPercent(name: string, percent: number): void {
    this.write({ clip: { name, loop: false, finished: true, percent }, queue: [], frame: undefined });
  }
  setFrame(frame: number): void {
    if (frame !== this.state.frame) {
      this.write({ frame });
    }
  }
  setFrameAt(fraction: number): void {
    if (!(fraction >= 0 && fraction <= 1)) {
      throw new RangeError('Frame fraction must be within [0, 1]');
    }
    this.write({ frame: { at: fraction } });
  }
  setArtSource(source: SpriteSourceJson): void {
    if (source !== this.state.source) {
      this.write({ source });
    }
  }
  /** The entity's own AnimState, by its json signal: the display follows it rather than a copy. */
  setAnimState(state: ReadonlySignal<AnimStateJson>, art?: AnimStateArt): void {
    this.withAppearance('anim-state', { kind: 'anim-state', state, art });
  }
  /**
   * Another entity's AnimState on this one, by its json signal, as an equipped item names its owner's symbols. It is drawn
   * over the entity's own (`setAnimState`) and over the slots declared before it; declaring it again keeps its place, and
   * undefined removes it.
   */
  declareAnimState(key: string, state: ReadonlySignal<AnimStateJson> | undefined, art?: AnimStateArt): void {
    const slot = `${ANIM_STATE_SLOT}${key}`,
      appearance = new Map(this.state.appearance);
    if (state) {
      appearance.set(slot, { kind: 'anim-state', state, art });
    } else if (!appearance.delete(slot)) {
      return;
    }
    this.write({ appearance });
  }
  /** Wortox's blend tint; AnimState:SetAddColour's rgb, which setAddColour declares, is kept. */
  setTint(tint: SpriteTint): void {
    const add = this.state.tint?.add;
    this.write({ tint: add ? { ...tint, add } : tint });
  }
  /** AnimState:SetAddColour(r, g, b, a): added to the art in proportion to its alpha; any blend tint is kept. */
  setAddColour(add: readonly number[]): void {
    const tint = this.state.tint ?? { colour: [0, 0, 0], amount: 0 };
    if (tint.add?.every((value, i) => value === add[i]) ?? add.every(value => value === 0)) {
      return;
    }
    this.write({ tint: { ...tint, add: [add[0], add[1], add[2]] } });
  }
  followSymbol(
    symbol: string,
    x: number,
    y: number,
    fx?: FollowerFx,
  ): { readonly node: THREE.Object3D; remove(): void } {
    const node = this.probe?.createFollower?.();
    if (!node) {
      throw new Error('The sprite has no display for a symbol follower');
    }
    this.write({ followers: new Map(this.state.followers).set(node, { symbol, x, y, ...(fx ? { fx } : {}) }) });
    return {
      node,
      remove: () => {
        const followers = new Map(this.state.followers);
        followers.delete(node);
        this.write({ followers });
      },
    };
  }
  setFacing(facing: number, mirrored?: boolean): void {
    if (facing !== this.state.facing || mirrored !== this.state.mirrored || this.state.facingRotation !== undefined) {
      this.write({ facing, mirrored, facingRotation: undefined });
    }
  }
  setFacingRotation(rotation: number, facingMode: 4 | 6 | 8 = 8): void {
    if (rotation !== this.state.facingRotation || facingMode !== this.state.facingMode) {
      this.write({ facingRotation: rotation, facingMode, facing: undefined, mirrored: undefined });
    }
  }
  /** World-space direction; coincident points preserve the previous logical heading. */
  facePoint(from: THREE.Vector3, to: THREE.Vector3): void {
    const x = to.x - from.x,
      z = to.z - from.z;
    if (x * x + z * z > 1e-8) {
      this.setFacingRotation((Math.atan2(-z, x) * 180) / Math.PI, this.state.facingMode);
    }
  }
  setPlaybackRate(playbackRate: number): void {
    if (playbackRate !== this.state.playbackRate) {
      this.write({ playbackRate });
    }
  }
  setFrameSource(frameSource: SpriteJson['frameSource']): void {
    this.write({ frameSource });
  }
  setColour(colour: readonly number[]): void {
    this.write({ colour });
  }
  setOpacity(opacity: number): void {
    this.write({ opacity });
  }
  setLightOverride(lightOverride: number | null): void {
    this.write({ lightOverride: lightOverride ?? undefined });
  }
  setPaused(paused: boolean): void {
    this.write({ paused });
  }
  setVisible(visible: boolean): void {
    this.write({ visible });
  }
  setFloatParams(offset: number, enabled: number, bob: number): void {
    this.writeOceanShading({ float: [offset, enabled, bob], blend: this.state.oceanShading?.blend ?? 0 });
  }
  setOceanBlendParams(amount: number): void {
    this.writeOceanShading({ float: this.state.oceanShading?.float ?? NO_OCEAN_SHADING.float, blend: amount });
  }
  private writeOceanShading(shading: SpriteOceanShading): void {
    const current = this.state.oceanShading ?? NO_OCEAN_SHADING;
    if (sameOceanShading(current, shading)) {
      return;
    }
    this.write({ oceanShading: hasOceanShading(shading) ? Object.freeze(shading) : undefined });
  }
  setErosion(erosion: number): void {
    this.write({ erosion });
  }
  /**
   * Display-only orientation and the entity's group order. The terrain is drawn at group order 0 and ordered by its
   * meshes, so a negative group order would put the entity under every turf layer: ground art takes order 0 (or above)
   * and places itself among the ground layers with `setMeshOrder`.
   */
  setGround(renderOrder: number, flat = true): void {
    if (!(renderOrder >= 0)) {
      throw new RangeError(`Ground group order ${renderOrder} draws under the terrain; use setMeshOrder`);
    }
    this.write({ ground: { renderOrder, flat } });
  }
  setMeshOrder(meshOrder: number): void {
    this.write({ meshOrder });
  }
  setLayer(layer: 'world' | 'background'): void {
    const background = layer === 'background' ? true : undefined;
    if (background !== this.state.background) {
      this.write({ background });
    }
  }
  setVisualHeight(visualHeight: number): void {
    if (visualHeight !== (this.state.visualHeight ?? 0)) {
      this.write({ visualHeight });
    }
  }
  setDepthOffset(depthOffset: boolean): void {
    this.write({ depthOffset });
  }
  setBehindFoot(behindFoot: boolean): void {
    if (behindFoot !== (this.state.behindFoot ?? false)) {
      this.write({ behindFoot });
    }
  }
  setSymbolOverride(symbol: string, archive?: string, sourceSymbol?: string): void {
    this.withAppearance(`archive-symbol:${symbol}`, { kind: 'archive-symbol', symbol, archive, sourceSymbol });
  }
  setSymbolHidden(symbol: string, hidden: boolean): void {
    this.withAppearance(`archive-hidden:${symbol}`, { kind: 'archive-hidden', symbol, hidden });
  }
  setBuildArchive(archive: string): void {
    this.withAppearance('archive-build', { kind: 'archive-build', archive });
  }
  /** Declares an effect under `key`; declaring the key again replaces it. */
  attachFx(key: string, fx: FxJson): void {
    this.assertNotPlain('effects');
    this.fxDeclared.set(new Map(this.fxDeclared.peek()).set(key, fx));
  }
  detachFx(key: string): void {
    const fx = new Map(this.fxDeclared.peek());
    fx.delete(key);
    this.fxDeclared.set(fx);
  }
  /** Declares that the animation is this signal's value; the display keeps it so. Undefined ends it. */
  followAnimation(source: ReadonlySignal<string | number> | undefined): void {
    this.assertNotPlain('a followed animation');
    this.followed.set(source);
  }

  private assertNotPlain(what: string): void {
    if (this.state.plainClips) {
      throw new Error(`A plain-clip sprite declares no ${what}`);
    }
  }

  hideLayer(layer: string): void {
    this.withAppearance(`layer:${layer}`, { kind: 'layer', layer, hidden: true });
  }
  showLayer(layer: string): void {
    this.withAppearance(`layer:${layer}`, { kind: 'layer', layer, hidden: false });
  }
  setSnowCovered(): void {
    if (!this.state.snowCovered) {
      this.write({ snowCovered: true });
    }
  }
  setLunarHailBuildup(hail: LunarHailBuildupJson): void {
    this.write({ snowCovered: true, lunarHailBuildup: hail });
  }
  setAcidGlobs(acidGlobs: AcidGlobsJson): void {
    this.write({ acidGlobs });
  }
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

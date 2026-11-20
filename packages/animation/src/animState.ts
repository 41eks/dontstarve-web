import type * as THREE from 'three';
import { createSignal, readonlySignal } from '@dontstarve-web/signals';
import { findImage, smallHash, type AnimElement, type Matrix2D, type ParsedAnim, type ParsedBuild, type ResolvedSprite } from './animationAssets';

/** A loaded build, as the display resolves a named one. */
export interface SymbolBuild { readonly build: ParsedBuild; readonly materials: THREE.MeshBasicMaterial[] }

/**
 * The archives an AnimState names, cached by the entity's resource owner. Prefabs only name archives; the display
 * reads what has loaded and loads the rest.
 */
export interface AnimStateArt {
  peekBuild(archive: string): SymbolBuild | undefined;
  loadBuild(archive: string): Promise<SymbolBuild>;
  peekAnimation(archive: string): ParsedAnim | undefined;
  loadAnimation(archive: string): Promise<ParsedAnim>;
}

/** A build named as in Lua (`swap_torch`) or by its archive (`dynamic/torch_spooky.zip`). */
export type SymbolSource = string | readonly string[];
export interface AnimationAttachment {
  update(dt: number): void;
  readonly isAnimating: boolean;
}

/** OverrideSymbol: the first source whose build has its symbol is drawn. */
export interface SymbolOverrideJson { readonly sources: readonly { readonly archive: string; readonly symbol: number }[] }
/** A symbol drawn as clip `${animation}${anchor frame + 1}` of `bank`, from `builds`, at the anchor's transform. */
export interface SymbolAnimationJson {
  readonly bank: string;
  readonly animation: string;
  readonly builds: readonly string[];
  readonly symbols?: readonly number[];
}

/** Immutable appearance snapshot: plain declarations, apart from the time attachments of equipped pieces. */
export interface AnimStateJson {
  readonly overrides: ReadonlyMap<number, SymbolOverrideJson>;
  /** AddOverrideBuild: whole builds, in declaration order, beneath explicit symbol overrides. */
  readonly overrideBuilds?: readonly string[];
  readonly hiddenLayers: ReadonlySet<number>;
  readonly hiddenSymbols: ReadonlySet<number>;
  /** Show/ShowSymbol: merged over another declaration, these are shown even where the one below hides them. */
  readonly shownLayers?: ReadonlySet<number>;
  readonly shownSymbols?: ReadonlySet<number>;
  /** AnimState:SetSymbolLightOverride: the minimum light of each listed symbol's parts. */
  readonly symbolLightOverrides: ReadonlyMap<number, number>;
  readonly symbolAnimations: ReadonlyMap<number, SymbolAnimationJson>;
  /** SetBloomEffectHandle, approximated by a halo drawn behind each listed symbol. */
  readonly blooms: ReadonlySet<number>;
  readonly attachments: readonly AnimationAttachment[];
}

interface ResolvedSymbolAnimation {
  readonly animations: ParsedAnim;
  readonly builds: readonly SymbolBuild[];
  readonly animation: string;
  readonly symbols?: ReadonlySet<number>;
}

/** An AnimStateJson with its named art resolved; an undefined entry is still loading and draws nothing. */
export interface ResolvedAnimState extends Omit<AnimStateJson, 'overrides' | 'overrideBuilds' | 'symbolAnimations'> {
  readonly overrides: ReadonlyMap<number, readonly { readonly build: SymbolBuild; readonly symbol: number }[] | undefined>;
  readonly overrideBuilds?: readonly SymbolBuild[];
  readonly symbolAnimations: ReadonlyMap<number, ResolvedSymbolAnimation | undefined>;
}

/** Resolves a snapshot against loaded art and lists the archives that are not loaded yet. */
export function resolveAnimState(state: AnimStateJson, art: AnimStateArt | undefined): {
  state: ResolvedAnimState; missing: { builds: Set<string>; animations: Set<string> };
} {
  const missing = { builds: new Set<string>(), animations: new Set<string>() };
  const build = (archive: string) => {
    if (!art) { throw new Error(`AnimState names ${archive}, but its entity has no art source`); }
    const loaded = art.peekBuild(archive);
    if (!loaded) { missing.builds.add(archive); }
    return loaded;
  };
  const overrides = new Map<number, { build: SymbolBuild; symbol: number }[] | undefined>();
  const overrideBuilds = (state.overrideBuilds ?? []).map(build).filter((value): value is SymbolBuild => value !== undefined);
  for (const [hash, { sources }] of state.overrides) {
    const resolved = sources.map(source => ({ build: build(source.archive), symbol: source.symbol }));
    overrides.set(hash, resolved.every(source => source.build) ? resolved as { build: SymbolBuild; symbol: number }[] : undefined);
  }
  const symbolAnimations = new Map<number, ResolvedSymbolAnimation | undefined>();
  for (const [hash, declared] of state.symbolAnimations) {
    const builds = declared.builds.map(build);
    const animations = art?.peekAnimation(declared.bank);
    if (!animations) { missing.animations.add(declared.bank); }
    symbolAnimations.set(hash, animations && builds.every(Boolean) ? {
      animations, builds: builds as SymbolBuild[], animation: declared.animation,
      ...declared.symbols ? { symbols: new Set(declared.symbols) } : {},
    } : undefined);
  }
  return { state: { ...state, overrides, overrideBuilds, symbolAnimations }, missing };
}

/** AnimStateJson or ResolvedAnimState: the shape mergeAnimStates keeps, whatever its overrides resolve to. */
interface MergeableAnimState<Override, Build, SymbolAnimation> extends Omit<AnimStateJson, 'overrides' | 'overrideBuilds' | 'symbolAnimations'> {
  readonly overrides: ReadonlyMap<number, Override>;
  readonly overrideBuilds?: readonly Build[];
  readonly symbolAnimations: ReadonlyMap<number, SymbolAnimation>;
}

/** Declarations drawn over one another, in order: a later one's overrides and shown or hidden layers and symbols win; the rest add up. */
export function mergeAnimStates<Override, Build, SymbolAnimation>(
  states: readonly MergeableAnimState<Override, Build, SymbolAnimation>[],
): MergeableAnimState<Override, Build, SymbolAnimation> {
  if (states.length === 1) { return states[0]; }
  const overrides = new Map<number, Override>();
  const overrideBuilds: Build[] = [];
  const symbolAnimations = new Map<number, SymbolAnimation>();
  const symbolLightOverrides = new Map<number, number>();
  const hiddenLayers = new Set<number>(), hiddenSymbols = new Set<number>(), blooms = new Set<number>();
  const attachments: AnimationAttachment[] = [];
  for (const state of states) {
    for (const [hash, override] of state.overrides) { overrides.set(hash, override); }
    overrideBuilds.push(...state.overrideBuilds ?? []);
    for (const [hash, animation] of state.symbolAnimations) { symbolAnimations.set(hash, animation); }
    for (const [hash, light] of state.symbolLightOverrides) { symbolLightOverrides.set(hash, light); }
    for (const layer of state.hiddenLayers) { hiddenLayers.add(layer); }
    for (const layer of state.shownLayers ?? []) { hiddenLayers.delete(layer); }
    for (const symbol of state.hiddenSymbols) { hiddenSymbols.add(symbol); }
    for (const symbol of state.shownSymbols ?? []) { hiddenSymbols.delete(symbol); }
    for (const bloom of state.blooms) { blooms.add(bloom); }
    attachments.push(...state.attachments);
  }
  return { overrides, overrideBuilds, hiddenLayers, hiddenSymbols, symbolLightOverrides, symbolAnimations, blooms, attachments };
}

export function animStateVisible(state: Pick<AnimStateJson, 'hiddenLayers' | 'hiddenSymbols'>, element: AnimElement): boolean {
  const group = visibilityGroups.get(element.imageHash);
  return !state.hiddenSymbols.has(element.imageHash) && !state.hiddenLayers.has(element.layerHash)
    && (group === undefined || !state.hiddenLayers.has(group));
}

function compose(parent: Matrix2D, child: Matrix2D): Matrix2D {
  const [a, b, c, d, tx, ty] = parent;
  const [e, f, g, h, ux, uy] = child;
  return [a * e + c * f, b * e + d * f, a * g + c * h, b * g + d * h, a * ux + c * uy + tx, b * ux + d * uy + ty];
}

function resolveImage(builds: readonly SymbolBuild[], element: AnimElement, hash = element.imageHash): ResolvedSprite | undefined {
  const source = builds.find(candidate => candidate.build.symbols.has(hash));
  const image = source && findImage(source.build, hash, element.imageIndex);
  return image && source ? { element, image, materials: source.materials } : undefined;
}

/** The declared art of a symbol, or undefined when the AnimState leaves it to the sprite's own builds. */
export function resolveAnimStateSymbol(state: ResolvedAnimState, element: AnimElement, elapsed: number): ResolvedSprite[] | undefined {
  if (state.symbolAnimations.has(element.imageHash)) {
    const follow = state.symbolAnimations.get(element.imageHash);
    const animation = follow?.animations.animations.find(({ name }) => name === `${follow.animation}${element.imageIndex + 1}`);
    if (!follow || !animation) { return []; }
    const frame = animation.frames[Math.floor(elapsed * animation.frameRate) % animation.frames.length];
    return [...frame.elements].filter(part => !follow.symbols || follow.symbols.has(part.imageHash))
      .sort((a, b) => b.z - a.z)
      .flatMap(part => resolveImage(follow.builds, { ...part, matrix: compose(element.matrix, part.matrix) }) ?? []);
  }
  if (!state.overrides.has(element.imageHash)) {
    for (let index = (state.overrideBuilds?.length ?? 0) - 1; index >= 0; index--) {
      const sprite = resolveImage([state.overrideBuilds![index]], element);
      if (sprite) { return [sprite]; }
    }
    return undefined;
  }
  const sources = state.overrides.get(element.imageHash);
  const source = sources?.find(candidate => candidate.build.build.symbols.has(candidate.symbol));
  const sprite = source && resolveImage([source.build], element, source.symbol);
  return sprite ? [sprite] : [];
}

const visibilityGroups = new Map([
  ['swap_hat', 'HAT'], ['headbase', 'HEAD'], ['headbase_hat', 'HEAD_HAT'],
  ['hair', 'HAIR'], ['hairfront', 'HAIR'], ['hairpigtails', 'HAIR'],
].map(([symbol, layer]) => [smallHash(symbol), smallHash(layer)]));

function withAdded<T>(set: ReadonlySet<T> | undefined, value: T): Set<T> { return new Set(set).add(value); }
function without<T>(set: ReadonlySet<T> | undefined, value: T): Set<T> {
  const next = new Set(set);
  next.delete(value);
  return next;
}
function deleted<K, V>(map: ReadonlyMap<K, V>, key: K): Map<K, V> {
  const next = new Map(map);
  next.delete(key);
  return next;
}

/**
 * AnimState symbol overrides and visibility, independent of prefab IDs and equipment slots. Art is named, not loaded.
 * The Lua-style setters each write a new `json` snapshot that copies only the collection they change.
 */
export class AnimState {
  /** RegisterBuild's names; they only resolve archive names and are not part of the snapshot. */
  private readonly builds = new Map<string, string>();
  private readonly state = createSignal<AnimStateJson>({ overrides: new Map(), overrideBuilds: [], hiddenLayers: new Set(), hiddenSymbols: new Set(),
    shownLayers: new Set(), shownSymbols: new Set(), symbolLightOverrides: new Map(), symbolAnimations: new Map(), blooms: new Set(), attachments: [] });
  readonly json = readonlySignal(this.state);

  private update(patch: (state: AnimStateJson) => Partial<AnimStateJson>): void {
    const state = this.state.peek();
    this.state.set({ ...state, ...patch(state) });
  }
  /** Names a build whose archive is not `<name>.zip`, such as a skin under `dynamic/`. */
  RegisterBuild(name: string, archive: string): void { this.builds.set(name, archive); }
  private archive(build: string): string {
    return this.builds.get(build) ?? (build.endsWith('.zip') ? build : `${build}.zip`);
  }
  private archives(source: SymbolSource): readonly string[] {
    return (typeof source === 'string' ? [source] : source).map(build => this.archive(build));
  }
  /** A build added again moves to the end, above the others. */
  AddOverrideBuild(build: string): void {
    const archive = this.archive(build);
    this.update(({ overrideBuilds = [] }) => ({ overrideBuilds: [...overrideBuilds.filter(other => other !== archive), archive] }));
  }
  ClearOverrideBuild(build: string): void {
    const archive = this.archive(build);
    const { overrideBuilds = [] } = this.state.peek();
    if (overrideBuilds.includes(archive)) { this.update(() => ({ overrideBuilds: overrideBuilds.filter(other => other !== archive) })); }
  }
  OverrideSymbol(symbol: string, build: SymbolSource, sourceSymbol: string): void {
    const hash = smallHash(sourceSymbol);
    this.setOverride(symbol, this.archives(build).map(archive => ({ archive, symbol: hash })));
  }
  /**
   * The skin's symbol, else the fallback build's; a skin without the symbol and no fallback hides it. One skin named as a
   * build (skin_build, as AnimState:GetSkinBuild returns it) is the item skin archive anim/dynamic/<build>.zip; archives
   * and registered builds are used as named.
   */
  OverrideItemSkinSymbol(symbol: string, skin: SymbolSource, sourceSymbol: string, _guid: string, fallback?: SymbolSource, fallbackSymbol = sourceSymbol): void {
    const skinHash = smallHash(sourceSymbol), fallbackHash = smallHash(fallbackSymbol);
    const skins = typeof skin === 'string' && !skin.endsWith('.zip') && !this.builds.has(skin) ? [`dynamic/${skin}.zip`] : this.archives(skin);
    this.setOverride(symbol, [...skins.map(archive => ({ archive, symbol: skinHash })),
      ...(fallback === undefined ? [] : this.archives(fallback).map(archive => ({ archive, symbol: fallbackHash })))]);
  }
  private setOverride(symbol: string, sources: SymbolOverrideJson['sources']): void {
    this.update(({ overrides }) => ({ overrides: new Map(overrides).set(smallHash(symbol), { sources }) }));
  }
  ClearOverrideSymbol(symbol: string): void { this.update(({ overrides }) => ({ overrides: deleted(overrides, smallHash(symbol)) })); }
  Show(layer: string): void {
    const hash = smallHash(layer.toLowerCase());
    this.update(state => ({ hiddenLayers: without(state.hiddenLayers, hash), shownLayers: withAdded(state.shownLayers, hash) }));
  }
  Hide(layer: string): void {
    const hash = smallHash(layer.toLowerCase());
    this.update(state => ({ shownLayers: without(state.shownLayers, hash), hiddenLayers: withAdded(state.hiddenLayers, hash) }));
  }
  ShowSymbol(symbol: string): void {
    const hash = smallHash(symbol);
    this.update(state => ({ hiddenSymbols: without(state.hiddenSymbols, hash), shownSymbols: withAdded(state.shownSymbols, hash) }));
  }
  HideSymbol(symbol: string): void {
    const hash = smallHash(symbol);
    this.update(state => ({ shownSymbols: without(state.shownSymbols, hash), hiddenSymbols: withAdded(state.hiddenSymbols, hash) }));
  }
  /** 0 restores the symbol to the entity's own light. */
  SetSymbolLightOverride(symbol: string, value: number): void {
    const hash = smallHash(symbol), clamped = Math.min(1, Math.max(0, value));
    this.update(({ symbolLightOverrides }) => ({
      symbolLightOverrides: clamped > 0 ? new Map(symbolLightOverrides).set(hash, clamped) : deleted(symbolLightOverrides, hash),
    }));
  }
  /** SetBloomEffectHandle on the symbol's art. */
  SetSymbolBloom(symbol: string): void { this.update(({ blooms }) => ({ blooms: withAdded(blooms, smallHash(symbol)) })); }
  IsVisible(element: AnimElement): boolean {
    return animStateVisible(this.state.peek(), element);
  }
  /** Follower:FollowSymbol of an equipped piece's own animation, drawn in the symbol's place until the returned stop. */
  FollowSymbolAnimation(symbol: string, follow: { bank: string; animation: string; builds: SymbolSource; symbols?: readonly string[] }): () => void {
    const hash = smallHash(symbol);
    const declared: SymbolAnimationJson = { bank: this.archive(follow.bank), animation: follow.animation, builds: this.archives(follow.builds),
      ...follow.symbols ? { symbols: follow.symbols.map(smallHash) } : {} };
    this.update(({ symbolAnimations }) => ({ symbolAnimations: new Map(symbolAnimations).set(hash, declared) }));
    return () => {
      if (this.state.peek().symbolAnimations.get(hash) === declared) {
        this.update(({ symbolAnimations }) => ({ symbolAnimations: deleted(symbolAnimations, hash) }));
      }
    };
  }
  /** An attachment added twice is held once, in its first place; the returned stop removes it. */
  AddAttachment(attachment: AnimationAttachment): () => void {
    this.update(({ attachments }) => ({ attachments: attachments.includes(attachment) ? attachments : [...attachments, attachment] }));
    return () => this.update(({ attachments }) => ({ attachments: attachments.filter(other => other !== attachment) }));
  }
  get isAnimating(): boolean { return this.state.peek().attachments.some(attachment => attachment.isAnimating); }
  Update(dt: number): void { for (const attachment of this.state.peek().attachments) { attachment.update(dt); } }
}

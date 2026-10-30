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
export interface ResolvedAnimState extends Omit<AnimStateJson, 'overrides' | 'symbolAnimations'> {
  readonly overrides: ReadonlyMap<number, readonly { readonly build: SymbolBuild; readonly symbol: number }[] | undefined>;
  readonly symbolAnimations: ReadonlyMap<number, ResolvedSymbolAnimation | undefined>;
}

/** Resolves a snapshot against loaded art and lists the archives that are not loaded yet. */
export function resolveAnimState(state: AnimStateJson, art: AnimStateArt | undefined): {
  state: ResolvedAnimState; missing: { builds: Set<string>; animations: Set<string> };
} {
  const missing = { builds: new Set<string>(), animations: new Set<string>() };
  const build = (archive: string) => {
    if (!art) throw new Error(`AnimState names ${archive}, but its entity has no art source`);
    const loaded = art.peekBuild(archive);
    if (!loaded) missing.builds.add(archive);
    return loaded;
  };
  const overrides = new Map<number, { build: SymbolBuild; symbol: number }[] | undefined>();
  for (const [hash, { sources }] of state.overrides) {
    const resolved = sources.map(source => ({ build: build(source.archive), symbol: source.symbol }));
    overrides.set(hash, resolved.every(source => source.build) ? resolved as { build: SymbolBuild; symbol: number }[] : undefined);
  }
  const symbolAnimations = new Map<number, ResolvedSymbolAnimation | undefined>();
  for (const [hash, declared] of state.symbolAnimations) {
    const builds = declared.builds.map(build);
    const animations = art?.peekAnimation(declared.bank);
    if (!animations) missing.animations.add(declared.bank);
    symbolAnimations.set(hash, animations && builds.every(Boolean) ? {
      animations, builds: builds as SymbolBuild[], animation: declared.animation,
      ...declared.symbols ? { symbols: new Set(declared.symbols) } : {},
    } : undefined);
  }
  return { state: { ...state, overrides, symbolAnimations }, missing };
}

/** Declarations drawn over one another, in order: a later one's overrides and shown or hidden layers and symbols win; the rest add up. */
export function mergeAnimStates<S extends AnimStateJson | ResolvedAnimState>(states: readonly S[]): S {
  if (states.length === 1) return states[0];
  const overrides = new Map<number, unknown>();
  const symbolAnimations = new Map<number, unknown>();
  const symbolLightOverrides = new Map<number, number>();
  const hiddenLayers = new Set<number>(), hiddenSymbols = new Set<number>(), blooms = new Set<number>();
  const attachments: AnimationAttachment[] = [];
  for (const state of states) {
    for (const [hash, override] of state.overrides) overrides.set(hash, override);
    for (const [hash, animation] of state.symbolAnimations) symbolAnimations.set(hash, animation);
    for (const [hash, light] of state.symbolLightOverrides) symbolLightOverrides.set(hash, light);
    for (const layer of state.hiddenLayers) hiddenLayers.add(layer);
    for (const layer of state.shownLayers ?? []) hiddenLayers.delete(layer);
    for (const symbol of state.hiddenSymbols) hiddenSymbols.add(symbol);
    for (const symbol of state.shownSymbols ?? []) hiddenSymbols.delete(symbol);
    for (const bloom of state.blooms) blooms.add(bloom);
    attachments.push(...state.attachments);
  }
  return { overrides, hiddenLayers, hiddenSymbols, symbolLightOverrides, symbolAnimations, blooms, attachments } as unknown as S;
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
    if (!follow || !animation) return [];
    const frame = animation.frames[Math.floor(elapsed * animation.frameRate) % animation.frames.length];
    return [...frame.elements].filter(part => !follow.symbols || follow.symbols.has(part.imageHash))
      .sort((a, b) => b.z - a.z)
      .flatMap(part => resolveImage(follow.builds, { ...part, matrix: compose(element.matrix, part.matrix) }) ?? []);
  }
  if (!state.overrides.has(element.imageHash)) return undefined;
  const sources = state.overrides.get(element.imageHash);
  const source = sources?.find(candidate => candidate.build.build.symbols.has(candidate.symbol));
  const sprite = source && resolveImage([source.build], element, source.symbol);
  return sprite ? [sprite] : [];
}

const visibilityGroups = new Map([
  ['swap_hat', 'HAT'], ['headbase', 'HEAD'], ['headbase_hat', 'HEAD_HAT'],
  ['hair', 'HAIR'], ['hairfront', 'HAIR'], ['hairpigtails', 'HAIR'],
].map(([symbol, layer]) => [smallHash(symbol), smallHash(layer)]));

/** AnimState symbol overrides and visibility, independent of prefab IDs and equipment slots. Art is named, not loaded. */
export class AnimState {
  private readonly builds = new Map<string, string>();
  private readonly overrides = new Map<number, SymbolOverrideJson>();
  private readonly hiddenLayers = new Set<number>();
  private readonly hiddenSymbols = new Set<number>();
  private readonly shownLayers = new Set<number>();
  private readonly shownSymbols = new Set<number>();
  private readonly symbolLightOverrides = new Map<number, number>();
  private readonly symbolAnimations = new Map<number, SymbolAnimationJson>();
  private readonly blooms = new Set<number>();
  private readonly attachments = new Set<AnimationAttachment>();
  private readonly state = createSignal<AnimStateJson>({ overrides: new Map(), hiddenLayers: new Set(), hiddenSymbols: new Set(),
    shownLayers: new Set(), shownSymbols: new Set(), symbolLightOverrides: new Map(), symbolAnimations: new Map(), blooms: new Set(), attachments: [] });
  readonly json = readonlySignal(this.state);
  private readonly onChanged: () => void;

  constructor(changed: () => void = () => {}) { this.onChanged = changed; }
  private changed(): void {
    this.state.set({ overrides: new Map(this.overrides), hiddenLayers: new Set(this.hiddenLayers), hiddenSymbols: new Set(this.hiddenSymbols),
      shownLayers: new Set(this.shownLayers), shownSymbols: new Set(this.shownSymbols), symbolLightOverrides: new Map(this.symbolLightOverrides), symbolAnimations: new Map(this.symbolAnimations),
      blooms: new Set(this.blooms), attachments: [...this.attachments] });
    this.onChanged();
  }
  /** Names a build whose archive is not `<name>.zip`, such as a skin under `dynamic/`. */
  RegisterBuild(name: string, archive: string): void { this.builds.set(name, archive); }
  private archive(build: string): string {
    return this.builds.get(build) ?? (build.endsWith('.zip') ? build : `${build}.zip`);
  }
  private archives(source: SymbolSource): readonly string[] {
    return (typeof source === 'string' ? [source] : source).map(build => this.archive(build));
  }
  OverrideSymbol(symbol: string, build: SymbolSource, sourceSymbol: string): void {
    const hash = smallHash(sourceSymbol);
    this.setOverride(symbol, this.archives(build).map(archive => ({ archive, symbol: hash })));
  }
  /** The skin's symbol, else the fallback build's; a skin without the symbol and no fallback hides it. */
  OverrideItemSkinSymbol(symbol: string, skin: SymbolSource, sourceSymbol: string, _guid: string, fallback?: SymbolSource, fallbackSymbol = sourceSymbol): void {
    const skinHash = smallHash(sourceSymbol), fallbackHash = smallHash(fallbackSymbol);
    this.setOverride(symbol, [...this.archives(skin).map(archive => ({ archive, symbol: skinHash })),
      ...(fallback === undefined ? [] : this.archives(fallback).map(archive => ({ archive, symbol: fallbackHash })))]);
  }
  private setOverride(symbol: string, sources: SymbolOverrideJson['sources']): void {
    this.overrides.set(smallHash(symbol), { sources });
    this.changed();
  }
  ClearOverrideSymbol(symbol: string): void { this.overrides.delete(smallHash(symbol)); this.changed(); }
  Show(layer: string): void { const hash = smallHash(layer.toLowerCase()); this.hiddenLayers.delete(hash); this.shownLayers.add(hash); this.changed(); }
  Hide(layer: string): void { const hash = smallHash(layer.toLowerCase()); this.shownLayers.delete(hash); this.hiddenLayers.add(hash); this.changed(); }
  ShowSymbol(symbol: string): void { const hash = smallHash(symbol); this.hiddenSymbols.delete(hash); this.shownSymbols.add(hash); this.changed(); }
  HideSymbol(symbol: string): void { const hash = smallHash(symbol); this.shownSymbols.delete(hash); this.hiddenSymbols.add(hash); this.changed(); }
  /** 0 restores the symbol to the entity's own light. */
  SetSymbolLightOverride(symbol: string, value: number): void {
    const hash = smallHash(symbol), clamped = Math.min(1, Math.max(0, value));
    if (clamped > 0) this.symbolLightOverrides.set(hash, clamped); else this.symbolLightOverrides.delete(hash);
    this.changed();
  }
  /** SetBloomEffectHandle on the symbol's art. */
  SetSymbolBloom(symbol: string): void { this.blooms.add(smallHash(symbol)); this.changed(); }
  IsVisible(element: AnimElement): boolean {
    return animStateVisible(this.state.peek(), element);
  }
  /** Follower:FollowSymbol of an equipped piece's own animation, drawn in the symbol's place until the returned stop. */
  FollowSymbolAnimation(symbol: string, follow: { bank: string; animation: string; builds: SymbolSource; symbols?: readonly string[] }): () => void {
    const hash = smallHash(symbol);
    const declared: SymbolAnimationJson = { bank: this.archive(follow.bank), animation: follow.animation, builds: this.archives(follow.builds),
      ...follow.symbols ? { symbols: follow.symbols.map(smallHash) } : {} };
    this.symbolAnimations.set(hash, declared); this.changed();
    return () => { if (this.symbolAnimations.get(hash) === declared) { this.symbolAnimations.delete(hash); this.changed(); } };
  }
  AddAttachment(attachment: AnimationAttachment): () => void {
    this.attachments.add(attachment); this.changed();
    return () => { this.attachments.delete(attachment); this.changed(); };
  }
  get isAnimating(): boolean { return [...this.attachments].some(attachment => attachment.isAnimating); }
  Update(dt: number): void { for (const attachment of this.attachments) attachment.update(dt); }
}

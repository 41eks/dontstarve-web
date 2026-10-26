import type * as THREE from 'three';
import { createSignal, readonlySignal } from '@dontstarve-web/signals';
import { findImage, smallHash, type AnimElement, type ParsedBuild, type ResolvedSprite } from './animationAssets';

/** Decoded handles stand in for the engine's named builds. */
export interface SymbolBuild { readonly build: ParsedBuild; readonly materials: THREE.MeshBasicMaterial[] }
export type SymbolSource = string | SymbolBuild | readonly SymbolBuild[];
export interface FrameEffect { back: ResolvedSprite[]; front: ResolvedSprite[] }
export interface AnimationAttachment {
  update(dt: number): void;
  readonly isAnimating: boolean;
  resolve?(elements: readonly AnimElement[], mirrored: boolean): FrameEffect;
}

/** Immutable appearance snapshot; decoded builds and equipment attachments retain their owner's lifetime. */
export interface AnimStateJson {
  readonly overrides: ReadonlyMap<number, { sources: readonly SymbolBuild[]; symbol: number }>;
  readonly hiddenLayers: ReadonlySet<number>;
  readonly hiddenSymbols: ReadonlySet<number>;
  readonly followers: ReadonlyMap<number, (element: AnimElement) => ResolvedSprite[]>;
  readonly attachments: readonly AnimationAttachment[];
}

export function animStateVisible(state: AnimStateJson, element: AnimElement): boolean {
  const group = visibilityGroups.get(element.imageHash);
  return !state.hiddenSymbols.has(element.imageHash) && !state.hiddenLayers.has(element.layerHash)
    && (group === undefined || !state.hiddenLayers.has(group));
}

export function resolveAnimStateSymbol(state: AnimStateJson, element: AnimElement): ResolvedSprite[] | undefined {
  const follower = state.followers.get(element.imageHash);
  if (follower) return follower(element);
  const override = state.overrides.get(element.imageHash);
  if (!override) return undefined;
  const source = override.sources.find(candidate => candidate.build.symbols.has(override.symbol));
  const image = source && findImage(source.build, override.symbol, element.imageIndex);
  return image && source ? [{ element, image, materials: source.materials }] : [];
}

const visibilityGroups = new Map([
  ['swap_hat', 'HAT'], ['headbase', 'HEAD'], ['headbase_hat', 'HEAD_HAT'],
  ['hair', 'HAIR'], ['hairfront', 'HAIR'], ['hairpigtails', 'HAIR'],
].map(([symbol, layer]) => [smallHash(symbol), smallHash(layer)]));

/** AnimState symbol overrides and visibility, independent of prefab IDs and equipment slots. */
export class AnimState {
  private readonly builds = new Map<string, SymbolBuild>();
  private readonly overrides = new Map<number, { sources: readonly SymbolBuild[]; symbol: number }>();
  private readonly hiddenLayers = new Set<number>();
  private readonly hiddenSymbols = new Set<number>();
  private readonly followers = new Map<number, (element: AnimElement) => ResolvedSprite[]>();
  private readonly attachments = new Set<AnimationAttachment>();
  private readonly state = createSignal<AnimStateJson>({ overrides: new Map(), hiddenLayers: new Set(), hiddenSymbols: new Set(), followers: new Map(), attachments: [] });
  readonly json = readonlySignal(this.state);
  private readonly onChanged: () => void;

  constructor(changed: () => void = () => {}) { this.onChanged = changed; }
  private changed(): void {
    this.state.set({ overrides: new Map(this.overrides), hiddenLayers: new Set(this.hiddenLayers), hiddenSymbols: new Set(this.hiddenSymbols),
      followers: new Map(this.followers), attachments: [...this.attachments] });
    this.onChanged();
  }
  RegisterBuild(name: string, source: SymbolBuild): void { this.builds.set(name, source); }
  private sources(source: SymbolSource): readonly SymbolBuild[] {
    if (typeof source !== 'string') return Array.isArray(source) ? source : [source as SymbolBuild];
    const build = this.builds.get(source);
    if (!build) throw new Error(`Override build ${source} has not been loaded`);
    return [build];
  }
  OverrideSymbol(symbol: string, build: SymbolSource, sourceSymbol: string): void {
    this.overrides.set(smallHash(symbol), { sources: this.sources(build), symbol: smallHash(sourceSymbol) });
    this.changed();
  }
  OverrideItemSkinSymbol(symbol: string, skin: SymbolSource, sourceSymbol: string, _guid: string, fallback?: SymbolSource): void {
    const sources = [...this.sources(skin), ...(fallback === undefined ? [] : this.sources(fallback))];
    this.OverrideSymbol(symbol, sources, sourceSymbol);
  }
  ClearOverrideSymbol(symbol: string): void { this.overrides.delete(smallHash(symbol)); this.changed(); }
  Show(layer: string): void { this.hiddenLayers.delete(smallHash(layer.toLowerCase())); this.changed(); }
  Hide(layer: string): void { this.hiddenLayers.add(smallHash(layer.toLowerCase())); this.changed(); }
  ShowSymbol(symbol: string): void { this.hiddenSymbols.delete(smallHash(symbol)); this.changed(); }
  HideSymbol(symbol: string): void { this.hiddenSymbols.add(smallHash(symbol)); this.changed(); }
  IsVisible(element: AnimElement): boolean {
    return animStateVisible(this.state.peek(), element);
  }
  ResolveSymbol(element: AnimElement): ResolvedSprite[] | undefined {
    return resolveAnimStateSymbol(this.state.peek(), element);
  }
  FollowSymbol(symbol: string, resolve: (element: AnimElement) => ResolvedSprite[]): () => void {
    const hash = smallHash(symbol);
    this.followers.set(hash, resolve); this.changed();
    return () => { if (this.followers.get(hash) === resolve) this.followers.delete(hash); this.changed(); };
  }
  AddAttachment(attachment: AnimationAttachment): () => void {
    this.attachments.add(attachment); this.changed();
    return () => { this.attachments.delete(attachment); this.changed(); };
  }
  get isAnimating(): boolean { return [...this.attachments].some(attachment => attachment.isAnimating); }
  Update(dt: number): void { for (const attachment of this.attachments) attachment.update(dt); }
  ResolveEffects(elements: readonly AnimElement[], mirrored: boolean): FrameEffect {
    const result: FrameEffect = { back: [], front: [] };
    for (const attachment of this.attachments) {
      const layers = attachment.resolve?.(elements, mirrored);
      if (layers) { result.back.push(...layers.back); result.front.push(...layers.front); }
    }
    return result;
  }
}

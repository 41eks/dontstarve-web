import { createSignal, readonlySignal, type ReadonlySignal } from '@dontstarve-web/signals';
import type { LayerAnimationController, LoadedBuildOverride, PercentAnimationController, SpriteController, TransientSpriteAnimationController } from '@dontstarve-web/animation/sprite';

type SymbolOverrideValue = Parameters<SpriteController['overrideSymbol']>[1];
type SymbolOverrideMap = Parameters<SpriteController['setSymbolOverrides']>[0];

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
}

/** Appearance that belongs to the entity and is dressed again on every drawn sprite. */
export type AppearanceJson =
  | { readonly kind: 'layer'; readonly layer: string; readonly hidden: boolean }
  | { readonly kind: 'symbols'; readonly overrides: SymbolOverrideMap; readonly hiddenLayers: readonly string[] }
  | { readonly kind: 'symbol'; readonly symbol: string; readonly override: SymbolOverrideValue }
  | { readonly kind: 'build'; readonly name: string; readonly override: LoadedBuildOverride | undefined };

/** What an entity looks like, as plain data. The prefab writes it; the display draws it. */
export interface SpriteJson {
  readonly clip: ClipJson;
  readonly queue: readonly { readonly name: string; readonly loop: boolean }[];
  readonly frame?: number;
  /** A fresh object is one more request for a brief feedback clip. */
  readonly transient?: { readonly name: string };
  readonly image?: number;
  readonly facing?: number;
  readonly colour?: readonly number[];
  readonly opacity?: number;
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
}

/**
 * The prefab-side sprite of an entity: animation commands become a `SpriteJson` snapshot, and nothing here touches a
 * model. It offers the controller surface prefabs already call, so a prefab changes the json and the display reacts.
 */
export class SpriteState implements TransientSpriteAnimationController, PercentAnimationController, LayerAnimationController {
  private readonly json: ReturnType<typeof createSignal<SpriteJson>>;
  /** Snapshots of the entity's sprite; the display subscribes to this. */
  readonly sprite: ReadonlySignal<SpriteJson>;
  private readonly artVersion = createSignal(0);
  /** Changes whenever the drawn sprite is attached or released; owners dress what they keep outside the json after it. */
  readonly art = readonlySignal(this.artVersion);
  private readonly initialAnimation: string;
  private probe: SpriteProbe | undefined;
  private awake = true;

  /** `held` marks an initial clip shown on its last frame. */
  constructor(clip: { name: string; held?: boolean }) {
    this.initialAnimation = clip.name;
    this.json = createSignal<SpriteJson>({
      clip: { name: clip.name, loop: !clip.held, finished: clip.held === true }, queue: [], appearance: new Map(),
    });
    this.sprite = readonlySignal(this.json);
  }

  private get state(): SpriteJson { return this.json.peek(); }
  private write(patch: Partial<SpriteJson>): void { this.json.set({ ...this.state, ...patch }); }
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
  private get drawn(): boolean { return this.awake && (this.probe?.loaded ?? true); }
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
    const clip: ClipJson = { name, loop: false, finished: false, complete };
    this.write({ clip, queue: [], frame: undefined });
    // Nothing is drawn, so the transition completes at once.
    if (!this.drawn) this.finish(clip);
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
  setFrame(frame: number): void { this.write({ frame }); }
  showImage(image: number): void { this.write({ image }); }
  setFacing(facing: number): void { this.write({ facing }); }
  setColour(colour: readonly number[]): void { this.write({ colour }); }
  setOpacity(opacity: number): void { this.write({ opacity }); }

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

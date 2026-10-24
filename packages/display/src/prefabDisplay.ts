import * as THREE from 'three';
import { createEffect, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import { ResidentSprite, ResidentSpriteController } from '@dontstarve-web/animation/residentSprite';
import { AnimationFollower } from './animationFollower';
import { FxAttachments, type FxRenderEntry } from './fxAttachments';
import { ArchiveEngine, type ArchiveSpriteSource, type DisplayEngine } from './displayEngine';
import type { AppearanceJson, ClipJson, SpriteJson, SpriteState } from './spriteState';

/** active: drawn and in the scene; asleep: nothing drawn and out of the scene; removed: everything released. */
export type PrefabStatus = 'active' | 'asleep' | 'removed';

/** The entity's shared sprite source. It owns the atlases; the display only builds and returns drawn sprites. */
export interface SpriteSource {
  /** Builds a sprite directly in `animation`; `frame` is given only for the first sprite of a held clip. */
  create(animation: string, frame?: 'first' | 'last'): THREE.Group;
  release(sprite: THREE.Group): void;
}

export interface PrefabDisplayOptions {
  readonly name?: string;
  /** Draw with factory sprites; exactly one of `source` and `archive` is given. */
  readonly source?: SpriteSource;
  /** Draw with a shared archive sprite. */
  readonly archive?: ArchiveSpriteSource;
  /** The entity's lifecycle, written by the logical side. */
  readonly status: ReadonlySignal<PrefabStatus>;
  /** The entity's sprite json, written by the prefab. The first sprite is drawn in its clip; the rest is dressed at once. */
  readonly sprite: SpriteState;
}

/**
 * Draws one entity. It owns the model (the engine's root) and the drawn sprite, subscribes to the entity's `status` and `sprite` signals and
 * reacts: the prefab only changes data. While asleep the model leaves the scene and returns to the same parent on wake.
 */
export class PrefabDisplay {
  private readonly engine: DisplayEngine;
  private readonly state: SpriteState;
  private readonly json: ReturnType<typeof watchSignal<SpriteJson>>;
  private readonly cleanups: (() => void)[] = [];
  private fx!: FxAttachments;
  private readonly follower = new AnimationFollower(name => {
    if (!this.engine.setAnimation) throw new Error('This display cannot follow an animation');
    this.engine.setAnimation(name);
  });
  private disposed = false;
  private asleep = false;
  private home: THREE.Object3D | undefined;
  // The owner may add the model to the scene after its tile was already found inactive.
  private readonly onAdded = () => { if (this.asleep) this.sleep(); };
  // What the controller has been given, so that each snapshot only sends what changed.
  private applied: { clip: ClipJson | undefined; queue: number; frame?: number; transient?: SpriteJson['transient'];
    image?: number; facing?: number; colour?: readonly number[]; opacity?: number; paused?: boolean; appearance: ReadonlyMap<string, AppearanceJson> };

  constructor(options: PrefabDisplayOptions) {
    const { source, archive, sprite: state } = options;
    this.state = state;
    const first = state.sprite.peek();
    const held = first.clip.finished && !first.clip.loop;
    if (archive) {
      const clip = { name: first.clip.name, loop: !held };
      this.engine = new ArchiveEngine(new ResidentSprite(archive.create, clip, archive.initial, options.name));
    } else if (source) {
      this.engine = new ResidentSpriteController(new THREE.Group(), animation => source.create(animation),
        drawn => source.release(drawn), source.create(first.clip.name, held ? 'last' : 'first'), { name: first.clip.name, held });
      if (options.name) this.engine.model.name = options.name;
    } else throw new Error('A display needs a sprite source');
    // The controller starts in a looping or held clip; any other first clip is sent by the first snapshot.
    const plain = first.clip.pose === undefined && first.clip.percent === undefined && (first.clip.loop ? !first.clip.finished : first.clip.finished);
    this.applied = { clip: plain ? first.clip : undefined, queue: 0, appearance: new Map() };
    const controller = this.engine;
    // A frame, or a question about the drawn sprite, first brings it up to date with the entity's latest json.
    const sync = () => this.sync();
    state.bind({
      get currentAnimation() { sync(); return controller.currentAnimation; },
      get numFrames() { sync(); return controller.numFrames; },
      get currentAnimationLength() { sync(); return controller.currentAnimationLength; },
      get pose() { sync(); return controller.pose; },
      get loaded() { return controller.loaded; },
      update: dt => { sync(); controller.update(dt); this.fx.update(dt); },
    });
    this.model.addEventListener('added', this.onAdded);
    const status = watchSignal(options.status, stop => this.cleanups.push(stop));
    const json = this.json = watchSignal(state.sprite, stop => this.cleanups.push(stop));
    const art = watchSignal(this.engine.art, stop => this.cleanups.push(stop));
    this.cleanups.push(createEffect(() => this.applyStatus(status.get())));
    this.cleanups.push(createEffect(() => this.applySprite(json.get())));
    const followed = watchSignal(state.animationSource, stop => this.cleanups.push(stop));
    const declaredFx = watchSignal(state.fx, stop => this.cleanups.push(stop));
    this.cleanups.push(createEffect(() => this.follower.follow(followed.get())));
    this.fx = new FxAttachments(this.model);
    this.cleanups.push(createEffect(() => this.fx.apply(declaredFx.get())));
    this.cleanups.push(createEffect(() => { art.get(); this.dress(json.peek()); state.artChanged(); }));
  }

  get model(): THREE.Group { return this.engine.model; }

  /** Render entries of the effects that are shown now, for the owner's registry to sort with it. */
  get fxRenderEntries(): FxRenderEntry[] { return this.fx.entries(); }

  /** Take over another display's source and drawn sprite (a reskin); this model, entity and json stay. */
  adopt(other: PrefabDisplay): void {
    if (!this.disposed) this.engine.adopt(other.engine);
  }

  private applyStatus(status: PrefabStatus): void {
    if (status === 'active') { this.wake(); this.engine.setActive(true); }
    else if (status === 'asleep') { this.engine.setActive(false); this.asleep = true; this.sleep(); }
    else this.dispose();
  }

  private sleep(): void {
    const parent = this.model.parent;
    if (!parent) return;
    this.home = parent;
    this.model.removeFromParent();
  }

  private wake(): void {
    this.asleep = false;
    const home = this.home;
    this.home = undefined;
    if (home && !this.model.parent && !this.disposed) home.add(this.model);
  }

  /** Applying a snapshot twice is a no-op, so the effect and the frame can both bring the sprite up to date. */
  private sync(): void {
    if (!this.disposed) this.applySprite(this.json.peek());
  }

  private applySprite(json: SpriteJson): void {
    const { engine: controller, applied, state } = this;
    if (json.clip !== applied.clip) {
      const clip = json.clip;
      if (clip.pose) controller.setPose(clip.pose.name);
      else if (clip.percent !== undefined) controller.setPercent(clip.name, clip.percent);
      else if (clip.loop) controller.start(clip.name);
      else if (clip.finished) controller.holdLastFrame(clip.name);
      else controller.playOnce(clip.name, () => state.finish(clip));
      applied.clip = clip; applied.queue = 0; applied.frame = undefined;
    }
    for (; applied.queue < json.queue.length; applied.queue++) {
      const entry = json.queue[applied.queue];
      controller.pushAnimation(entry.name, entry.loop);
    }
    if (json.frame !== applied.frame) { applied.frame = json.frame; if (json.frame !== undefined) controller.setFrame(json.frame); }
    if (json.transient !== applied.transient) { applied.transient = json.transient; if (json.transient) controller.playTransient(json.transient.name); }
    if (json.image !== applied.image) { applied.image = json.image; if (json.image !== undefined) controller.showImage(json.image); }
    if (json.facing !== applied.facing) { applied.facing = json.facing; if (json.facing !== undefined) controller.setFacing(json.facing); }
    if (json.colour !== applied.colour) { applied.colour = json.colour; if (json.colour) controller.setColour(json.colour); }
    if (json.opacity !== applied.opacity) { applied.opacity = json.opacity; if (json.opacity !== undefined) controller.setOpacity(json.opacity); }
    if (json.paused !== applied.paused) { applied.paused = json.paused; if (json.paused !== undefined) controller.setPaused?.(json.paused); }
    for (const [key, op] of json.appearance) if (applied.appearance.get(key) !== op) this.dressOne(op);
    applied.appearance = json.appearance;
  }

  /** Every sprite that is drawn starts undressed: give it the entity's appearance again. */
  private dress(json: SpriteJson): void {
    const controller = this.engine;
    if (!controller.loaded) return;
    if (json.image !== undefined) controller.showImage(json.image);
    if (json.facing !== undefined) controller.setFacing(json.facing);
    if (json.colour) controller.setColour(json.colour);
    if (json.opacity !== undefined) controller.setOpacity(json.opacity);
    if (json.paused !== undefined) controller.setPaused?.(json.paused);
    for (const op of json.appearance.values()) this.dressOne(op);
  }

  private dressOne(op: AppearanceJson): void {
    const controller = this.engine;
    switch (op.kind) {
      case 'layer': if (op.hidden) controller.hideLayer(op.layer); else controller.showLayer(op.layer); break;
      case 'symbols': controller.setSymbolOverrides(op.overrides, op.hiddenLayers); break;
      case 'symbol': controller.overrideSymbol(op.symbol, op.override); break;
      case 'build':
        if (op.override) controller.addOverrideBuild(op.name, op.override); else controller.clearOverrideBuild(op.name);
        break;
    }
  }

  /** Releases the drawn sprite and the model; the shared source stays with its owner. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.asleep = false;
    this.home = undefined;
    this.model.removeEventListener('added', this.onAdded);
    for (const stop of this.cleanups.splice(0)) stop();
    this.follower.dispose();
    this.fx.dispose();
    this.state.bind(undefined);
    this.engine.dispose();
    this.model.removeFromParent();
  }
}

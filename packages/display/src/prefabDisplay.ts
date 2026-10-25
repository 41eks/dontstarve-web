import * as THREE from 'three';
import { createEffect, getBoundWatchWorldContent, watchSignal, WorldContentKey, type ReadonlySignal } from '@dontstarve-web/signals';
import { ResidentSprite, ResidentSpriteController } from '@dontstarve-web/animation/residentSprite';
import { setLightOverride } from '@dontstarve-web/animation/lightOverride';
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
  /** Transform-only entities have no art to load. The display still owns their model and lifecycle. */
  readonly empty?: boolean;
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
  private readonly status: ReturnType<typeof watchSignal<PrefabStatus>>;
  private readonly cleanups: (() => void)[] = [];
  private fx!: FxAttachments;
  private readonly follower = new AnimationFollower(name => {
    if (!this.engine.setAnimation) throw new Error('This display cannot follow an animation');
    this.engine.setAnimation(name);
  });
  private disposed = false;
  // The camera rotation the drawn sprite was turned to; a sprite drawn later is turned to it too.
  private facing: THREE.Quaternion | undefined;
  private asleep = false;
  private home: THREE.Object3D | undefined;
  // The owner may add the model to the scene after its tile was already found inactive.
  private readonly onAdded = () => { if (this.asleep) this.sleep(); };
  // What the controller has been given, so that each snapshot only sends what changed.
  private applied: { clip: ClipJson | undefined; queue: number; frame?: number; transient?: SpriteJson['transient'];
    image?: number; facing?: number; mirrored?: boolean; colour?: readonly number[]; opacity?: number; lightOverride?: number; paused?: boolean; erosion?: number; ground?: SpriteJson['ground']; meshOrder?: number; appearance: ReadonlyMap<string, AppearanceJson> };

  constructor(options: PrefabDisplayOptions) {
    const { archive, sprite: state } = options;
    const source = options.source ?? (options.empty ? { create: () => new THREE.Group(), release: (model: THREE.Group) => model.removeFromParent() } : undefined);
    this.state = state;
    const first = state.sprite.peek();
    const held = first.clip.finished && !first.clip.loop;
    if (archive) {
      const clip = { name: first.clip.name, loop: !held };
      const prepare = (drawn: import('@dontstarve-web/animation/archiveSprite').ArchiveSprite) => {
        if (archive.alignBottom) {
          drawn.model.updateWorldMatrix(true, true);
          const bounds = new THREE.Box3().setFromObject(drawn.model);
          drawn.model.children[0].position.y -= bounds.min.y;
        }
        return drawn;
      };
      const create: ArchiveSpriteSource['create'] = clip => {
        const drawn = archive.create(clip);
        return drawn instanceof Promise ? drawn.then(prepare) : prepare(drawn);
      };
      this.engine = new ArchiveEngine(new ResidentSprite(create, clip, archive.initial && prepare(archive.initial), options.name));
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
    const status = this.status = watchSignal(options.status, stop => this.cleanups.push(stop));
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
    // A billboard turns to TheCamera itself, through its own bridge to the world's camera rotation.
    const watchWorldContent = first.billboard ? getBoundWatchWorldContent() : undefined;
    if (watchWorldContent) {
      const camera = watchWorldContent(WorldContentKey.CameraRotation, stop => this.cleanups.push(stop));
      this.cleanups.push(createEffect(() => this.faceCamera(camera.get())));
    }
  }

  get model(): THREE.Group { return this.engine.model; }

  get isRemoved(): boolean { return this.disposed || this.status.peek() === 'removed'; }

  /** Advance a display owned by a scene collection, including standalone camera-facing FX. */
  update(dt: number, cameraRotation: THREE.Quaternion): void {
    if (this.disposed) return;
    this.applyStatus(this.status.peek());
    if (this.isRemoved || this.asleep) return;
    if (this.json.peek().billboard) this.faceCamera(cameraRotation);
    this.state.update(dt);
    // Animation completion can remove the entity during this update.
    this.applyStatus(this.status.peek());
  }

  /** Render entries of the effects that are shown now, for the owner's registry to sort with it. */
  get fxRenderEntries(): readonly FxRenderEntry[] { return this.fx.entries(); }

  /** Take over another display's source and drawn sprite (a reskin); this model, entity and json stay. */
  adopt(other: PrefabDisplay): void {
    if (!this.disposed) this.engine.adopt(other.engine);
  }

  /** A static archive billboard turns its drawn sprite; any other sprite turns with the model. */
  private faceCamera(rotation: THREE.Quaternion): void {
    if (this.disposed) return;
    if (!this.engine.faceCamera) { this.model.quaternion.copy(rotation); return; }
    (this.facing ??= new THREE.Quaternion()).copy(rotation);
    this.engine.faceCamera(this.facing);
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
    if (json.visible !== undefined) this.model.visible = json.visible;
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
    if (json.facing !== applied.facing || json.mirrored !== applied.mirrored) {
      applied.facing = json.facing; applied.mirrored = json.mirrored;
      if (json.facing !== undefined) controller.setFacing(json.facing, json.mirrored);
    }
    if (json.colour !== applied.colour) { applied.colour = json.colour; if (json.colour) controller.setColour(json.colour); }
    if (json.opacity !== applied.opacity) { applied.opacity = json.opacity; if (json.opacity !== undefined) controller.setOpacity(json.opacity); }
    if (json.lightOverride !== applied.lightOverride) {
      applied.lightOverride = json.lightOverride;
      if (json.lightOverride !== undefined) setLightOverride(this.model, json.lightOverride);
    }
    if (json.paused !== applied.paused) { applied.paused = json.paused; if (json.paused !== undefined) controller.setPaused?.(json.paused); }
    if (json.erosion !== applied.erosion) { applied.erosion = json.erosion; if (json.erosion !== undefined) controller.setErosion?.(json.erosion); }
    if (json.ground !== applied.ground) { applied.ground = json.ground; if (json.ground) controller.setGround?.(json.ground.renderOrder, json.ground.flat); }
    if (json.meshOrder !== applied.meshOrder) { applied.meshOrder = json.meshOrder; if (json.meshOrder !== undefined) controller.setMeshOrder?.(json.meshOrder); }
    for (const [key, op] of json.appearance) if (applied.appearance.get(key) !== op) this.dressOne(op);
    applied.appearance = json.appearance;
  }

  /** Every sprite that is drawn starts undressed: give it the entity's appearance again. */
  private dress(json: SpriteJson): void {
    const controller = this.engine;
    if (!controller.loaded) return;
    if (this.facing) controller.faceCamera?.(this.facing);
    if (json.image !== undefined) controller.showImage(json.image);
    if (json.facing !== undefined) controller.setFacing(json.facing, json.mirrored);
    if (json.colour) controller.setColour(json.colour);
    if (json.opacity !== undefined) controller.setOpacity(json.opacity);
    if (json.paused !== undefined) controller.setPaused?.(json.paused);
    if (json.erosion !== undefined) controller.setErosion?.(json.erosion);
    if (json.ground) controller.setGround?.(json.ground.renderOrder, json.ground.flat);
    if (json.meshOrder !== undefined) controller.setMeshOrder?.(json.meshOrder);
    for (const op of json.appearance.values()) this.dressOne(op);
  }

  private dressOne(op: AppearanceJson): void {
    const controller = this.engine;
    switch (op.kind) {
      case 'archive-symbol': controller.setSymbolOverride?.(op.symbol, op.archive, op.sourceSymbol); break;
      case 'archive-hidden': controller.setSymbolHidden?.(op.symbol, op.hidden); break;
      case 'archive-build': controller.setBuildArchive?.(op.archive); break;
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

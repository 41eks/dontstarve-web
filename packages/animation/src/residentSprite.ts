import * as THREE from 'three';
import { createEffect, createSignal, readonlySignal } from '@dontstarve-web/signals';
import type { StaticSpriteController } from './wallSprite';
import type { ArchiveSprite } from './archiveSprite';
import { registerSpriteRenderGroup, setSpriteEntityRenderOrder } from './renderOrder';
import type { InstancedSprite } from './instancedArchiveSprites';
import { installRootMatrixGate } from './matrixGate';
import type { LayerAnimationController, LoadedBuildOverride, PercentAnimationController, SpriteController, TransientSpriteAnimationController } from './sprite';

/** `none` is AnimState with no animation playing: nothing is drawn, and no sprite is built until a clip is played. */
interface Clip { name: string; loop: boolean; complete?: () => void; finished: boolean; frame?: number; none?: boolean }

/** Persistent entity origin; only the sprite under its model may be unloaded. */
export interface ResidentEntity {
  readonly id: number;
  readonly saveId?: string;
  readonly position: THREE.Vector3;
  readonly model: THREE.Group;
}

/**
 * An `ArchiveSprite` whose frames, materials and instance entries exist only while the entity is active.
 * The stable root keeps the entity origin, identity and render-order slot; inactive entities hold an empty
 * placeholder group. The logical clip and callback survive unloading; the owner reapplies appearance through `art`.
 * `create` receives the logical clip so a factory sprite is built directly in it.
 * `setActive(false)` also takes the stable root out of its parent and `setActive(true)` puts it back, so scene
 * traversals (projection, matrix updates) skip inactive entities; the owner keeps the root and its state.
 */
export class ResidentSprite implements ArchiveSprite {
  readonly model = new THREE.Group();
  private readonly placeholder = new THREE.Group();
  // The current sprite owns its subtree cache; the stable root caches only itself.
  private readonly matrixGate = installRootMatrixGate(this.model, this.placeholder);
  private readonly visual = createSignal<ArchiveSprite | undefined>(undefined);
  private readonly artVersion = createSignal(0);
  /** Changes whenever the drawn sprite is attached or released; effects that dress the sprite (build, symbols, colour) read it. */
  readonly art = readonlySignal(this.artVersion);
  private readonly stopVisualEffect: () => void;
  private get sprite(): ArchiveSprite | undefined { return this.visual.peek(); }
  private set sprite(sprite: ArchiveSprite | undefined) { this.visual.set(sprite); this.artVersion.set(this.artVersion.peek() + 1); }
  private clip: Clip;
  private queue: { name: string; loop: boolean }[] = [];
  private generation = 0;
  private disposed = false;
  private paused = false;
  /** Inactive: the root is held out of the scene and returns to `home` on activation. */
  private asleep = false;
  private home: THREE.Object3D | undefined;
  private create: (clip: { name: string; loop: boolean }) => ArchiveSprite | Promise<ArchiveSprite>;
  // The owner may add the root to its parent after the tile was already found inactive.
  private readonly onAdded = () => { if (this.asleep) this.sleep(); };

  /** `initial` is an already created sprite in `clip`; without it the sprite stays unloaded until `load()`. */
  constructor(create: ResidentSprite['create'], clip: { name: string; loop: boolean; none?: boolean }, initial?: ArchiveSprite,
    name = 'ResidentSprite') {
    this.create = create;
    this.clip = { ...clip, finished: clip.none === true };
    this.model.name = name;
    this.model.userData.billboard = true;
    this.model.add(this.placeholder);
    registerSpriteRenderGroup(this.model, this.placeholder);
    this.model.addEventListener('added', this.onAdded);
    if (initial) this.attach(initial);
    this.stopVisualEffect = createEffect(() => this.matrixGate.setRenderEnabled(this.visual.get() !== undefined));
  }

  private attachHook?: (sprite: ArchiveSprite) => void;
  /** Applies prefab-specific changes to the drawn sprite, now and after every reload. */
  onAttach(hook: (sprite: ArchiveSprite) => void): void {
    this.attachHook = hook;
    if (this.sprite) hook(this.sprite);
  }

  get loaded(): boolean { return this.sprite !== undefined; }
  get currentAnimation(): string { return this.sprite?.currentAnimation ?? this.clip.name; }
  get frameCount(): number { return this.sprite?.frameCount ?? 0; }

  /** Build the sprite for an active entity; a no-op while loaded or loading. A synchronous factory loads immediately. */
  load(): void {
    if (this.disposed || this.sprite || this.loading || this.clip.none) return;
    const generation = ++this.generation;
    const created = this.create({ name: this.clip.name, loop: this.clip.loop });
    if (!(created instanceof Promise)) { this.attach(created); return; }
    this.loading = true;
    const request = this.request = created.then(sprite => {
      this.loading = false;
      if (this.disposed || generation !== this.generation) { sprite.dispose(); return; }
      this.attach(sprite);
    }, error => {
      this.loading = false;
      if (!this.disposed && generation === this.generation) console.error('Unable to load sprite', error);
    }).finally(() => { if (this.request === request) this.request = undefined; });
  }
  private loading = false;
  private request?: Promise<void>;
  /** Settles when the sprite being built for the logical clip is drawn, or immediately when none is. */
  get pending(): Promise<void> | undefined { return this.request; }

  /** Release frames, private materials and instances; the logical clip stays. */
  unload(): void {
    this.generation++;
    this.loading = false;
    const sprite = this.sprite;
    if (!sprite) return;
    this.sprite = undefined;
    // A transition that was playing is not replayed on return: it settles into its completion state.
    this.settle();
    this.placeholder.visible = sprite.model.visible;
    this.placeholder.position.copy(sprite.model.position);
    this.matrixGate.markDirty();
    this.model.add(this.placeholder);
    registerSpriteRenderGroup(this.model, this.placeholder);
    sprite.dispose();
  }

  /** Replace a prepared source for reskinning without replacing the root, logical clip or callbacks. */
  adopt(other: ResidentSprite): void {
    if (this.disposed || other === this) return;
    this.generation++; this.loading = false;
    other.generation++; other.loading = false;
    const taken = other.sprite;
    other.sprite = undefined;
    taken?.model.removeFromParent();
    this.create = other.create;
    const old = this.sprite;
    this.sprite = undefined;
    if (old) { this.placeholder.visible = old.model.visible; this.placeholder.position.copy(old.model.position); }
    old?.dispose();
    if (taken && !this.asleep) this.attach(taken);
    else {
      taken?.dispose();
      this.model.add(this.placeholder);
      registerSpriteRenderGroup(this.model, this.placeholder);
    }
  }

  setActive(active: boolean): void {
    if (active) { this.wake(); this.load(); } else { this.unload(); this.asleep = true; this.sleep(); }
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

  private attach(sprite: ArchiveSprite): void {
    this.matrixGate.markDirty();
    this.sprite = sprite;
    sprite.model.visible = this.placeholder.visible;
    sprite.model.position.copy(this.placeholder.position);
    this.model.remove(this.placeholder);
    this.model.add(sprite.model);
    registerSpriteRenderGroup(this.model, sprite.model.children[0] as THREE.Group);
    this.attachHook?.(sprite);
    this.play();
    sprite.setPaused(this.paused);
  }

  private play(): void {
    const clip = this.clip, sprite = this.sprite;
    if (!sprite) return;
    if (clip.loop) sprite.start(clip.name);
    else if (clip.finished) { sprite.playOnce(clip.name); sprite.setFrame(sprite.frameCount - 1); }
    else sprite.playOnce(clip.name, () => {
      if (this.clip !== clip) return;
      clip.finished = true;
      clip.complete?.();
      this.advanceQueue();
    });
    if (clip.frame !== undefined) sprite.setFrame(clip.frame);
  }

  update(dt: number): void { this.sprite?.update(dt); }
  start(name: string): void {
    const resume = this.leavesNoAnimation();
    this.queue = [];
    this.clip = { name, loop: true, finished: false };
    if (resume) this.load();
    this.play();
  }
  playOnce(name: string, complete?: () => void): void {
    const resume = this.leavesNoAnimation();
    this.queue = [];
    this.clip = { name, loop: false, complete, finished: false };
    if (resume) this.load();
    // Nothing is drawn while unloaded, so the transition settles at once into its completion state.
    if (!this.sprite && !this.loading) this.settle(); else this.play();
  }
  /** Stops playing any animation: the drawn sprite is released until a clip is played again. */
  clearAnimation(): void {
    this.queue = [];
    this.clip = { name: this.clip.name, loop: false, finished: true, none: true };
    this.unload();
  }
  /** An awake entity leaving `clearAnimation()` builds its sprite for the clip it now plays. */
  private leavesNoAnimation(): boolean { return this.clip.none === true && !this.asleep; }
  /** Rests on the clip's last frame, now or once the sprite is drawn again; no frame index is recorded while unloaded. */
  holdLastFrame(name: string): void {
    const resume = this.leavesNoAnimation();
    this.queue = [];
    this.clip = { name, loop: false, finished: true };
    if (resume) this.load();
    this.play();
  }
  private settle(): void {
    const clip = this.clip;
    if (!clip.loop && !clip.finished) { clip.finished = true; clip.complete?.(); }
    if (this.queue.length) {
      const last = this.queue[this.queue.length - 1];
      this.queue = [];
      this.clip = { name: last.name, loop: last.loop, finished: !last.loop };
    }
  }
  /** AnimState:PushAnimation waits for the current one-shot, then plays the next clip. */
  pushAnimation(name: string, loop = false): void {
    this.queue.push({ name, loop });
    if (!this.sprite && !this.loading) this.settle();
  }
  private advanceQueue(): void {
    const next = this.queue.shift();
    if (!next) return;
    this.clip = { name: next.name, loop: next.loop, finished: false };
    this.play();
  }
  setAnimation(name: string): void {
    if (this.clip.name === name) return;
    this.clip = { name, loop: this.clip.loop, finished: false };
    this.sprite?.setAnimation(name);
  }
  setFrame(frame: number): void {
    this.clip.frame = Math.max(0, Math.floor(frame));
    this.sprite?.setFrame(frame);
  }
  setPaused(paused: boolean): void { this.paused = paused; this.sprite?.setPaused(paused); }
  setFacing(facing: number): void { this.sprite?.setFacing(facing); }
  // Appearance is not kept here: the owning prefab dresses each drawn sprite from its own state through an
  // effect on `art`. These calls reach only the sprite that is currently drawn.
  setOpacity(opacity: number): void { this.sprite?.setOpacity(opacity); }
  setColour(colour: readonly [number, number, number]): void { this.sprite?.setColour(colour); }
  setDepthOffset(enabled: boolean): void { this.sprite?.setDepthOffset(enabled); }
  setBuildArchive(archive: string): void { this.sprite?.setBuildArchive(archive); }
  setSymbolOverride(symbol: string, archive?: string, sourceSymbol?: string): void { this.sprite?.setSymbolOverride(symbol, archive, sourceSymbol); }
  setSymbolHidden(symbol: string, hidden: boolean): void { this.sprite?.setSymbolHidden(symbol, hidden); }
  setLayerHidden(layer: string, hidden: boolean): void { this.sprite?.setLayerHidden(layer, hidden); }
  faceCamera(rotation: THREE.Quaternion): void { this.sprite?.faceCamera(rotation); }
  /** Erosion is keyed by the drawn sprite model; its owner sets it every update. */
  setErosion(amount: number): void { this.sprite?.setErosion(amount); }
  get instanced(): InstancedSprite | undefined { return this.sprite?.instanced; }
  /** LAYER_BACKGROUND art drawn by its mesh order within the ground layers; the group keeps its own order. */
  setMeshOrder(order: number): void {
    if (!this.sprite) return;
    (this.sprite.model.children[0].children[0] as THREE.Object3D).renderOrder = order;
  }
  /** Display-only orientation and background order, reapplied by the entity's sprite json after loading. */
  setGround(renderOrder: number, flat: boolean): void {
    if (!this.sprite) return;
    const visual = this.sprite.model.children[0];
    visual.rotation.x = flat ? -Math.PI / 2 : 0;
    visual.position.y = flat ? .01 : 0;
    setSpriteEntityRenderOrder(this.model, renderOrder);
    this.matrixGate.markDirty();
  }
  refreshTransform(): void { this.sprite?.refreshTransform(); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.asleep = false;
    this.home = undefined;
    this.model.removeEventListener('added', this.onAdded);
    this.stopVisualEffect();
    this.unload();
    this.matrixGate.dispose();
    this.model.removeFromParent();
  }
}

type SymbolOverrideValue = Parameters<SpriteController['overrideSymbol']>[1];
type SymbolOverrideMap = Parameters<SpriteController['setSymbolOverrides']>[0];
interface BuildingClip {
  name: string;
  loop: boolean;
  complete?: () => void;
  finished: boolean;
  /** AnimState:SetPercent pose, kept as a held frame. */
  percent?: number;
  /** Static build-image rest pose; undefined name selects the source image. */
  pose?: { name: string | undefined };
}

/**
 * A resident factory sprite, including static build-image controllers.
 * The stable root keeps the entity identity, position and render-order slot; the controller keeps the logical clip
 * and queue. Appearance calls only reach the current sprite; the owner reapplies them through `art`. `create` builds a sprite from
 * the entity's shared source and `release` returns it to that owner; no atlas belongs to the entity.
 * Transitions that were running or requested while unloaded settle into their completion state.
 */
export class ResidentSpriteController implements TransientSpriteAnimationController, PercentAnimationController, LayerAnimationController {
  readonly model: THREE.Group;
  private readonly placeholder = new THREE.Group();
  private readonly matrixGate: ReturnType<typeof installRootMatrixGate>;
  /** Undefined while the source the display loads is not ready: nothing is drawn yet. */
  private create: (initialAnimation: string) => THREE.Group | undefined;
  private release: (sprite: THREE.Group) => void;
  private readonly visual = createSignal<THREE.Group | undefined>(undefined);
  private readonly artVersion = createSignal(0);
  /** Changes whenever the drawn sprite is attached, released or replaced; effects that dress the sprite read it. */
  readonly art = readonlySignal(this.artVersion);
  private readonly stopVisualEffect: () => void;
  private get sprite(): THREE.Group | undefined { return this.visual.peek(); }
  private set sprite(sprite: THREE.Group | undefined) { this.visual.set(sprite); this.artVersion.set(this.artVersion.peek() + 1); }
  private clip: BuildingClip;
  private readonly initialAnimation: string;
  private queue: { name: string; loop: boolean }[] = [];
  private frame?: number;
  private disposed = false;

  /** `initial` is the first sprite, already built in `clip`, if its source is ready; `held` marks a clip shown on its last frame. */
  constructor(model: THREE.Group, create: (initialAnimation: string) => THREE.Group | undefined, release: (sprite: THREE.Group) => void,
    initial: THREE.Group | undefined, clip: { name: string; held?: boolean }) {
    this.model = model;
    this.initialAnimation = clip.name;
    this.matrixGate = installRootMatrixGate(model, this.placeholder);
    this.create = create;
    this.release = release;
    this.clip = { name: clip.name, loop: !clip.held, finished: clip.held === true };
    model.userData.billboard = true;
    registerSpriteRenderGroup(model, this.placeholder);
    if (initial) this.attach(initial, false); else model.add(this.placeholder);
    this.stopVisualEffect = createEffect(() => this.matrixGate.setRenderEnabled(this.visual.get() !== undefined));
  }

  get loaded(): boolean { return this.sprite !== undefined; }
  private get controller(): SpriteController | undefined { return this.sprite?.userData.animationController as SpriteController | undefined; }
  get currentAnimation(): string { return this.controller?.currentAnimation ?? this.clip.name; }
  get numFrames(): number { return this.controller?.numFrames ?? 0; }
  get currentAnimationLength(): number { return this.controller?.currentAnimationLength ?? 0; }

  setActive(active: boolean): void {
    if (this.disposed) return;
    if (!active) { this.unload(); return; }
    if (this.sprite) return;
    const sprite = this.create(this.clip.name);
    if (sprite) this.attach(sprite, true);
  }

  /** Release the drawn sprite to its owner; the logical state stays. */
  private unload(): void {
    const sprite = this.sprite;
    if (!sprite) return;
    this.settle();
    this.placeholder.visible = sprite.visible;
    this.placeholder.position.copy(sprite.position);
    this.matrixGate.markDirty();
    this.sprite = undefined;
    this.release(sprite);
    this.model.add(this.placeholder);
    registerSpriteRenderGroup(this.model, this.placeholder);
  }

  /** A transition that was playing or queued is not replayed: it ends in the state its completion leaves. */
  private settle(): void {
    const clip = this.clip;
    if (!clip.loop && !clip.finished) {
      clip.finished = true;
      clip.complete?.();
      if (this.clip !== clip) return;
    }
    const last = this.queue[this.queue.length - 1];
    if (last) {
      this.clip = { name: last.name, loop: last.loop, finished: !last.loop };
      this.queue = [];
    }
  }

  private attach(sprite: THREE.Group, replay: boolean): void {
    this.matrixGate.markDirty();
    this.sprite = sprite;
    if (replay) { sprite.visible = this.placeholder.visible; sprite.position.copy(this.placeholder.position); }
    this.placeholder.removeFromParent();
    this.model.add(sprite);
    registerSpriteRenderGroup(this.model, sprite.children[0] as THREE.Group);
    if (replay) this.play();
  }

  private play(): void {
    const controller = this.controller, clip = this.clip;
    if (!controller) return;
    if (clip.pose) this.staticController?.setPose(clip.pose.name);
    else if (clip.percent !== undefined) controller.setPercent(clip.name, clip.percent);
    else if (clip.loop) controller.start(clip.name);
    else if (clip.finished) controller.holdLastFrame(clip.name);
    else controller.playOnce(clip.name, this.completion(clip));
    for (const entry of this.queue) controller.pushAnimation(entry.name, entry.loop);
    if (this.frame !== undefined && clip.loop) controller.setFrame(Math.min(this.frame, controller.numFrames - 1));
  }

  private completion(clip: BuildingClip): () => void {
    return () => {
      if (this.clip !== clip) return;
      clip.finished = true;
      clip.complete?.();
    };
  }

  private get staticController(): StaticSpriteController | undefined {
    return this.sprite?.userData.animationController as StaticSpriteController | undefined;
  }
  get pose(): string | undefined { return this.clip.pose?.name; }
  setPose(name: string | undefined): void {
    this.clip = { name: name ?? this.initialAnimation, loop: false, finished: true, pose: { name } };
    this.queue = []; this.frame = undefined;
    this.staticController?.setPose(name);
  }
  showImage(image: number): void { this.staticController?.showImage(image); }
  setFacing(facing: number, mirrored?: boolean): void {
    // Only six-faced art mirrors; other sprites keep their one-argument facing.
    if (mirrored === undefined) { this.staticController?.setFacing(facing); return; }
    (this.sprite?.userData.animationController as { setFacing(facing: number, mirrored: boolean): void } | undefined)?.setFacing(facing, mirrored);
  }
  /** AnimState:SetBuild, for factory sprites that carry the entity's alternative builds. */
  setBuildArchive(archive: string): void {
    const controller = this.sprite?.userData.animationController as { setBuildArchive?(archive: string): void } | undefined;
    if (controller && !controller.setBuildArchive) throw new Error('This sprite has no alternative builds');
    controller?.setBuildArchive?.(archive);
  }
  setColour(colour: readonly number[]): void { this.staticController?.setColour(colour); }
  setOpacity(opacity: number): void { this.staticController?.setOpacity(opacity); }
  setPaused(paused: boolean): void { this.controller?.setPaused?.(paused); }
  setArtSource(source: import('./sprite').SpriteArtSource): void { this.controller?.setArtSource?.(source); }
  setAnimState(state: import('./animState').ResolvedAnimState): void { this.controller?.setAnimState?.(state); }
  setTint(tint: import('./sprite').SpriteTint): void { this.controller?.setTint?.(tint); }
  setComposites(frames: readonly import('./sprite').CompositeSpriteFrame[]): void { this.controller?.setComposites?.(frames); }
  getResolvedFrame(): readonly import('./animationAssets').ResolvedSprite[] { return this.controller?.getResolvedFrame?.() ?? []; }
  getSymbolPosition(symbol: string, x: number, y: number, target: THREE.Vector3): boolean {
    return this.controller?.getSymbolPosition?.(symbol, x, y, target) ?? false;
  }
  setDepthOffset(enabled: boolean): void {
    (this.sprite?.userData.animationController as { setDepthOffset?(enabled: boolean): void } | undefined)?.setDepthOffset?.(enabled);
  }
  setMeshOrder(order: number): void {
    if (!this.sprite) return;
    (this.sprite.children[0].children[0] as THREE.Object3D).renderOrder = order;
  }
  setGround(renderOrder: number, flat: boolean): void {
    if (!this.sprite) return;
    const visual = this.sprite.children[0];
    visual.rotation.x = flat ? -Math.PI / 2 : 0;
    visual.position.y = flat ? .01 : 0;
    setSpriteEntityRenderOrder(this.model, renderOrder);
    this.matrixGate.markDirty();
  }

  start(name: string): void {
    this.clip = { name, loop: true, finished: false };
    this.queue = []; this.frame = undefined;
    this.controller?.start(name);
  }
  playOnce(name: string, complete?: () => void): void {
    const clip = this.clip = { name, loop: false, complete, finished: false };
    this.queue = []; this.frame = undefined;
    if (this.controller) this.controller.playOnce(name, this.completion(clip)); else this.settle();
  }
  pushAnimation(name: string, loop = false): void {
    this.queue.push({ name, loop });
    if (this.controller) this.controller.pushAnimation(name, loop); else this.settle();
  }
  playTransient(name: string): void { this.controller?.playTransient(name); }
  holdLastFrame(name: string): void {
    this.clip = { name, loop: false, finished: true };
    this.queue = []; this.frame = undefined;
    this.controller?.holdLastFrame(name);
  }
  setPercent(name: string, percent: number): void {
    this.clip = { name, loop: false, finished: true, percent };
    this.queue = []; this.frame = undefined;
    this.controller?.setPercent(name, percent);
  }
  setFrame(frame: number): void { this.frame = frame; this.controller?.setFrame(frame); }
  // Appearance is not kept here: the owning prefab dresses each drawn sprite from its own state through an
  // effect on `art`, and the sprite factory options carry the skin when a sprite is built.
  hideLayer(layer: string): void { this.controller?.hideLayer(layer); }
  showLayer(layer: string): void { this.controller?.showLayer(layer); }
  setSymbolOverrides(overrides: SymbolOverrideMap, hiddenLayers: readonly string[] = []): void {
    this.controller?.setSymbolOverrides(overrides, hiddenLayers);
  }
  overrideSymbol(symbol: string, override: SymbolOverrideValue): void { this.controller?.overrideSymbol(symbol, override); }
  addOverrideBuild(name: string, override: LoadedBuildOverride): void { this.controller?.addOverrideBuild(name, override); }
  clearOverrideBuild(name: string): void { this.controller?.clearOverrideBuild(name); }
  update(dt: number): void { this.controller?.update(dt); }

  /** Keep a live entity's clip, progress and layers across a reskin that replaces the sprite source. */
  copyPlaybackFrom(source: ResidentSpriteController): void {
    this.clip = { ...source.clip };
    this.queue = source.queue.map(entry => ({ ...entry }));
    this.frame = source.frame;
    const from = source.controller, to = this.controller;
    if (from && to) to.copyPlaybackFrom(from); else if (to) this.play();
  }

  /** Take over another controller's source and loaded sprite (a reskin), keeping this root and logical state. */
  adopt(other: ResidentSpriteController): void {
    if (this.disposed) return;
    this.matrixGate.markDirty();
    const old = this.sprite, oldRelease = this.release, taken = other.takeSprite();
    this.create = other.create; this.release = other.release;
    this.sprite = undefined;
    if (old && taken) {
      taken.visible = old.visible; taken.position.copy(old.position);
      this.attach(taken, false);
      (taken.userData.animationController as SpriteController).copyPlaybackFrom(old.userData.animationController as SpriteController);
      oldRelease(old);
      return;
    }
    if (old) {
      this.placeholder.visible = old.visible; this.placeholder.position.copy(old.position);
      oldRelease(old);
    }
    if (taken) this.release(taken);
    this.model.add(this.placeholder);
    registerSpriteRenderGroup(this.model, this.placeholder);
  }

  private takeSprite(): THREE.Group | undefined {
    const sprite = this.sprite;
    this.sprite = undefined;
    sprite?.removeFromParent();
    return sprite;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopVisualEffect();
    const sprite = this.sprite;
    this.sprite = undefined;
    if (sprite) this.release(sprite);
    this.matrixGate.dispose();
    this.placeholder.removeFromParent();
  }
}

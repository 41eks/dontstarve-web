import * as THREE from 'three';
import { createEffect, createMemo, createRenderEffect, getBoundWatchWorldContent, watchSignal, WorldContentKey, type ReadonlySignal } from '@dontstarve-web/signals';
import { ResidentSprite, ResidentSpriteController } from '@dontstarve-web/animation/residentSprite';
import { AnimationFollower } from './animationFollower';
import { FxAttachments, type FxRenderEntry } from './fxAttachments';
import { FollowerFxSlot } from './followerFx';
import { ArchiveEngine, type ArchiveSpriteSource, type DisplayEngine } from './displayEngine';
import { DisplaySprite, listDisplayLight, type DisplayLight } from './displaySprites';
import type { LightJson, LightState } from './lightState';
import { animStateDeclarations, type AppearanceJson, type ClipJson, type NamedSpriteArt, type SkinJson, type SpriteJson, type SpriteSourceJson, type SpriteState } from './spriteState';
import { smallHash, type ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import type { SpriteArtSource, SpriteSkin } from '@dontstarve-web/animation/sprite';
import { mergeAnimStates, resolveAnimState, type AnimStateArt, type AnimStateJson } from '@dontstarve-web/animation/animState';
import { facingFromRotation, selectsFacing } from '@dontstarve-web/animation/facing';

/** active: drawn and in the scene; asleep: nothing drawn and out of the scene; removed: everything released. */
export type PrefabStatus = 'active' | 'asleep' | 'removed';

/** The entity's shared sprite source. It owns the atlases; the display only builds and returns drawn sprites. */
export interface SpriteSource {
  /** Builds a sprite directly in `animation`; `frame` is given only for the first sprite of a held clip. */
  create(animation: string, frame?: 'first' | 'last'): THREE.Group;
  release(sprite: THREE.Group): void;
}

/**
 * A sprite source the display loads before it can draw; the entity exists and plays meanwhile, undrawn. `peek` is the
 * source when its owner has it already, so the first sprite is drawn at once.
 */
export interface LoadedSpriteSource { peek(): SpriteSource | undefined; load(): Promise<SpriteSource> }

export interface PrefabDisplayOptions {
  readonly name?: string;
  /** Draw with factory sprites; exactly one of `source` and `archive` is given. */
  readonly source?: SpriteSource | LoadedSpriteSource;
  /** Draw with a shared archive sprite. */
  readonly archive?: ArchiveSpriteSource;
  /** Transform-only entities have no art to load. The display still owns their model and lifecycle. */
  readonly empty?: boolean;
  /** Keep the entity at its foot point, offsetting only its private drawn sprite. */
  readonly alignBottom?: boolean;
  /** The entity's lifecycle, written by the logical side. */
  readonly status: ReadonlySignal<PrefabStatus>;
  /** A child shares its owner's tile residency; its own removed state still ends its display. */
  readonly parentStatus?: ReadonlySignal<PrefabStatus>;
  /** The entity's sprite json, written by the prefab. The first sprite is drawn in its clip; the rest is dressed at once. */
  readonly sprite: SpriteState;
  /** The entity's inst.Light declaration, listed for the renderer while the entity is active. */
  readonly light?: LightState;
}

const displaysByModel = new WeakMap<THREE.Object3D, PrefabDisplay>();

/** Look up display-owned resources without writing references onto the model. */
export function prefabDisplay(model: THREE.Object3D): PrefabDisplay | undefined { return displaysByModel.get(model); }

/**
 * Draws one entity. It owns the model (the engine's root) and the drawn sprite, subscribes to the entity's `status` and `sprite` signals and
 * reacts: the prefab only changes data. While asleep the model leaves the scene and returns to the same parent on wake.
 */
export class PrefabDisplay {
  private readonly engine: DisplayEngine;
  /** This display in the display layer's sprite list: its drawn instance and its sprite json. */
  private readonly listed: DisplaySprite;
  private readonly state: SpriteState;
  private readonly json: ReturnType<typeof watchSignal<SpriteJson>>;
  private readonly status: ReadonlySignal<PrefabStatus>;
  private readonly cleanups: (() => void)[] = [];
  private readonly disposalHandlers = new Set<() => void>();
  private readonly symbolNodes = new Map<THREE.Object3D, FollowerFxSlot | undefined>();
  /** Archives the AnimState names that this display is loading. */
  private readonly loadingArt = new Set<string>();
  private dressedVersion = -1;
  /** Whether the drawn sprite was given an AnimState, so that removing the last declaration clears it. */
  private animStateDressed = false;
  /** The AnimState declarations this display follows, by appearance key, with the snapshot of each it last drew. */
  private readonly animStates = new Map<string, { readonly op: Extract<AppearanceJson, { kind: 'anim-state' }>; drawn?: AnimStateJson; stop(): void }>();
  private skin?: { declaration: SkinJson; id: string | undefined; value: SpriteSkin | undefined };
  private sourceArt?: { declaration: NamedSpriteArt; value: SpriteArtSource };
  /** The deferred sprite source while this display loads it. */
  private sourceLoading?: Promise<unknown>;
  private fx!: FxAttachments;
  private readonly follower = new AnimationFollower(name => {
    if (!this.engine.setAnimation) throw new Error('This display cannot follow an animation');
    this.engine.setAnimation(name);
  });
  private disposed = false;
  // The camera rotation the drawn sprite was turned to; a sprite drawn later is turned to it too.
  private facing: THREE.Quaternion | undefined;
  private readonly cameraDirection = new THREE.Vector3();
  private asleep = false;
  private home: THREE.Object3D | undefined;
  // The owner may add the model to the scene after its tile was already found inactive.
  private readonly onAdded = () => { if (this.asleep) this.sleep(); };
  // What the controller has been given, so that each snapshot only sends what changed.
  private applied: { clip: ClipJson | undefined; queue: number; frame?: SpriteJson['frame']; transient?: SpriteJson['transient'];
    image?: number; facingImages?: SpriteJson['facingImages']; facing?: number; facingRotation?: number; mirrored?: boolean; colour?: readonly number[]; opacity?: number; paused?: boolean; erosion?: number; ground?: SpriteJson['ground']; meshOrder?: number; depthOffset?: boolean;
    skinId?: string; source?: SpriteJson['source']; tint?: SpriteJson['tint']; appearance: ReadonlyMap<string, AppearanceJson> };

  constructor(options: PrefabDisplayOptions) {
    const { archive, sprite: state } = options;
    const source = options.source ?? (options.empty ? { create: () => new THREE.Group(), release: (model: THREE.Group) => model.removeFromParent() } : undefined);
    this.state = state;
    const first = state.sprite.peek();
    const held = first.clip.finished && !first.clip.loop;
    if (archive) {
      const clip = { name: first.clip.name, loop: !held, none: first.clip.none };
      const prepare = (drawn: import('@dontstarve-web/animation/archiveSprite').ArchiveSprite) => {
        if (archive.alignBottom || options.alignBottom) {
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
      let ready = 'load' in source ? source.peek() : source;
      const create = (animation: string, frame?: 'first' | 'last') => {
        const drawn = ready?.create(animation, frame);
        if (drawn && options.alignBottom) {
          drawn.updateWorldMatrix(true, true);
          const bounds = new THREE.Box3().setFromObject(drawn);
          if (!bounds.isEmpty()) drawn.position.y -= bounds.min.y;
        }
        return drawn;
      };
      this.engine = new ResidentSpriteController(new THREE.Group(), animation => create(animation),
        drawn => ready!.release(drawn), create(first.clip.name, held ? 'last' : 'first'), { name: first.clip.name, held });
      if (options.name) this.engine.model.name = options.name;
      if (!ready && 'load' in source) this.sourceLoading = source.load().then(loaded => {
        this.sourceLoading = undefined;
        if (this.disposed) return;
        ready = loaded;
        this.applyStatus(this.status.peek());
        this.sync();
      }, (error: unknown) => { this.sourceLoading = undefined; if (!this.disposed) console.error(`Unable to load ${options.name ?? 'a sprite'}`, error); });
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
      update: dt => {
        sync(); controller.update(dt);
        this.fx.update(dt, this.json.peek());
        if (this.fx.hasComposites) controller.setComposites?.(this.fx.compositeFrames());
        this.updateSymbolFollowers(this.json.peek());
        for (const fx of this.symbolNodes.values()) fx?.update(dt);
      },
      createFollower: () => new THREE.Object3D(),
    });
    this.model.addEventListener('added', this.onAdded);
    const ownStatus = watchSignal(options.status, stop => this.cleanups.push(stop));
    const parentStatus = options.parentStatus && watchSignal(options.parentStatus, stop => this.cleanups.push(stop));
    const status = this.status = parentStatus ? createMemo<PrefabStatus>(() => {
      const own = ownStatus.get();
      return own === 'removed' ? own : own === 'asleep' || parentStatus.get() !== 'active' ? 'asleep' : 'active';
    }) : ownStatus;
    const json = this.json = watchSignal(state.sprite, stop => this.cleanups.push(stop));
    if (options.light) {
      const light = watchSignal(options.light.json, stop => this.cleanups.push(stop));
      let listed: DisplayLight | undefined;
      this.cleanups.push(createEffect(() => { listed = listDisplayLight(listed, this.model, status.get() === 'active' ? light.get() : undefined); }));
      this.cleanups.push(() => { listed = listDisplayLight(listed, this.model, undefined); });
      this.followParentedLights(options.light, status);
    }
    this.listed = new DisplaySprite(this.model, json);
    const art = watchSignal(this.engine.art, stop => this.cleanups.push(stop));
    this.cleanups.push(createEffect(() => this.applyStatus(status.get())));
    this.cleanups.push(createEffect(() => this.applySprite(json.get())));
    const followed = watchSignal(state.animationSource, stop => this.cleanups.push(stop));
    const declaredFx = watchSignal(state.fx, stop => this.cleanups.push(stop));
    this.cleanups.push(createEffect(() => this.follower.follow(followed.get())));
    this.fx = new FxAttachments(this.model, () => this.engine.setComposites?.(this.fx.compositeFrames()));
    this.cleanups.push(createEffect(() => this.fx.apply(declaredFx.get())));
    this.cleanups.push(createEffect(() => { art.get(); this.listed.setSprite(this.engine.instanced); this.sync(); this.dress(json.peek()); state.artChanged(); }));
    // A billboard turns to TheCamera itself, through its own bridge to the world's camera rotation.
    // The rotation changes every frame of a turn, so it applies before that frame renders, not a microtask later.
    // An asleep display has released its sprite, so it unsubscribes and resyncs to the camera when it wakes.
    const watchWorldContent = first.billboard ? getBoundWatchWorldContent() : undefined;
    if (watchWorldContent) {
      const active = createMemo(() => status.get() === 'active');
      this.cleanups.push(() => active.dispose());
      const camera = watchWorldContent(WorldContentKey.CameraRotation, stop => this.cleanups.push(stop), { active });
      this.cleanups.push(createRenderEffect(() => this.faceCamera(camera.get())));
    }
    displaysByModel.set(this.model, this);
  }

  get model(): THREE.Group { return this.engine.model; }

  /** Mount the display-owned model; status changes still remove and restore it at this parent. */
  mount(parent: THREE.Object3D): void {
    if (this.disposed) return;
    parent.add(this.model);
  }

  get isRemoved(): boolean { return this.disposed || this.status.peek() === 'removed'; }

  /** Source owners release their shared resources after the display has returned its last sprite. */
  onDispose(callback: () => void): () => void {
    if (this.disposed) { callback(); return () => {}; }
    this.disposalHandlers.add(callback);
    return () => { this.disposalHandlers.delete(callback); };
  }

  /** A composited child supplies frame parts to its parent's merged billboard. */
  resolveFrame(): readonly ResolvedSprite[] {
    this.applyStatus(this.status.peek());
    this.sync();
    return this.engine.getResolvedFrame?.() ?? [];
  }

  private updateSymbolFollowers(json: SpriteJson): void {
    for (const [node, fx] of this.symbolNodes) if (!json.followers?.has(node)) { fx?.dispose(); node.removeFromParent(); this.symbolNodes.delete(node); }
    for (const [node, { symbol, x, y, fx }] of json.followers ?? []) {
      if (!this.symbolNodes.has(node)) {
        this.symbolNodes.set(node, fx && new FollowerFxSlot(node, fx, this.model.name || 'a sprite'));
        this.model.add(node);
      }
      node.visible = this.engine.getSymbolPosition?.(symbol, x, y, node.position) ?? false;
    }
  }

  /** Advance a display owned by a scene collection, including standalone camera-facing FX. */
  update(dt: number, cameraRotation?: THREE.Quaternion): void {
    if (this.disposed) return;
    this.applyStatus(this.status.peek());
    if (this.isRemoved || this.asleep) return;
    if (cameraRotation && this.json.peek().billboard) this.faceCamera(cameraRotation);
    this.state.update(dt);
    // Animation completion can remove the entity during this update.
    this.applyStatus(this.status.peek());
  }

  /** Render entries of the effects that are shown now, for the owner's registry to sort with it. */
  get fxRenderEntries(): readonly FxRenderEntry[] { return this.fx.entries(); }


  /** A static archive billboard turns its drawn sprite; any other sprite turns with the model. */
  private faceCamera(rotation: THREE.Quaternion): void {
    if (this.disposed) return;
    (this.facing ??= new THREE.Quaternion()).copy(rotation);
    if (this.engine.faceCamera) this.engine.faceCamera(this.facing);
    else this.model.quaternion.copy(rotation);
    this.applyFacing(this.json.peek());
  }

  private applyFacing(json: SpriteJson): void {
    if (json.facingRotation !== undefined && this.facing) {
      const direction = this.cameraDirection.set(0, 0, -1).applyQuaternion(this.facing);
      const heading = THREE.MathUtils.radToDeg(Math.atan2(-direction.z, -direction.x));
      const facing = facingFromRotation(json.facingRotation, heading);
      const source = this.resolveSource(json.source);
      const clips = source?.animations.animations.filter(clip => clip.name === json.clip.name && clip.bankHash === source.bank);
      const clip = clips?.find(clip => clip.facing === facing) ?? clips?.find(clip => selectsFacing(clip.facing, facing).matches);
      const image = json.facingImages && [...json.facingImages].find(([mask]) => (mask & facing) !== 0)?.[1];
      if (image !== undefined) this.engine.showImage(image);
      this.engine.setFacing(facing, clip ? selectsFacing(clip.facing, facing).flipped : false);
    } else if (json.facing !== undefined) this.engine.setFacing(json.facing, json.mirrored);
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
    const source = this.resolveSource(json.source);
    if (json.source && !source) return;
    if (json.source !== applied.source) { applied.source = json.source; if (source) controller.setArtSource?.(source); }
    if (json.clip !== applied.clip) {
      const clip = json.clip;
      if (clip.none) {
        if (!controller.clearAnimation) throw new Error(`${this.model.name || 'Sprite'} cannot play no animation`);
        controller.clearAnimation();
      } else if (clip.pose) controller.setPose(clip.pose.name);
      else if (clip.percent !== undefined) controller.setPercent(clip.name, clip.percent);
      else if (clip.loop) controller.start(clip.name);
      else if (clip.finished) controller.holdLastFrame(clip.name);
      else controller.playOnce(clip.name, () => state.finish(clip));
      applied.clip = clip; applied.queue = 0; applied.frame = undefined;
      applied.paused = undefined;
    }
    for (; applied.queue < json.queue.length; applied.queue++) {
      const entry = json.queue[applied.queue];
      controller.pushAnimation(entry.name, entry.loop);
    }
    if (json.frame !== applied.frame) {
      const frame = this.frameIndex(json.frame);
      // A fractional frame waits for the clip's art; dressing the drawn sprite applies it.
      if (frame !== undefined || json.frame === undefined) applied.frame = json.frame;
      if (frame !== undefined) controller.setFrame(frame);
    }
    if (json.transient !== applied.transient) { applied.transient = json.transient; if (json.transient) controller.playTransient(json.transient.name); }
    if (json.image !== applied.image) { applied.image = json.image; if (json.image !== undefined) controller.showImage(json.image); }
    if (json.facing !== applied.facing || json.mirrored !== applied.mirrored || json.facingRotation !== applied.facingRotation || json.facingImages !== applied.facingImages) {
      applied.facing = json.facing; applied.mirrored = json.mirrored; applied.facingRotation = json.facingRotation;
      applied.facingImages = json.facingImages;
      this.applyFacing(json);
    }
    if (json.colour !== applied.colour) { applied.colour = json.colour; if (json.colour) controller.setColour(json.colour); }
    if (json.opacity !== applied.opacity) { applied.opacity = json.opacity; if (json.opacity !== undefined) controller.setOpacity(json.opacity); }
    if (json.tint !== applied.tint) { applied.tint = json.tint; if (json.tint) controller.setTint?.(json.tint); }
    if (json.paused !== applied.paused) { applied.paused = json.paused; if (json.paused !== undefined) controller.setPaused?.(json.paused); }
    if (json.erosion !== applied.erosion) { applied.erosion = json.erosion; if (json.erosion !== undefined) controller.setErosion?.(json.erosion); }
    if (json.ground !== applied.ground) { applied.ground = json.ground; if (json.ground) controller.setGround?.(json.ground.renderOrder, json.ground.flat); }
    if (json.meshOrder !== applied.meshOrder) { applied.meshOrder = json.meshOrder; if (json.meshOrder !== undefined) controller.setMeshOrder?.(json.meshOrder); }
    if (json.depthOffset !== applied.depthOffset) { applied.depthOffset = json.depthOffset; controller.setDepthOffset?.(json.depthOffset ?? false); }
    if (json.skinId !== applied.skinId || json.appearance.get('skin') !== applied.appearance.get('skin')) {
      applied.skinId = json.skinId;
      this.dress(json);
    }
    for (const [key, op] of json.appearance) {
      if (op.kind !== 'skin' && op.kind !== 'anim-state' && applied.appearance.get(key) !== op) this.dressOne(op);
    }
    applied.appearance = json.appearance;
    this.refreshAnimStates(json);
    if (this.dressedVersion !== controller.art.peek()) this.dress(json);
    this.updateSymbolFollowers(json);
  }

  /** The frame index of a json frame; a fraction resolves only once the drawn sprite knows its clip's length. */
  private frameIndex(frame: SpriteJson['frame']): number | undefined {
    if (typeof frame !== 'object') return frame;
    const frames = this.engine.loaded ? this.engine.numFrames : 0;
    return frames > 0 ? Math.min(frames - 1, Math.floor(frame.at * frames)) : undefined;
  }

  /** Every sprite that is drawn starts undressed: give it the entity's appearance again. */
  private dress(json: SpriteJson): void {
    const controller = this.engine;
    if (!controller.loaded) return;
    const source = this.resolveSource(json.source);
    if (json.source && !source) return;
    const fresh = this.dressedVersion !== controller.art.peek();
    this.dressedVersion = controller.art.peek();
    const skin = json.appearance.get('skin');
    if (skin?.kind === 'skin') this.dressSkin(skin.skin, json.skinId);
    if (source) controller.setArtSource?.(source);
    if (this.facing) controller.faceCamera?.(this.facing);
    if (json.image !== undefined) controller.showImage(json.image);
    this.applyFacing(json);
    const frame = this.frameIndex(json.frame);
    if (frame !== undefined && controller.currentAnimation === json.clip.name && (fresh || this.applied.frame !== json.frame)) {
      controller.setFrame(frame); this.applied.frame = json.frame;
    }
    if (json.colour) controller.setColour(json.colour);
    if (json.opacity !== undefined) controller.setOpacity(json.opacity);
    if (json.tint) controller.setTint?.(json.tint);
    if (json.paused !== undefined) controller.setPaused?.(json.paused);
    if (json.erosion !== undefined) controller.setErosion?.(json.erosion);
    if (json.ground) controller.setGround?.(json.ground.renderOrder, json.ground.flat);
    if (json.meshOrder !== undefined) controller.setMeshOrder?.(json.meshOrder);
    if (json.depthOffset) controller.setDepthOffset?.(true);
    for (const op of json.appearance.values()) if (op.kind !== 'skin' && op.kind !== 'anim-state') this.dressOne(op);
    this.dressAnimStates(json);
  }

  private dressOne(op: AppearanceJson): void {
    const controller = this.engine;
    switch (op.kind) {
      case 'skin': this.dressSkin(op.skin, this.json.peek().skinId); break;
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

  private async loadSource(source: NamedSpriteArt): Promise<void> {
    await Promise.all([source.art.loadAnimation(source.animationArchive),
      ...[source.buildArchive, ...source.fallbackBuilds ?? []].map(archive => source.art.loadBuild(archive))]);
  }

  private resolveSource(source: SpriteSourceJson | undefined): SpriteArtSource | undefined {
    if (!source || !('art' in source)) return source;
    if (this.sourceArt?.declaration === source) return this.sourceArt.value;
    const animations = source.art.peekAnimation(source.animationArchive), build = source.art.peekBuild(source.buildArchive);
    const fallbacks = (source.fallbackBuilds ?? []).map(archive => source.art.peekBuild(archive));
    if (animations && build && fallbacks.every(value => value !== undefined)) {
      return (this.sourceArt = { declaration: source, value: { animations, build, bank: smallHash(source.bank),
        fallbackBuilds: fallbacks as NonNullable<SpriteArtSource['fallbackBuilds']> } }).value;
    }
    if (this.engine.loaded) {
      const key = `source:${JSON.stringify([source.animationArchive, source.buildArchive, source.fallbackBuilds])}`;
      if (!this.loadingArt.has(key)) {
        this.loadingArt.add(key);
        void this.loadSource(source).then(() => {
          this.loadingArt.delete(key);
          if (!this.disposed) this.sync();
        }, (error: unknown) => {
          this.loadingArt.delete(key);
          if (!this.disposed) console.error(`Unable to load ${key} for ${this.model.name || 'a sprite'}`, error);
        });
      }
    }
    return undefined;
  }

  /** Skin assets belong to the declared owner; loading rechecks the current json before dressing anything. */
  private dressSkin(declaration: SkinJson, id: string | undefined): void {
    if (!this.engine.loaded) return;
    if (id === undefined) {
      this.skin = { declaration, id, value: undefined };
      this.engine.setSkin(undefined);
      return;
    }
    const archive = declaration.archives[id];
    if (!archive) throw new Error(`Unsupported skin ${id} for ${this.model.name || 'a sprite'}`);
    const build = declaration.art.peekBuild(archive, declaration.materialOptions);
    const banks = declaration.animationBanks?.[id] ?? [];
    const animations = banks.length ? declaration.art.peekAnimation(archive) : undefined;
    if (!build || banks.length && !animations) {
      const key = `skin:${archive}:${JSON.stringify(declaration.materialOptions)}`;
      if (!this.loadingArt.has(key)) {
        this.loadingArt.add(key);
        void this.loadSkin(declaration, id).then(() => {
          this.loadingArt.delete(key);
          if (!this.disposed && this.engine.loaded) this.dress(this.json.peek());
        }, (error: unknown) => {
          this.loadingArt.delete(key);
          if (!this.disposed) console.error(`Unable to load ${key} for ${this.model.name || 'a sprite'}`, error);
        });
      }
      return;
    }
    const previous = this.skin;
    if (previous?.declaration !== declaration || previous.id !== id || previous.value?.build !== build.build
      || previous.value?.animations !== animations) {
      this.skin = { declaration, id, value: { ...build, animations,
        symbols: declaration.symbols && new Set(declaration.symbols.map(smallHash)),
        baseSymbols: new Set(declaration.baseSymbols?.map(smallHash)), animationBanks: new Set(banks.map(smallHash)) } };
    }
    this.engine.setSkin(this.skin!.value);
  }

  private async loadSkin(declaration: SkinJson, id: string): Promise<void> {
    const archive = declaration.archives[id];
    if (!archive) throw new Error(`Unsupported skin ${id} for ${this.model.name || 'a sprite'}`);
    await Promise.all([declaration.art.loadBuild(archive, declaration.materialOptions),
      declaration.animationBanks?.[id]?.length ? declaration.art.loadAnimation(archive) : undefined]);
  }

  /** Prepare a proposed skin before a timed action, without changing the entity's declaration or drawing it. */
  async preloadSkin(id: string | undefined): Promise<void> {
    const op = this.json.peek().appearance.get('skin');
    if (op?.kind === 'skin' && id !== undefined) await this.loadSkin(op.skin, id);
  }

  /**
   * The entity's own AnimState and the slots other entities declared on it, merged in that order. Each names its art; what
   * has loaded is drawn now and the rest is loaded from that declaration's art source. Each load dresses whatever is declared
   * once it lands, so a declaration replaced meanwhile only leaves the art cached.
   */
  private dressAnimStates(json: SpriteJson): void {
    const declared = animStateDeclarations(json.appearance);
    if (declared.length === 0 && !this.animStateDressed) return;
    this.animStateDressed = declared.length > 0;
    this.engine.setAnimState?.(mergeAnimStates(declared.map(([key, op]) => {
      const snapshot = op.state.peek(), followed = this.animStates.get(key);
      if (followed?.op === op) followed.drawn = snapshot;
      const { state, missing } = resolveAnimState(snapshot, op.art);
      if (op.art) this.loadAnimStateArt(key, op.art, missing);
      return state;
    })));
  }

  /**
   * Follows each declared AnimState's own signal, as FxAttachments follows an effect's `active`: a declaration that changes
   * redraws the merged state, and one taken away stops being followed. A frame also catches a change its effect has not run for yet.
   */
  private refreshAnimStates(json: SpriteJson): void {
    const declared = new Map(animStateDeclarations(json.appearance));
    let changed = false;
    for (const [key, entry] of [...this.animStates]) {
      if (declared.get(key) === entry.op) continue;
      entry.stop(); this.animStates.delete(key); changed = true;
    }
    for (const [key, op] of declared) {
      const followed = this.animStates.get(key);
      if (followed) { changed ||= followed.drawn !== op.state.peek(); continue; }
      const entry: { op: typeof op; drawn?: AnimStateJson; stop(): void } = { op, drawn: op.state.peek(), stop: () => {} };
      this.animStates.set(key, entry);
      // The watched signal owns the effect that reads it: stopping the bridge stops both.
      const state = watchSignal(op.state, stop => { entry.stop = stop; });
      createEffect(() => { if (state.get() !== entry.drawn && !this.disposed) this.dressAnimStates(this.json.peek()); });
      changed = true;
    }
    if (changed) this.dressAnimStates(json);
  }

  /**
   * Lights other entities parent here (`LightState.declare`) stand at this model and go out while this entity is not active.
   * Each declared signal is followed as FxAttachments follows an effect's `active`; one taken away is unlisted.
   */
  private followParentedLights(light: LightState, status: ReadonlySignal<PrefabStatus>): void {
    const followed = new Map<string, { readonly source: ReadonlySignal<LightJson | undefined>; listed?: DisplayLight; stop(): void }>();
    const unlist = (key: string) => {
      const entry = followed.get(key)!;
      entry.stop();
      entry.listed = listDisplayLight(entry.listed, this.model, undefined);
      followed.delete(key);
    };
    const slots = watchSignal(light.slots, stop => this.cleanups.push(stop));
    this.cleanups.push(createEffect(() => {
      const declared = slots.get();
      for (const [key, entry] of [...followed]) if (declared.get(key) !== entry.source) unlist(key);
      for (const [key, source] of declared) {
        if (followed.has(key)) continue;
        const entry: { readonly source: typeof source; listed?: DisplayLight; stop(): void } = { source, stop: () => {} };
        followed.set(key, entry);
        // The watched signal owns the effect that reads it: stopping the bridge stops both.
        const json = watchSignal(source, stop => { entry.stop = stop; });
        createEffect(() => { entry.listed = listDisplayLight(entry.listed, this.model, status.get() === 'active' ? json.get() : undefined); });
      }
    }));
    this.cleanups.push(() => { for (const key of [...followed.keys()]) unlist(key); });
  }

  private stopAnimStates(): void {
    for (const entry of this.animStates.values()) entry.stop();
    this.animStates.clear();
  }

  private loadAnimStateArt(slot: string, art: AnimStateArt, missing: ReturnType<typeof resolveAnimState>['missing']): void {
    const load = (name: string, request: () => Promise<unknown>) => {
      const key = `${slot}:${name}`;
      if (this.loadingArt.has(key)) return;
      this.loadingArt.add(key);
      void request().then(() => {
        this.loadingArt.delete(key);
        if (!this.disposed && this.engine.loaded) this.dressAnimStates(this.json.peek());
      }, (error: unknown) => {
        this.loadingArt.delete(key);
        if (!this.disposed) console.error(`Unable to load ${name} for ${this.model.name || 'a sprite'}`, error);
      });
    };
    for (const archive of missing.builds) load(`build:${archive}`, () => art.loadBuild(archive));
    for (const archive of missing.animations) load(`anim:${archive}`, () => art.loadAnimation(archive));
  }

  /** Settles once this entity's sprite source, the art its AnimState names, its follower effects and its declared FX entities have loaded. */
  async artLoaded(): Promise<void> {
    await this.sourceLoading;
    await this.engine.pending;
    this.updateSymbolFollowers(this.json.peek());
    await Promise.all([...this.symbolNodes.values()].map(fx => fx?.loaded));
    // The FX of a fresh declaration reach their displays in a later task.
    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.all([...this.state.fx.peek().values()].map(fx => fx.display?.artLoaded()));
    for (;;) {
      if (this.disposed) return;
      const json = this.json.peek(), skin = json.appearance.get('skin');
      const requests: Promise<unknown>[] = [];
      if (json.source && 'art' in json.source && !this.resolveSource(json.source)) requests.push(this.loadSource(json.source));
      if (skin?.kind === 'skin' && json.skinId !== undefined) {
        const { art, archives, materialOptions, animationBanks } = skin.skin, archive = archives[json.skinId];
        if (!archive) throw new Error(`Unsupported skin ${json.skinId}`);
        if (!art.peekBuild(archive, materialOptions)) requests.push(art.loadBuild(archive, materialOptions));
        if (animationBanks?.[json.skinId]?.length && !art.peekAnimation(archive)) requests.push(art.loadAnimation(archive));
      }
      for (const [, op] of animStateDeclarations(json.appearance)) {
        const art = op.art;
        if (!art) continue;
        const { missing } = resolveAnimState(op.state.peek(), art);
        requests.push(...[...missing.builds].map(archive => art.loadBuild(archive)), ...[...missing.animations].map(archive => art.loadAnimation(archive)));
      }
      if (requests.length === 0) { this.applySprite(json); this.dress(json); return; }
      await Promise.all(requests);
      // The display's own load callbacks dress the sprite first.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  /** Releases the drawn sprite and the model; the shared source stays with its owner. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    displaysByModel.delete(this.model);
    this.asleep = false;
    this.home = undefined;
    this.model.removeEventListener('added', this.onAdded);
    for (const stop of this.cleanups.splice(0)) stop();
    this.stopAnimStates();
    this.follower.dispose();
    this.fx.dispose();
    this.state.bind(undefined);
    this.engine.dispose();
    this.listed.dispose();
    for (const [node, fx] of this.symbolNodes) { fx?.dispose(); node.removeFromParent(); }
    this.symbolNodes.clear();
    this.model.removeFromParent();
    for (const dispose of this.disposalHandlers) dispose();
    this.disposalHandlers.clear();
  }
}

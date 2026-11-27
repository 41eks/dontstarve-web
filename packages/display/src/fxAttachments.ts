import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type * as THREE from 'three';
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  watchSignal,
  type ReadonlySignal,
} from '@dontstarve-web/signals';
import type { ArchiveSpriteCommands, SpriteJson, SpriteState } from './spriteState';
import { smallHash, type ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import {
  SharedFramePlayer,
  type SharedArchiveFrames,
  type SharedFrameInstance,
} from '@dontstarve-web/animation/archiveSprite';
import type { CompositeSpriteFrame } from '@dontstarve-web/animation/sprite';
import type { ArchiveSpriteSource } from './displayEngine';
import type { PrefabDisplay } from './prefabDisplay';
import { ListedInstance } from './displaySprites';
import type { InstancedSprite } from '@dontstarve-web/animation/instancedArchiveSprites';

/** An effect the prefab declares for an entity, shown while `active`; fire on a burning item is one. */
interface FxOptions {
  readonly active: ReadonlySignal<boolean>;
  /** Ordered at the owner's foot point: after the owner (2) or behind it (0). */
  readonly sortLayer: number;
  /** Background children keep their declared render order rather than joining billboard sorting. */
  readonly background?: boolean;
  /** Merge the child's frame into the owner's billboard, preserving a followed symbol's layer position. */
  readonly composite?: {
    readonly symbol?: string;
    readonly detached?: { readonly position: ReadonlyVector3; readonly mirrored: boolean };
    /** AnimState:SetFinalOffset of a symbol follower: drawn behind (< 0) or in front of (> 0) the whole owner. */
    readonly finalOffset?: number;
    /** Transform:SetNoFaced: the follower keeps its single facing whatever the owner's. */
    readonly noFaced?: boolean;
    /** Follower:FollowSymbol's x/y offset, in the followed symbol's space. */
    readonly offset?: readonly [number, number];
    /** The follower's AnimState:SetScale(scale, scale), in the followed symbol's space. */
    readonly scale?: number;
  };
}

/** An effect entity drawn by its own display (including children that unload with their tile); its tags and persistence belong to its instance. */
export type DisplayedFxJson = FxOptions & { readonly sprite: ArchiveSpriteCommands; readonly display: PrefabDisplay };

/**
 * An effect whose sprite declared `plainClips`: it has no display of its own and is drawn from the frames every effect
 * of that archive shares, in the archive's plain appearance. A composited follower is merged into its owner's
 * billboard; a billboard drawn after its owner on the owner's foot is an instance in the shared batches at the owner's
 * origin.
 */
export type SharedFxJson = FxOptions & {
  readonly sprite: Pick<SpriteState, 'sprite' | 'finish' | 'settleAsleep'>;
  readonly display?: undefined;
};

export type FxJson = DisplayedFxJson | SharedFxJson;

/**
 * The display's choice: an effect that only plays clips is drawn from shared frames, merged into its owner when
 * composited and batched at its owner's origin when it is a billboard drawn after its owner; anything else is drawn by
 * its own display.
 */
function sharedFrames(fx: FxJson): ArchiveSpriteSource | undefined {
  const art = fx.composite || (!fx.background && fx.sortLayer > 1) ? fx.sprite.sprite.value.plainClips : undefined;
  if (art && fx.display) {
    throw new Error('A plain-clip follower is merged from shared frames and takes no display of its own');
  }
  if (!art && !fx.display) {
    throw new Error('An effect that is not a plain-clip follower is drawn by its own display');
  }
  return art;
}

const isShared = (fx: FxJson): fx is SharedFxJson => fx.display === undefined;

export interface FxRenderEntry {
  readonly object: THREE.Group;
  readonly footPosition: ReadonlyVector3;
  readonly cameraDepth: number;
  readonly sortLayer: number;
}

interface Attached {
  readonly fx: FxJson;
  /** The playback of a shared-frame follower. */
  readonly follower?: SharedFrameFollower;
  enabled: boolean;
  stop(): void;
  /** A billboard effect ordered at the owner's foot: its entry, listed while the effect is shown under the owner. */
  readonly sorted?: { readonly entry: FxRenderEntry; readonly shown: ReadonlySignal<boolean> };
}

const NO_ENTRIES: readonly FxRenderEntry[] = Object.freeze([]);
const NO_PARTS: readonly ResolvedSprite[] = Object.freeze([]);

/**
 * A shared-frame follower's playback, from its sprite json as a display would draw it: a clip played or looped from
 * its start, nothing while no clip plays, and its transition settled while the follower sleeps. Until the archive's
 * frames have loaded it draws nothing; the owner redraws once they have.
 */
class SharedFrameFollower {
  private player?: SharedFramePlayer;
  /** A billboard batched at its owner's origin; a composited follower has none. */
  private instance?: SharedFrameInstance;
  private readonly listed = new ListedInstance();
  private readonly root: THREE.Object3D | undefined;
  private enabled = false;
  private shown?: { name: string; index: number };
  private readonly json: ReturnType<typeof watchSignal<SpriteJson>>;
  private readonly stops: (() => void)[] = [];
  private disposed = false;
  private readonly fx: SharedFxJson;
  /** The clip the player was last given, as the sprite json declared it. */
  private playing?: SpriteJson['clip'];
  /** How many of the json's queued clips were taken for `playing`, and those still waiting for the player. */
  private queued = 0;
  private readonly waiting: { readonly name: string; readonly loop: boolean }[] = [];
  /** Whether the player is still drawing a clip that has to end before the queue moves. */
  private drawingPass = false;
  readonly loaded: Promise<void>;

  /** `root` is the owner's root for a billboard batched at it, and undefined for a composited follower. */
  constructor(fx: SharedFxJson, art: ArchiveSpriteSource, root: THREE.Object3D | undefined, loaded: () => void) {
    this.fx = fx;
    this.root = root;
    this.json = watchSignal(fx.sprite.sprite, stop => this.stops.push(stop));
    const frames = art.frames?.();
    if (!frames) {
      throw new Error('A shared-frame follower needs an archive source with shared frames');
    }
    const start = (shared: SharedArchiveFrames) => {
      if (this.disposed) {
        return;
      }
      this.player = new SharedFramePlayer(shared);
      this.instance = this.root && shared.retainAtRoot(this.root);
      // The clip follows each json the entity writes in the same task, as a display's sprite does.
      this.stops.push(createRenderEffect(() => this.apply(this.json.get())));
      loaded();
    };
    if (frames instanceof Promise) {
      this.loaded = frames.then(start, (error: unknown) => {
        if (!this.disposed) {
          console.error('Unable to load the frames of a composited follower', error);
        }
      });
    } else {
      start(frames);
      this.loaded = Promise.resolve();
    }
  }

  private apply(json: SpriteJson): void {
    const player = this.player!;
    if (json.status !== 'active') {
      this.draw();
      // Asleep, nothing is drawn: the transition ends in its completion state, as a released sprite's does.
      if (json.status === 'asleep') {
        this.fx.sprite.settleAsleep();
      }
      return;
    }
    const { clip } = json;
    if (clip !== this.playing) {
      this.playing = clip;
      this.queued = 0;
      this.waiting.length = 0;
      if (clip.none) {
        this.drawingPass = false;
        player.clear();
      } else {
        this.drawingPass = true;
        player.play(clip.name, clip.loop, () => {
          this.fx.sprite.finish(clip);
          this.advance();
        });
        if (clip.finished && !clip.loop) {
          player.settle();
        }
      }
    }
    // AnimState:PushAnimation: queued clips play once the current one-shot ends, or a loop ends its pass.
    for (; this.queued < json.queue.length; this.queued++) {
      const entry = json.queue[this.queued];
      const idle = this.waiting.length === 0;
      this.waiting.push(entry);
      if (!idle || clip.none) {
        continue;
      }
      if (!this.drawingPass) {
        this.advance();
      } else {
        player.endAfterPass(() => this.advance());
      }
    }
    this.draw();
  }

  /** The player ended what it drew: the next queued clip plays, completing in turn if it does not loop. */
  private advance(): void {
    const next = this.waiting.shift();
    if (!next) {
      this.drawingPass = false;
      return;
    }
    this.drawingPass = true;
    this.player!.play(next.name, next.loop, () => this.advance());
    if (next.loop && this.waiting.length > 0) {
      this.player!.endAfterPass(() => this.advance());
    }
  }

  /** The owner shows the effect while its `active` signal is true. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.draw();
  }

  /** A batched billboard's instance shows the player's frame while the effect is shown and active, and is listed then. */
  private draw(): void {
    const { instance, player } = this;
    if (!instance || !player) {
      return;
    }
    const name = player.clipName;
    if (this.disposed || !this.enabled || name === undefined || this.json.value.status !== 'active') {
      if (this.shown) {
        this.shown = undefined;
        instance.hide();
        this.listed.setSprite(undefined);
      }
      return;
    }
    const index = player.frameIndex;
    if (this.shown?.name !== name || this.shown.index !== index) {
      this.shown = { name, index };
      instance.show(name, index);
    }
    this.listed.setSprite(instance.sprite);
  }

  get isRemoved(): boolean {
    return this.disposed || this.json.value.status === 'removed';
  }

  /** The shared-batch instance a batched billboard is drawn by now. */
  get drawnInstance(): InstancedSprite | undefined {
    return this.listed.sprite;
  }

  update(dt: number): void {
    if (!this.isRemoved && this.json.value.status === 'active') {
      this.player?.update(dt);
      this.draw();
    }
  }

  get sprites(): readonly ResolvedSprite[] {
    return this.player?.sprites ?? NO_PARTS;
  }

  dispose(): void {
    this.disposed = true;
    for (const stop of this.stops) {
      stop();
    }
    this.listed.setSprite(undefined);
    this.instance?.dispose();
  }
}

/**
 * Shows each declared effect as a child of its owner's model, as DST adds `fx` with AddChild: it follows the owner's
 * position, and it is in the scene only while the owner is. Each billboard display applies the camera facing.
 * Declaring a different effect for a key, or none, takes the old one away; the effect's own sprite stays with the prefab
 * that made it.
 */
export class FxAttachments {
  private readonly owner: THREE.Group;
  private readonly attached = new Map<string, Attached>();
  /** The attached effects that order at the owner's foot, whether shown now or not. */
  private readonly sorted = createSignal<readonly Attached[]>([]);
  private readonly changed: () => void;
  /** Entries for the effects shown under the owner now, ordered with it. */
  readonly renderEntries = createMemo(() => {
    let entries: FxRenderEntry[] | undefined;
    for (const { sorted } of this.sorted.get()) {
      if (sorted!.shown.get()) {
        (entries ??= []).push(sorted!.entry);
      }
    }
    return entries ?? NO_ENTRIES;
  });

  constructor(owner: THREE.Group, changed: () => void = () => {}) {
    this.owner = owner;
    this.changed = changed;
  }

  apply(declared: ReadonlyMap<string, FxJson> | undefined): void {
    let compositesChanged = false;
    for (const [key, entry] of [...this.attached]) {
      if (declared?.get(key) === entry.fx) {
        continue;
      }
      compositesChanged ||= entry.fx.composite !== undefined;
      this.detach(key, entry);
    }
    for (const [key, fx] of declared ?? []) {
      if (!this.attached.has(key)) {
        compositesChanged ||= fx.composite !== undefined;
        this.attach(key, fx);
      }
    }
    if (compositesChanged) {
      this.changed();
    }
  }

  private attach(key: string, fx: FxJson): void {
    const stops: (() => void)[] = [];
    // The watched signals own the effect and memo that read them: stopping the bridges stops those too.
    const active = watchSignal(fx.active, stop => stops.push(stop));
    let follower: SharedFrameFollower | undefined;
    let sorted: Attached['sorted'];
    // The json chooses: a shared follower has its art, and every other effect its display.
    const art = sharedFrames(fx);
    if (isShared(fx)) {
      const composited = fx.composite !== undefined;
      follower = new SharedFrameFollower(fx, art!, composited ? undefined : this.owner, () => {
        if (composited) {
          this.changed();
        }
      });
      stops.push(() => follower!.dispose());
    } else {
      const model = fx.display.model;
      if (!fx.background && !fx.composite) {
        const status = watchSignal(fx.display.status, stop => stops.push(stop));
        // Under the owner while enabled, until its own display sleeps or is removed.
        const shown = createMemo(() => active.get() && status.get() === 'active');
        stops.push(() => shown.dispose());
        const entry = { object: model, footPosition: this.owner.position, cameraDepth: 0, sortLayer: fx.sortLayer };
        sorted = { entry, shown };
      }
      // A billboard effect is drawn under the owner, so its own display takes no foot order of its own.
      if (!fx.composite) {
        fx.display.setAttachedAsFx(true);
      }
      model.position.set(0, 0, 0);
      // Drawn after its owner on the owner's foot: a batched instance of it takes that sort layer too.
      if (!fx.composite && fx.sortLayer > 1) {
        fx.sprite.setDepthOffset(true);
      }
    }
    const entry: Attached = {
      fx,
      follower,
      enabled: fx.active.value,
      stop: () => {
        for (const stop of stops) {
          stop();
        }
      },
      sorted,
    };
    this.attached.set(key, entry);
    if (sorted) {
      this.sorted.set([...this.sorted.value, entry]);
    }
    createEffect(() => {
      entry.enabled = active.get();
      follower?.setEnabled(entry.enabled);
      if (fx.composite) {
        this.changed();
        return;
      }
      if (follower) {
        return;
      }
      const { model } = (fx as DisplayedFxJson).display;
      if (entry.enabled) {
        this.owner.add(model);
      } else {
        model.removeFromParent();
      }
    });
  }

  private detach(key: string, entry: Attached): void {
    if (entry.sorted) {
      this.sorted.set(this.sorted.value.filter(other => other !== entry));
    }
    const { fx } = entry;
    if (!isShared(fx) && !fx.composite) {
      fx.display.setAttachedAsFx(false);
    }
    entry.stop();
    if (!isShared(fx)) {
      if (!fx.composite && fx.sortLayer > 1) {
        fx.sprite.setDepthOffset(false);
      }
      fx.display.model.removeFromParent();
    }
    this.attached.delete(key);
  }

  get hasComposites(): boolean {
    return [...this.attached.values()].some(({ fx }) => fx.composite !== undefined);
  }

  /** The shared-batch instances the effects without a display of their own are drawn by now. */
  get batchedEffects(): readonly InstancedSprite[] {
    return [...this.attached.values()].flatMap(({ follower }) => follower?.drawnInstance ?? []);
  }

  /** Settles once the shared frames of the attached followers have loaded. */
  framesLoaded(): Promise<unknown> {
    return Promise.all([...this.attached.values()].map(({ follower }) => follower?.loaded));
  }

  compositeFrames(): readonly CompositeSpriteFrame[] {
    return [...this.attached.values()].flatMap(({ fx, follower, enabled }) => {
      const composite = fx.composite;
      if (!enabled || !composite || (follower ? follower.isRemoved : (fx as DisplayedFxJson).display.isRemoved)) {
        return [];
      }
      return [
        {
          sprites: follower ? follower.sprites : (fx as DisplayedFxJson).display.resolveFrame(),
          symbol: composite.symbol === undefined ? undefined : smallHash(composite.symbol),
          detached: composite.detached,
          finalOffset: composite.finalOffset,
          noFaced: composite.noFaced,
          offset: composite.offset,
          scale: composite.scale,
        },
      ];
    });
  }

  update(dt: number, owner?: SpriteJson): void {
    for (const { fx, follower, enabled } of this.attached.values()) {
      if (isShared(fx)) {
        if (enabled) {
          follower!.update(dt);
        }
      } else if (fx.composite && enabled) {
        if (owner?.facing !== undefined && !fx.composite.noFaced) {
          (fx.sprite as SpriteState).setFacing(owner.facing);
        }
        fx.sprite.update(dt);
      } else if (fx.display.model.parent === this.owner) {
        fx.display.update(dt);
      }
    }
  }

  dispose(): void {
    for (const [key, entry] of [...this.attached]) {
      this.detach(key, entry);
    }
    this.renderEntries.dispose();
  }
}

import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type * as THREE from 'three';
import { createEffect, createMemo, createSignal, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import type { ArchiveSpriteCommands, SpriteJson } from './spriteState';
import { smallHash } from '@dontstarve-web/animation/animationAssets';
import type { CompositeSpriteFrame } from '@dontstarve-web/animation/sprite';
import type { PrefabDisplay } from './prefabDisplay';

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
  };
}

/** An effect entity drawn by its own display (including children that unload with their tile); its tags and persistence belong to its instance. */
export type FxJson = FxOptions & { readonly sprite: ArchiveSpriteCommands; readonly display: PrefabDisplay };

const fxModel = (fx: FxJson): THREE.Group => fx.display.model;

export interface FxRenderEntry {
  readonly object: THREE.Group;
  readonly footPosition: ReadonlyVector3;
  readonly cameraDepth: number;
  readonly sortLayer: number;
}

interface Attached {
  readonly fx: FxJson;
  enabled: boolean;
  stop(): void;
  /** A billboard effect ordered at the owner's foot: its entry, listed while the effect is shown under the owner. */
  readonly sorted?: { readonly entry: FxRenderEntry; readonly shown: ReadonlySignal<boolean> };
}

const NO_ENTRIES: readonly FxRenderEntry[] = Object.freeze([]);

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
  private readonly ownerBatched: () => boolean;
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

  /** `ownerBatched`: whether the owner's last frame was drawn by the shared batches. */
  constructor(owner: THREE.Group, changed: () => void = () => {}, ownerBatched: () => boolean = () => false) {
    this.owner = owner;
    this.changed = changed;
    this.ownerBatched = ownerBatched;
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
    const model = fxModel(fx);
    let sorted: Attached['sorted'];
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
    const entry: Attached = {
      fx,
      enabled: fx.active.peek(),
      stop: () => {
        for (const stop of stops) {
          stop();
        }
      },
      sorted,
    };
    this.attached.set(key, entry);
    if (sorted) {
      this.sorted.set([...this.sorted.peek(), entry]);
    }
    model.position.set(0, 0, 0);
    // Drawn after its owner on the owner's plane: the owner's depth (an instance batch writes it) must not hide it.
    if (!fx.composite && fx.sortLayer > 1) {
      fx.sprite.setDepthOffset(true);
    }
    // Every batch draws before the ordinary billboards: a batched effect stays ordered with its owner only while the
    // owner is batched too, and is otherwise its own billboard, sorted against the owner's.
    if (!fx.composite) {
      fx.display.setInstancedWhile(this.ownerBatched);
    }
    createEffect(() => {
      entry.enabled = active.get();
      if (fx.composite) {
        this.changed();
        return;
      }
      if (entry.enabled) {
        this.owner.add(model);
      } else {
        model.removeFromParent();
      }
    });
  }

  private detach(key: string, entry: Attached): void {
    if (entry.sorted) {
      this.sorted.set(this.sorted.peek().filter(other => other !== entry));
    }
    if (!entry.fx.composite) {
      entry.fx.display.setAttachedAsFx(false);
    }
    entry.stop();
    if (!entry.fx.composite && entry.fx.sortLayer > 1) {
      entry.fx.sprite.setDepthOffset(false);
    }
    if (!entry.fx.composite) {
      entry.fx.display.setInstancedWhile(undefined);
    }
    fxModel(entry.fx).removeFromParent();
    this.attached.delete(key);
  }

  get hasComposites(): boolean {
    return [...this.attached.values()].some(({ fx }) => fx.composite !== undefined);
  }

  compositeFrames(): readonly CompositeSpriteFrame[] {
    return [...this.attached.values()].flatMap(({ fx, enabled }) =>
      enabled && fx.composite && !fx.display.isRemoved
        ? [
            {
              sprites: fx.display.resolveFrame(),
              symbol: fx.composite.symbol === undefined ? undefined : smallHash(fx.composite.symbol),
              detached: fx.composite.detached,
              finalOffset: fx.composite.finalOffset,
              noFaced: fx.composite.noFaced,
              offset: fx.composite.offset,
            },
          ]
        : [],
    );
  }

  update(dt: number, owner?: SpriteJson): void {
    for (const { fx, enabled } of this.attached.values()) {
      if (fx.composite && enabled) {
        if (owner?.facing !== undefined && !fx.composite.noFaced) {
          (fx.sprite as import('./spriteState').SpriteState).setFacing(owner.facing);
        }
        fx.sprite.update(dt);
      } else if (fxModel(fx).parent === this.owner) {
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

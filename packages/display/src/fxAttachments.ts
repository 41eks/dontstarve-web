import type * as THREE from 'three';
import { createEffect, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import type { ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
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
  readonly composite?: { readonly symbol?: string; readonly detached?: { readonly position: THREE.Vector3; readonly mirrored: boolean } };
}

/** Prepared art, or an entity drawn by its own display (including children that unload with their tile). */
export type FxJson = FxOptions & (
  /** Tags the source adds to the effect entity (`FX`, `HASHEATER`). */
  | { readonly sprite: ArchiveSprite; readonly display?: undefined; readonly tags: readonly string[] }
  /** A drawn entity's tags and persistence belong to its own instance. */
  | { readonly sprite: ArchiveSpriteCommands; readonly display: PrefabDisplay; readonly tags?: undefined }
);

const fxModel = (fx: FxJson): THREE.Group => fx.display ? fx.display.model : (fx.sprite as ArchiveSprite).model;

export interface FxRenderEntry {
  readonly object: THREE.Group;
  readonly footPosition: THREE.Vector3;
  readonly cameraDepth: number;
  readonly sortLayer: number;
}

interface Attached { readonly fx: FxJson; enabled: boolean; stop(): void }

const NO_ENTRIES: readonly FxRenderEntry[] = Object.freeze([]);

/**
 * Shows each declared effect as a child of its owner's model, as DST adds `fx` with AddChild: it follows the owner's
 * position and camera facing, and it is in the scene only while the owner is. Declaring a different effect for a key,
 * or none, takes the old one away; the effect's own sprite stays with the prefab that made it.
 */
export class FxAttachments {
  private readonly owner: THREE.Group;
  private readonly attached = new Map<string, Attached>();
  private readonly changed: () => void;

  constructor(owner: THREE.Group, changed: () => void = () => {}) { this.owner = owner; this.changed = changed; }

  apply(declared: ReadonlyMap<string, FxJson> | undefined): void {
    let compositesChanged = false;
    for (const [key, entry] of [...this.attached]) {
      if (declared?.get(key) === entry.fx) continue;
      compositesChanged ||= entry.fx.composite !== undefined;
      this.detach(key, entry);
    }
    for (const [key, fx] of declared ?? []) if (!this.attached.has(key)) {
      compositesChanged ||= fx.composite !== undefined;
      this.attach(key, fx);
    }
    if (compositesChanged) this.changed();
  }

  private attach(key: string, fx: FxJson): void {
    const entry: Attached = { fx, enabled: fx.active.peek(), stop: () => {} };
    this.attached.set(key, entry);
    const model = fxModel(fx);
    if (!fx.display) { model.userData.tags = [...fx.tags]; model.userData.persists = false; }
    model.position.set(0, 0, 0);
    // Drawn after its owner on the owner's plane: the owner's depth (an instance batch writes it) must not hide it.
    if (!fx.composite && fx.sortLayer > 1) fx.sprite.setDepthOffset(true);
    // The watched signal owns the effect that reads it: stopping the bridge stops both.
    const active = watchSignal(fx.active, stop => { entry.stop = stop; });
    createEffect(() => {
      entry.enabled = active.get();
      if (fx.composite) { this.changed(); return; }
      if (entry.enabled) this.owner.add(model);
      else model.removeFromParent();
    });
  }

  private detach(key: string, entry: Attached): void {
    entry.stop();
    if (!entry.fx.composite && entry.fx.sortLayer > 1) entry.fx.sprite.setDepthOffset(false);
    fxModel(entry.fx).removeFromParent();
    this.attached.delete(key);
  }

  get hasComposites(): boolean { return [...this.attached.values()].some(({ fx }) => fx.composite !== undefined); }

  compositeFrames(): readonly CompositeSpriteFrame[] {
    return [...this.attached.values()].flatMap(({ fx, enabled }) => enabled && fx.composite && fx.display && !fx.display.isRemoved
      ? [{ sprites: fx.display.resolveFrame(), symbol: fx.composite.symbol === undefined ? undefined : smallHash(fx.composite.symbol), detached: fx.composite.detached }] : []);
  }

  update(dt: number, owner?: SpriteJson): void {
    for (const { fx, enabled } of this.attached.values()) {
      if (fx.composite && enabled) {
        if (owner?.facing !== undefined) (fx.sprite as import('./spriteState').SpriteState).setFacing(owner.facing);
        fx.sprite.update(dt);
      } else if (fxModel(fx).parent === this.owner) fx.sprite.update(dt);
    }
  }

  /** Entries for the effects that are shown, ordered with the owner. */
  entries(): readonly FxRenderEntry[] {
    // Most owners show no effect; they share one empty list instead of allocating one per frame.
    if (this.attached.size === 0) return NO_ENTRIES;
    const entries: FxRenderEntry[] = [];
    for (const { fx } of this.attached.values()) {
      const model = fxModel(fx);
      if (fx.background || fx.composite || model.parent !== this.owner) continue;
      entries.push({ object: model, footPosition: this.owner.position, cameraDepth: 0, sortLayer: fx.sortLayer });
    }
    return entries;
  }

  dispose(): void {
    for (const [key, entry] of [...this.attached]) this.detach(key, entry);
  }
}

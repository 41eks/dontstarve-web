import type * as THREE from 'three';
import { createEffect, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import type { ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { ArchiveSpriteCommands } from './spriteState';
import type { PrefabDisplay } from './prefabDisplay';

/** An effect the prefab declares for an entity, shown while `active`; fire on a burning item is one. */
interface FxOptions {
  readonly active: ReadonlySignal<boolean>;
  /** Drawn in the owner's sort group, after the owner (2). */
  readonly sortLayer: number;
  /** Background children keep their declared render order rather than joining billboard sorting. */
  readonly background?: boolean;
}

/** Prepared art, or an entity drawn by its own display (including children that unload with their tile). */
export type FxJson = FxOptions & (
  /** Tags the source adds to the effect entity (`FX`, `HASHEATER`). */
  | { readonly sprite: ArchiveSprite; readonly display?: undefined; readonly tags: readonly string[] }
  /** A drawn entity's tags belong to its own instance. */
  | { readonly sprite: ArchiveSpriteCommands; readonly display: PrefabDisplay; readonly tags?: undefined }
);

const fxModel = (fx: FxJson): THREE.Group => fx.display ? fx.display.model : (fx.sprite as ArchiveSprite).model;

export interface FxRenderEntry {
  readonly object: THREE.Group;
  readonly footPosition: THREE.Vector3;
  readonly cameraDepth: number;
  readonly sortGroup: number;
  readonly sortLayer: number;
}

interface Attached { readonly fx: FxJson; stop(): void }

/**
 * Shows each declared effect as a child of its owner's model, as DST adds `fx` with AddChild: it follows the owner's
 * position and camera facing, and it is in the scene only while the owner is. Declaring a different effect for a key,
 * or none, takes the old one away; the effect's own sprite stays with the prefab that made it.
 */
export class FxAttachments {
  private readonly owner: THREE.Group;
  private readonly attached = new Map<string, Attached>();

  constructor(owner: THREE.Group) { this.owner = owner; }

  apply(declared: ReadonlyMap<string, FxJson> | undefined): void {
    for (const [key, entry] of [...this.attached]) {
      if (declared?.get(key) === entry.fx) continue;
      this.detach(key, entry);
    }
    if (!declared) return;
    for (const [key, fx] of declared) if (!this.attached.has(key)) this.attach(key, fx);
  }

  private attach(key: string, fx: FxJson): void {
    const entry: Attached = { fx, stop: () => {} };
    this.attached.set(key, entry);
    const model = fxModel(fx);
    if (!fx.display) model.userData.tags = [...fx.tags];
    model.userData.persists = false;
    model.position.set(0, 0, 0);
    // The watched signal owns the effect that reads it: stopping the bridge stops both.
    const active = watchSignal(fx.active, stop => { entry.stop = stop; });
    createEffect(() => {
      if (active.get()) this.owner.add(model);
      else model.removeFromParent();
    });
  }

  private detach(key: string, entry: Attached): void {
    entry.stop();
    fxModel(entry.fx).removeFromParent();
    this.attached.delete(key);
  }

  update(dt: number): void {
    for (const { fx } of this.attached.values()) if (fxModel(fx).parent === this.owner) fx.sprite.update(dt);
  }

  /** Entries for the effects that are shown, ordered with the owner. */
  entries(): FxRenderEntry[] {
    const entries: FxRenderEntry[] = [];
    for (const { fx } of this.attached.values()) {
      const model = fxModel(fx);
      if (fx.background || model.parent !== this.owner) continue;
      entries.push({ object: model, footPosition: this.owner.position, cameraDepth: 0, sortGroup: this.owner.id, sortLayer: fx.sortLayer });
    }
    return entries;
  }

  dispose(): void {
    for (const [key, entry] of [...this.attached]) this.detach(key, entry);
  }
}

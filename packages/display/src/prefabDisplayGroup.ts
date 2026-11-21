import { retainEntityRootUpdates, type ReadonlyVector3 } from '../../animation/src/transformRoot';
import type * as THREE from 'three';
import { createEffect, createRenderEffect } from '@dontstarve-web/signals';
import { PrefabDisplay, type PrefabDisplayOptions } from './prefabDisplay';
import type { FxRenderEntry } from './fxAttachments';

type DisplayRenderEntry =
  | {
      readonly object: THREE.Group;
      readonly footPosition: ReadonlyVector3;
      readonly cameraDepth: number;
      readonly sortLayer?: number;
    }
  | FxRenderEntry;

const NO_ENTRIES: readonly DisplayRenderEntry[] = Object.freeze([]);

/** Scene ownership, frame updates and foot-point sorting for independently declared prefab displays. */
export class PrefabDisplayGroup {
  /** Every mounted display, for its final cleanup. */
  private readonly entries = new Set<PrefabDisplay>();
  /** Those not asleep: a sleeping display leaves frame updates and the render list until it wakes. */
  private readonly awake = new Map<PrefabDisplay, ReadonlyVector3>();
  /**
   * The foot-sorted entries of the awake displays and their shown effects. Each display lists and unlists its own as
   * its status, sprite json and effects change, so a frame only reads the list.
   */
  private readonly sortEntries: DisplayRenderEntry[] = [];
  private readonly sortIndex = new Map<DisplayRenderEntry, number>();
  private disposed = false;
  private readonly scene: THREE.Scene;

  /** The scene's matrix update settles only the entity roots marked since the last one. */
  private readonly releaseRootUpdates: () => void;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.releaseRootUpdates = retainEntityRootUpdates(scene);
  }

  add(options: PrefabDisplayOptions, footPosition?: ReadonlyVector3): PrefabDisplay {
    if (this.disposed) {
      throw new Error('Prefab displays have been disposed');
    }
    const display = new PrefabDisplay(options);
    this.mount(display, footPosition);
    return display;
  }

  /** Adopt an existing display; the group owns its scene membership and final display cleanup. */
  mount(display: PrefabDisplay, footPosition?: ReadonlyVector3): void {
    if (this.disposed) {
      throw new Error('Prefab displays have been disposed');
    }
    if (display.isRemoved) {
      return;
    }
    if (this.entries.has(display)) {
      display.mount(this.scene);
      return;
    }
    this.entries.add(display);
    const foot = footPosition ?? display.model.position;
    const stopFollowing = createEffect(() => {
      if (display.status.get() === 'asleep') {
        this.awake.delete(display);
      } else {
        this.awake.set(display, foot);
      }
    });
    const own = { object: display.model, footPosition: foot, cameraDepth: 0 };
    const behindFoot = { ...own, sortLayer: 0 },
      afterFoot = { ...own, sortLayer: 2 };
    let listed = NO_ENTRIES;
    // In the task that wakes, spawns or removes the entity: the frame that follows orders it.
    const stopListing = createRenderEffect(() => {
      let next = NO_ENTRIES;
      if (display.status.get() === 'active' && display.visible.get()) {
        const layer = display.footSortLayer.get();
        const fx = display.fxRenderEntries.get();
        next = layer === undefined ? fx : [layer === 0 ? behindFoot : layer === 2 ? afterFoot : own, ...fx];
      }
      for (const entry of listed) {
        if (!next.includes(entry)) {
          this.unlist(entry);
        }
      }
      for (const entry of next) {
        this.list(entry);
      }
      listed = next;
    });
    display.onDispose(() => {
      stopFollowing();
      stopListing();
      for (const entry of listed) {
        this.unlist(entry);
      }
      listed = NO_ENTRIES;
      this.entries.delete(display);
      this.awake.delete(display);
    });
    display.mount(this.scene);
  }

  private list(entry: DisplayRenderEntry): void {
    if (!this.sortIndex.has(entry)) {
      this.sortIndex.set(entry, this.sortEntries.length);
      this.sortEntries.push(entry);
    }
  }

  /** Order across the list is free: each entry takes its own key. The last entry fills the gap. */
  private unlist(entry: DisplayRenderEntry): void {
    const index = this.sortIndex.get(entry);
    if (index === undefined) {
      return;
    }
    this.sortIndex.delete(entry);
    const last = this.sortEntries.pop()!;
    if (last !== entry) {
      this.sortEntries[index] = last;
      this.sortIndex.set(last, index);
    }
  }

  /** The awake displays' foot-sorted entries; the same list, kept current as displays change. */
  get renderEntities(): readonly DisplayRenderEntry[] {
    return this.sortEntries;
  }

  update(dt: number): void {
    for (const display of this.awake.keys()) {
      display.update(dt);
      if (display.isRemoved) {
        display.dispose();
      }
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const display of this.entries) {
      display.dispose();
    }
    this.entries.clear();
    this.awake.clear();
    this.sortEntries.length = 0;
    this.sortIndex.clear();
    this.releaseRootUpdates();
  }
}

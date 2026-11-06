import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type * as THREE from 'three';
import { createEffect } from '@dontstarve-web/signals';
import { PrefabDisplay, type PrefabDisplayOptions } from './prefabDisplay';
import type { FxRenderEntry } from './fxAttachments';

/** Scene ownership, frame updates and foot-point sorting for independently declared prefab displays. */
export class PrefabDisplayGroup {
  /** Every mounted display, for its final cleanup. */
  private readonly entries = new Set<PrefabDisplay>();
  /** Those not asleep: a sleeping display leaves frame updates and the render list until it wakes. */
  private readonly awake = new Map<PrefabDisplay, ReadonlyVector3>();
  private disposed = false;
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) { this.scene = scene; }

  add(options: PrefabDisplayOptions, footPosition?: ReadonlyVector3): PrefabDisplay {
    if (this.disposed) throw new Error('Prefab displays have been disposed');
    const display = new PrefabDisplay(options);
    this.mount(display, footPosition);
    return display;
  }

  /** Adopt an existing display; the group owns its scene membership and final display cleanup. */
  mount(display: PrefabDisplay, footPosition?: ReadonlyVector3): void {
    if (this.disposed) throw new Error('Prefab displays have been disposed');
    if (display.isRemoved) return;
    if (this.entries.has(display)) { display.mount(this.scene); return; }
    this.entries.add(display);
    const foot = footPosition ?? display.model.position;
    const stopFollowing = createEffect(() => {
      if (display.status.get() === 'asleep') this.awake.delete(display);
      else this.awake.set(display, foot);
    });
    display.onDispose(() => { stopFollowing(); this.entries.delete(display); this.awake.delete(display); });
    display.mount(this.scene);
  }

  get renderEntities() {
    const entries: ({ object: THREE.Group; footPosition: ReadonlyVector3; cameraDepth: number; sortLayer?: number } | FxRenderEntry)[] = [];
    for (const [display, footPosition] of this.awake) {
      const { model } = display;
      if (model.parent !== this.scene || !model.visible || display.isRemoved) continue;
      if (!display.hasGroundOrder) {
        const sortLayer = display.sortLayer;
        entries.push(sortLayer === undefined ? { object: model, footPosition, cameraDepth: 0 } : { object: model, footPosition, cameraDepth: 0, sortLayer });
      }
      for (const entry of display.fxRenderEntries) entries.push(entry);
    }
    return entries;
  }

  update(dt: number, cameraRotation?: THREE.Quaternion): void {
    for (const display of this.awake.keys()) {
      display.update(dt, cameraRotation);
      if (display.isRemoved) display.dispose();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const display of this.entries) display.dispose();
    this.entries.clear(); this.awake.clear();
  }
}

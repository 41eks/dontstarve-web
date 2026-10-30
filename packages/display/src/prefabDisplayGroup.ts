import type * as THREE from 'three';
import { PrefabDisplay, type PrefabDisplayOptions } from './prefabDisplay';

/** Scene ownership, frame updates and foot-point sorting for independently declared prefab displays. */
export class PrefabDisplayGroup {
  private readonly entries = new Map<PrefabDisplay, THREE.Vector3>();
  private disposed = false;
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) { this.scene = scene; }

  add(options: PrefabDisplayOptions, footPosition?: THREE.Vector3): PrefabDisplay {
    if (this.disposed) throw new Error('Prefab displays have been disposed');
    const display = new PrefabDisplay(options);
    this.mount(display, footPosition);
    return display;
  }

  /** Adopt an existing display; the group owns its scene membership and final display cleanup. */
  mount(display: PrefabDisplay, footPosition?: THREE.Vector3): void {
    if (this.disposed) throw new Error('Prefab displays have been disposed');
    if (display.isRemoved) return;
    if (this.entries.has(display)) { display.mount(this.scene); return; }
    this.entries.set(display, footPosition ?? display.model.position);
    display.onDispose(() => this.entries.delete(display));
    display.mount(this.scene);
  }

  get renderEntities() {
    return [...this.entries].filter(([display]) => !display.isRemoved && display.model.visible && display.model.parent === this.scene)
      .flatMap(([display, footPosition]) => [{ object: display.model, footPosition, cameraDepth: 0 }, ...display.fxRenderEntries]);
  }

  update(dt: number, cameraRotation?: THREE.Quaternion): void {
    for (const display of this.entries.keys()) {
      display.update(dt, cameraRotation);
      if (display.isRemoved) {
        display.dispose();
        this.entries.delete(display);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const display of this.entries.keys()) display.dispose();
    this.entries.clear();
  }
}

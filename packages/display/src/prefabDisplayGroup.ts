import type * as THREE from 'three';
import { PrefabDisplay, type PrefabDisplayOptions } from './prefabDisplay';

/** Scene ownership, frame updates and foot-point sorting for independently declared prefab displays. */
export class PrefabDisplayGroup {
  private readonly entries = new Map<PrefabDisplay, THREE.Vector3>();
  private disposed = false;
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) { this.scene = scene; }

  add(options: PrefabDisplayOptions, footPosition: THREE.Vector3): PrefabDisplay {
    if (this.disposed) throw new Error('Prefab displays have been disposed');
    const display = new PrefabDisplay(options);
    this.entries.set(display, footPosition);
    this.scene.add(display.model);
    return display;
  }

  get renderEntities() {
    return [...this.entries].filter(([display]) => !display.isRemoved && display.model.visible && display.model.parent === this.scene)
      .map(([display, footPosition]) => ({ object: display.model, footPosition, cameraDepth: 0 }));
  }

  update(dt: number, cameraRotation: THREE.Quaternion): void {
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

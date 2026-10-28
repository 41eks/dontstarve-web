import type * as THREE from 'three';
import type { PrefabDisplay } from '@dontstarve-web/display';

/** Shared manager lifecycle. A manager owns its entities, save records and resources. */
export interface PrefabManager<ExportRecord = unknown> {
  exportRecords(): readonly ExportRecord[];
  dispose(): void;
}

/** The scene advances registered displays; this manager has no per-frame work. */
export interface DisplayDrivenPrefabManager<ExportRecord = unknown> extends PrefabManager<ExportRecord> {
  readonly update?: never;
  readonly beforePhysics?: never;
}

/** Managers with entity simulation that genuinely needs a scene frame. */
export interface FrameUpdatedPrefabManager<ExportRecord = unknown> extends PrefabManager<ExportRecord> {
  update(dt: number, cameraQuaternion: THREE.Quaternion): void;
}

/** Required scene hook for every display owned by a display-driven manager. */
export interface DisplayManagerWorld {
  trackDisplay(display: PrefabDisplay): void;
}

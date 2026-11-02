import type * as THREE from 'three';
import { createEffect, watchSignal, type ReadonlySignal, type TileStateQuery } from '@dontstarve-web/signals';
import { TileTracker } from '../../componets/src/tileManager';

/**
 * OnEntitySleep/OnEntityWake for a stationary entity: follows the tickingarea memo of the tile under `model`
 * through a private signal. Without a query the entity is always awake. The returned function releases the view.
 * An entity that moves passes its own tracker's `tile`, which it keeps up to date.
 */
export function watchTileActivity(model: THREE.Object3D, tickingarea: TileStateQuery | undefined, onActive: (active: boolean) => void,
  tile: ReadonlySignal<number> = new TileTracker(() => model.position).tile): () => void {
  const area = tickingarea?.(tile);
  if (!area) { onActive(true); return () => {}; }
  let stop = () => {};
  const active = watchSignal(area, cleanup => { stop = cleanup; });
  createEffect(() => onActive(active.get()));
  return () => { stop(); area.dispose(); };
}

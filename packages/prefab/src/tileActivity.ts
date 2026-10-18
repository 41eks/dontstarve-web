import type * as THREE from 'three';
import { createEffect, watchSignal, type TileStateQuery } from '@dontstarve-web/signals';
import { TileTracker } from '../../componets/src/tileManager';

/**
 * OnEntitySleep/OnEntityWake for a stationary entity: follows the tickingarea memo of the tile under `model`
 * through a private signal. Without a query the entity is always awake. The returned function releases the view.
 */
export function watchTileActivity(model: THREE.Object3D, tickingarea: TileStateQuery | undefined, onActive: (active: boolean) => void): () => void {
  const area = tickingarea?.(new TileTracker(() => model.position).tile);
  if (!area) { onActive(true); return () => {}; }
  let stop = () => {};
  const active = watchSignal(area, cleanup => { stop = cleanup; });
  createEffect(() => onActive(active.get()));
  return () => { stop(); area.dispose(); };
}

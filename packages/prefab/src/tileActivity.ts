import type * as THREE from 'three';
import { createEffect, watchSignal, type TileStateQuery } from '@dontstarve-web/signals';
import { prefabInstance } from './prefabInstance';

/**
 * Follow the entity transform's shared tile activity. Without a query the entity stays awake.
 * Releasing this view retains the query until the transform's final consumer leaves.
 */
export function watchTileActivity(model: THREE.Object3D, tickingarea: TileStateQuery | undefined, onActive: (active: boolean) => void): () => void {
  if (!tickingarea) { onActive(true); return () => {}; }
  const instance = prefabInstance(model);
  if (!instance) throw new Error('Tile activity needs an entity-owned transform');
  instance.tileTracker.sync();
  const cleanups: (() => void)[] = [];
  const area = instance.transform.getTileActivity(tickingarea, stop => cleanups.push(stop));
  const release = () => cleanups.splice(0).reverse().forEach(stop => stop());
  if (!area) { onActive(true); return release; }
  const active = watchSignal(area, stop => cleanups.push(stop));
  createEffect(() => onActive(active.get()));
  return release;
}

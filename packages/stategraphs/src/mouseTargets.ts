import type { Object3D } from 'three';
import { retainSpatialEntity } from './entitySpatialIndex.ts';

const targets = new Set<Object3D>();
export function isMouseTarget(model: Object3D): boolean { return targets.has(model); }

/** Engine mouse targets are registered independently of which actions currently succeed. */
export function registerMouseTarget(model: Object3D, enabled: () => boolean) {
  const spatial = retainSpatialEntity(model);
  let disposed = false;
  const refresh = () => {
    if (!disposed && model.parent && enabled()) targets.add(model);
    else targets.delete(model);
    spatial.setMouse(targets.has(model));
  };
  model.addEventListener('added', refresh);
  model.addEventListener('removed', refresh);
  refresh();
  return {
    refresh,
    dispose() {
      disposed = true;
      targets.delete(model);
      spatial.setMouse(false);
      spatial.dispose();
      model.removeEventListener('added', refresh);
      model.removeEventListener('removed', refresh);
    },
  };
}


import type { Object3D, Vector3 } from 'three';
import { isSpriteEntityRendered } from '@dontstarve-web/animation/renderOrder';
import { SpatialIndex, type SpatialQuery } from './spatialIndex';

export interface PlacementBlocker {
  readonly position: Vector3;
  readonly prefab?: string;
  readonly tags?: readonly string[];
  readonly smartRadius?: number;
  readonly inventoryRadius?: number;
  readonly visible?: boolean;
  readonly logicalTree?: boolean;
  hasTag?(tag: string): boolean;
  getInventoryRadius?(fallback: number): number | undefined;
}
export type PlacementQuery = SpatialQuery<PlacementBlocker>;
interface WorldBlocker extends PlacementBlocker { readonly root: Object3D; valid(): boolean }
const index = new SpatialIndex<WorldBlocker>(entry => entry.position, entry => entry.smartRadius ?? 0);
const models = new WeakMap<Object3D, { sync(): void }>();

export function hasPlacementTag(blocker: PlacementBlocker, tag: string): boolean {
  return blocker.hasTag?.(tag) ?? blocker.tags?.includes(tag) ?? false;
}
export function ignoresPlacement(blocker: PlacementBlocker, tags: Iterable<string>): boolean {
  for (const tag of tags) if (hasPlacementTag(blocker, tag)) return true;
  return false;
}

/** One engine entity entry, independent of rendering lists, selected action and mouse visibility. */
export function registerPlacementEntity(model: Object3D, position: () => Vector3): () => void {
  const entry: WorldBlocker = {
    root: model,
    get position() { return position(); },
    get prefab() { return model.userData.actionEntity?.prefab ?? model.userData.prefab; },
    get smartRadius() { return model.userData.deploySmartRadius; },
    get inventoryRadius() { return model.userData.itemId ? model.userData.physicsRadius ?? .5 : undefined; },
    getInventoryRadius: fallback => model.userData.itemId ? model.userData.physicsRadius ?? fallback : undefined,
    get visible() { return isSpriteEntityRendered(model); },
    hasTag: tag => model.userData.actionEntity?.hasTag(tag) ?? model.userData.tags?.includes(tag) ?? false,
    valid: () => !!model.parent && !model.userData.placementLogical && !model.userData.actionEntity?.isRemoved
      && !model.userData.removed && !model.userData.placer
      && (hasPlacementTag(entry, 'dockjammer') || !ignoresPlacement(entry, ['NOBLOCK', 'FX', 'DECOR', 'player'])),
  };
  const sync = () => { if (entry.valid()) index.add(entry); else index.delete(entry); };
  models.set(model, { sync });
  model.addEventListener('added', sync);
  model.addEventListener('removed', sync);
  sync();
  return () => {
    index.delete(entry); models.delete(model);
    model.removeEventListener('added', sync); model.removeEventListener('removed', sync);
  };
}

/** Called by moving entities after their authoritative transform is settled, never by a query. */
export function syncPlacementEntity(model: Object3D): void { models.get(model)?.sync(); }

/** Logical trees keep their index entry when only their nearby visual is unloaded. */
export function registerPlacementTree(root: Object3D, tree: { position: Vector3; model?: Object3D },
  prefab: string, smartRadius: number): () => void {
  const entry: WorldBlocker = {
    root, position: tree.position, prefab, smartRadius, logicalTree: true,
    get visible() { return !!tree.model?.parent && isSpriteEntityRendered(tree.model); },
    hasTag: tag => tree.model?.userData.actionEntity?.hasTag(tag) ?? tree.model?.userData.tags?.includes(tag) ?? false,
    valid: () => true,
  };
  index.add(entry);
  return () => index.delete(entry);
}

export function placementEntities(root: Object3D): PlacementQuery {
  const includes = (entry: WorldBlocker) => {
    if (!entry.valid()) return false;
    for (let node: Object3D | null = entry.root; node; node = node.parent) if (node === root) return true;
    return false;
  };
  return {
    someNear: (position, radius, predicate) => index.someNear(position, radius, entry => includes(entry) && predicate(entry)),
    someOnTile: (position, predicate) => index.someOnTile(position, entry => includes(entry) && predicate(entry)),
  };
}

import * as THREE from 'three';
import type { ActionWorldContext } from '@dontstarve-web/stategraphs/actionContext';

/**
 * Everything a prefab needs from the host application to place itself in the
 * running game. The application owns the scene graph, the camera, the renderer
 * and the ground, so prefabs receive them instead of creating their own.
 */
export interface WorldContext extends ActionWorldContext {
    registerContainer?: (id: string, container: import('./containers').BuildingContainer) => void;
    unregisterContainer?: (id: string, container: import('./containers').BuildingContainer) => void;
    /** Place destruction loot in the application's authoritative ground-item store. */
    dropLoot?: (items: readonly { itemId: string; count: number }[], position: THREE.Vector3) => void;
}

/** The subset a prefab needs to turn raw pointer events into raycasts. */
export type PointerContext = Pick<WorldContext, 'camera' | 'renderer'>;

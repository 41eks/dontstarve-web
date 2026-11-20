import * as THREE from 'three';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import { ItemEntity } from '@dontstarve-web/inventory';
import { PrefabEntityManager, type PrefabInstance } from '@dontstarve-web/prefab/prefabInstance';
import type { ItemWorld } from './inventory';
import { world, worldState } from './physics';
import { ITEM_PREFAB_IDS } from './prefabDefinitions';
import { scene } from './universal';

export const PREFAB_BASE_URL = `${import.meta.env.BASE_URL}dst/data/anim`;

/** The display-layer owner of every prefab entity's scene membership. */
export const prefabDisplays = new PrefabDisplayGroup(scene);

/**
 * The world's one PrefabEntityManager. It exists before anything that spawns into it, the inventory included, so an
 * inst can only be made by SpawnPrefab; the scene registers the prefab definitions on it and disposes it.
 */
export const prefabs = new PrefabEntityManager<string, PrefabInstance>(prefabDisplays, PREFAB_BASE_URL,
  // Items without ground art are drawn from their inventory image.
  { tickingarea: worldState.tickingarea, physics: world, scheduler: worldState.scheduler, iconArchiveUrl: `${import.meta.env.BASE_URL}dst/data/databundles/images.zip` });

const ITEM_ORIGIN = new THREE.Vector3();
const ITEM_IDS = new Set(ITEM_PREFAB_IDS);

/** SpawnPrefab for the inventory's item registry: every item inst is this world's prefab inst from its birth. */
export const itemWorld: ItemWorld = {
  isItemPrefab: prefab => ITEM_IDS.has(prefab),
  SpawnPrefab(prefab, saved): ItemEntity {
    const entity = prefabs.spawn(prefab, ITEM_ORIGIN, saved);
    if (!(entity instanceof ItemEntity)) { throw new Error(`${prefab} does not spawn an item entity`); }
    return entity;
  },
};

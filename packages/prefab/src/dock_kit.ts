import { ignoresPlacement, hasPlacementTag, type PlacementQuery, type PlacementBlocker } from './placementEntities';
import * as THREE from 'three';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { Deployable } from '../../componets/src/deployable';
import { DockManager, type DockMap } from '../../componets/src/dockmanager';
import { PlaySound } from './sound';
import { snapToTileCenter, TILE_SIZE } from './tile';
import { TurfMap, WORLD_TILES, isLandTile } from './turfMap';

export const DOCK_KIT_ID = 'dock_kit';
/** TUNING.STACK_SIZE_MEDITEM, the stackable default dock_kit.lua sets. */
export const DOCK_KIT_MAX_STACK = 20;
const SCALE = TILE_SIZE / 4;
/** map.lua DEPLOY_IGNORE_TAGS. */
const DEPLOY_IGNORE_TAGS = new Set(['NOBLOCK', 'player', 'FX', 'INLIMBO', 'DECOR', 'walkableplatform', 'walkableperipheral', 'isdead']);
/** (TILE_SCALE / 2) + 1.2 in DST units: CanDeployDockAtPoint's min_distance_from_entities. */
const MIN_DISTANCE_FROM_ENTITIES = (4 / 2 + 1.2) * SCALE;
const DOCK_DEPLOY_SOUND = 'dontstarve/common/together/boat/damage' as const;

export type DockBlocker = PlacementBlocker;

/** tilegroups.lua classification: void tiles are neither land nor ocean. */
export const dockMapOf = (turf: TurfMap): DockMap => ({
  getTile: (col, row) => turf.tileIdAtCell(col, row),
  setTile: (col, row, tile, under) => turf.setTile(col, row, tile as never, under as never),
  cellsOfTile: tile => turf.cellsOfTile(tile),
  isLandTile,
  isTemporaryTile: tile => tile === WORLD_TILES.FARMING_SOIL || tile === WORLD_TILES.MONKEY_DOCK,
});

const cellOf = (point: Pick<THREE.Vector3, 'x' | 'z'>): [number, number] =>
  [Math.floor(point.x / TILE_SIZE), Math.floor(point.z / TILE_SIZE)];

/** TheWorld.Map:CanDeployDockAtPoint and TheWorld.components.dockmanager, as dock_kit.lua reaches them. */
export function createDockWorld(turf: TurfMap, blockers: PlacementQuery) {
  const map = dockMapOf(turf);
  // Built on first use: its roots come from the tiles, which a save restores after the map is wired.
  let manager: DockManager | undefined;
  return {
    get dockmanager(): DockManager {
      return manager ??= new DockManager(map, { dock: WORLD_TILES.MONKEY_DOCK, farmingSoil: WORLD_TILES.FARMING_SOIL });
    },
    /**
     * CLIENT_CanDeployDockKit followed by Map:CanDeployDockAtPoint: an ocean tile touching permanent land or a dock,
     * with no dockjammer on it and nothing standing in the water within the dock's footprint.
     */
    canDeployDock(point: THREE.Vector3): boolean {
      const [col, row] = cellOf(point), snapped = snapToTileCenter(point);
      const center = new THREE.Vector3(snapped.x, 0, snapped.z);
      if (turf.tileIdAtCell(col, row) !== WORLD_TILES.OCEAN_COASTAL) return false;
      let adjacent = false;
      for (let dx = -1; dx <= 1 && !adjacent; dx++) for (let dz = -1; dz <= 1; dz++) {
        if ((dx !== 0 || dz !== 0) && map.isLandTile(map.getTile(col + dx, row + dz))) { adjacent = true; break; }
      }
      if (!adjacent) return false;
      if (blockers.someOnTile(center, blocker => hasPlacementTag(blocker, 'dockjammer'))) return false;
      return !blockers.someNear(center, MIN_DISTANCE_FROM_ENTITIES, blocker => {
        if (blocker.visible === false || ignoresPlacement(blocker, DEPLOY_IGNORE_TAGS)) return false;
        // IsDockNearOtherOnOcean only considers entities standing on ocean tiles.
        const [bc, br] = cellOf(blocker.position);
        if (map.isLandTile(map.getTile(bc, br))) return false;
        return isNearOther(blocker, center, MIN_DISTANCE_FROM_ENTITIES);
      });
    },
    /** on_deploy: CreateDockAtPoint, then ResolveDockSafetyAtPoint; deployable tiles always touch land or a connected dock. */
    createDock(point: THREE.Vector3): void {
      const [col, row] = cellOf(point);
      this.dockmanager.CreateDockAtTile(col, row);
      this.dockmanager.ResolveDockSafetyAtTile(col, row);
    },
  };
}

/** dock_kit.lua: tags, deployable(CUSTOM) with its gridplacer, and on_deploy consuming one kit. */
export function configureDockKitEntity(entity: ItemEntity): void {
  if (entity.prefab !== DOCK_KIT_ID || entity.components.deployable) return;
  for (const tag of ['groundtile', 'deploykititem', 'usedeployspacingasoffset', 'deployable']) entity.addTag(tag);
  entity.components.deployable = entity.component('deployable', () => new Deployable(entity, (point, deployer, map) => {
    // PlaySoundWithParams("turnoftides/common/together/boat/damage", { intensity = 0.8 }) on the deployer.
    PlaySound(DOCK_DEPLOY_SOUND, deployer.position).setParameter?.('intensity', .8);
    map.createDock(point);
    entity.remove();
  }, { mode: 'CUSTOM', spacing: 2 * SCALE, usegridplacer: true, candeploy: (point, map) => map.canDeployDock(point) }));
}

/** map.lua IsNearOther (min_spacing form) with deploy_smart_radius and inventoryitem physics radius. */
function isNearOther(other: DockBlocker, pt: THREE.Vector3, minSpacing: number): boolean {
  let spacing = minSpacing;
  if (other.smartRadius !== undefined) spacing = other.smartRadius + minSpacing / 2;
  else if (other.inventoryRadius !== undefined) spacing = Math.min(other.inventoryRadius + minSpacing / 2, minSpacing);
  return other.position.distanceToSquared(pt) < spacing ** 2;
}

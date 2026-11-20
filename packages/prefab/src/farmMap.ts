import * as THREE from 'three';
import type { ItemEntity } from '@dontstarve-web/inventory';
import type { FarmTillerMap } from '../../componets/src/farmtiller';
import {
  FARM_DECOR_IDS,
  FARM_PLOW_ID,
  FARM_PLOW_ITEM_ID,
  FARM_PLOW_USES,
  FARM_SCALE,
  FARM_TILL_SPACING,
  PLANTED_SEED_IDS,
  FarmPlowInstance,
  type FarmSoilMap,
} from './farm_plow';
import { hasPlacementTag, ignoresPlacement, type PlacementBlocker, type PlacementQuery } from './placementEntities';
import type { PrefabEntityManager, PrefabInstance } from './prefabInstance';
import { snapToTileCenter, TILE_SIZE } from './tile';
import { WORLD_TILES, type TurfMap } from './turfMap';

/** map.lua DEPLOY_IGNORE_TAGS plus TILLSOIL_IGNORE_TAGS' soil and merm. */
const TILL_IGNORE_TAGS = [
  'NOBLOCK',
  'player',
  'FX',
  'INLIMBO',
  'DECOR',
  'walkableplatform',
  'walkableperipheral',
  'isdead',
  'soil',
  'merm',
];
/** farm_plow.lua can_plow_tile's ignored tags. */
const PLOW_IGNORE_TAGS = ['NOBLOCK', 'locomotor', 'NOCLICK', 'FX', 'DECOR'];
const FARM_ENTITY_IDS: readonly string[] = [FARM_PLOW_ID, ...FARM_DECOR_IDS, ...PLANTED_SEED_IDS];

/** The live entities the farm prefabs spawn: TheSim:FindEntities over them and SpawnPrefab. */
export interface FarmEntities extends Pick<PrefabEntityManager<string, PrefabInstance>, 'spawn' | 'spawnAs'> {
  instances(prefabId: string): Iterable<PrefabInstance>;
}
export interface FarmMap extends FarmSoilMap, FarmTillerMap {
  /** farm_plow_item's can_plow_tile. */
  canDeploy(point: THREE.Vector3): boolean;
  /** farm_plow_item's item_ondeploy. */
  deploy(point: THREE.Vector3, item: ItemEntity): boolean;
  dispose(): void;
}

function tileCenter(point: Pick<THREE.Vector3, 'x' | 'z'>): THREE.Vector3 {
  const center = snapToTileCenter(point);
  return new THREE.Vector3(center.x, 0, center.z);
}
const tileOf = (point: Pick<THREE.Vector3, 'x' | 'z'>) =>
  `${Math.floor(point.x / TILE_SIZE)},${Math.floor(point.z / TILE_SIZE)}`;

/**
 * TheWorld.Map's farm soil functions: CanTillSoilAtPoint, CollapseSoilAtPoint and the plow's terraform, over the
 * shared manager's farm entities and the other entities in the placement query.
 */
export function createFarmMap({
  turf,
  entities,
  blockers,
}: {
  turf: TurfMap;
  entities: FarmEntities;
  blockers: PlacementQuery;
}): FarmMap {
  function* farmEntities(): Generator<PrefabInstance> {
    for (const id of FARM_ENTITY_IDS) {
      yield* entities.instances(id);
    }
  }
  // The farm entities are found above; the query holds everything else.
  const external = (blocker: PlacementBlocker, ignored: readonly string[]) =>
    !FARM_ENTITY_IDS.includes(blocker.prefab ?? '') &&
    (blocker.logicalTree === true || !ignoresPlacement(blocker, ignored));
  /** map.lua IsNearOther with deploy_smart_radius. */
  const spacing = (smartRadius: number | undefined, minSpacing: number) =>
    smartRadius !== undefined ? smartRadius + minSpacing / 2 : minSpacing;
  /** map.lua IsDeployPointClear(pt, nil, min_spacing, nil, nil, nil, ignore_tags). */
  function isDeployPointClear(point: THREE.Vector3, minSpacing: number, ignored: readonly string[]): boolean {
    for (const inst of farmEntities()) {
      if (ignored.some(tag => inst.hasTag(tag))) {
        continue;
      }
      if (inst.position.distanceToSquared(point) < spacing(inst.deploySmartRadius, minSpacing) ** 2) {
        return false;
      }
    }
    return !blockers.someNear(
      point,
      minSpacing,
      blocker =>
        external(blocker, ignored) &&
        blocker.position.distanceToSquared(point) <
          spacing(
            blocker.smartRadius ?? (hasPlacementTag(blocker, 'farm_plant') ? 0.5 * FARM_SCALE : undefined),
            minSpacing,
          ) **
            2,
    );
  }
  const map: FarmMap = {
    CanTillSoilAtPoint(point, ignoreTileType = false) {
      return (
        (ignoreTileType ? turf.canPlant(point) : turf.getTileAtWorld(point) === WORLD_TILES.FARMING_SOIL) &&
        isDeployPointClear(point, FARM_TILL_SPACING, TILL_IGNORE_TAGS)
      );
    },
    CollapseSoilAtPoint(point) {
      for (const soil of [...entities.instances('farm_soil')]) {
        if (!soil.hasTag('soil')) {
          continue;
        }
        const distanceSquared = soil.position.distanceToSquared(point);
        if (distanceSquared > FARM_TILL_SPACING ** 2) {
          continue;
        }
        // GetDistanceSqToPoint < till_spacing * 0.5, a squared distance against Lua units.
        soil.PushEvent(
          distanceSquared < (FARM_TILL_SPACING / FARM_SCALE) * 0.5 * FARM_SCALE ** 2 ? 'collapsesoil' : 'breaksoil',
        );
      }
    },
    Terraform: point => turf.plow(point),
    canTill: point => map.CanTillSoilAtPoint(new THREE.Vector3(point.x, 0, point.z)),
    /** farmtiller.lua Till: CollapseSoilAtPoint, then SpawnPrefab("farm_soil"). */
    till(point) {
      const position = new THREE.Vector3(point.x, 0, point.z);
      if (!map.CanTillSoilAtPoint(position)) {
        return false;
      }
      map.CollapseSoilAtPoint(position);
      entities.spawn('farm_soil', position);
      return true;
    },
    canDeploy(point) {
      const center = tileCenter(point),
        tile = tileOf(center);
      if (!turf.canPlow(point) || turf.getTileAtWorld(center) === WORLD_TILES.INVALID) {
        return false;
      }
      for (const inst of farmEntities()) {
        if (tileOf(inst.position) === tile && !PLOW_IGNORE_TAGS.some(tag => inst.hasTag(tag))) {
          return false;
        }
      }
      return !blockers.someOnTile(center, blocker => external(blocker, PLOW_IGNORE_TAGS));
    },
    deploy(point, item) {
      if (!map.canDeploy(point)) {
        return false;
      }
      if (
        item.prefab !== FARM_PLOW_ITEM_ID ||
        item.isRemoved ||
        item.components.inventoryitem.owner ||
        item.components.stackable.count !== 1
      ) {
        throw new Error('Deployment requires one detached farm_plow_item');
      }
      // item_ondeploy: SpawnPrefab("farm_plow") at the tile centre, finiteuses:Use(1), then the item's save record.
      const plow = entities.spawnAs(FarmPlowInstance, FARM_PLOW_ID, tileCenter(point));
      item.components.finiteuses.setMaxUses(FARM_PLOW_USES);
      item.components.finiteuses.use(1);
      if (!item.isRemoved) {
        plow.deploy_item_save_record = item.GetSaveRecord();
        item.remove();
      }
      return true;
    },
    dispose: () => stopDig(),
  };
  // Digging a farming tile back up collapses the soil on it.
  const stopDig = turf.onDig(point => {
    const tile = tileOf(point);
    for (const soil of [...entities.instances('farm_soil')]) {
      if (tileOf(soil.position) === tile) {
        soil.PushEvent('collapsesoil');
      }
    }
  });
  return map;
}

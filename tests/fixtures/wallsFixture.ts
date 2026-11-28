import { WALL_PREFAB_IDS, type WallId } from '../../packages/prefab/src/walls';
import type { EntitySaveRecord } from '../../packages/prefab/src/saveRecord';
import type { WorldContext } from '../../packages/prefab/src/worldContext';
import { managedBuildings } from './managedBuildings';

const isWallPrefab = (prefab: string) => (WALL_PREFAB_IDS as readonly string[]).includes(prefab);

/**
 * The scene's walls: the build flow and the shared PrefabEntityManager, read as the save loop and the reskin tool see them.
 * Spawning settles the frame's zero-delay tasks (InitializePathFinding), as the scene's next frame does.
 */
export function wallsFixture(world: WorldContext) {
  const buildings = managedBuildings(world);
  const { prefabs, scheduler } = buildings;
  const records = () => prefabs.exportRecords().filter(({ prefabId }) => isWallPrefab(prefabId));
  return {
    ...buildings,
    async spawn(buildId: WallId, skinId?: string) {
      await buildings.spawn(buildId, skinId);
      scheduler.advance(0);
    },
    async spawnFromSave(buildId: WallId, record: EntitySaveRecord) {
      const model = buildings.spawnFromSave(buildId, record);
      scheduler.advance(0);
      return model;
    },
    exportRecords: records,
    update: (dt = 0) => buildings.update(dt),
    get renderEntities() {
      return buildings.renderEntities;
    },
    /** The placed walls, in spawn order: the entities the reskin tool casts on. */
    get reskinTargets() {
      return records().map(({ record }) => prefabs.get(record.id)!);
    },
  };
}

import { prefabInstance } from '../../prefab/src/prefabInstance';
import type { ReskinTarget } from '../../stategraphs/src/reskin_tool';
import { WALL_PREFAB_IDS, type WallId } from '../../prefab/src/walls';
import type { PlacementSaveRecord } from '../../prefab/src/saveRecord';
import type { WorldContext } from '../../prefab/src/worldContext';
import { managedBuildings } from './managedBuildings';

const isWallPrefab = (prefab: string) => (WALL_PREFAB_IDS as readonly string[]).includes(prefab);

/**
 * The scene's walls: the build flow and the shared PrefabEntityManager, read as the save loop and the reskin tool see them.
 * Spawning settles the frame's zero-delay tasks (InitializePathFinding), as the scene's next frame does.
 */
export function wallsFixture(world: WorldContext, consume: (buildId: WallId, skinId?: string) => boolean = () => false) {
  const buildings = managedBuildings(world, { consume: consume as () => boolean });
  const { prefabs, scheduler } = buildings;
  const records = () => prefabs.exportRecords().filter(({ prefabId }) => isWallPrefab(prefabId));
  return {
    ...buildings,
    begin: (buildId: WallId, skinId?: string) => buildings.begin(buildId, skinId),
    async spawn(buildId: WallId, skinId?: string) { await buildings.spawn(buildId, skinId); scheduler.advance(0); },
    async spawnFromSave(buildId: WallId, record: PlacementSaveRecord) {
      const model = buildings.spawnFromSave(buildId, record);
      scheduler.advance(0);
      return model;
    },
    exportRecords: records,
    update: (dt = 0) => buildings.update(dt),
    get renderEntities() { return buildings.renderEntities; },
    /** The placed walls' reskin operations, in spawn order. */
    get reskinTargets(): ReskinTarget[] {
      return records().map(({ record }) => prefabInstance(prefabs.get(record.id)!.transform.model)!.reskinTarget!);
    },
  };
}

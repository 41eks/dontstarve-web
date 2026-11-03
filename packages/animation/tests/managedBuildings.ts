import { PrefabDisplayGroup } from '../../display/src';
import { FireFxHost } from '../../prefab/src/treeFire';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { WorldContext } from '../../prefab/src/worldContext';
import { createSignal, GameTimeScheduler } from '../../signals/src';
import { PlaceableBuildingPlacement, type PlaceableBuildingInteractionChange } from '../../../src/placeableBuilding';

/** The application's wiring of the build flow and the shared PrefabEntityManager, driven as the scene drives them. */
export function managedBuildings(world: WorldContext, { consume = () => true, onInteraction }: {
  consume?: () => boolean; onInteraction?: (change: PlaceableBuildingInteractionChange) => void;
} = {}) {
  const scheduler = world.scheduler ?? new GameTimeScheduler(), fire = world.fire ?? FireFxHost.create();
  const displays = new PrefabDisplayGroup(world.scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { tickingarea: world.tickingarea, physics: world.physics });
  const placement = new PlaceableBuildingPlacement({ cameraFacing: createSignal(8), cameraHeading: createSignal(45), ...world, scheduler, fire }, consume, onInteraction, prefabs);
  let disposed = false;
  return {
    prefabs, displays, scheduler, placement,
    begin: placement.begin.bind(placement), cancel: placement.cancel.bind(placement), spawn: placement.spawn.bind(placement),
    spawnFromSave: placement.spawnFromSave.bind(placement), performContainerAction: placement.performContainerAction.bind(placement),
    exportRecords: () => [...prefabs.exportRecords(), ...placement.exportRecords()],
    get renderEntities() { return [...placement.renderEntities, ...displays.renderEntities]; },
    update(dt: number) { displays.update(dt); placement.update(dt); scheduler.advance(dt); },
    dispose() {
      if (disposed) return;
      disposed = true;
      placement.dispose(); prefabs.dispose(); displays.dispose(); fire.dispose();
    },
  };
}

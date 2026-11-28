import type { Vector3 } from 'three';
import { fixedCamera } from '../../packages/prefab/src/followcamera';
import { PrefabDisplayGroup } from '../../packages/display/src';
import { FireFxHost } from '../../packages/prefab/src/treeFire';
import { PrefabEntityManager, type PrefabInstance } from '../../packages/prefab/src/prefabInstance';
import type { WorldContext } from '../../packages/prefab/src/worldContext';
import { createSignal, GameTimeScheduler } from '../../packages/signals/src';
import { PlaceableBuildingPlacement, type PlaceableBuildingInteractionChange } from '../../src/placeableBuilding';

/** The application's wiring of the build flow and the shared PrefabEntityManager, driven as the scene drives them. */
export function managedBuildings(
  world: WorldContext,
  {
    consume = () => true,
    onInteraction,
  }: {
    consume?: (recipe: string, skin?: string) => boolean;
    onInteraction?: (change: PlaceableBuildingInteractionChange) => void;
  } = {},
) {
  const scheduler = world.scheduler ?? new GameTimeScheduler(),
    fire = world.fire ?? FireFxHost.create();
  const displays = new PrefabDisplayGroup(world.scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', {
    tickingarea: world.tickingarea,
    physics: world.physics,
  });
  const placement = new PlaceableBuildingPlacement(
    {
      ...world,
      cameraFacing: world.cameraFacing ?? createSignal(8),
      cameraHeading: world.cameraHeading ?? createSignal(45),
      TheCamera: world.TheCamera ?? fixedCamera(45),
      scheduler,
      fire,
    },
    () => true,
    onInteraction,
    prefabs,
  );
  let disposed = false;
  return {
    prefabs,
    displays,
    scheduler,
    placement,
    begin: placement.begin.bind(placement),
    spawnBuilding: (id: string, point: Vector3, skin?: string) =>
      consume(id, skin) ? prefabs.spawn(id, point, undefined, skin) : undefined,
    cancel: placement.cancel.bind(placement),
    spawn: placement.spawn.bind(placement),
    spawnFromSave: placement.spawnFromSave.bind(placement),
    performContainerAction: placement.performContainerAction.bind(placement),
    exportRecords: () => [...prefabs.exportRecords(), ...placement.exportRecords()],
    get renderEntities() {
      return [...placement.renderEntities, ...displays.renderEntities];
    },
    update(dt: number) {
      displays.update(dt);
      placement.update(dt);
      scheduler.advance(dt);
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      placement.dispose();
      prefabs.dispose();
      displays.dispose();
      fire.dispose();
    },
  };
}

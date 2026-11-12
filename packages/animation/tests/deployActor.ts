import { wilsonPlayer } from './wilsonPlayer';
import { testPlayer } from './testPlayer';
import { testLocomotor } from './testLocomotor';
import type * as THREE from 'three';
import type { DeployMap } from '../../componets/src/deployable';
import type { InventoryStore } from '../../inventory/src';
import { createEquipmentExistenceState } from '../../signals/src';
import { PlayerController } from '../../stategraphs/src/playercontroller';
import { WORLD_TILES, type TurfMap } from '../../prefab/src/turfMap';
import type { WorldContext } from '../../prefab/src/worldContext';

/** A TurfMap stub that is all walkable land except for the overridden rules. */
export const landTurf = (rules: Partial<Record<keyof TurfMap, unknown>>) =>
  ({ getTileAtWorld: () => WORLD_TILES.DIRT, isOceanAtWorld: () => false, ...rules }) as unknown as TurfMap;

/** A player whose controller walks to DEPLOY with its own locomotor, which `deploy` lets arrive. */
export function deployActor(world: WorldContext, inventory: InventoryStore, map: DeployMap,
  graph = wilsonPlayer(() => 1).sg) {
  const walker = testLocomotor(world.player);
  // The player inst deploys from its own inventory, onto TheWorld.Map.
  const doer = testPlayer({ model: world.player, inventory, map });
  const controller = new PlayerController(world, graph, walker.locomotor, createEquipmentExistenceState('HANDS'), doer);
  return { graph, locomotor: walker, doer, controller,
    canDeploy: (point: THREE.Vector3) => inventory.GetActiveItem()!.components.deployable!.CanDeploy(point, map),
    /** PlayerController:DoAction with the active item, then the locomotor's arrival. */
    deploy(point: THREE.Vector3): boolean {
      const action = controller.createAction({ action: 'DEPLOY', invobject: inventory.GetActiveItem() as never, pos: point });
      if (!action || !controller.DoAction(action)) return false;
      walker.arrive();
      return true;
    } };
}

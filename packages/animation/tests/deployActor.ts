import type * as THREE from 'three';
import { vi } from 'vitest';
import type { DeployMap } from '../../componets/src/deployable';
import type { InventoryStore } from '../../inventory/src';
import { createSignal } from '../../signals/src';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import { PlayerController } from '../../stategraphs/src/playercontroller';
import { WORLD_TILES, type TurfMap } from '../../prefab/src/turfMap';
import type { WorldContext } from '../../prefab/src/worldContext';

/** A TurfMap stub that is all walkable land except for the overridden rules. */
export const landTurf = (rules: Partial<Record<keyof TurfMap, unknown>>) =>
  ({ getTileAtWorld: () => WORLD_TILES.DIRT, isOceanAtWorld: () => false, ...rules }) as unknown as TurfMap;

/** A player whose controller buffers DEPLOY through a locomotor that arrives when told. */
export function deployActor(world: WorldContext, inventory: InventoryStore, map: DeployMap,
  graph = new WilsonStateGraph({ playAnimation: () => 1, playSound() {}, stopSound() {}, setCasting() {}, onStateChanged() {} })) {
  let arrive = () => {};
  const locomotor = { destination: undefined, goToPoint: vi.fn(() => true), stop: vi.fn(),
    PushAction: vi.fn((_action: { target: { getPosition(): THREE.Vector3 } }, arrived: () => void) => { arrive = arrived; }) };
  const doer = { components: { inventory }, Map: map, position: world.player.position, getPosition: () => world.player.position,
    GetPosition: () => world.player.position, hasTag: () => false, PushEvent: vi.fn() };
  const controller = new PlayerController(world, graph, locomotor as never, createSignal(undefined) as never, doer as never);
  return { graph, locomotor, doer, controller,
    canDeploy: (point: THREE.Vector3) => inventory.GetActiveItem()!.components.deployable!.CanDeploy(point, map),
    /** PlayerController:DoAction with the active item, then the locomotor's arrival. */
    deploy(point: THREE.Vector3): boolean {
      const action = controller.createAction({ action: 'DEPLOY', invobject: inventory.GetActiveItem() as never, pos: point });
      if (!action || !controller.DoAction(action)) return false;
      arrive();
      return true;
    } };
}

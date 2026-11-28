import { createEquipmentExistenceState } from '../../packages/signals/src';
import {
  PlayerController,
  type MouseControl,
  type PlayerPlacement,
} from '../../packages/stategraphs/src/playercontroller';
import type { WorldContext } from '../../packages/prefab/src/worldContext';
import { bufferingStategraph } from './bufferingStategraph';
import { playerDoer } from './playerDoer';
import { testLocomotor } from './testLocomotor';
import { createInventoryStore } from './testInventory';
import { Builder, type BuilderWorld } from '../../packages/componets/src/builder';
import { addComponent, removeComponent } from '../../packages/prefab/src/components';
import type { InventoryStore } from '../../packages/inventory/src';

/** The placing players not disposed yet. */
const live = new Set<{ dispose(): void }>();

/**
 * The application's player with its placer wired to PlayerController, which walks its own
 * locomotor and buffers on SGwilson. `place()` arrives at the walk's destination and runs the BUILD or DEPLOY hit frame.
 */
export function placingPlayer(
  world: WorldContext,
  placement: PlayerPlacement,
  spawn: NonNullable<BuilderWorld['placement']>['SpawnPrefab'],
  inventory?: InventoryStore,
  canBuildAtPoint: NonNullable<BuilderWorld['placement']>['CanDeployRecipeAtPoint'] = () => true,
) {
  const items = inventory ?? createInventoryStore();
  const animation = bufferingStategraph(),
    walk = testLocomotor(world.player),
    doer = playerDoer(world.player, { inventory: items });
  const builder = addComponent(doer, 'builder', Builder, {
    findEntities: () => [],
    placement: {
      recipe: id => ({ productId: id, buffered: true }),
      CanDeployRecipeAtPoint: canBuildAtPoint,
      SpawnPrefab: spawn,
    },
  });
  const controller = new PlayerController(
    world,
    animation.graph,
    walk.locomotor,
    createEquipmentExistenceState('HANDS'),
    doer,
    undefined,
    { placement },
  );
  doer.components.playercontroller = controller;
  const player = {
    controller,
    builder,
    pay(recipeId: string, skin?: string): void {
      if (!items.isBuffered(recipeId)) {
        items.craft({ recipeId, productId: recipeId, productCount: 1, ingredients: {}, buffered: true }, skin);
      }
    },
    walk,
    animation,
    click(control: MouseControl = 'PRIMARY', clientX = 0, clientY = 0): boolean {
      return controller.OnControl(control, true, { clientX, clientY });
    },
    /**
     * Arrives and plays out the state the arrival buffered the action on: its hit frame places, and the player is idle
     * again. A click that started no walk does nothing.
     */
    place(): void {
      walk.arrive();
      animation.finish();
    },
    dispose(): void {
      if (!live.delete(player)) {
        return;
      }
      controller.dispose();
      removeComponent(doer, 'builder');
      delete doer.components.playercontroller;
      if (!inventory) {
        items.dispose();
      }
    },
  };
  live.add(player);
  return player;
}

/** Disposes every placing player left, for an afterEach to call while the test's stubs and spies are still in place. */
export function disposePlacingPlayers(): void {
  for (const player of [...live]) {
    player.dispose();
  }
}

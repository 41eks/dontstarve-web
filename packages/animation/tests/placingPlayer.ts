import { createEquipmentExistenceState } from '../../signals/src';
import { PlayerController, type MouseControl, type PlayerPlacement } from '../../stategraphs/src/playercontroller';
import type { WorldContext } from '../../prefab/src/worldContext';
import { bufferingStategraph } from './bufferingStategraph';
import { playerDoer } from './playerDoer';
import { testLocomotor } from './testLocomotor';

/** The placing players not disposed yet. */
const live = new Set<{ dispose(): void }>();

/**
 * The application's player with its placer wired to PlayerController, which walks its own
 * locomotor and buffers on SGwilson. `place()` arrives at the walk's destination and runs the BUILD or DEPLOY hit frame.
 */
export function placingPlayer(world: WorldContext, placement: PlayerPlacement) {
  const animation = bufferingStategraph(),
    walk = testLocomotor(world.player),
    doer = playerDoer(world.player);
  const controller = new PlayerController(
    world,
    animation.graph,
    walk.locomotor,
    createEquipmentExistenceState('HANDS'),
    doer,
    undefined,
    { placement },
  );
  const player = {
    controller,
    walk,
    animation,
    click(control: MouseControl = 'PRIMARY'): boolean {
      return controller.OnControl(control, { clientX: 0, clientY: 0 });
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

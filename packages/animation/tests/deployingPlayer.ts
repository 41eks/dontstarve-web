import { createEquipmentExistenceState } from '../../signals/src';
import { PlayerController } from '../../stategraphs/src/playercontroller';
import type { WorldContext } from '../../prefab/src/worldContext';
import { bufferingStategraph } from './bufferingStategraph';
import { playerDoer } from './playerDoer';
import { testLocomotor } from './testLocomotor';

/**
 * The application's player as a deploy placer reaches it: `world.player`'s inst owns the PlayerController, which walks
 * its own locomotor and buffers on SGwilson. `deploy()` arrives at the walk's destination and runs the hit frame.
 */
export function deployingPlayer(world: WorldContext) {
  const animation = bufferingStategraph(),
    walk = testLocomotor(world.player),
    doer = playerDoer(world.player);
  const controller = new PlayerController(
    world,
    animation.graph,
    walk.locomotor,
    createEquipmentExistenceState('HANDS'),
    doer,
  );
  doer.components.playercontroller = controller;
  return {
    controller,
    walk,
    animation,
    deploy(): void {
      walk.arrive();
      animation.hit();
    },
    dispose(): void {
      controller.dispose();
      delete doer.components.playercontroller;
    },
  };
}

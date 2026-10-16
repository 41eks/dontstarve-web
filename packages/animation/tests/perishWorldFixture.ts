import { afterEach } from 'vitest';
import { createSignal, GameTimeScheduler, type ReadonlySignal } from '../../signals/src';
import { WorldPerishClock } from '../../componets/src/worldperishclock';

const worlds: { dispose(): void }[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.dispose(); });

/** World time records its integral before the shared scheduler executes crossed deadlines. */
export function createPerishWorld(temperature: ReadonlySignal<number> = createSignal(20), initialTime = 0) {
  const perishClock = new WorldPerishClock(temperature, initialTime);
  const scheduler = new GameTimeScheduler(initialTime);
  const world = {
    perishClock, scheduler,
    advance(dt: number) { perishClock.OnUpdate(dt); scheduler.advanceTo(perishClock.GetTick().time); },
    dispose() { scheduler.dispose(); perishClock.dispose(); },
  };
  worlds.push(world);
  return world;
}

import { vi } from 'vitest';
import type { BufferedAction } from '../../stategraphs/src/bufferedaction';
import { wilsonPlayer } from './wilsonPlayer';

/**
 * A player inst whose own SGwilson takes the actions a controller buffers: `sg` spies on its pushBufferedAction and
 * cancelAction, `last` is the last pushed action, and `hit()` performs it as its state's hit frame would.
 */
export function bufferingStategraph() {
  const player = wilsonPlayer(), graph = player.sg;
  const sg = { pushBufferedAction: vi.spyOn(graph, 'pushBufferedAction'), cancelAction: vi.spyOn(graph, 'cancelAction') };
  const last = (): BufferedAction<string> | undefined => sg.pushBufferedAction.mock.calls.at(-1)?.[0];
  return {
    player, graph, sg,
    get last() { return last(); },
    /** BufferedAction:Do for the last pushed action, even after it was cancelled: its own checks decide. */
    hit: () => last()?.do(),
    /** Plays the state out until the player is idle again. */
    finish() { for (let i = 0; i < 300 && graph.stateName !== 'idle'; i++) { graph.update(1 / 30); } },
  };
}

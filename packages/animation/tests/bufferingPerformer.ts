import { vi } from 'vitest';
import type { BufferedAction } from '../../stategraphs/src/bufferedaction';
import type { ActionPerformer } from '../../stategraphs/src/actionContext';

/**
 * A player whose stategraph only buffers actions: every push is accepted and stays active until it is
 * cancelled or `finish()`ed, and `hit()` performs the last pushed action as its state's hit frame would.
 */
export function bufferingPerformer(onPush?: (action: BufferedAction<string>) => void) {
  let active: BufferedAction<string> | undefined;
  let last: BufferedAction<string> | undefined;
  const stategraph = {
    hasStateTag: (_tag: string) => false,
    isPerformingAction: (action: string, invobjectPrefab?: string) => active?.action === action
      && (invobjectPrefab === undefined || active.invobject?.prefab === invobjectPrefab),
    pushBufferedAction: vi.fn((action: BufferedAction<string>) => {
      active = last = action;
      onPush?.(action);
      return true;
    }),
    cancelAction: vi.fn((action?: string) => { if (active && (!action || active.action === action)) active = undefined; }),
    isActionActive: (action: BufferedAction<string>) => active === action,
  };
  return {
    stategraph,
    cancelEmote: vi.fn(),
    setFacing: vi.fn(),
    get last() { return last; },
    /** BufferedAction:Do for the last pushed action, even after it was cancelled: its own checks decide. */
    hit: () => last?.do(),
    finish() { active = undefined; },
    get performer() { return this as unknown as ActionPerformer; },
  };
}

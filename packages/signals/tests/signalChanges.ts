import { createRenderEffect, untrack, type ReadonlySignal } from '../src';

/**
 * Test observer for a signal's changes after registration: listener(next, previous) runs synchronously on each change
 * outside a batch, and once with the net change after a batch commits. Its reads are untracked. Signals have no
 * listener API; game code observes them with createRenderEffect directly.
 */
export function onSignalChange<T>(signal: ReadonlySignal<T>, listener: (next: T, previous: T) => void): () => void {
  let previous = signal.value;
  return createRenderEffect(() => {
    const next = signal.get();
    if (next === previous) {
      return;
    }
    const before = previous;
    previous = next;
    untrack(() => listener(next, before));
  });
}

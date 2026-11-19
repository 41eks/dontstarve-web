import type { ReadonlySignal } from '@dontstarve-web/signals';

/**
 * Tags a component's own state decides, as workable.lua's and repairable.lua's property setters add and remove them.
 * The component stays their only owner: the inst reads them through here instead of keeping a copy.
 */
export interface DerivedTags {
  /** The tags from the current inputs, also inside a batch whose memos have not settled yet. */
  currentTags(): readonly string[];
  /** The same tags as a signal, for subscribers. */
  readonly derivedTags: ReadonlySignal<readonly string[]>;
}

export const NO_TAGS: readonly string[] = Object.freeze([]);

export function isDerivedTags(component: unknown): component is DerivedTags {
  return typeof component === 'object' && component !== null && 'derivedTags' in component && 'currentTags' in component;
}

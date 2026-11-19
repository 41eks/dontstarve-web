import type { ReadonlySignal } from '@dontstarve-web/signals';

/**
 * Tags a component's own state decides, as workable.lua's and repairable.lua's property setters add and remove them.
 * The component stays their only owner: the inst reads them through this memo instead of keeping a copy. A memo read
 * inside a batch is current (see the signals scheduling table), so hasTag can read it in a transaction.
 */
export interface DerivedTags {
  readonly derivedTags: ReadonlySignal<readonly string[]>;
}

export const NO_TAGS: readonly string[] = Object.freeze([]);

export function isDerivedTags(component: unknown): component is DerivedTags {
  return typeof component === 'object' && component !== null && 'derivedTags' in component;
}

import { createSignal, type ReadonlySignal, type Signal } from './signal';

export interface SanityState extends Signal<number> {
  readonly maximum: number;
  /** Derived read-only ratio; no second copy of the sanity value is stored. */
  readonly percent: ReadonlySignal<number>;
}

/** Sanity points are finite and clamped to the character's supported range. */
export function createSanityState(initialValue: number, maximum: number): SanityState {
  if (!Number.isFinite(maximum) || maximum <= 0) throw new RangeError('Maximum sanity must be positive and finite');
  const normalize = (value: number) => {
    if (!Number.isFinite(value)) throw new TypeError('Sanity must be finite');
    return Math.max(0, Math.min(maximum, value));
  };
  const state = createSignal(normalize(initialValue));
  return {
    ...state,
    maximum,
    set(value) { state.set(normalize(value)); },
    percent: {
      get: () => state.get() / maximum,
      peek: () => state.peek() / maximum,
      subscribe: listener => state.subscribe((value, previous) => listener(value / maximum, previous / maximum)),
    },
  };
}

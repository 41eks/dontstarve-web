import { createSignal, type ReadonlySignal, type Signal } from './signal';

export interface StatState extends Signal<number> {
  readonly maximum: number;
  /** Derived read-only ratio; no second copy of the value is stored. */
  readonly percent: ReadonlySignal<number>;
}

/** Character stats are finite and clamped to their supported range. */
export function createStatState(initialValue: number, maximum: number, name: string): StatState {
  if (!Number.isFinite(maximum) || maximum <= 0) throw new RangeError(`Maximum ${name.toLowerCase()} must be positive and finite`);
  const normalize = (value: number) => {
    if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
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

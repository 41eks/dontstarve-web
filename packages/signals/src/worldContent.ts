import { watchSignal, type ReadonlySignal, type Signal } from './signal';
import type { SeasonState, WorldPhase } from './world';
import type { GameTimeScheduler } from './gameTimeScheduler';

/** Named world inputs; compatible with erasableSyntaxOnly. */
export const WorldContentKey = {
  Cycle: 'cycle', Season: 'season', Temperature: 'temperature', Wind: 'wind', PerishClock: 'perishTick', SnowLevel: 'snowLevel',
} as const;
export type WorldContentKey = typeof WorldContentKey[keyof typeof WorldContentKey];

export interface WorldContentValues {
  cycle: WorldPhase;
  season: SeasonState;
  temperature: number;
  wind: WorldWindChange;
  perishTick: PerishTick;
  snowLevel: number;
}

export interface WorldWindChange { readonly angle: number; readonly velocity: number; }
export interface PerishTick { readonly time: number; readonly total: number; }
/** Live and historical prefix queries are separate from the last published snapshot. */
export interface PerishClock {
  GetTick(time?: number): PerishTick;
  /** Frozen perishables do not decay during recorded intervals below freezing. */
  GetFrozenTick?(time?: number): PerishTick;
}

export type WorldContentSources = { readonly [K in WorldContentKey]: ReadonlySignal<WorldContentValues[K]> };

export type WorldContentEnvironment = WorldContentSources & {
  readonly scheduler: GameTimeScheduler;
  /** Standalone contexts may omit the world prefix service. */
  readonly perishClock?: PerishClock;
};

/** The signal belongs to the consumer; the scheduler remains owned by the world. */
export interface WorldContentSignal<T> extends Signal<T> {
  readonly scheduler: GameTimeScheduler;
  readonly perishClock?: PerishClock;
}

/** Bound to world sources, never to a consumer's cleanup or local signals. */
export type GetWatchWorldContent = <K extends WorldContentKey>(
  key: K, registerCleanup: (stop: () => void) => void,
) => WorldContentSignal<WorldContentValues[K]>;

/** Shared contract for the application world and prefab world context. */
export interface WorldContentContext extends WorldContentEnvironment {
  readonly getWatchWorldContent: GetWatchWorldContent;
}

let currentWorld: WorldContentEnvironment | undefined;

/** The world owns the sources. Disposing an older world cannot unbind a newer world. */
export function bindWorldContent(sources: WorldContentEnvironment): () => void {
  currentWorld = sources;
  return () => { if (currentWorld === sources) currentWorld = undefined; };
}

/** Standalone contexts without a world binding can skip world-driven behaviour. */
export function isWorldContentBound(): boolean { return currentWorld !== undefined; }

/** The bound world's getter for consumers that take world content as a parameter; undefined when standalone. */
export function getBoundWatchWorldContent(): GetWatchWorldContent | undefined {
  const world = currentWorld;
  return world ? (key, registerCleanup) => getWatchWorldContent(key, registerCleanup, world) : undefined;
}

/** A key resolves to a shared world input; each caller receives its own lifecycle-managed signal. */
export function getWatchWorldContent<K extends WorldContentKey>(
  key: K, registerCleanup: (stop: () => void) => void,
  sources?: WorldContentEnvironment,
): WorldContentSignal<WorldContentValues[K]> {
  const world = sources ?? currentWorld;
  if (!world) throw new Error(`World content ${key} is not bound`);
  const signals: WorldContentSources = world;
  const source = signals[key];
  if (!source) throw new Error(`World content ${key} is not bound`);
  if (!world.scheduler) throw new Error('World scheduler is not bound');
  const local = watchSignal<WorldContentValues[K]>(source, registerCleanup);
  return Object.defineProperties(local, {
    scheduler: { value: world.scheduler, enumerable: true },
    perishClock: { value: world.perishClock, enumerable: true },
  }) as WorldContentSignal<WorldContentValues[K]>;
}

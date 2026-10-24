import { createSignal, readonlySignal, watchSignal, type Memo, type ReadonlySignal, type Signal } from './signal';
import type { SeasonState, WorldPhase, WorldMoonPhase } from './world';
import type { GameTimeScheduler } from './gameTimeScheduler';
import type { Quaternion, Vector3 } from 'three';

/** Named world inputs; compatible with erasableSyntaxOnly. */
export const WorldContentKey = {
  Cycle: 'cycle', Moon: 'moon', Season: 'season', Temperature: 'temperature', Wind: 'wind', PerishClock: 'perishTick', SnowLevel: 'snowLevel',
  PlayerPositions: 'playerpositions', CameraRotation: 'camerarotation',
  Moisture: 'moisture', MoistureCeil: 'moistureceil', MoistureFloor: 'moisturefloor', PrecipType: 'preciptype',
  PeakPrecipitationRate: 'peakprecipitationrate', PrecipitationRate: 'precipitationRate', RainRate: 'rainRate', SnowRate: 'snowRate', SnowCover: 'snowCover',
} as const;
export type WorldContentKey = typeof WorldContentKey[keyof typeof WorldContentKey];

export interface WorldContentValues {
  cycle: WorldPhase;
  moon: WorldMoonState;
  season: SeasonState;
  temperature: number;
  wind: WorldWindChange;
  perishTick: PerishTick;
  snowLevel: number;
  /** weather.lua moisture state: moisture, its randomized ceiling and floor, and the precipitation they select. */
  moisture: number;
  moistureceil: number;
  moisturefloor: number;
  preciptype: WorldPrecipitationType;
  peakprecipitationrate: number;
  precipitationRate: number;
  rainRate: number;
  snowRate: number;
  snowCover: number;
  playerpositions: Vector3[];
  /** Camera world orientation, republished only when it changes; billboards copy it instead of polling the camera. */
  camerarotation: Quaternion;
}

/** Dry-weather sources for standalone worlds and fixtures that have no Weather component. */
export function createIdleWeatherSources() {
  return {
    moisture: readonlySignal(createSignal(0)), moistureceil: readonlySignal(createSignal(0)), moisturefloor: readonlySignal(createSignal(0)),
    preciptype: readonlySignal(createSignal<WorldPrecipitationType>('none')), peakprecipitationrate: readonlySignal(createSignal(1)),
    precipitationRate: readonlySignal(createSignal(0)), rainRate: readonlySignal(createSignal(0)), snowRate: readonlySignal(createSignal(0)),
    snowCover: readonlySignal(createSignal(0)),
  } satisfies Pick<WorldContentSources, 'moisture' | 'moistureceil' | 'moisturefloor' | 'preciptype' | 'peakprecipitationrate'
    | 'precipitationRate' | 'rainRate' | 'snowRate' | 'snowCover'>;
}

export type WorldPrecipitationType = 'none' | 'rain' | 'snow';

/** Publish moonphase and iswaxingmoon together, without an intermediate mixed pair. */
export interface WorldMoonState { readonly phase: WorldMoonPhase; readonly waxing: boolean; }

export interface WorldWindChange { readonly angle: number; readonly velocity: number; }
export interface PerishTick { readonly time: number; readonly total: number; }
/** Live and historical prefix queries are separate from the last published snapshot. */
export interface PerishClock {
  GetTick(time?: number): PerishTick;
  /** Frozen perishables do not decay during recorded intervals below freezing. */
  GetFrozenTick?(time?: number): PerishTick;
}

export type WorldContentSources = { readonly [K in WorldContentKey]: ReadonlySignal<WorldContentValues[K]> };

/**
 * The world binds player positions once; consumers query a cached memo that follows their own tile key
 * (a number from tileManager's TileTracker), so moving inside one tile never notifies it.
 */
export type TileStateQuery = (tile: ReadonlySignal<number>, radius?: number) => Memo<boolean> | undefined;

export type WorldContentEnvironment = WorldContentSources & {
  readonly scheduler: GameTimeScheduler;
  /** Standalone contexts may omit the world prefix service. */
  readonly perishClock?: PerishClock;
  /** Standalone contexts may omit tile activity. The world owns its cache and cleanup. */
  readonly tickingarea?: TileStateQuery;
};

/** The signal belongs to the consumer; the scheduler remains owned by the world. */
export interface WorldContentSignal<T> extends Signal<T> {
  readonly scheduler: GameTimeScheduler;
  readonly perishClock?: PerishClock;
  /** The tickingarea memo that gates this signal (see WatchWorldContentOptions.tracker); the consumer's own to watch. */
  readonly area?: ReadonlySignal<boolean>;
}

export interface WatchWorldContentOptions {
  /**
   * The consumer's own tile key signal (TileTracker.tile), which the entity refreshes itself. While its tickingarea
   * memo is false the returned signal holds its last value and does not subscribe to the world source; it resyncs
   * when the area becomes active again. The memo is keyed by this signal, so keep it private to the consumer: its
   * cleanup releases the memo. Standalone worlds or tiles outside the grid have no memo and stay subscribed.
   */
  readonly tile?: ReadonlySignal<number>;
}

/** Player snapshots published by the world: a consumer's private signal whose value is a `Vector3[]`. */
export type PlayerPositionsSignal = WorldContentSignal<WorldContentValues['playerpositions']>;

/** Bound to world sources, never to a consumer's cleanup or local signals. */
export type GetWatchWorldContent = <K extends WorldContentKey>(
  key: K, registerCleanup: (stop: () => void) => void, options?: WatchWorldContentOptions,
) => WorldContentSignal<WorldContentValues[K]>;

/** Shared contract for the application world and prefab world context. */
export interface WorldContentContext extends WorldContentEnvironment {
  readonly getWatchWorldContent: GetWatchWorldContent;
  readonly tickingarea: TileStateQuery;
}

let currentWorld: WorldContentEnvironment | undefined;

/** The world owns the sources. Disposing an older world cannot unbind a newer world. */
export function bindWorldContent(sources: WorldContentEnvironment): () => void {
  currentWorld = sources;
  return () => { if (currentWorld === sources) currentWorld = undefined; };
}

/** Standalone contexts without a world binding can skip world-driven behaviour. */
export function isWorldContentBound(): boolean { return currentWorld !== undefined; }

/** Resolve the current world's query without passing its player position source to prefabs. */
export function GetTileStateAtPoint(tile: ReadonlySignal<number>, radius = 10): Memo<boolean> | undefined {
  const query = currentWorld?.tickingarea;
  if (!query) throw new Error('World tile activity is not bound');
  return query(tile, radius);
}

/** The bound world's getter for consumers that take world content as a parameter; undefined when standalone. */
export function getBoundWatchWorldContent(): GetWatchWorldContent | undefined {
  const world = currentWorld;
  return world ? (key, registerCleanup, options) => getWatchWorldContent(key, registerCleanup, world, options) : undefined;
}

/** A key resolves to a shared world input; each caller receives its own lifecycle-managed signal. */
export function getWatchWorldContent<K extends WorldContentKey>(
  key: K, registerCleanup: (stop: () => void) => void,
  sources?: WorldContentEnvironment, options?: WatchWorldContentOptions,
): WorldContentSignal<WorldContentValues[K]> {
  const world = sources ?? currentWorld;
  if (!world) throw new Error(`World content ${key} is not bound`);
  const signals: WorldContentSources = world;
  const source = signals[key];
  if (!source) throw new Error(`World content ${key} is not bound`);
  if (!world.scheduler) throw new Error('World scheduler is not bound');
  const area = options?.tile ? world.tickingarea?.(options.tile) : undefined;
  const local = watchSignal<WorldContentValues[K]>(source,
    area ? stop => registerCleanup(() => { stop(); area.dispose(); }) : registerCleanup, area);
  return Object.defineProperties(local, {
    scheduler: { value: world.scheduler, enumerable: true },
    perishClock: { value: world.perishClock, enumerable: true },
    ...(area ? { area: { value: area, enumerable: true } } : {}),
  }) as WorldContentSignal<WorldContentValues[K]>;
}
